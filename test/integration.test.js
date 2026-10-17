/**
 * Integration test: mount the real plugin in a real Cordis context.
 *
 * This is the test that would have caught the two failures this plugin was
 * written through: a route registered on a context that did not declare
 * `webServer`, and an `inject` declaration dropped by the Loader's export
 * unwrapping. Both show up here as a failed mount or a missing route.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as plugin from '../src/index.js'

const CORDIS = process.env.DSH_CORDIS_PATH
  ?? '/home/c163q/Program/fetch/deepseek-harness/vendor/cordis/lib/index.js'

/** Skip cleanly when the harness checkout is not available. */
async function loadCordis() {
  try {
    return await import(CORDIS)
  } catch {
    return undefined
  }
}

/** A fake webServer that records routes the way the real one dispatches them. */
function fakeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      if (routes.some((entry) => entry.path === route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade() { return () => {} },
  }
}

/** Drive one route the way node:http would, and resolve with the response. */
function callRoute(route, { method = 'POST', url = route.path, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = {
      method,
      url,
      async* [Symbol.asyncIterator]() { yield payload },
    }
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code },
      end(text) {
        try {
          resolve({ status: this.statusCode, body: JSON.parse(text) })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

/** A shell Tool execution the way the registry hands it to `tools/pre-execute`. */
function shellExec(callId, command, cwd) {
  return {
    callId,
    name: 'bash',
    arguments: { command },
    agent: { session: { header: { cwd, path: cwd } } },
    signal: new AbortController().signal,
  }
}

test('the plugin mounts, tracks a shell call, and serves both endpoints', async (t) => {
  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  const workspace = await mkdtemp(join(tmpdir(), 'always-allow-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const { Context } = cordis
  const app = new Context()
  const webServer = fakeWebServer()
  app.provide('webServer', webServer)
  // The route applies the Connection trust check; an always-accepting stub
  // stands in for an authenticated browser session.
  app.provide('connection', { requestRejection: () => undefined })
  app.provide('tools', {})

  // Mount exactly as the Loader does: the namespace object, whose `apply`
  // carries the inject declaration.
  const fiber = app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply })
  await fiber

  const route = webServer.routes.find((entry) => entry.path === plugin.CHANNEL)
  assert.ok(route, 'the plugin registered its own route')
  assert.equal(webServer.routes.length, 1)

  // A pre-execute listener must never tighten or loosen the decision. This
  // assertion used to expect `allow`, which encoded the bug: the plugin
  // returned its own decision instead of delegating, so in a waterfall it
  // vetoed every later listener and `permission-rules` could never deny or ask.
  // The downstream decision MUST survive.
  const decision = await app.waterfall('tools/pre-execute', shellExec('call-1', 'git status --short', workspace), () => Promise.resolve({ kind: 'ask' }))
  assert.deepEqual(decision, { kind: 'ask' }, 'the plugin delegates instead of deciding')
  const denied = await app.waterfall('tools/pre-execute', shellExec('call-2', 'rm -rf /', workspace), () => Promise.resolve({ kind: 'deny', reason: 'blocked' }))
  assert.deepEqual(denied, { kind: 'deny', reason: 'blocked' }, 'a downstream deny is not overridden')

  const proposal = await callRoute(route, { url: `${plugin.CHANNEL}/propose`, body: { callId: 'call-1' } })
  assert.equal(proposal.status, 200)
  assert.deepEqual(proposal.body, { ok: true, command: 'git', args: ['status'], label: 'git status' })

  const saved = await callRoute(route, { url: `${plugin.CHANNEL}/save`, body: { callId: 'call-1' } })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.ok, true)
  assert.equal(saved.body.value.file, join(workspace, '.dsh/rules.yaml'))

  const document = await readFile(join(workspace, '.dsh/rules.yaml'), 'utf8')
  assert.match(document, /^rules:/)
  assert.match(document, /tools: \[bash, pwsh\]/)
  assert.match(document, /command: "git"/)
  assert.match(document, /args: \["status"\]/)
  assert.match(document, /action: allow/)

  // The approval is consumed once saved.
  const again = await callRoute(route, { url: `${plugin.CHANNEL}/propose`, body: { callId: 'call-1' } })
  assert.equal(again.body.code, 'unknown-call')
})

test('a non-shell tool call is not tracked and offers no rule', async (t) => {
  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  const app = new cordis.Context()
  const webServer = fakeWebServer()
  app.provide('webServer', webServer)
  app.provide('connection', { requestRejection: () => undefined })
  app.provide('tools', {})
  await app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply })
  const route = webServer.routes[0]

  await app.waterfall('tools/pre-execute', {
    callId: 'read-1', name: 'read', arguments: { path: 'x' }, agent: undefined,
  }, () => Promise.resolve({ kind: 'allow' }))

  const result = await callRoute(route, { url: `${plugin.CHANNEL}/propose`, body: { callId: 'read-1' } })
  assert.equal(result.body.code, 'unknown-call')
})

test('an unauthenticated request is refused and writes nothing', async (t) => {
  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  const workspace = await mkdtemp(join(tmpdir(), 'always-allow-auth-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const app = new cordis.Context()
  const webServer = fakeWebServer()
  app.provide('webServer', webServer)
  // Mirrors the real admit(): untrusted or unauthenticated requests get 401/403.
  app.provide('connection', {
    requestRejection: (req) => (req.headers?.cookie === undefined ? 401 : undefined),
  })
  app.provide('tools', {})
  await app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply })
  const route = webServer.routes[0]

  await app.waterfall('tools/pre-execute', shellExec('call-1', 'ls', workspace), () => Promise.resolve({ kind: 'allow' }))

  const refused = await callRoute(route, { url: `${plugin.CHANNEL}/save`, body: { callId: 'call-1' } })
  assert.equal(refused.status, 401)
  assert.equal(refused.body.ok, false)

  await assert.rejects(readFile(join(workspace, '.dsh/rules.yaml'), 'utf8'), /ENOENT/)
})

test('a non-POST method is refused', async (t) => {
  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  const app = new cordis.Context()
  const webServer = fakeWebServer()
  app.provide('webServer', webServer)
  app.provide('connection', { requestRejection: () => undefined })
  app.provide('tools', {})
  await app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply })

  const result = await callRoute(webServer.routes[0], { method: 'GET', url: `${plugin.CHANNEL}/propose` })
  assert.equal(result.status, 405)
})

test('an invalid config fails the mount loudly', async (t) => {
  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  for (const config of [{ rulesFile: '' }, { toolNames: [] }, { maxTracked: 0 }]) {
    const app = new cordis.Context()
    app.provide('webServer', fakeWebServer())
    app.provide('connection', { requestRejection: () => undefined })
    app.provide('tools', {})
    // A plugin fiber rejects asynchronously; the Loader surfaces it as a
    // failed activation, so the test must await it too.
    const mounting = async () => {
      await app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply }, config)
    }
    await assert.rejects(mounting, /always-allow:/)
  }
})

test('inject declares only services the route can actually reach', async (t) => {
  // A declared Service that no earlier row provides leaves the fiber PENDING
  // forever: no error, no log, and — because the row never activates — no
  // browser half either. That is silent, so pin the contract here.
  assert.deepEqual(plugin.inject, ['webServer'])

  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  const app = new cordis.Context()
  const webServer = fakeWebServer()
  app.provide('webServer', webServer)
  // `connection` is provided AFTER the mount, exactly as at runtime.
  const fiber = app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply })
  await fiber
  assert.equal(fiber.state, 2, 'the fiber activates without connection')

  app.provide('connection', { requestRejection: () => 403 })
  const route = webServer.routes.find((entry) => entry.path === plugin.CHANNEL)
  const rejected = await callRoute(route, { url: `${plugin.CHANNEL}/propose`, body: { callId: 'x' } })
  assert.equal(rejected.status, 403, 'a newly provided connection is honoured at request time')
})

test('the escalation listener mounts only when the rule engine is present', async (t) => {
  const cordis = await loadCordis()
  if (cordis === undefined) {
    t.skip('harness checkout not available for the Cordis import')
    return
  }
  const workspace = await mkdtemp(join(tmpdir(), 'always-allow-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const { Context } = cordis
  const app = new Context()
  const webServer = fakeWebServer()
  app.provide('webServer', webServer)
  app.provide('connection', { requestRejection: () => undefined })
  app.provide('tools', {})

  // No runtime yet: the listener must not exist, and the plugin must still
  // mount. A declared `inject` entry would have left the whole fiber pending.
  const fiber = app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply, Config: undefined }, { autoApproveEscalation: true })
  await fiber
  assert.ok(webServer.routes.find((entry) => entry.path === plugin.CHANNEL), 'the route mounted without the engine')

  // Provide the engine the way `dsh-permission-rules` does, then drive one
  // escalation through the real `approval/request` waterfall.
  const compiled = {
    rules: [{
      index: 0, sourceIndex: 0, action: 'allow', reason: 'saved', enabled: true, tags: [],
      tools: [], agents: [], params: new Map(), paths: [], absent: [], source: {},
      argv: {
        command: [/^git$/],
        args: { positive: [], negative: [] },
        anyArg: { positive: [], negative: [] },
        pipeline: [],
      },
    }],
  }
  app.provide('permissionRulesRuntime', { rulesFor: () => ({ compiled, sources: [], cwd: workspace }) })

  // Track a call the way a real pre-execute pass does.
  await app.waterfall('tools/pre-execute', shellExec('call-esc', 'git status', workspace), () => Promise.resolve({ kind: 'allow' }))

  const approved = await app.waterfall(
    'approval/request',
    { callId: 'call-esc', toolName: 'bash', reason: 'escalate sandbox to danger-full-access: needs real /tmp' },
    () => Promise.resolve('unavailable'),
  )
  assert.equal(approved, 'allowed-once', 'a saved rule answers its own escalation')

  const other = await app.waterfall(
    'approval/request',
    { callId: 'call-esc', toolName: 'bash', reason: 'mkfs formats a device' },
    () => Promise.resolve('unavailable'),
  )
  assert.equal(other, 'unavailable', 'an ordinary ask is still delegated')
})
