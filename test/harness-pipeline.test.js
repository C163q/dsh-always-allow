import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import Approval, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import { PermissionRulesRuntime, resolveConfig } from 'dsh-permission-rules'
import * as plugin from '../src/index.js'

test('the published Harness pipeline preserves explicit grants, policy ordering, and approval policy', async t => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/aa-pipeline-'))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'host-home')
  const app = new Context()
  t.after(async () => {
    await app.fiber.dispose()
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(root, { recursive: true, force: true })
  })
  await app.plugin(SessionStore)
  await app.plugin(SessionProjections)
  await app.plugin(SystemPrompt)
  await app.plugin(Tools)
  await app.plugin(Approval)
  let route
  app.provide('webServer', { register(value) { route = value; return () => { route = undefined } } })
  app.provide('connection', { requestRejection: req => req.headers.cookie === 'trusted' ? undefined : 401 })
  const file = join(cwd, 'rules.yaml')
  const engine = new PermissionRulesRuntime(app, resolveConfig({
    rulesFile: file, watch: false, builtin: { enabled: false }, network: { enabled: false, injectEnv: false },
  }))
  app.provide('permissionRulesRuntime', engine)
  app.on('tools/pre-execute', (exec, next) => engine.preExecute(exec, next))
  let humanCalls = 0
  let humanAnswer = async () => 'rejected'
  app.on('approval/request', req => { humanCalls++; return humanAnswer(req) })
  const owner = app.plugin(plugin, { rulesFile: file, autoApproveEscalation: true })
  await owner
  const session = app.sessions.create(undefined, { meta: { cwd } })
  session.append('turn/start', { turn: 1 })
  const agent = { session }
  const approvals = []
  app.on('session/event', (subject, event) => {
    if (subject === session && (event.type === 'approval/asked' || event.type === 'approval/decided')) approvals.push(event)
  })
  let executions = 0
  app.tools.register({
    name: 'bash', description: 'In-memory escalation probe; never starts a shell',
    parameters: { type: 'object' },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const mode = await approveEscalation({
        requestedMode: args.sandbox_permissions, justification: args.justification,
        effectiveMode: 'workspace-write', subject: 'command',
      }, { approver: app.approval, agent: exec.agent, callId: exec.callId, toolName: exec.name, signal: exec.signal })
      executions++
      return mode
    },
  })
  const pipeline = new ToolExecutionPipeline(app)
  let callId = 0
  const run = async command => {
    const prepared = await pipeline.prepare({
      name: 'bash', callId: `pipeline-${++callId}`, agent, signal: new AbortController().signal,
      arguments: { command, sandbox_permissions: 'danger-full-access', justification: 'pipeline regression' },
    })
    const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
    return pipeline.complete(prepared.exec, outcome)
  }
  const request = async (endpoint, body) => {
    let response
    await route.handler({
      method: 'POST', url: `/always-allow/${endpoint}`, headers: { cookie: 'trusted' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
    }, {
      writeHead(status) { response = { status } },
      end(text) { response.body = JSON.parse(text) },
    })
    assert.equal(response.status, 200)
    return response.body
  }
  humanAnswer = async req => {
    const identity = { sessionId: session.header.id, callId: req.callId }
    const proposal = await request('propose', identity)
    assert.equal(proposal.ok, true)
    assert.equal(proposal.hostAccess, true)
    assert.equal((await request('save', { ...identity, approvalToken: proposal.approvalToken, allowHost: true })).ok, true)
    return 'allowed-once'
  }
  assert.equal((await run('git status --short')).value, 'danger-full-access')
  assert.equal(humanCalls, 1)
  assert.equal((await run('git status --porcelain')).value, 'danger-full-access')
  assert.equal(humanCalls, 1, 'the repeat must not reach the human answerer')
  humanAnswer = async () => 'rejected'
  assert.equal((await run('git diff --stat')).isError, true)
  assert.equal(humanCalls, 2, 'a different prefix still needs consent')
  const saved = await readFile(file, 'utf8')
  await writeFile(file, 'rules:\n  - match: { tools: [bash] }\n    action: deny\n    reason: earlier denial\n' + saved.slice(saved.indexOf('\n') + 1))
  engine.reload(cwd)
  assert.equal(engine.rulesFor(cwd).compiled.rules[0].action, 'deny')
  assert.equal((await run('git status --short')).isError, true)
  assert.equal(humanCalls, 2, 'deny must stop before approval')
  await writeFile(file, saved)
  engine.reload(cwd)
  setApprovalPolicy(session, 'never')
  assert.equal((await run('git status --short')).isError, true)
  assert.equal(humanCalls, 2)
  assert.equal(executions, 2, 'neither deny nor never may execute the authorized body')
  const asked = approvals.filter(event => event.type === 'approval/asked')
  const decided = approvals.filter(event => event.type === 'approval/decided')
  assert.equal(asked.length, 4)
  assert.deepEqual(decided.map(event => event.data.outcome), ['allowed-once', 'allowed-once', 'rejected', 'rejected'])
  assert.deepEqual(asked.map(event => event.data.id), decided.map(event => event.data.id))
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await owner.dispose()
  assert.equal(route, undefined)
})
