/** Live shell-approval tracking, host authorization, and authenticated rule persistence. */
import { randomUUID } from 'node:crypto'
import { constants, existsSync, lstatSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { mkdir, open, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { compileRules, parseRulesDocument } from 'dsh-permission-rules'
import { resolveConfig } from './config.js'
import { commandOf } from './prefix.js'
import { dispatch } from './endpoints.js'
import { insertRule } from './rules-file.js'
import { callKey, createEscalationListener, isEscalation } from './escalation.js'
import { createGrantStore } from './grants.js'

export const name = 'dsh-always-allow'
export const CHANNEL = '/always-allow'
// Optional services are read per request. Missing admission/engine services fail closed.
export const inject = ['webServer']

/** Atomic, serialized writes; reject stale approvals and concurrent edits before commit. */
export function createAppender() {
  let chain = Promise.resolve()
  return (file, ruleText, options = {}) => {
    const task = async () => {
      if (existsSync(file) && !lstatSync(file).isFile()) throw new Error('rules file must be a regular file')
      let existing = ''
      try { existing = await readFile(file, 'utf8') } catch (error) { if (error?.code !== 'ENOENT') throw error }
      if (Buffer.byteLength(existing) > 1024 * 1024) throw new Error('rules file exceeds 1 MiB')
      const next = insertRule(existing, ruleText)
      options.validate?.(next)
      await mkdir(dirname(file), {recursive:true,mode:0o700})
      const temp = join(dirname(file), `.always-allow.${randomUUID()}.tmp`)
      const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      try { await handle.writeFile(next,'utf8'); await handle.sync() } finally { await handle.close() }
      try {
        let latest = ''
        try { latest = readFileSync(file,'utf8') } catch (error) { if(error?.code !== 'ENOENT') throw error }
        if (readFileSync(temp, 'utf8') !== next) throw new Error('staged rules changed while saving; retry')
        if (latest !== existing) throw new Error('rules file changed while saving; retry')
        options.beforeCommit?.()
        // Synchronous commit keeps withdrawal and authorization in the same event-loop turn.
        renameSync(temp, file)
      } finally { if (existsSync(temp)) unlinkSync(temp) }
      return file
    }
    const run = chain.then(task,task)
    chain = run.catch(() => {}) // A failed save must not poison later saves.
    return run
  }
}

/** Reject agentless calls rather than assigning them to the host process workspace. */
export function cwdOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

async function readJson(req, maxBytes) {
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (body === null || Array.isArray(body) || typeof body !== 'object') throw new Error('expected a JSON object')
  return body
}

/** Install global listeners on the plugin context so scoped tool and approval dispatch reaches them. */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const appendRule = createAppender()
  const calls = new Map()
  const records = new WeakMap()
  const liveByKey = new Map()
  const pending = new Map()
  const grants = createGrantStore(join(resolve(process.env.DSH_HOME || join(homedir(),'.dsh')), 'always-allow', 'grants.json'))
  const runtime = () => ctx.get('permissionRulesRuntime')
  const keyOf = exec => callKey(exec.agent?.session?.header?.id, exec.callId)
  const exclude = (key, record) => {
    if (calls.get(key) === record) calls.delete(key)
    const entry = pending.get(key)
    if (entry?.record === record) { entry.active = false; pending.delete(key) }
  }
  const remove = (key, record) => {
    if (record === undefined || !record.alive) return
    record.alive = false
    exclude(key,record)
    records.delete(record.exec)
    record.exec.signal?.removeEventListener('abort', record.onAbort)
    const group = liveByKey.get(key)
    group?.delete(record)
    if (group?.size === 0) liveByKey.delete(key)
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    const key = keyOf(exec)
    if (typeof exec.agent?.session?.header?.id !== 'string' || cwdOf(exec.agent) === undefined
      || typeof exec.callId !== 'string' || commandOf(exec.name,exec.arguments,resolved.toolNames) === undefined) return next()
    const group = liveByKey.get(key) ?? new Set()
    const record = {exec,gate:undefined,dispatching:false,alive:true,onAbort:()=>remove(key,record)}
    if (group.size > 0) {
      // The approval API carries no execution token. Do not guess which duplicate asked.
      for (const previous of group) exclude(key,previous)
    } else {
      calls.set(key,record)
    }
    group.add(record)
    liveByKey.set(key,group)
    records.set(exec,record)
    exec.signal?.addEventListener('abort',record.onAbort,{once:true})
    if (exec.signal?.aborted) remove(key,record)
    while (calls.size > resolved.maxTracked) { const oldest = calls.keys().next().value; exclude(oldest,calls.get(oldest)) }
    try {
      const decision = await next()
      record.gate = decision.kind
      if (decision.kind !== 'allow' && decision.kind !== 'ask') remove(key,record)
      return decision
    } catch (error) { remove(key,record); throw error }
  }, {prepend:true})
  ctx.on('tools/execute', async (exec,next) => {
    const key = keyOf(exec)
    const record = records.get(exec)
    if (record === undefined) return next()
    record.dispatching = true
    try { return await next() } finally { remove(key,record) }
  }, {prepend:true})
  ctx.on('tools/post-execute', (exec,_result,next) => {
    const key = keyOf(exec); const record = records.get(exec)
    remove(key,record)
    return next()
  })
  const autoApprove = createEscalationListener({
    enabled:()=>resolveConfig(config).autoApproveEscalation,
    calls,runtime,rulesFile:()=>resolved.rulesFile,verifyGrant:grants.verify,
  })
  ctx.on('approval/request', (req,next) => autoApprove(req, async () => {
    const key = callKey(req.agent?.session?.header?.id,req.callId)
    const record = calls.get(key)
    const exec = record?.exec
    if (exec === undefined || req.agent !== exec.agent || req.toolName !== exec.name
      || req.signal?.aborted || exec.signal?.aborted || pending.has(key)) return next()
    const command = commandOf(exec.name,exec.arguments,resolved.toolNames)
    if (typeof command !== 'string') return next()
    const entry = {
      token:randomUUID(),active:true,record,command,cwd:cwdOf(exec.agent),tool:exec.name,signal:req.signal,
      hostAccess:resolveConfig(config).autoApproveEscalation && isEscalation(req,exec),
      isCurrent:()=>calls.get(key) === record && exec.arguments?.command === command && cwdOf(exec.agent) === entry.cwd,
    }
    pending.set(key,entry)
    try { return await next() } finally { entry.active=false; if(pending.get(key)===entry) pending.delete(key) }
  }), {prepend:true})
  ctx.effect(() => () => {
    for (const [key,group] of liveByKey) for (const record of group) remove(key,record)
    pending.clear()
  }, 'always-allow: cleanup')
  ctx.effect(() => ctx.get('webServer').register({
    kind:'prefix',path:CHANNEL,
    handler:async (req,res) => {
      const send = (status,value) => {
        res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'})
        res.end(JSON.stringify(value))
      }
      try {
        const connection = ctx.get('connection')
        if (typeof connection?.requestRejection !== 'function') { send(503,{ok:false,code:'unavailable',message:'authentication service unavailable'}); return }
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) { send(rejection,{ok:false,code:'unauthorized',message:'not authorized'}); return }
        if (req.method !== 'POST') { send(405,{ok:false,code:'method',message:'POST only'}); return }
        const engine = runtime()
        if (engine === undefined || engine.config.enforce !== true) { send(503,{ok:false,code:'unavailable',message:'enabled permission-rules enforcement is required'}); return }
        if (resolve(engine.config.rulesFile) !== resolve(resolved.rulesFile) && engine.config.rulesFile !== resolved.rulesFile) {
          send(503,{ok:false,code:'unavailable',message:'permission-rules rulesFile differs from always-allow'}); return
        }
        const endpoint = new URL(req.url ?? '/', 'http://localhost').pathname.slice(CHANNEL.length+1)
        const body = await readJson(req,resolved.maxBodyBytes)
        send(200,await dispatch({
          pending,rulesFile:resolved.rulesFile,patternMode:engine.config.patternMode,appendRule,
          authorizeGrant:grants.issue,grantId:grants.idFor,
          validate:text=>compileRules(parseRulesDocument(text),engine.config),
          reload:cwd=>engine.reload(cwd),
        },endpoint,body))
      } catch (error) {
        send(400,{ok:false,code:'invalid',message:error instanceof Error ? error.message : String(error)})
      }
    },
  }), 'always-allow: route')
}
