/**
 * The YAML this plugin writes must be exactly what `dsh-permission-rules`
 * documents. These tests pin the rendered shape and the append behaviour that
 * keeps earlier, narrower rules winning.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertRule, renderRule, scalar } from '../src/rules-file.js'

test('a rule renders in the documented shape', () => {
  const rule = renderRule({ command: 'git', args: ['status'] }, 'Always allow "git status"', ['bash', 'pwsh'])
  assert.equal(rule, [
    '  - match:',
    '      tools: [bash, pwsh]',
    '      argv:',
    '        command: "git"',
    '        args: ["status"]',
    '    action: allow',
    '    reason: "Always allow \\"git status\\""',
  ].join('\n'))
})

test('a command without a subcommand omits the args key', () => {
  const rule = renderRule({ command: 'ls', args: [] }, 'reason', ['bash'])
  assert.match(rule, /command: "ls"\n {4}action: allow/)
  assert.doesNotMatch(rule, /args:/)
})

test('scalars escape quotes and backslashes', () => {
  assert.equal(scalar('a"b\\c'), '"a\\"b\\\\c"')
})

test('an empty document gets a rules list', () => {
  // The caller passes a rule block without a trailing newline (renderRule's
  // shape), and the document always ends with exactly one.
  assert.equal(insertRule('', 'RULE'), 'rules:\nRULE\n')
  assert.equal(insertRule('   \n\n', 'RULE'), 'rules:\nRULE\n')
})

test('a rule block that already ends in a newline is kept as one trailing newline', () => {
  // `renderRule` returns no trailing newline; a caller that adds one must not
  // produce a blank line inside the rules list.
  assert.equal(insertRule('', 'RULE\n'), 'rules:\nRULE\n\n')
  assert.equal(insertRule('rules:\n', 'RULE\n'), 'rules:\nRULE\n\n')
})

test('an existing empty rules key is filled in place', () => {
  assert.equal(insertRule('rules:\n', 'RULE'), 'rules:\nRULE\n')
})

test('a new rule is appended below existing rules so they still win first-match', () => {
  const existing = 'rules:\n  - match:\n      tools: [bash]\n    action: deny\n    reason: "no"\n'
  const next = insertRule(existing, '  - match:\n      tools: [bash]\n    action: allow\n    reason: "yes"\n')
  const denyAt = next.indexOf('action: deny')
  const allowAt = next.indexOf('action: allow')
  assert.ok(denyAt !== -1 && allowAt !== -1)
  assert.ok(denyAt < allowAt, 'the earlier deny must stay first')
})

test('a document without a rules key gains one, keeping its comments above the body', () => {
  const next = insertRule('# my rules\n\n', 'RULE')
  assert.equal(next, 'rules:\nRULE\n\n# my rules\n')
  assert.ok(next.includes('# my rules'), 'comments survive')
})

test('flow-style rules are refused instead of being corrupted', () => {
  assert.throws(() => insertRule('rules: [{match: {}}]', 'RULE'), /flow-style/)
})

test('appending twice keeps a single rules key', () => {
  let text = insertRule('', 'ONE')
  text = insertRule(text, 'TWO')
  const keys = text.split('\n').filter((line) => /^rules:/.test(line))
  assert.equal(keys.length, 1)
  assert.ok(text.indexOf('ONE') < text.indexOf('TWO'))
})

test('an empty flow list is filled in place instead of being refused', () => {
  // `rules: []` is what a prune-to-empty leaves behind. Refusing it would make
  // the file parse fine while the plugin could never save again.
  for (const text of ['rules: []\n', 'rules: []', 'rules: [ ]\n']) {
    const out = insertRule(text, 'RULE')
    assert.match(out, /^rules:$/m, `"${text.trim()}" becomes a block list`)
    assert.match(out, /RULE/, 'the rule is present')
    assert.doesNotMatch(out, /\[\s*\]/, 'no empty flow list survives')
  }
})

test('a non-empty flow list is still refused', () => {
  assert.throws(() => insertRule('rules: [{match: {}}]', 'RULE'), /flow-style/)
})

test('an identical rule is not appended twice', () => {
  // Clicking the button twice used to grow the document on every click, and the
  // duplicate is invisible in the UI: first-match wins, so the copy below never
  // runs.
  const rule = renderRule({ command: 'git', args: ['status'] }, 'Always allow "git status"', ['bash'])
  const once = insertRule('', rule)
  const twice = insertRule(once, rule)
  assert.equal(twice, once, 'the second insert is a no-op')
  assert.equal((twice.match(/command: "git"/g) ?? []).length, 1)
})

test('a different rule still appends after an identical one', () => {
  const first = renderRule({ command: 'git', args: [] }, 'a', ['bash'])
  const second = renderRule({ command: 'ls', args: [] }, 'b', ['bash'])
  const text = insertRule(insertRule('', first), second)
  assert.match(text, /command: "git"/)
  assert.match(text, /command: "ls"/)
})
