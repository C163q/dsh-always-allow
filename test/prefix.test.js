/**
 * `proposeRule` decides which commands get a "permanently allow" button. These
 * tests are the safety contract: a prefix that could cover more than the user
 * approved must never be offered.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandOf, proposeRule } from '../src/prefix.js'

test('a plain command offers its own word and keeps the arguments free', () => {
  const proposal = proposeRule('ls -la')
  assert.deepEqual(proposal, { ok: true, command: 'ls', args: [], label: 'ls' })
})

test('a subcommand command keeps exactly one literal subcommand', () => {
  assert.deepEqual(proposeRule('git status --short'), {
    ok: true, command: 'git', args: ['status'], label: 'git status',
  })
  assert.deepEqual(proposeRule('npm install -g pkg'), {
    ok: true, command: 'npm', args: ['install'], label: 'npm install',
  })
})

test('the same prefix covers every later argument', () => {
  // This is the property that makes the rule behave like Codex's prefix match.
  const first = proposeRule('git status --short')
  const second = proposeRule('git status -s')
  assert.deepEqual(first, second)
})

test('a bare subcommand command is refused as too broad', () => {
  const refusal = proposeRule('git')
  assert.equal(refusal.ok, false)
  assert.equal(refusal.code, 'too-broad')
})

test('destructive and interpreter commands are never offered', () => {
  for (const command of ['rm -rf build', 'sudo ls', 'curl https://x', 'bash script.sh', 'dd if=a of=b', 'chmod 777 x']) {
    const refusal = proposeRule(command)
    assert.equal(refusal.ok, false, `${command} must be refused`)
    assert.equal(refusal.code, 'never', `${command} must be refused as never-prefixable`)
  }
})

test('compound and metacharacter command lines are refused', () => {
  // Every case must be refused; some are caught earlier as `unsafe` because the
  // offending operator sits inside the command word itself.
  for (const command of ['echo hi > out', 'a && b', 'a | b', 'a; b', '`whoami`', '$(id)', "git log --grep='a b'"]) {
    const refusal = proposeRule(command)
    assert.equal(refusal.ok, false, `${command} must be refused`)
    assert.ok(['compound', 'unsafe'].includes(refusal.code), `${command} -> ${refusal.code}`)
  }
})

test('an environment assignment in front is refused', () => {
  const refusal = proposeRule('FOO=1 git status')
  assert.equal(refusal.ok, false)
  assert.equal(refusal.code, 'unsafe')
})

test('empty and non-string input are refused', () => {
  for (const command of ['', '   ', undefined, null, 42]) {
    const refusal = proposeRule(command)
    assert.equal(refusal.ok, false)
    assert.equal(refusal.code, 'empty')
  }
})

test('a glob or shell metacharacter in the command word is refused', () => {
  for (const command of ['*', 'a*b', 'echo$', './x{1,2}']) {
    const refusal = proposeRule(command)
    assert.equal(refusal.ok, false)
  }
})

test('a subcommand that is itself a flag is refused', () => {
  const refusal = proposeRule('git --version')
  assert.equal(refusal.ok, false)
  assert.equal(refusal.code, 'too-broad')
})

test('a quoted command word is refused rather than half-parsed', () => {
  // The command word is never shell-parsed: a quoted program keeps its quote in
  // the word, so it fails the literal-word check instead of producing a
  // misleading prefix.
  const refusal = proposeRule('"my program" --flag')
  assert.equal(refusal.ok, false)
  assert.equal(refusal.code, 'unsafe')
})

test('commandOf reads only configured shell tools', () => {
  assert.equal(commandOf('bash', { command: 'ls' }, ['bash']), 'ls')
  assert.equal(commandOf('bash', 'ls', ['bash']), 'ls')
  assert.equal(commandOf('read', { path: 'x' }, ['bash']), undefined)
  assert.equal(commandOf('bash', { path: 'x' }, ['bash']), undefined)
})

test('newlines, escapes, expansions, and path-disguised interpreters never get a grant', () => {
  for (const command of ['git status\nid', 'ls\r\nid', 'ls \\x', 'ls *', 'ls ~', 'ls # hi', 'ls "x"', 'ls %PATH%', '/bin/bash script.sh', './rm x', '/usr/bin/git', 'pwsh -c id']) {
    assert.equal(proposeRule(command).ok, false, JSON.stringify(command))
  }
})

test('case variants and shell dispatch builtins cannot disguise broad command grants', () => {
  assert.deepEqual(proposeRule('GIT status -s'), {ok:true,command:'GIT',args:['status'],label:'GIT status'})
  for (const command of ['BASH script.sh','SUDO ls','PwSh -c id','command git status','builtin eval x','time git status','exec git status']) {
    assert.equal(proposeRule(command).ok,false,command)
  }
})
