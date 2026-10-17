/**
 * Matching this plugin performs against ALREADY-COMPILED rules.
 *
 * The rule engine itself lives in `dsh-permission-rules`, and this module does
 * NOT reimplement it: it is handed the `CompiledRuleset` that engine built
 * (parsed YAML, compiled `RegExp` patterns, resolved defaults) and only asks
 * "did one of these compiled `allow` rules cover this command?".
 *
 * Deliberately NARROW. A rule carrying any dimension this module cannot
 * evaluate faithfully — `params`, `paths`, `absent`, `when`, `agents`,
 * `network` — is treated as NOT matching, so the human keeps seeing that
 * approval. A false negative costs one click; a false positive would grant
 * permission the rule never expressed, so every guess here errs toward asking.
 *
 * @module dsh-always-allow/allow-rules
 */

import { wordsOf } from './prefix.js'

/**
 * Whether one compiled rule's tool globs cover a Tool name.
 * @param {readonly RegExp[]} tools - compiled tool patterns; empty = every tool.
 * @param {string} toolName - the Tool being called.
 */
function coversTool(tools, toolName) {
  if (tools.length === 0) return true
  return tools.some((pattern) => pattern.test(toolName))
}

/**
 * Whether every positive pattern in an argv dimension matches at least one
 * token, and no negative pattern matches any token.
 * @param {{positive: readonly RegExp[], negative: readonly RegExp[]}} dimension
 * @param {readonly string[]} tokens
 */
function argvDimensionMatches(dimension, tokens) {
  for (const pattern of dimension.positive) {
    if (!tokens.some((token) => pattern.test(token))) return false
  }
  for (const pattern of dimension.negative) {
    if (tokens.some((token) => pattern.test(token))) return false
  }
  return true
}

/**
 * Whether a rule is one this module can evaluate at all.
 *
 * Each rejected dimension is one whose semantics depend on host facts or on
 * argument shapes this plugin does not reconstruct.
 * @param {object} rule - a compiled rule.
 */
function isEvaluable(rule) {
  if (rule.enabled !== true) return false
  if (rule.action !== 'allow') return false
  if (rule.params !== undefined && rule.params.size > 0) return false
  if (rule.paths.length > 0) return false
  if (rule.absent.length > 0) return false
  if (rule.when !== undefined) return false
  if (rule.agents.length > 0) return false
  if (rule.network !== undefined) return false
  return true
}

/**
 * Whether one compiled rule covers a shell command.
 * @param {object} rule - a compiled rule.
 * @param {string} toolName - the Tool being called.
 * @param {string} command - the raw command line.
 * @returns {boolean}
 */
function ruleCovers(rule, toolName, command) {
  if (!isEvaluable(rule)) return false
  if (!coversTool(rule.tools, toolName)) return false
  const argv = rule.argv
  if (argv === undefined) return false

  const { head, word, rest } = wordsOf(command)
  // An env-assignment prefix changes what actually runs, so no argv rule can
  // describe it faithfully.
  if (head.length > 0) return false
  if (word === undefined) return false

  if (argv.command.length > 0 && !argv.command.some((pattern) => pattern.test(word))) return false

  const args = rest
  if (!argvDimensionMatches(argv.args, args)) return false
  if (!argvDimensionMatches(argv.anyArg, args)) return false

  if (argv.pipeline.length > 0) {
    // A rule constrained by pipeline shape only speaks about one simple command;
    // any compound line is out of this module's scope.
    if (/[|&;]/.test(command)) return false
    const signature = word
    if (!argv.pipeline.some((pattern) => pattern.test(signature))) return false
  }
  return true
}

/**
 * The first compiled `allow` rule covering a command, if any.
 * @param {{rules: readonly object[]}} ruleset - the engine's compiled ruleset.
 * @param {{toolName: string, command: string}} call - the pending shell call.
 * @returns {object | undefined} the matching rule.
 */
export function findAllowRule(ruleset, call) {
  if (ruleset === undefined || ruleset === null) return undefined
  const rules = ruleset.rules
  if (!Array.isArray(rules)) return undefined
  for (const rule of rules) {
    if (ruleCovers(rule, call.toolName, call.command)) return rule
  }
  return undefined
}
