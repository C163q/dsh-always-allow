import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PermissionRulesRuntime, resolveConfig } from 'dsh-permission-rules'
import { Context } from '@deepseek-ai/cordis'
import { createEscalationListener } from '../src/escalation.js'
import { renderRule } from '../src/rules-file.js'

async function fixture(t) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/aa-security-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const file = join(cwd, 'rules.yaml')
  const { createGrantStore } = await import('../src/grants.js')
  const grantStore = createGrantStore(join(root, 'private/grants.json'))
  const grant = { cwd, file, tool: 'bash', prefix: 'git status' }
  const grantId = await grantStore.issue(grant)
  const block = renderRule({ command: 'git', args: ['status'] }, 'saved', ['bash'], { autoApproveEscalation: true, grantId })
  await writeFile(file, `rules:\n${block}\n`)
  const engine = new PermissionRulesRuntime(new Context(), resolveConfig({ rulesFile: file, watch: false, builtin: { enabled: false }, network: { enabled: false, injectEnv: false } }))
  const agent = { session: { header: { id: 's1', cwd, origin: 'main' } } }
  const exec = { agent, name: 'bash', callId: 'c1', arguments: { command: 'git status --short', sandbox_permissions: 'danger-full-access', justification: 'test' }, signal: new AbortController().signal }
  const record = { exec, gate: 'allow', dispatching: true }
  const calls = new Map([[JSON.stringify(['s1', 'c1']), record]])
  const listener = createEscalationListener({ enabled: () => true, calls, runtime: () => engine, rulesFile: () => file, verifyGrant: grantStore.verify })
  const req = { agent, toolName: 'bash', callId: 'c1', reason: 'escalate sandbox to danger-full-access: test', signal: exec.signal }
  return { root, cwd, file, grantStore, grant, block, engine, exec, record, calls, listener, req, ask: () => listener(req, async () => 'human') }
}

test('a recorded explicit grant approves a live escalation without decision audit logs', async t => {
  const f = await fixture(t)
  assert.equal(await f.ask(), 'allowed-once')
})

test('earlier deny and ask take precedence over a recorded allow', async t => {
  const f = await fixture(t)
  for (const action of ['deny', 'ask']) {
    await writeFile(f.file, `rules:\n  - match: {tools: [bash]}\n    action: ${action}\n    reason: first\n${f.block}\n`)
    assert.equal(await f.ask(), 'human', action)
  }
})

test('revocation, malformed rules and disabled enforcement fail closed without watcher delay', async t => {
  const f = await fixture(t)
  assert.equal(await f.ask(), 'allowed-once')
  await writeFile(f.file, 'rules: []\n')
  assert.equal(await f.ask(), 'human')
  await writeFile(f.file, 'rules: [')
  assert.equal(await f.ask(), 'human')
  await writeFile(f.file, `rules:\n${f.block}\n`)
  f.engine.setConfigSource(() => resolveConfig({ rulesFile: f.file, enforce: false }))
  assert.equal(await f.ask(), 'human')
})

test('ordinary rules, forged tags and grants copied across prefixes do not grant host access', async t => {
  const f = await fixture(t)
  for (const text of [
    'rules:\n - match: {tools: [bash]}\n   action: allow\n   reason: old\n',
    `rules:\n${f.block.replace(/grant\/[^"\s,\]]+/, 'grant/' + '0'.repeat(64))}\n`,
    `rules:\n${f.block.replaceAll('git status', 'git push')}\n`,
  ]) {
    await writeFile(f.file, text)
    assert.equal(await f.ask(), 'human')
  }
  f.exec.arguments.command = 'git push'
  assert.equal(await f.ask(), 'human')
})

test('wrong agent/tool/reason/mode and stale or cancelled calls are delegated', async t => {
  const f = await fixture(t)
  for (const override of [
    { agent: { session: f.req.agent.session } }, { toolName: 'pwsh' }, { callId: 'other' },
    { reason: 'ordinary ask' }, { reason: 'escalate sandbox to workspace-write: test' },
    { reason: 'escalate sandbox to danger-full-access: forged' },
  ]) assert.equal(await f.listener({ ...f.req, ...override }, async () => 'human'), 'human')
  for (const command of ['git push status', 'git status; id', 'git status\nid', 'echo hi | git status']) {
    f.exec.arguments.command = command
    assert.equal(await f.ask(), 'human', command)
  }
  f.exec.arguments.command = 'git status'
  for (const state of [{ dispatching: false }, { gate: 'ask' }, { gate: 'deny' }]) {
    const old = { ...f.record }; Object.assign(f.record, state)
    assert.equal(await f.ask(), 'human'); Object.assign(f.record, old)
  }
  const controller = new AbortController(); controller.abort()
  f.req.signal = controller.signal
  assert.equal(await f.ask(), 'human')
  f.calls.clear()
  assert.equal(await f.ask(), 'human')
})

test('missing engine or opt-in never approves', async t => {
  const f = await fixture(t)
  for (const deps of [{ enabled: () => false }, { runtime: () => undefined }]) {
    const listener = createEscalationListener({ enabled: () => true, runtime: () => f.engine, calls: f.calls, verifyGrant: f.grantStore.verify, rulesFile: () => f.file, ...deps })
    assert.equal(await listener(f.req, async () => 'human'), 'human')
  }
})

test('grants cannot be forged, moved to another workspace or recorded with a workspace-local ledger', async t => {
  const f = await fixture(t)
  const grantId = await f.grantStore.issue(f.grant)
  assert.equal(f.grantStore.verify(f.grant, grantId), true)
  assert.equal(f.grantStore.verify({ ...f.grant, prefix: 'git push' }, grantId), false)
  assert.equal(f.grantStore.verify({ ...f.grant, cwd: '/elsewhere' }, grantId), false)
  const { createGrantStore } = await import('../src/grants.js')
  const unsafe = createGrantStore(join(f.cwd, 'ledger.json'))
  assert.throws(() => unsafe.issue(f.grant), /workspace/)
  assert.equal(unsafe.verify(f.grant, grantId), false)
  const secret = await readFile(join(f.root, 'private/grants.json'))
  assert.equal(JSON.parse(secret).version, 1)
})

test('host authorization cannot be stored in platform temporary writable roots', async t => {
  const f = await fixture(t)
  const { createGrantStore } = await import('../src/grants.js')
  const unsafe = createGrantStore(join(tmpdir(), `aa-ledger-${Date.now()}.json`))
  assert.throws(() => unsafe.issue(f.grant), /writable|temporary/)
  assert.equal(unsafe.verify(f.grant, 'forged-id'), false)
})

test('live compile-option changes cannot reuse a cached allow', async t => {
  const f = await fixture(t)
  assert.equal(await f.ask(), 'allowed-once')
  f.engine.setConfigSource(() => resolveConfig({ rulesFile:f.file, patternMode:'regex', builtin:{enabled:false} }))
  assert.equal(await f.ask(), 'human')
})

test('an explicit new grant works after an older ordinary allow without reordering policy', async t => {
  const f = await fixture(t)
  await writeFile(f.file, `rules:\n  - match: {tools: [bash], argv: {command: git, args: [status]}}\n    action: allow\n    reason: legacy\n${f.block}\n`)
  assert.equal(await f.ask(), 'allowed-once')
  await writeFile(f.file, 'rules:\n  - match: {tools: [bash], argv: {command: git, args: [status]}}\n    action: allow\n    reason: legacy\n')
  assert.equal(await f.ask(), 'human', 'removing the explicit grant rule revokes automatic host access')
})
