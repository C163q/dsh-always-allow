import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'yaml'
import { compileRules, matchRules, parseRulesDocument } from 'dsh-permission-rules'
import { insertRule, renderRule, scalar } from '../src/rules-file.js'

const proposal = { command: 'git', args: ['status'], label: 'git status' }
const block = () => renderRule(proposal, 'Always allow git status', ['bash'])
const compile = text => compileRules(parseRulesDocument(text), { patternMode: 'glob' })

test('saved rule grants only a literal command prefix with safe word boundaries', () => {
  const rules = compile(insertRule('', block()))
  for (const [command, allowed] of [
    ['git status', true], ['git status --short', true], ['git status -s /tmp', true],
    ['git statusx', false], ['git push status', false], ['echo status; git push', false],
    ['git status; echo pwned', false], ['git status\necho pwned', false],
    ['git status > /tmp/x', false], ['git status $(id)', false],
    ['git status `id`', false], ['git status # comment', false],
    ['git status "x"', false], ['git status \\x', false], ['git status *', false],
  ]) {
    assert.equal(matchRules(rules, 'bash', { command }, '/w')?.rule.action === 'allow', allowed, command)
  }
  assert.equal(matchRules(rules, 'pwsh', { command: 'git status' }, '/w'), undefined)
})

test('YAML append preserves comments, top-level lists, and earlier deny precedence', () => {
  const existing = '# keep me\nrules:\n  - match: {tools: [bash]}\n    action: deny\n    reason: stop\nmetadata:\n  - untouched\n'
  const next = insertRule(existing, block())
  assert.equal(parse(next).rules.length, 2)
  assert.deepEqual(parse(next).metadata, ['untouched'])
  assert.match(next, /# keep me/)
  assert.equal(matchRules(compile(JSON.stringify({ rules: parse(next).rules })), 'bash', { command: 'git status' }, '/w').rule.action, 'deny')
})

test('empty block/flow rules and comment-only documents accept exactly one identical rule', () => {
  for (const input of ['', '# keep\n', 'rules:\n', 'rules: []\n', 'rules: [ ] # keep\n']) {
    const once = insertRule(input, block())
    assert.equal(parse(once).rules.length, 1)
    assert.equal(insertRule(once, block()), once)
  }
})

test('invalid YAML, duplicate keys, aliases and non-list rules fail without rewriting', () => {
  for (const input of ['rules: [', 'rules: []\nrules: []', 'rules: {}', 'rules: nope', '- rules: []', 'rules: &r []\nother: *r']) {
    assert.throws(() => insertRule(input, block()), undefined, input)
  }
})

test('scalars and tool names cannot inject YAML keys or new rules', () => {
  const reason = 'hello\n  action: deny\r\u0000"\\'
  assert.equal(parse(`value: ${scalar(reason)}`).value, reason)
  const text = insertRule('', renderRule(proposal, reason, ['bash]\n  action: deny']))
  assert.deepEqual(parse(text).rules[0].match.tools, ['bash]\n  action: deny'])
  assert.equal(parse(text).rules[0].reason, reason)
})
