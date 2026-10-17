/**
 * Answering a sandbox-escalation approval from a saved `allow` rule.
 *
 * The two approvals a shell Tool can raise are independent:
 *
 *   * "may this command run?" — the `tools/pre-execute` waterfall, where
 *     `permission-rules` consults the rule files;
 *   * "may this call widen the sandbox?" — raised from INSIDE the Tool body by
 *     `approveEscalation`, which asks the approval service directly and never
 *     looks at a rule.
 *
 * So a saved rule silences the first prompt and the second one asks again, with
 * a different reason, for the same command. That is what this module closes —
 * but only when the operator opted in, because a rule grants "may run", not
 * "may leave the sandbox".
 *
 * The escalation reason is the ONLY reliable marker: `approval/request` carries
 * no arguments and no target mode, so the reason text — `escalate sandbox to
 * <mode>: <justification>`, built in `packages/sandbox/sandbox/src/escalation.ts`
 * — is what distinguishes an escalation from an ordinary ask.
 *
 * @module dsh-always-allow/escalation
 */

/** The fixed prefix `approveEscalation` puts on every escalation reason. */
export const ESCALATION_REASON = /^escalate sandbox to [a-z-]+: /

/**
 * Whether an approval request is a sandbox escalation rather than an ordinary
 * ask.
 * @param {{reason?: string}} req - the approval request.
 */
export function isEscalation(req) {
  return typeof req?.reason === 'string' && ESCALATION_REASON.test(req.reason)
}

/**
 * Build the `approval/request` listener.
 *
 * Returns a listener that answers `allowed-once` when a saved `allow` rule
 * covers the command the pending call carries, and delegates via `next()`
 * otherwise — so a human still sees every escalation no rule covers.
 * @param {object} deps
 * @param {(cwd: string) => object | undefined} deps.rulesetFor - the compiled
 *   ruleset in effect for a workspace, or undefined when the engine is absent.
 * @param {Map<string, {command: string, cwd: string}>} deps.calls - tracked
 *   pending calls, keyed by call id.
 * @param {(ruleset: object, call: {toolName: string, command: string}) => object | undefined} deps.findAllowRule
 *   - rule lookup over the compiled set.
 * @param {() => boolean} deps.enabled - whether the operator opted in, read per
 *   request so a live config edit takes effect without a remount.
 * @returns {(req: object, next: () => Promise<string>) => Promise<string>}
 */
export function createEscalationListener(deps) {
  return async (req, next) => {
    if (!deps.enabled()) return next()
    if (!isEscalation(req)) return next()
    const callId = req.callId
    if (typeof callId !== 'string') return next()
    const tracked = deps.calls.get(callId)
    if (tracked === undefined) return next()

    const ruleset = deps.rulesetFor(tracked.cwd)
    if (ruleset === undefined) return next()

    const rule = deps.findAllowRule(ruleset, { toolName: req.toolName, command: tracked.command })
    if (rule === undefined) return next()
    return 'allowed-once'
  }
}
