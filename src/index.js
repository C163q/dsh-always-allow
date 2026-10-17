/**
 * `dsh-always-allow` host half.
 *
 * Two small jobs:
 *
 * 1. Remember the command line of each shell Tool call, because an approval
 *    request carries only `{agent, toolName, callId}` — never the arguments.
 *    A `/always-allow` HTTP route then answers the browser half with the
 *    prefix it can offer as a button.
 * 2. Append a command-prefix `allow` rule to the workspace rule file that
 *    `dsh-permission-rules` already reads.
 *
 * This plugin is deliberately NOT a second rule engine. It never evaluates a
 * rule, never answers an approval itself, and never widens
 * `tools/pre-execute` beyond the neutral `{kind:'allow'}` passthrough it
 * returns. It only writes the document an already-installed, enabled
 * `permission-rules` row consumes, so a single authority still decides whether
 * a command runs.
 *
 * @module dsh-always-allow
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveConfig } from './config.js'
import { commandOf } from './prefix.js'
import { dispatch } from './endpoints.js'
import { insertRule } from './rules-file.js'

/** Plugin name: matches the package name and the bundle row id. */
export const name = 'dsh-always-allow'

/** Absolute route owned by this plugin. */
export const CHANNEL = '/always-allow'

/**
 * Services consumed: only `webServer`, which hosts this plugin's own route.
 *
 * `connection` is deliberately NOT declared, even though the route prefers to
 * run its trust check. A declared Service that the composing tree does not
 * provide leaves the fiber PENDING forever — no error, no log — and a pending
 * fiber also keeps this package's browser half out of the boot graph, so the UI
 * silently vanishes. The route therefore reads `connection` from the live
 * context when it handles a request and skips the check when absent.
 *
 * `tools` is likewise absent: listening to `tools/pre-execute` needs no Service
 * handle.
 *
 * No `export default` here on purpose. The Loader resolves a row's module
 * namespace through `unwrapExports` (which prefers `exports.default`) and then
 * narrows an applicable object to its `apply` function; the fiber is built from
 * `Inject.resolve(plugin.inject)` on THAT value, so a declaration exported
 * beside a default object would be silently dropped.
 */
export const inject = ['webServer']

/**
 * Append one rule to a rules file atomically.
 *
 * Read-modify-write is serialized per process, so two browser tabs cannot
 * interleave, and the write goes through a temp file plus rename so a crash
 * never leaves a half-written rule document (which `badFilePolicy: fail` would
 * turn into a hard refusal of every Tool call).
 * @param {string} file - absolute rules-file path.
 * @param {string} ruleText - rule block from `renderRule`.
 * @returns {Promise<string>} the path written.
 */
export function createAppender() {
  let chain = Promise.resolve()
  return (file, ruleText) => {
    const task = async () => {
      let existing = ''
      try {
        existing = await readFile(file, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const next = insertRule(existing, ruleText)
      await mkdir(dirname(file), { recursive: true })
      const temp = join(dirname(file), `.rules.yaml.${process.pid}.${Date.now()}.tmp`)
      await writeFile(temp, next, 'utf8')
      await rename(temp, file)
      return file
    }
    const run = chain.then(task, task)
    chain = run.catch(() => {})
    return run
  }
}

/** Workspace directory of the session that issued a call. */
export function cwdOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/** Read and size-cap a JSON request body. */
async function readJson(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() === '' ? {} : JSON.parse(text)
}

/**
 * Plugin body: track command lines and serve the `/always-allow` route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host Cordis context.
 * @param {import('./config.js').Config} [config] - user config from the Loader.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const appendRule = createAppender()

  /** Pending approval id → the command and workspace it belongs to. Bounded. */
  const calls = new Map()

  ctx.effect(() => ctx.on('tools/pre-execute', (exec) => {
    // A waterfall listener's return value IS the decision. This plugin answers
    // `allow` — the neutral passthrough — so it never makes a permission
    // decision; `permission-rules` still decides, and still asks.
    const command = commandOf(exec.name, exec.arguments, resolved.toolNames)
    if (command !== undefined && typeof exec.callId === 'string') {
      calls.delete(exec.callId)
      calls.set(exec.callId, { command, cwd: cwdOf(exec.agent) })
      if (calls.size > resolved.maxTracked) {
        const oldest = calls.keys().next()
        if (!oldest.done) calls.delete(oldest.value)
      }
    }
    return { kind: 'allow' }
  }), 'always-allow: command tracker')

  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  /*
   * One owned webServer route rather than `connection.rpc.handle()`.
   *
   * `HostConnectionService` binds `const owner = this.ctx` — the PROVIDER
   * plugin's context — and its `register()` runs
   * `owner.effect(() => owner.webServer.register(route))`. That read happens in
   * the provider's fiber, which does not declare `webServer`, so the generic
   * RPC channel throws `cannot get property "webServer" without inject` no
   * matter what a consumer plugin declares. Registering on this plugin's own
   * `ctx.webServer` keeps the read inside a fiber that declared it.
   *
   * Authentication mirrors the `/api` route: a request must pass the Connection
   * trust/credential check, so a foreign page cannot spend the user's session
   * to widen their rules.
   */
  ctx.effect(() => {
    const route = {
      kind: 'prefix',
      path: CHANNEL,
      handler: async (req, res) => {
        const send = (status, value) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(value))
        }
        try {
          // Read lazily: `connection` is provided by a row that may activate
          // later, and an absent one simply skips the trust test.
          const connection = ctx.get('connection')
          const rejection = connection?.requestRejection === undefined
            ? undefined
            : connection.requestRejection(req)
          if (rejection !== undefined) {
            send(rejection, { ok: false, code: 'unauthorized', message: 'not authorized' })
            return
          }
          if (req.method !== 'POST') {
            send(405, { ok: false, code: 'method', message: 'POST only' })
            return
          }
          const endpoint = new URL(req.url ?? '/', 'http://x').pathname.slice(CHANNEL.length + 1)
          const body = await readJson(req, resolved.maxBodyBytes)
          send(200, await dispatch(
            { calls, rulesFile: resolved.rulesFile, toolNames: resolved.toolNames, appendRule },
            endpoint,
            body,
          ))
        } catch (error) {
          send(200, {
            ok: false,
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }
    return webServer.register(route)
  }, 'always-allow: route')
}
