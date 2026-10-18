/** Serialize narrowly scoped prefix rules and append them through the YAML AST. */
import { isMap, isSeq, parseDocument, visit } from 'yaml'
import { COMMAND_CHARS } from './prefix.js'

/** A saved rule may grant host access only with this versioned marker. */
export const GRANT_TAG = 'dsh-always-allow/v1/danger-full-access'
export const GRANT_ID_TAG = 'dsh-always-allow/grant/'
export const PREFIX_TAG = 'dsh-always-allow/prefix/'

/** JSON double-quoted scalars are valid YAML and escape control characters. */
export function scalar(value) {
  return JSON.stringify(value)
}

/** Render a rule in the engine's configured glob or regex syntax. */
export function renderRule(proposal, reason, toolNames, options = {}) {
  const label = [proposal.command, ...proposal.args].join(' ')
  const regexEscape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = options.patternMode === 'regex'
    ? [`^${regexEscape(label)}(?: [${COMMAND_CHARS}]*)?$`]
    : [label, `${label} *`, `!*[!${COMMAND_CHARS}]*`]
  const tags = options.autoApproveEscalation === true
    ? [GRANT_TAG, `${PREFIX_TAG}${label}`, `${GRANT_ID_TAG}${options.grantId}`]
    : []
  return [
    '  - match:',
    `      tools: [${toolNames.map(scalar).join(', ')}]`,
    '      params:',
    `        command: [${patterns.map(scalar).join(', ')}]`,
    '    action: allow',
    `    reason: ${scalar(reason)}`,
    `    tags: [${tags.map(scalar).join(', ')}]`,
  ].join('\n')
}

/** Reject unsupported YAML before it can be changed. Aliases obscure write ownership. */
function documentOf(text) {
  const doc = parseDocument(text, { uniqueKeys: true })
  if (doc.errors.length > 0) throw new Error(`invalid rules YAML: ${doc.errors[0].message}`)
  visit(doc, {
    Alias() { throw new Error('rules YAML aliases are not supported for automatic edits') },
    Node(_key, node) {
      if (node.tag !== undefined) throw new Error('rules YAML custom tags are not supported')
    },
  })
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error('rules YAML must be a mapping')
  return doc
}

/** Append below existing policy, retaining comments and all unrelated top-level keys. */
export function insertRule(text, ruleText) {
  const doc = documentOf(String(text ?? ''))
  const incoming = documentOf(`rules:\n${ruleText}\n`).get('rules')
  if (!isSeq(incoming) || incoming.items.length !== 1 || !isMap(incoming.items[0])) {
    throw new Error('expected one rule mapping')
  }
  let rules = doc.get('rules', true)
  if (rules === undefined || rules?.value === null) {
    doc.set('rules', doc.createNode([]))
    rules = doc.get('rules', true)
  }
  if (!isSeq(rules)) throw new Error('rules must be a YAML sequence')
  const entry = incoming.items[0].toJSON()
  if (rules.items.some(item => isMap(item) && JSON.stringify(item.toJSON()) === JSON.stringify(entry))) {
    return text
  }
  rules.flow = false
  rules.add(doc.createNode(entry))
  return doc.toString({ lineWidth: 0 })
}

/** Whether inserting an identical rule would leave the document unchanged. */
export function hasRule(body, ruleText) {
  return insertRule(body, ruleText) === body
}
