/** Answer only an explicit, live danger-full-access request covered by a host grant. */
import { resolve } from 'node:path'
import { compileRulesChain, matchRules } from 'dsh-permission-rules'
import { readFileSync } from 'node:fs'
import { proposeRule } from './prefix.js'
import { GRANT_TAG, PREFIX_TAG, GRANT_ID_TAG } from './rules-file.js'

/** Call ids are session-local, not process-global. */
export function callKey(sessionId, callId) {
  return JSON.stringify([sessionId, callId])
}

/** Match the exact reason emitted by the bash sandbox escalation path. */
export function isEscalation(req, exec) {
  const args = exec?.arguments
  return args?.sandbox_permissions === 'danger-full-access'
    && typeof args.justification === 'string' && args.justification.trim() !== ''
    && req?.reason === `escalate sandbox to danger-full-access: ${args.justification}`
}

/** Re-evaluate the current ordered policy, without depending on optional audit events. */
export function createEscalationListener(deps) {
  return async (req, next) => {
    try {
      if (!deps.enabled() || req.signal?.aborted) return next()
      const header = req.agent?.session?.header
      const record = deps.calls.get(callKey(header?.id, req.callId))
      const exec = record?.exec
      if (exec === undefined || req.agent !== exec.agent || req.toolName !== exec.name
        || req.callId !== exec.callId || !record.dispatching || record.gate !== 'allow'
        || exec.signal?.aborted || !isEscalation(req, exec)) return next()
      const proposal = proposeRule(exec.arguments?.command)
      if (!proposal.ok) return next()
      const runtime = deps.runtime()
      if (runtime === undefined || runtime.config.enforce !== true) return next()
      // Resolve through the live engine, then compile current bytes/options without its cache.
      const sources = runtime.resolveSources(header.cwd)
      const fresh = compileRulesChain(sources.map(path => ({ path, text: readFileSync(path, 'utf8') })), runtime.config)
      const loaded = { sources: fresh.sources, compiled: fresh.ruleset }
      const agents = [header.origin === 'subagent' ? 'subagent' : 'main']
      if (typeof header.agentPreset === 'string' && header.agentPreset !== '') agents.push(`preset:${header.agentPreset}`)
      const context = { platform: process.platform, env: process.env, agents }
      const hit = matchRules(loaded.compiled, exec.name, exec.arguments, header.cwd, context)
      // Policy must allow first. Explicit host consent may follow a legacy ordinary allow.
      if (hit?.rule.action !== 'allow') return next()
      const file = resolve(header.cwd, deps.rulesFile())
      for (const rule of loaded.compiled.rules) {
        if (!rule.enabled || rule.action !== 'allow' || !rule.tags.includes(GRANT_TAG)
          || !rule.tags.includes(`${PREFIX_TAG}${proposal.label}`)) continue
        const source = loaded.sources[rule.sourceIndex]
        if (source === undefined || resolve(source) !== file) continue
        const grantIds = rule.tags.filter(tag => tag.startsWith(GRANT_ID_TAG))
        if (grantIds.length !== 1 || !deps.verifyGrant(
          { cwd: header.cwd, file, tool: exec.name, prefix: proposal.label },
          grantIds[0].slice(GRANT_ID_TAG.length),
        )) continue
        // Respect any additional restrictions on the explicit grant itself.
        const grantHit = matchRules({ ...loaded.compiled, rules: [rule] }, exec.name, exec.arguments, header.cwd, context)
        if (grantHit !== undefined) return 'allowed-once'
      }
      return next()
    } catch {
      // Unavailable dependencies or unreadable policy always leave the question to a human.
    }
    return next()
  }
}
