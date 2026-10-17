/**
 * The two operations the browser half performs, kept transport-neutral so they
 * can be exercised without an HTTP server or a live Cordis context.
 *
 * `propose` answers "is there a prefix worth offering for this pending
 * approval?" and `save` writes it. Both take a `store` — the pending-approval
 * map plus the filesystem writes — as a parameter rather than importing a
 * singleton, so tests can supply their own.
 */

import { insertRule, renderRule } from './rules-file.js'
import { proposeRule } from './prefix.js'

/** A pending approval cannot be answered any more (answered, denied, or replaced). */
export const UNKNOWN_CALL = 'unknown-call'

/**
 * Resolve the tracked call a request refers to.
 * @param {Map<string, {command: string, cwd: string}>} calls - pending approvals.
 * @param {unknown} callId - caller-supplied identity.
 * @returns {{ok: true, tracked: {command: string, cwd: string}, callId: string}
 *   | {ok: false, code: string, message: string}}
 */
export function lookup(calls, callId) {
  const id = typeof callId === 'string' ? callId : undefined
  const tracked = id === undefined ? undefined : calls.get(id)
  if (tracked === undefined) {
    return { ok: false, code: UNKNOWN_CALL, message: 'that approval is no longer pending' }
  }
  return { ok: true, tracked, callId: id }
}

/**
 * Offer the prefix for one pending approval, if it has one worth saving.
 * @param {Map<string, {command: string, cwd: string}>} calls - pending approvals.
 * @param {unknown} callId - caller-supplied identity.
 * @returns the proposal, or a typed refusal the UI explains.
 */
export function proposeFor(calls, callId) {
  const found = lookup(calls, callId)
  if (found.ok !== true) return found
  return proposeRule(found.tracked.command)
}

/**
 * Save the prefix for one pending approval and forget the approval.
 * @param {object} deps
 * @param {Map<string, {command: string, cwd: string}>} deps.calls - pending approvals.
 * @param {string} deps.rulesFile - configured rule-file path.
 * @param {string[]} deps.toolNames - shell Tool names the rule applies to.
 * @param {(file: string, ruleText: string) => Promise<string>} deps.appendRule
 *   - performs the atomic append and resolves the absolute path written.
 * @param {unknown} callId - caller-supplied identity.
 * @param {unknown} [reason] - optional caller-supplied reason text.
 * @returns `{ok: true, value: {file, label}}` or a typed refusal.
 */
export async function saveFor(deps, callId, reason) {
  const found = lookup(deps.calls, callId)
  if (found.ok !== true) return found
  const proposal = proposeRule(found.tracked.command)
  if (proposal.ok !== true) return proposal
  const text = typeof reason === 'string' && reason.trim() !== ''
    ? reason.trim()
    : `Always allow "${proposal.label}" in this workspace (saved from the approval prompt)`
  const file = await deps.appendRule(
    rulesFileFor(deps, found.tracked.cwd),
    renderRule(proposal, text, deps.toolNames),
  )
  deps.calls.delete(found.callId)
  return { ok: true, value: { ok: true, file, label: proposal.label } }
}

/**
 * Absolute rule-file path for one session cwd.
 * @param {object} deps
 * @param {string} deps.cwd - Session workspace directory (or the tracked call's).
 * @param {string} deps.rulesFile - configured path.
 */
export function rulesFileFor(deps, cwd) {
  const file = deps.rulesFile
  return file.startsWith('/') ? file : `${cwd.replace(/\/+$/, '')}/${file}`
}

/**
 * Dispatch one endpoint by name — the single place both transports agree on.
 * @param {object} deps - see {@link saveFor}.
 * @param {string} endpoint - `propose` or `save`.
 * @param {Record<string, unknown>} [body] - decoded request body.
 */
export async function dispatch(deps, endpoint, body) {
  const callId = body?.callId
  if (endpoint === 'propose') return proposeFor(deps.calls, callId)
  if (endpoint === 'save') return saveFor(deps, callId, body?.reason)
  return { ok: false, code: 'bad-endpoint', message: `unknown endpoint ${String(endpoint)}` }
}
