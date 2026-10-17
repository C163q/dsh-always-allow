/**
 * Config resolution: what a Loader-less mount sees, and what a bad value does.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES_FILE, DEFAULT_TOOL_NAMES, resolveConfig, rulesPath } from '../src/config.js'

test('an absent config resolves to the documented defaults', () => {
  const resolved = resolveConfig(undefined)
  assert.equal(resolved.rulesFile, DEFAULT_RULES_FILE)
  assert.deepEqual(resolved.toolNames, DEFAULT_TOOL_NAMES)
  assert.equal(resolved.maxTracked, 128)
  assert.equal(resolved.maxBodyBytes, 4096)
})

test('user values replace defaults', () => {
  const resolved = resolveConfig({ rulesFile: 'cfg/rules.yaml', toolNames: ['shell'], maxTracked: 4 })
  assert.equal(resolved.rulesFile, 'cfg/rules.yaml')
  assert.deepEqual(resolved.toolNames, ['shell'])
  assert.equal(resolved.maxTracked, 4)
})

test('the default toolNames array is copied, never shared', () => {
  const first = resolveConfig(undefined)
  first.toolNames.push('mutated')
  assert.deepEqual(resolveConfig(undefined).toolNames, DEFAULT_TOOL_NAMES)
})

test('bad values fail loudly', () => {
  assert.throws(() => resolveConfig({ rulesFile: '' }), /rulesFile/)
  assert.throws(() => resolveConfig({ rulesFile: 3 }), /rulesFile/)
  assert.throws(() => resolveConfig({ toolNames: [] }), /toolNames/)
  assert.throws(() => resolveConfig({ toolNames: [''] }), /toolNames/)
  assert.throws(() => resolveConfig({ toolNames: 'bash' }), /toolNames/)
  assert.throws(() => resolveConfig({ maxTracked: 0 }), /maxTracked/)
  assert.throws(() => resolveConfig({ maxTracked: 1.5 }), /maxTracked/)
})

test('a relative rulesFile resolves against the workspace, an absolute one does not', () => {
  assert.equal(rulesPath('/ws', '.dsh/rules.yaml'), '/ws/.dsh/rules.yaml')
  assert.equal(rulesPath('/ws/', '.dsh/rules.yaml'), '/ws/.dsh/rules.yaml')
  assert.equal(rulesPath('/ws', '/etc/rules.yaml'), '/etc/rules.yaml')
})
