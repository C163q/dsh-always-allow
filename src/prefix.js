/**
 * Command-prefix derivation.
 *
 * Turns "the user just approved `git status --short`" into the prefix worth
 * remembering: `git status`. The result is a PREFIX, not a fingerprint — one
 * command word plus, when the command needs one, one literal subcommand.
 * Everything after it stays free, which is what makes a saved rule behave like
 * Codex's "always allow commands that start with …" rather than "allow this
 * exact invocation".
 *
 * This module is pure: no filesystem, no clock, no process state.
 */

/**
 * A saved rule is built from shell words, so each word must be unambiguous.
 * Anything carrying shell syntax, glob metacharacters, or whitespace is
 * refused outright rather than escaped — an allow rule must never come from a
 * fragment whose meaning depends on quoting.
 */
export const SAFE_WORD = /^[A-Za-z0-9_@+=:,./-]+$/

/** Shared character grammar for plain, unquoted command strings. */
export const COMMAND_CHARS = 'A-Za-z0-9_@+=:,./ -'
export const SAFE_COMMAND = new RegExp(`^[${COMMAND_CHARS}]+$`)

/**
 * Commands whose meaning lives in their first argument. Allowing bare `npm`
 * would allow `npm run anything`, and bare `git` would allow `git push
 * --force`, so these require one literal subcommand in the saved prefix.
 */
export const NEEDS_SUBCOMMAND = new Set([
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'make', 'cmake',
  'docker', 'podman', 'kubectl', 'helm', 'systemctl', 'gh', 'ssh', 'scp',
  'pip', 'pip3', 'poetry', 'uv', 'deno', 'node', 'python', 'python3', 'ruby',
  'perl', 'php', 'java', 'dotnet', 'mvn', 'gradle', 'terraform', 'aws', 'gcloud',
])

/**
 * Commands never offered as a prefix, whatever their arguments. A prefix rule
 * for any of these would run arbitrary code or cause irreversible damage
 * behind one click, so no button is offered and the user keeps approving them
 * one call at a time.
 */
export const NEVER_PREFIXABLE = new Set([
  'sudo', 'doas', 'su', 'pkexec', 'eval', 'exec', 'source', '.',
  'command', 'builtin', 'time', 'coproc', 'function', 'alias', 'unalias',
  'export', 'declare', 'typeset', 'local', 'readonly', 'set', 'trap', 'fc',
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd',
  'xargs', 'env', 'nice', 'nohup', 'timeout', 'watch', 'parallel', 'find',
  'rm', 'rmdir', 'unlink', 'shred', 'dd', 'mkfs', 'fdisk', 'parted', 'truncate',
  'chmod', 'chown', 'chgrp', 'setfacl', 'mount', 'umount', 'iptables', 'nft',
  'shutdown', 'reboot', 'halt', 'poweroff', 'kill', 'killall', 'pkill',
  'curl', 'wget', 'tee', 'install', 'git-remote-ext', 'ssh-keygen',
])

/** Shell operators that make a command line a compound, not one invocation. */
export const OPERATORS = /[|&;<>`$(){}]|\|\||&&/

/**
 * Reasons a command yields no prefix. Each maps to one localized sentence in
 * the client, so the user is told why the button is missing instead of being
 * left to guess.
 * @typedef {'empty'|'unsafe'|'compound'|'too-broad'|'never'} RefusalCode
 */

/** Split a command line into words, isolating leading `VAR=value` assignments. */
export function wordsOf(command) {
  const words = command.trim().split(/\s+/).filter((word) => word !== '')
  let index = 0
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index += 1
  return { head: words.slice(0, index), word: words[index], rest: words.slice(index + 1) }
}

/** Quote a word with spaces as one shell word, so it reads like the real invocation. */
function quoteWord(word) {
  return /\s/.test(word) ? `"${word}"` : word
}

/**
 * Turn a command line into the prefix worth saving.
 * @param command - raw command line recovered from the tool call.
 * @returns `{ok: true, command, args, label}`, or `{ok: false, code, message}`.
 */
export function proposeRule(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { ok: false, code: 'empty', message: 'this call has no command line to build a rule from' }
  }
  const { head, word, rest } = wordsOf(command)
  if (word === undefined) {
    return { ok: false, code: 'empty', message: 'this call has no command word to build a rule from' }
  }
  if (head.length > 0) {
    return {
      ok: false,
      code: 'unsafe',
      message: `"${word}" runs behind an environment assignment, so a prefix rule would not describe it`,
    }
  }
  const executablePath = word.includes('/')
  const basename = word.slice(word.lastIndexOf('/') + 1)
  const executable = basename.toLowerCase().replace(/\.(?:exe|com|cmd|bat)$/, '')
  const validWord = executablePath
    ? SAFE_WORD.test(word) && !word.startsWith('-') && basename !== '' && basename !== '.' && basename !== '..'
    : /^[A-Za-z_][A-Za-z0-9_-]*$/.test(word)
  if (!validWord) {
    return {
      ok: false,
      code: 'unsafe',
      message: `"${word}" contains shell or glob syntax, so it cannot be saved as a literal prefix`,
    }
  }
  if (NEVER_PREFIXABLE.has(executable)) {
    return {
      ok: false,
      code: 'never',
      message: `"${word}" is never allowed by a saved prefix — approve it one call at a time`,
    }
  }
  // A compound line can hide an arbitrary second command in the part a prefix
  // would not cover, so it is saved for nothing but its head word.
  const compound = !SAFE_COMMAND.test(command)
    || OPERATORS.test(command)
    || /"[^"]*\s[^"]*"/.test(command)
    || /'[^']*\s[^']*'/.test(command)
  if (compound) {
    return {
      ok: false,
      code: 'compound',
      message: 'this is a compound command (pipe, redirect, or quoting), so no single prefix describes it',
    }
  }
  const args = []
  if (NEEDS_SUBCOMMAND.has(executable)) {
    const sub = rest[0]
    if (sub === undefined) {
      return {
        ok: false,
        code: 'too-broad',
        message: `"${word}" needs a subcommand — save "${word} status" rather than every ${word} command`,
      }
    }
    if (!SAFE_WORD.test(sub) || sub.startsWith('-')) {
      return {
        ok: false,
        code: 'too-broad',
        message: `"${word} ${sub}" is not a plain subcommand, so it cannot be the prefix`,
      }
    }
    args.push(sub)
  }
  return { ok: true, command: word, args, label: [word, ...args].map(quoteWord).join(' '), ...(executablePath ? { executablePath: true } : {}) }
}

/**
 * The command line a shell Tool call carries, if this plugin tracks that tool.
 * @param toolName - Tool name from the execution.
 * @param args - Parsed Tool arguments.
 * @param toolNames - Configured shell Tool names.
 * @returns the command line, or `undefined` when this call is not a shell call.
 */
export function commandOf(toolName, args, toolNames) {
  if (!toolNames.includes(toolName)) return undefined
  if (typeof args === 'string') return args
  return typeof args?.command === 'string' ? args.command : undefined
}
