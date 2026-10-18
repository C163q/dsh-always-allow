import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { PermissionRulesRuntime, resolveConfig } from 'dsh-permission-rules'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import * as plugin from '../src/index.js'

async function setup(t, config = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/aa-integration-'))
  const cwd = join(root,'workspace'); await mkdir(cwd)
  const home = join(root,'home')
  const oldHome = process.env.DSH_HOME; process.env.DSH_HOME = home
  t.after(async () => { if(oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=oldHome; await rm(root,{recursive:true,force:true}) })
  const app = new Context()
  const routes = []
  app.provide('webServer', { register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route),1) } })
  app.provide('connection', {requestRejection: req => req.headers.cookie === 'trusted' ? undefined : 401})
  const file = join(cwd,'rules.yaml')
  const engine = new PermissionRulesRuntime(app, resolveConfig({ rulesFile:file, watch:false, builtin:{enabled:false}, network:{enabled:false, injectEnv:false} }))
  app.provide('permissionRulesRuntime',engine)
  app.on('tools/pre-execute',(exec,next)=>engine.preExecute(exec,next))
  const fiber = app.plugin({name:plugin.name, inject:plugin.inject, apply:plugin.apply}, {rulesFile:file,autoApproveEscalation:true,...config})
  await fiber
  t.after(()=>fiber.dispose())
  const agent = {session:{header:{id:'s1',cwd,origin:'main'}}}
  const exec = {agent,callId:'c1',name:'bash',arguments:{command:'git status --short', sandbox_permissions:'danger-full-access',justification:'test'},signal:new AbortController().signal}
  const req = {agent,callId:'c1',toolName:'bash',reason:'escalate sandbox to danger-full-access: test',signal:exec.signal}
  const flow = (event, value, next) => app.waterfall(scopeTarget(agent,agent),event,value,next)
  const route = routes[0]
  async function http(endpoint,body,headers={cookie:'trusted'}) {
    let result
    await route.handler({method:'POST',url:'/always-allow/'+endpoint,headers,async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body))}}, {writeHead(status){result={status}},end(text){result.body=JSON.parse(text)}})
    return result
  }
  return {app,root,cwd,home,file,engine,exec,req,flow,http,agent}
}
const identity = {sessionId:'s1',callId:'c1'}
const settle = async () => { for(let i=0;i<12;i++) await Promise.resolve() }

async function pendingApproval(f) {
  let answer
  const response = f.flow('approval/request',f.req,()=>new Promise(resolve=>{answer=resolve}))
  await settle()
  return {response,answer}
}

test('saving a live scoped approval enables the next matching escalation before browser forwarding',async t=>{
  const f=await setup(t)
  await f.flow('tools/pre-execute',f.exec,async()=>({kind:'allow'}))
  await f.flow('tools/execute',f.exec,async()=>{
    const pending=await pendingApproval(f)
    const p=await f.http('propose',identity)
    assert.equal(p.body.ok,true)
    assert.equal(p.body.hostAccess,true)
    const save=await f.http('save',{...identity,approvalToken:p.body.approvalToken,allowHost:true})
    assert.equal(save.body.ok,true)
    assert.match(await readFile(f.file,'utf8'),/dsh-always-allow\/v1\/danger-full-access/)
    pending.answer('allowed-once'); assert.equal(await pending.response,'allowed-once')
    return {}
  })
  assert.equal((await f.http('propose',identity)).body.ok,false)
  f.exec.callId='c2'; f.req.callId='c2'
  await f.flow('tools/pre-execute',f.exec,async()=>({kind:'allow'}))
  let forwarded=false
  await f.flow('tools/execute',f.exec,async()=>{
    const outcome=await f.flow('approval/request',f.req,async()=>{forwarded=true;return 'human'})
    assert.equal(outcome,'allowed-once'); return {}
  })
  assert.equal(forwarded,false)
})

test('tracked calls alone do not permit saving and answered approvals expire',async t=>{
  const f=await setup(t)
  await f.flow('tools/pre-execute',f.exec,async()=>({kind:'allow'}))
  assert.equal((await f.http('propose',identity)).body.ok,false)
  const p=await pendingApproval(f)
  const proposal=(await f.http('propose',identity)).body
  p.answer('rejected'); await p.response
  assert.equal((await f.http('save',{...identity,approvalToken:proposal.approvalToken,allowHost:true})).body.ok,false)
  await assert.rejects(readFile(f.file),/ENOENT/)
})

test('the pre-execute tracker preserves an earlier ask or deny',async t=>{
  const f=await setup(t)
  await writeFile(f.file,'rules:\n - match: {tools: [bash]}\n   action: ask\n   reason: confirmation\n')
  assert.equal((await f.flow('tools/pre-execute',f.exec,async()=>({kind:'allow'}))).kind,'ask')
  const p=await pendingApproval(f)
  assert.equal((await f.http('propose',identity)).body.ok,true)
  p.answer('rejected');await p.response
})

test('missing authentication service fails closed and an untrusted request never writes',async t=>{
  const f=await setup(t)
  assert.equal((await f.http('save',identity,{})).status,401)
  const app=new Context();let route
  app.provide('webServer',{register(value){route=value;return()=>{}}})
  await app.plugin({name:plugin.name,inject:plugin.inject,apply:plugin.apply})
  let status
  await route.handler({method:'POST',headers:{}},{writeHead(value){status=value},end(){}})
  assert.equal(status,503)
})

test('same call id in another session cannot read or spend an approval',async t=>{
  const f=await setup(t)
  await f.flow('tools/pre-execute',f.exec,async()=>({kind:'allow'}))
  const p=await pendingApproval(f)
  assert.equal((await f.http('propose',{sessionId:'s2',callId:'c1'})).body.ok,false)
  p.answer('rejected');await p.response
})

test('overlapping identical call ids are quarantined until all executions finish',async t=>{
  const f=await setup(t)
  const first=f.exec
  await f.flow('tools/pre-execute',first,async()=>({kind:'allow'}))
  const second={...first,arguments:{...first.arguments,command:'printf DIFFERENT'}}
  await f.flow('tools/pre-execute',second,async()=>({kind:'allow'}))
  let answered=false
  await f.flow('tools/execute',second,async()=>{
    const p=await pendingApproval(f)
    assert.equal((await f.http('propose',identity)).body.ok,false)
    p.answer('human');assert.equal(await p.response,'human');answered=true
    return {}
  })
  assert.equal(answered,true)
  await f.app.waterfall(scopeTarget(f.agent,f.agent),'tools/post-execute',first,{},async()=>({kind:'accept'}))
})
