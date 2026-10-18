import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatch } from '../src/endpoints.js'
import { callKey } from '../src/escalation.js'

function fixture() {
  const entry = { token: 'approval-token', active: true, command: 'git status --short', cwd: '/ws', tool: 'bash', hostAccess: true }
  const pending = new Map([[callKey('s1', 'c1'), entry]])
  const written = []
  const grants = []
  const deps = { pending, rulesFile: '.dsh/rules.yaml', patternMode: 'glob',
    appendRule: async (file, text, options) => { options.beforeCommit(); written.push({file,text}); return file },
    authorizeGrant: (grant, id) => { grants.push({grant,id}) }, reload: () => {} }
  return { entry, pending, written, grants, deps }
}
const identity = { sessionId: 's1', callId: 'c1' }

test('proposals identify the pending approval and saves require its unguessable token', async () => {
  const f = fixture()
  const proposal = await dispatch(f.deps, 'propose', identity)
  assert.equal(proposal.label, 'git status')
  assert.equal(proposal.approvalToken, 'approval-token')
  for (const body of [identity, {...identity,approvalToken:'wrong'}]) {
    assert.equal((await dispatch(f.deps, 'save', body)).ok, false)
  }
  assert.equal(f.written.length, 0)
  assert.equal(f.grants.length, 0)
  const result = await dispatch(f.deps, 'save', {...identity, approvalToken:'approval-token', allowHost:true})
  assert.equal(result.ok, true)
  assert.equal(f.written.length, 1)
  assert.equal(f.written[0].file, '/ws/.dsh/rules.yaml')
  assert.equal(f.grants[0].grant.tool, 'bash')
  assert.equal(f.grants[0].grant.prefix, 'git status')
})

test('cross-session calls, expired approvals and non-consenting host saves cannot widen permissions', async () => {
  const f = fixture()
  assert.equal((await dispatch(f.deps, 'propose', {...identity,sessionId:'s2'})).ok, false)
  assert.equal((await dispatch(f.deps, 'save', {...identity,approvalToken:'approval-token'})).ok, false)
  f.entry.active = false
  assert.equal((await dispatch(f.deps, 'propose', identity)).ok, false)
  assert.equal(f.written.length, 0)
})

test('an approval withdrawn while disk IO is pending never writes or authorizes a grant', async () => {
  const f = fixture()
  let finish
  f.deps.appendRule = async (file, text, options) => {
    await new Promise(resolve => { finish = resolve })
    options.beforeCommit()
    f.written.push({file,text})
    return file
  }
  const save = dispatch(f.deps, 'save', {...identity,approvalToken:'approval-token',allowHost:true})
  await Promise.resolve()
  f.entry.active = false
  finish()
  await assert.rejects(save, /pending/)
  assert.equal(f.written.length, 0)
  assert.equal(f.grants.length, 0)
})

test('a second concurrent save is refused and an IO failure can be retried', async () => {
  const f = fixture()
  let finish
  f.deps.appendRule = async () => { await new Promise(resolve => { finish = resolve }); throw new Error('disk full') }
  const body = {...identity,approvalToken:'approval-token',allowHost:true}
  const first = dispatch(f.deps, 'save', body)
  await Promise.resolve()
  assert.equal((await dispatch(f.deps, 'save', body)).ok, false)
  finish()
  await assert.rejects(first, /disk full/)
  assert.equal(f.entry.saving, false)
  assert.equal(f.grants.length, 0)
})


test('path saves require acknowledgement of the executable-path warning before persisting', async () => {
  const f=fixture()
  f.entry.command='bin/fff-timer-query --status'
  const proposal=await dispatch(f.deps,'propose',identity)
  assert.equal(proposal.executablePath,true)
  const body={...identity,approvalToken:f.entry.token,allowHost:true}
  assert.equal((await dispatch(f.deps,'save',body)).ok,false)
  assert.equal(f.written.length,0)
  assert.equal(f.grants.length,0)
  assert.equal((await dispatch(f.deps,'save',{...body,allowExecutablePath:true})).ok,true)
  assert.equal(f.grants[0].grant.prefix,'bin/fff-timer-query')
})
