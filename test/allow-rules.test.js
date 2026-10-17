/**
 * Matching against ALREADY-COMPILED rules, and the escalation listener built
 * on it.
 *
 * The point of these tests is the NARROWNESS: a compiled rule is a real object
 * with a dozen dimensions, and every one this plugin cannot evaluate faithfully
 * must make it decline to match. A false negative costs one click; a false
 * positive would grant permission nobody wrote down.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findAllowRule } from '../src/allow-rules.js'
import { createEscalationListener, isEscalation } from '../src/escalation.js'

/** A compiled rule with every dimension at its "no constraint" value. */
function rule(overrides = {}) {
  return {
    index: 0,
    sourceIndex: 0,
    action: 'allow',
    reason: 'test',
    enabled: true,
    tags: [],
    tools: [],
    agents: [],
    params: new Map(),
    paths: [],
    absent: [],
    argv: {
      command: [/^git$/],
      args: { positive: [], negative: [] },
      anyArg: { positive: [], negative: [] },
      pipeline: [],
    },
    source: {},
    ...overrides,
  }
}

const gitRule = () => rule()
const gitStatusRule = () => rule({
  argv: {
    command: [/^git$/],
    args: { positive: [/^status$/], negative: [] },
    anyArg: { positive: [], negative: [] },
    pipeline: [],
  },
})

test('an allow rule matches the command it names', () => {
  assert.ok(findAllowRule({ rules: [gitRule()] }, { toolName: 'bash', command: 'git status --short' }))
})

test('a rule with an argv constraint requires that argument', () => {
  const ruleset = { rules: [gitStatusRule()] }
  assert.ok(findAllowRule(ruleset, { toolName: 'bash', command: 'git status --short' }))
  assert.equal(findAllowRule(ruleset, { toolName: 'bash', command: 'git push --force' }), undefined)
})

test('a different command word does not match', () => {
  assert.equal(findAllowRule({ rules: [gitRule()] }, { toolName: 'bash', command: 'rm -rf /' }), undefined)
})

test('a deny rule is never treated as an allow', () => {
  assert.equal(findAllowRule({ rules: [rule({ action: 'deny' })] }, { toolName: 'bash', command: 'git status' }), undefined)
})

test('a disabled rule never matches', () => {
  assert.equal(findAllowRule({ rules: [rule({ enabled: false })] }, { toolName: 'bash', command: 'git status' }), undefined)
})

test('a rule scoped to another tool does not match', () => {
  const scoped = rule({ tools: [/^pwsh$/] })
  assert.equal(findAllowRule({ rules: [scoped] }, { toolName: 'bash', command: 'git status' }), undefined)
  assert.ok(findAllowRule({ rules: [scoped] }, { toolName: 'pwsh', command: 'git status' }))
})

test('a negative argument pattern excludes the command', () => {
  const noForce = rule({
    argv: {
      command: [/^git$/],
      args: { positive: [], negative: [/^--force$/] },
      anyArg: { positive: [], negative: [] },
      pipeline: [],
    },
  })
  assert.ok(findAllowRule({ rules: [noForce] }, { toolName: 'bash', command: 'git status' }))
  assert.equal(findAllowRule({ rules: [noForce] }, { toolName: 'bash', command: 'git push --force' }), undefined)
})

test('every dimension this plugin cannot evaluate declines to match', () => {
  // Each entry is a rule that DOES allow the command by its argv dimension, but
  // carries one more constraint whose semantics depend on facts this module does
  // not reconstruct. Answering the approval would grant more than the rule says.
  const cases = {
    paths: rule({ paths: [/src\//] }),
    absent: rule({ absent: ['command'] }),
    params: rule({ params: new Map([['command', { positive: [/./], negative: [] }]]) }),
    when: rule({ when: { env: new Map(), platform: ['linux'] } }),
    agents: rule({ agents: [/^main$/] }),
    network: rule({ network: { domains: [], ips: [], ports: [], schemes: [] } }),
  }
  for (const [dimension, entry] of Object.entries(cases)) {
    assert.equal(
      findAllowRule({ rules: [entry] }, { toolName: 'bash', command: 'git status' }),
      undefined,
      `a rule with "${dimension}" must decline rather than guess`,
    )
  }
})

test('a rule WITHOUT an argv block cannot describe a shell command', () => {
  assert.equal(findAllowRule({ rules: [rule({ argv: undefined })] }, { toolName: 'bash', command: 'git status' }), undefined)
})

test('an environment-assignment prefix never matches', () => {
  assert.equal(findAllowRule({ rules: [gitRule()] }, { toolName: 'bash', command: 'FOO=bar git status' }), undefined)
})

test('an unusable ruleset is a non-match, never a throw', () => {
  for (const ruleset of [undefined, null, {}, { rules: 'nope' }]) {
    assert.equal(findAllowRule(ruleset, { toolName: 'bash', command: 'git status' }), undefined)
  }
})

test('first match wins across the chain', () => {
  const first = rule({ index: 0, reason: 'first' })
  const second = rule({ index: 1, reason: 'second' })
  assert.equal(findAllowRule({ rules: [first, second] }, { toolName: 'bash', command: 'git status' }).reason, 'first')
})

// --- the escalation listener ------------------------------------------------

/** The exact reason prefix the sandbox builds for an escalation. */
const ESCALATION = 'escalate sandbox to danger-full-access: this program needs the real /tmp'

test('an escalation reason is recognized and an ordinary ask is not', () => {
  assert.equal(isEscalation({ reason: ESCALATION }), true)
  assert.equal(isEscalation({ reason: 'mkfs formats a device — confirm' }), false)
  assert.equal(isEscalation({}), false)
  assert.equal(isEscalation(undefined), false)
})

/** Build a listener over one tracked call. */
function listenerFor({ enabled = true, rules = [gitRule()], tracked = { command: 'git status', cwd: '/w' } } = {}) {
  const calls = new Map([['call-1', tracked]])
  return createEscalationListener({
    rulesetFor: () => ({ rules }),
    calls,
    findAllowRule,
    enabled: () => enabled,
  })
}

test('a saved rule answers its own escalation', async () => {
  const outcome = await listenerFor()({ callId: 'call-1', toolName: 'bash', reason: ESCALATION }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'allowed-once')
})

test('the listener is OFF unless the operator opted in', async () => {
  const outcome = await listenerFor({ enabled: false })({ callId: 'call-1', toolName: 'bash', reason: ESCALATION }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'unavailable', 'the request is delegated, so a human still sees it')
})

test('an escalation for an uncovered command still reaches the human', async () => {
  const listen = listenerFor({ tracked: { command: 'rm -rf /tmp/x', cwd: '/w' } })
  const outcome = await listen({ callId: 'call-1', toolName: 'bash', reason: ESCALATION }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'unavailable')
})

test('an ORDINARY ask is delegated, never auto-approved', async () => {
  // A saved rule already silences the ordinary prompt through the rule engine.
  // Answering it here too would let this plugin auto-approve questions the
  // operator only opted into for escalations.
  const outcome = await listenerFor()({ callId: 'call-1', toolName: 'bash', reason: 'mkfs formats a device — confirm' }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'unavailable')
})

test('an unknown call id is delegated, not assumed', async () => {
  const outcome = await listenerFor()({ callId: 'call-unknown', toolName: 'bash', reason: ESCALATION }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'unavailable')
})

test('a rulesetFor that yields nothing delegates instead of approving', async () => {
  // The plugin wraps the engine call in a try/catch and returns undefined on
  // failure, so an unreadable rule file becomes "ask a human", never "allow".
  const listen = createEscalationListener({
    rulesetFor: () => undefined,
    calls: new Map([['call-1', { command: 'git status', cwd: '/w' }]]),
    findAllowRule,
    enabled: () => true,
  })
  const outcome = await listen({ callId: 'call-1', toolName: 'bash', reason: ESCALATION }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'unavailable')
})
