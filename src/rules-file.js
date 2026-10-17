/**
 * The rule document this plugin appends to.
 *
 * The format is `dsh-permission-rules`' own documented YAML
 * (`docs/rules-format.md` in that package): a top-level `rules:` list whose
 * entries match on `tools` and `argv` and carry an `action` plus a `reason`.
 * This module only SERIALIZES that document; it never parses or evaluates a
 * rule, so there is no second engine to keep in sync.
 */

/**
 * One YAML scalar: double-quoted, so every accepted word round-trips exactly.
 * @param {string} value
 */
/**
 * Whether a document already carries this exact rule block.
 *
 * The comparison is textual on the normalized block: this module never parses
 * YAML, and a rule it rendered itself is byte-identical when present.
 * @param {string} body - current document.
 * @param {string} ruleText - rule block from {@link renderRule}.
 */
export function hasRule(body, ruleText) {
  const needle = String(ruleText ?? '').trim()
  if (needle === '') return false
  return String(body ?? '').includes(needle)
}

export function scalar(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Render the `allow` entry for one proposal.
 *
 * The shape mirrors what a human would write by hand, in the documented key
 * order, because this file is meant to be read and edited afterwards.
 * @param {{command: string, args: string[]}} proposal - prefix from `proposeRule`.
 * @param {string} reason - shown in the file and, for question-style rules, in the UI.
 * @param {string[]} toolNames - shell Tool names the rule applies to.
 * @returns {string} the rule block, indented for a `rules:` list.
 */
export function renderRule(proposal, reason, toolNames) {
  const argv = [`        command: ${scalar(proposal.command)}`]
  if (proposal.args.length > 0) {
    argv.push(`        args: [${proposal.args.map(scalar).join(', ')}]`)
  }
  return [
    '  - match:',
    `      tools: [${toolNames.join(', ')}]`,
    '      argv:',
    ...argv,
    '    action: allow',
    `    reason: ${scalar(reason)}`,
  ].join('\n')
}

/**
 * Insert one rule into a rules document, creating the `rules:` list when the
 * file is empty or absent.
 *
 * An existing body keeps its comments and order, and the new entry is
 * APPENDED so any earlier, narrower `deny` or `ask` rule still wins on the
 * engine's first-match basis.
 *
 * An EMPTY flow list (`rules: []`) is treated as an empty document and filled
 * in place: it carries no entries, so there is nothing to corrupt, and
 * refusing it would leave a pruned file permanently unwritable — the file
 * would parse fine, the plugin would simply never save again.
 *
 * An identical rule already present is NOT appended twice. Clicking the button
 * twice, or approving the same command in two tabs, would otherwise grow the
 * document on every click, and a duplicate is invisible in the UI: the engine
 * stops at the first match, so the copy below it never does anything.
 * @param {string} text - current file contents (may be empty).
 * @param {string} ruleText - rule block from {@link renderRule}.
 * @returns {string} the new document.
 * @throws when the file uses a non-empty flow-style `rules: [...]`, which is
 * not rewritten.
 */
export function insertRule(text, ruleText) {
  const body = String(text ?? '').trimEnd()
  if (hasRule(body, ruleText)) return body === '' ? `rules:\n` : `${body}\n`
  if (body.trim() === '') return `rules:\n${ruleText}\n`
  if (/^rules:\s*$/m.test(body)) return `${body}\n${ruleText}\n`
  // `rules: []` / `rules: [ ]` — an empty flow sequence, same as no rules.
  if (/^rules:\s*\[\s*\]\s*$/m.test(body)) {
    return `${body.replace(/^rules:\s*\[\s*\]\s*$/m, 'rules:')}\n${ruleText}\n`
  }
  if (/^rules:\s*[^\s#]/m.test(body)) {
    throw new Error('the rule file uses flow-style "rules: [...]", which this plugin will not rewrite')
  }
  return `rules:\n${ruleText}\n\n${body}\n`
}
