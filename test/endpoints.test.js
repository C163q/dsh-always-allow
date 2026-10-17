/**
 * Endpoint behaviour: what the browser half can ask for, and what it gets.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatch, lookup, proposeFor, saveFor } from '../src/endpoints.js'

/** A store whose appender records the write instead of touching a filesystem. */
function store(entries, overrides = {}) {
  const calls = new Map(entries)
  const written = []
  return {
    calls,
    written,
    deps: {
      calls,
      rulesFile: '.dsh/rules.yaml',
      toolNames: ['bash'],
      appendRule: async (file, text) => { written.push({ file, text }); return file },
      ...overrides,
    },
  }
}

test('a pending shell call yields its prefix', () => {
  const { deps } = store([['c1', { command: 'git status --short', cwd: '/ws' }]])
  assert.deepEqual(proposeFor(deps.calls, 'c1'), {
    ok: true, command: 'git', args: ['status'], label: 'git status',
  })
})

test('an unknown or finished call is reported, not crashed', () => {
  const { deps } = store([])
  for (const callId of ['nope', undefined, 42]) {
    const result = proposeFor(deps.calls, callId)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'unknown-call')
  }
})

test('a pending call with no safe prefix reports why', () => {
  const { deps } = store([['c1', { command: 'rm -rf /', cwd: '/ws' }]])
  const result = proposeFor(deps.calls, 'c1')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'never')
})

test('saving writes to the workspace rule file and forgets the call', async () => {
  const { deps, written, calls } = store([['c1', { command: 'git status --short', cwd: '/ws' }]])
  const result = await saveFor(deps, 'c1')
  assert.equal(result.ok, true)
  assert.equal(result.value.file, '/ws/.dsh/rules.yaml')
  assert.equal(result.value.label, 'git status')
  assert.equal(written.length, 1)
  assert.match(written[0].text, /command: "git"/)
  assert.match(written[0].text, /args: \["status"\]/)
  assert.equal(calls.has('c1'), false, 'the approval is consumed')
})

test('an absolute rulesFile is used verbatim', async () => {
  const { deps, written } = store(
    [['c1', { command: 'ls', cwd: '/ws' }]],
    { rulesFile: '/etc/rules.yaml' },
  )
  await saveFor(deps, 'c1')
  assert.equal(written[0].file, '/etc/rules.yaml')
})

test('a refusal never writes', async () => {
  const { deps, written } = store([['c1', { command: 'sudo ls', cwd: '/ws' }]])
  const result = await saveFor(deps, 'c1')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'never')
  assert.equal(written.length, 0)
})

test('a caller-supplied reason replaces the default one', async () => {
  const { deps, written } = store([['c1', { command: 'ls', cwd: '/ws' }]])
  await saveFor(deps, 'c1', '  our reason  ')
  assert.match(written[0].text, /reason: "our reason"/)
})

test('an unknown call cannot be saved', async () => {
  const { deps, written } = store([])
  const result = await saveFor(deps, 'nope')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unknown-call')
  assert.equal(written.length, 0)
})

test('dispatch routes both endpoints and rejects others', async () => {
  const { deps } = store([
    ['c1', { command: 'git status', cwd: '/ws' }],
    ['c2', { command: 'ls -la', cwd: '/ws' }],
  ])
  assert.equal((await dispatch(deps, 'propose', { callId: 'c1' })).label, 'git status')
  assert.equal((await dispatch(deps, 'save', { callId: 'c2' })).ok, true)
  const bad = await dispatch(deps, 'drop', {})
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'bad-endpoint')
})

test('lookup distinguishes a missing id from an unknown one', () => {
  const calls = new Map([['c1', { command: 'ls', cwd: '/ws' }]])
  assert.equal(lookup(calls, 'c1').ok, true)
  assert.equal(lookup(calls, 'c2').code, 'unknown-call')
})
