/**
 * The panel's "why is there no forever button" logic, tested without a browser.
 *
 * The client bundle is a `window.__ModuleLoader__` factory, so it cannot be
 * imported by node --test. This file reads the source and evaluates the one
 * pure helper it needs, which keeps the assertion honest without a DOM.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

/** Evaluate `blockedHintOf` out of the bundle source. */
function loadHelper() {
  const start = source.indexOf('const blockedHintOf =')
  assert.notEqual(start, -1, 'the bundle still defines blockedHintOf')
  const end = source.indexOf('\n    }\n', start)
  assert.notEqual(end, -1, 'the helper body terminates')
  const body = source.slice(start, end + '\n    }'.length)
  return new Function(`${body}; return blockedHintOf`)()
}

/** A dictionary lookup that mimics the real one: a miss returns the key. */
function dictionary(entries) {
  return (key) => entries[key] ?? key
}

test('a compound command explains why there is no forever button', () => {
  const t = dictionary({ 'blocked.compound': '这是一条复合命令' })
  const hint = loadHelper()({ status: 'blocked', result: { code: 'compound' } }, t)
  assert.equal(hint, '这是一条复合命令')
})

test('every refusal code with copy produces a hint', () => {
  const codes = ['empty', 'unsafe', 'compound', 'too-broad', 'never']
  const entries = Object.fromEntries(codes.map((code) => [`blocked.${code}`, `why-${code}`]))
  const t = dictionary(entries)
  const helper = loadHelper()
  for (const code of codes) {
    assert.equal(helper({ status: 'blocked', result: { code } }, t), `why-${code}`)
  }
})

test('a ready proposal shows no hint', () => {
  const t = dictionary({ 'blocked.compound': 'x' })
  assert.equal(loadHelper()({ status: 'ready', proposal: { command: 'touch', args: [] } }, t), null)
})

test('an unknown code stays silent instead of printing the key', () => {
  const t = dictionary({})
  assert.equal(loadHelper()({ status: 'blocked', result: { code: 'mystery' } }, t), null)
  assert.equal(loadHelper()({ status: 'blocked', result: {} }, t), null)
  assert.equal(loadHelper()({ status: 'blocked' }, t), null)
})

test('the bundle ships copy for every refusal code', () => {
  // The helper is only useful if the sentences exist in both dictionaries.
  for (const code of ['empty', 'unsafe', 'compound', 'too-broad', 'never']) {
    const occurrences = source.split(`'blocked.${code}':`).length - 1
    assert.equal(occurrences, 2, `blocked.${code} needs one zh and one en entry`)
  }
})
