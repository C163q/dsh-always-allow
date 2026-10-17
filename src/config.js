/**
 * Config schema and resolution for `dsh-always-allow`.
 *
 * Every tunable is a validated field changeable from `cordis.patch.yml`, and
 * `resolveConfig` restates the same defaults for hand-built or test mounts
 * that bypass the schema. The framework convention is "no hardcoded tunable":
 * if a different deployment could want a different value, it is a field here.
 */

import { isAbsolute } from 'node:path'

/** Rule file location, relative to the session cwd unless absolute. */
export const DEFAULT_RULES_FILE = '.dsh/rules.yaml'

/** Shell Tools whose `{command}` argument is offered a prefix rule. */
export const DEFAULT_TOOL_NAMES = ['bash', 'pwsh']

/** Largest accepted request body: two short strings plus JSON framing. */
export const MAX_BODY_BYTES = 4096

/** How many pending approvals are remembered for the browser half. */
export const DEFAULT_MAX_TRACKED = 128

/**
 * Whether a saved `allow` rule also answers a sandbox-escalation approval.
 *
 * OFF by default, and deliberately so: a rule says "this command may run", not
 * "this command may leave the sandbox". Treating the first as the second would
 * silently grant full host access to anything a saved prefix covers, which is a
 * far stronger claim than the click that wrote the rule. Opting in is a
 * workspace owner's decision, made once, in writing.
 */
export const DEFAULT_AUTO_APPROVE_ESCALATION = false

/**
 * @typedef {object} Config
 * @property {string} [rulesFile]    Rule file the `permission-rules` row reads.
 * @property {string[]} [toolNames]  Shell Tool names carrying a `command` argument.
 * @property {number} [maxTracked]   Pending approvals remembered at once.
 * @property {boolean} [autoApproveEscalation] Also answer sandbox escalations.
 */

/**
 * Resolved config: every field present, in the vocabulary the plugin uses.
 * @typedef {object} ResolvedConfig
 * @property {string} rulesFile
 * @property {string[]} toolNames
 * @property {number} maxTracked
 * @property {number} maxBodyBytes
 * @property {boolean} autoApproveEscalation
 */

/**
 * Validate and default a raw user config.
 *
 * Written as plain JS on purpose: the values are simple enough that a schema
 * alone would only restate them, and a malformed value must fail loudly here
 * so a hand-built mount behaves like a Loader-validated one.
 * @param {Config | undefined} config - raw config from the Loader or a test.
 * @returns {ResolvedConfig}
 */
export function resolveConfig(config) {
  const raw = config ?? {}

  const rulesFile = raw.rulesFile ?? DEFAULT_RULES_FILE
  if (typeof rulesFile !== 'string' || rulesFile.trim() === '') {
    throw new Error('always-allow: rulesFile must be a non-empty path')
  }

  const toolNames = raw.toolNames ?? DEFAULT_TOOL_NAMES
  if (!Array.isArray(toolNames) || toolNames.length === 0
    || toolNames.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error('always-allow: toolNames must be a non-empty list of Tool names')
  }

  const maxTracked = raw.maxTracked ?? DEFAULT_MAX_TRACKED
  if (!Number.isInteger(maxTracked) || maxTracked < 1) {
    throw new Error('always-allow: maxTracked must be a positive integer')
  }

  const autoApproveEscalation = raw.autoApproveEscalation ?? DEFAULT_AUTO_APPROVE_ESCALATION
  if (typeof autoApproveEscalation !== 'boolean') {
    throw new Error('always-allow: autoApproveEscalation must be true or false')
  }

  return {
    rulesFile,
    toolNames: [...toolNames],
    maxTracked,
    maxBodyBytes: MAX_BODY_BYTES,
    autoApproveEscalation,
  }
}

/**
 * The rule file this plugin would write for one workspace.
 * @param {string} cwd - Session workspace directory.
 * @param {string} rulesFile - Configured path (relative or absolute).
 * @returns {string} the absolute path.
 */
export function rulesPath(cwd, rulesFile) {
  return isAbsolute(rulesFile)
    ? rulesFile
    : `${cwd.replace(/\/+$/, '')}/${rulesFile}`
}
