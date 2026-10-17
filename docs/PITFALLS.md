# Pitfalls

Hard-won findings from building this plugin against the real Harness profile.
Every item below cost at least one debugging round; each one failed **silently**,
which is what made it expensive. Read this before changing the host half, the
browser half, or the install instructions.

## 1. A declared-but-unprovided Service freezes the whole row

```js
export const inject = ['webServer', 'connection']   // WRONG here
```

Cordis builds a fiber's dependency epoch from the Services in `inject`. If one
of them is never provided, the epoch stays `INACTIVE`: the fiber sits in state
`0` (pending) **forever**, with no error, no warning, and no log line.

`connection` is provided by the `client-connection` row. Its activation is not
ordered before a plugin row inserted by a profile bundle, so declaring it kept
this plugin permanently pending.

Two symptoms, one cause — and both looked like unrelated bugs:

- the host half never ran, so `/always-allow` returned the SPA fallback's `405`;
- the pending fiber also kept the package **out of the client boot graph**, so
  the approval panel did not exist at all and the approval card vanished.

**Rule:** declare only Services that are guaranteed present before your row, and
read optional ones lazily with `ctx.get(name)` at call time. `tools` is not
needed to listen on `tools/pre-execute`.

## 2. A `405` from a prefix route means "no route", not "wrong method"

The webserver's fallback (the SPA dist server) answers unmatched requests with
`405`, so a probe like

```bash
curl -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:PORT/always-allow/propose
```

returns the **same** `405` whether the route is missing or the request was
rejected for its method. Comparing against a bogus path does not distinguish
them either — the bogus path hits the same fallback.

**Rule:** treat `401` as "route exists, authentication gate reached". Anything
that reaches the fallback is indistinguishable, so verify route liveness by
logging inside the handler instead of by status code.

## 3. `webServer.register()` succeeding does not mean the route stays

Registration returns a disposer. When the owning fiber is torn down, that
disposer runs and the route disappears. In this profile the whole tree is
recomposed once shortly after startup, so a route can be registered and disposed
within milliseconds:

```
REGISTERED port=4132
DISPOSED
```

**Rule:** when a route 404/405s, log inside the handler *and* inside the
disposer. A registered-then-disposed route and a never-registered route look
identical from the outside.

## 4. The enable/disable state lives in the market plugin, not the patch

The user toggling the plugin in Settings writes:

```json
// ~/.dsh/profiles/web/.dsh-market/state.json
{"disabled": ["dsh-always-allow"]}
```

That is **not** `cordis.patch.yml`. Consequences:

- `dsh --dump-config` shows the row with `disabled: false` while the row is
  still inactive at runtime, because the market row applies the disable later;
- deleting `- id: always-allow / disabled: true` from `cordis.patch.yml` does
  nothing;
- the entry's `status` in the Config inspector reads `inactive` while its patch
  row looks enabled.

**Rule:** to enable a plugin that was disabled from the UI, remove it from
`.dsh-market/state.json` `disabled`. Use `cordis_inspect_query` with the host
`Config` provider (`name: <package>`) to see the live truth — it reports the
actual `status`.

## 5. Being in `dependencies` does not load a bundle patch

A package must be listed in `package.json` → `dsh.profile.bundles` for its own
`cordis.patch.yml` to be applied. Installing it (adding it to `dependencies`)
is not enough: the row never appears, and neither half loads.

**Rule:** after installing, check `dsh.profile.bundles`. A path/git install adds
a dependency; the bundle list is separate.

## 6. A child Slot can be declared only once

```js
children: { 'conversation.approval.detail': { kind: 'single', scope: 'session' } }
```

The stock approval entry already declares that child slot, so a second
declaration throws at registration:

```
Error: slot "conversation.approval.detail" is already declared
       (by an entry in "conversation.composer" (Kb))
```

The throw happens during `apply`, so the **entire browser half fails to load** —
no panel, no banner, and no visible error in the UI.

**Rule:** declaring a child slot claims ownership; rendering one does not.
Call `props.renderSlot('conversation.approval.detail', { callId })` and do not
declare it.

## 7. Approvals are rendered in `conversation.composer`, not in a dock

`conversation.input.dock` is the row of chips *above* the composer. The approval
card is a **chain** slot takeover of `conversation.composer`: the stock panel
registers with `priority: 1` and `select` returns the pending interaction.

A banner registered in the dock renders nothing an approval ever shows, so it
looks like the plugin does nothing at all.

**Rule:** to add a decision to the approval UI you must take over
`conversation.composer` with a lower `priority`, elect only on
`pendingInteraction.kind === 'approval'`, and return `null` otherwise so every
other composer state falls through.

## 8. `ApprovalOutcome` has no permanent-allow value

```ts
export type ApprovalDecision = 'allowed-once' | 'rejected'
```

The two stock buttons are hard-coded and there is no extension slot for the
action row. "Always allow" therefore cannot be an added button; the panel has to
be replaced, and the third action must do its work *before* answering
`allowed-once`.

**Rule:** answer the approval through the same `PendingApproval` handle the
stock panel uses, so the flow stays authoritative. On a failed save, keep the
approval open and show why — never answer and swallow the error.

## 9. Client bundles are composed at host boot

Editing `src/client.js` has no effect on a running page, and a page reload is
not enough: the host composes the client graph (and the `?rev=` hash) at
startup. The browser also keeps the old bundle cached per tab.

**Rule:** after a client-half change, restart `dsh web` **and** open a fresh
tab. An old tab silently keeps running the previous bundle, which reads as "the
fix did nothing".

## 10. The GUI needs the launch token; the process may be invisible

`http://127.0.0.1:3080/` answers `401` without the `?token=` printed by `dsh web`
on startup. In this sandbox `ps` cannot see the serving process, so it is not
possible to inspect the live instance directly.

**Rule:** start an instrumented instance on a spare port with `--no-open`,
capture the token from its log, and drive that one. A throwaway instance on
another port does not touch the profile's live session.

## 11. `--patch` overlays are not a substitute for real enablement

An overlay can `insert` a row, but a row that the market row disables later is
still inactive, and a duplicated `insert` across the bundle patch and a profile
patch inserts the row **twice**.

**Rule:** fix the actual enablement path (bundle list + market state). Use
`--patch` only to probe a change, never to work around a disabled plugin.

## 12. The Loader will not rename a row

```yaml
- id: fs-observation-policy
  name: dsh-something-else
```

```
dsh: [<patch>] patch: name mismatch for "fs-observation-policy"
     (expected "...", got "dsh-something-else"), skipping
```

An id-targeted entry replaces that row's **config**, and cannot change its
`name`. To add behaviour, `insert` a new row; do not try to retarget an
existing one.

## 13. `apply` runs one macrotask after `app.plugin(...)`

Cordis honours `inject` asynchronously, so a test that mounts and immediately
asserts sees an unregistered route. Await the fiber, and remember that a fiber
is not a Promise: a rejected mount surfaces through
`await assert.rejects(async () => { await app.plugin(...) }, ...)`.

## 14. `webServer` routes are raw `node:http`

`WebRoute.handler` receives `(req: IncomingMessage, res: ServerResponse)`. There
is no `res.status()` / `res.json()`. Calling Express-style helpers throws
`res.status is not a function`, which the webserver's last-resort guard swallows
into a bare `400` — a fake response object in a test hides this completely.

**Rule:** write with `res.writeHead(status, headers)` and `res.end(body)`, and
make the test's response recorder a real `node:http` mock, not an object with
hand-written methods.

## 15. An agentless file write lands outside the workspace

Writing through the FS service without a sandbox policy resolves the workspace
from the **server** cwd, so a write into the session workspace is denied with
`file access denied under workspace-write mode`.

**Rule:** resolve `sandboxPolicy.resolve({ session })` and pass it through, or
write the file directly — this plugin appends to a rule file with `node:fs`,
which needs no policy at all.
