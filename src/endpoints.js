/** Browser proposals and saves are tied to a live approval and its opaque token. */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { callKey } from './escalation.js'
import { proposeRule } from './prefix.js'
import { renderRule } from './rules-file.js'

export const UNKNOWN_CALL = 'unknown-call'
const refused = message => ({ ok: false, code: UNKNOWN_CALL, message })

/** Resolve only a currently pending, unspent approval in the exact session. */
export function lookup(pending, body) {
  if (typeof body?.sessionId !== 'string' || typeof body?.callId !== 'string') return refused('approval identity is required')
  const entry = pending.get(callKey(body.sessionId, body.callId))
  if (entry === undefined || !entry.active || entry.saving || entry.saved || entry.signal?.aborted) return refused('that approval is no longer pending')
  return {ok:true, entry}
}

/** Propose a literal prefix; the host-access scope is visible before a user clicks. */
export function proposeFor(deps, body) {
  const found = lookup(deps.pending, body)
  if (!found.ok) return found
  const entry = found.entry
  const proposal = proposeRule(entry.command)
  if (!proposal.ok) return proposal
  return {...proposal, approvalToken:entry.token, hostAccess:entry.hostAccess, tool:entry.tool, commandLine:entry.command}
}

/** Resolve the rule file relative to the requesting session. */
export function rulesFileFor(deps, cwd) {
  return resolve(cwd, deps.rulesFile)
}

/** Commit only if this exact pending question still owns the unchanged command. */
export async function saveFor(deps, body) {
  const found = lookup(deps.pending, body)
  if (!found.ok) return found
  const entry = found.entry
  if (body.approvalToken !== entry.token) return refused('approval token does not match')
  if (entry.hostAccess && body.allowHost !== true) return refused('explicit host-access consent is required')
  const proposal = proposeRule(entry.command)
  if (!proposal.ok) return proposal
  if (proposal.executablePath && body.allowExecutablePath !== true) {
    return {ok:false,code:'path-risk',message:'acknowledge the executable-path risk warning before saving'}
  }
  const file = rulesFileFor(deps, entry.cwd)
  const grant = {cwd:entry.cwd, file, tool:entry.tool, prefix:proposal.label}
  const id = entry.hostAccess ? (deps.grantId?.(grant) ?? randomUUID()) : undefined
  const reason = entry.hostAccess
    ? `Always allow "${proposal.label}" with danger-full-access in this workspace (saved from the approval prompt)`
    : `Always allow "${proposal.label}" in this workspace (saved from the approval prompt)`
  const rule = renderRule(proposal, reason, [entry.tool], {
    patternMode:deps.patternMode, autoApproveEscalation:entry.hostAccess, grantId:id,
  })
  const current = () => {
    if (!entry.active || entry.saved || entry.signal?.aborted
      || deps.pending.get(callKey(body.sessionId, body.callId)) !== entry
      || (entry.isCurrent !== undefined && !entry.isCurrent())) {
      throw new Error('that approval is no longer pending or its command changed')
    }
  }
  entry.saving = true
  try {
    const written = await deps.appendRule(file, rule, {
      beforeCommit: () => {
        current()
        // This is synchronous: cancellation cannot interleave between authorization and rename.
        if (entry.hostAccess) deps.authorizeGrant(grant, id)
      },
      validate:deps.validate,
    })
    entry.saved = true
    deps.reload?.(entry.cwd)
    return {ok:true, value:{file:written,label:proposal.label}}
  } finally {
    entry.saving = false
  }
}

/** Dispatch the authenticated browser API. Caller-controlled reasons are never persisted. */
export async function dispatch(deps, endpoint, body) {
  if (endpoint === 'propose') return proposeFor(deps, body)
  if (endpoint === 'save') return saveFor(deps, body)
  return {ok:false,code:'bad-endpoint',message:'unknown endpoint'}
}
