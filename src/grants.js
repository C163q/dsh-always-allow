/** Host-side authorization ledger. Reading an id never permits widening its scope. */
import { randomUUID } from 'node:crypto'
import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

function inside(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel))
}

/** Bind a grant to the exact host policy scope. */
function payload(grant) {
  return JSON.stringify([1, resolve(grant.cwd), resolve(grant.file), grant.tool, grant.prefix, 'danger-full-access'])
}

/** Refuse ledger storage inside the model's workspace, including symlinked parents. */
function checkLocation(file, cwd) {
  for (const root of ['/tmp', tmpdir()]) {
    const canonical = existsSync(root) ? realpathSync(root) : resolve(root)
    if (inside(resolve(root), resolve(file)) || inside(canonical, resolve(file))) {
      throw new Error('authorization ledger must be outside sandbox-writable temporary roots')
    }
  }
  if (inside(resolve(cwd), resolve(file))) throw new Error('authorization ledger must be outside the session workspace')
  let parent = dirname(resolve(file))
  while (!existsSync(parent)) parent = dirname(parent)
  const actual = resolve(realpathSync(parent), relative(parent, resolve(file)))
  for (const root of ['/tmp', tmpdir()]) {
    if (existsSync(root) && inside(realpathSync(root), actual)) throw new Error('authorization ledger must be outside sandbox-writable temporary roots')
  }
  if (inside(realpathSync(cwd), actual)) throw new Error('authorization ledger must be outside the session workspace')
}

/** Read only regular files, refusing symlinks and corrupt authorization data. */
function readLedger(file) {
  if (!existsSync(file)) return { version: 1, grants: {} }
  if (!lstatSync(file).isFile()) throw new Error('authorization ledger must be a regular file')
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let data
  try { data = JSON.parse(readFileSync(fd, 'utf8')) } finally { closeSync(fd) }
  if (data?.version !== 1 || data.grants === null || typeof data.grants !== 'object' || Array.isArray(data.grants)) {
    throw new Error('invalid authorization ledger')
  }
  return data
}

/** Issue and verify opaque grants stored outside the writable workspace. */
export function createGrantStore(file) {
  return {
    idFor(grant) {
      checkLocation(file, grant.cwd)
      const data = readLedger(file)
      return Object.keys(data.grants).find(id => data.grants[id] === payload(grant)) ?? randomUUID()
    },
    issue(grant, requestedId) {
      checkLocation(file, grant.cwd)
      const data = readLedger(file)
      const value = payload(grant)
      const prior = Object.keys(data.grants).find(id => data.grants[id] === value)
      if (prior !== undefined && requestedId === undefined) return prior
      const id = requestedId ?? randomUUID()
      data.grants[id] = value
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      checkLocation(file, grant.cwd)
      const temp = `${file}.${randomUUID()}.tmp`
      const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      try {
        writeFileSync(fd, JSON.stringify(data))
        fsyncSync(fd)
      } finally { closeSync(fd) }
      try { renameSync(temp, file) } finally { if (existsSync(temp)) unlinkSync(temp) }
      return id
    },
    verify(grant, id) {
      try {
        checkLocation(file, grant.cwd)
        const ledger = readLedger(file)
        return typeof id === 'string' && Object.hasOwn(ledger.grants, id)
          && ledger.grants[id] === payload(grant)
      } catch {
        // Missing, corrupt, or workspace-writable authorization is never a grant.
        return false
      }
    },
  }
}
