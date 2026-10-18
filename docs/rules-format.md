# Saved prefix rules

New rules use `match.params.command`, not `argv.args`. The engine interprets `argv.args` as token membership, which cannot express an ordered literal prefix.

A glob-mode rule for `git status` has this structure (ids and reason shortened):

```yaml
rules:
  - match:
      tools: [bash]
      params:
        command:
          - git status
          - git status *
          - '!*[!A-Za-z0-9_@+=:,./ -]*'
    action: allow
    reason: 'Always allow git status with danger-full-access in this workspace'
    tags:
      - dsh-always-allow/v1/danger-full-access
      - dsh-always-allow/prefix/git status
      - dsh-always-allow/grant/opaque-id
```

The two positive patterns cover the exact prefix and a space-delimited continuation. The negative pattern rejects characters outside the supported plain-command grammar. Regex-mode saves use an anchored expression for the same grammar. The exact approved tool is retained. Existing comments, flow/block lists, and earlier rule order are preserved through YAML document edits; malformed YAML, duplicate keys, aliases, custom tags, unsupported rule schema, and changed files are refused before commit.

The tags alone confer no host access. The opaque id must refer to an exact record in `$DSH_HOME/always-allow/grants.json`, outside model-writable roots. Hand-written or copied allow rules do not create records. Ordinary approvals and saves with automatic escalation disabled carry no host grant tags.

First-match deny/ask precedence remains unchanged. New entries append after existing entries. If the first policy hit is an ordinary allow, a later explicit grant rule may authorize host access only for its matching prefix and exact host-ledger scope. This lets a user reauthorize a legacy prefix without reordering or changing the legacy policy. Both the ordinary policy decision and the explicit grant must permit the current invocation.

Deleting the workspace rule immediately stops the automatic match. To revoke against restoration of an old rule, also remove the matching id from the host ledger while the Web service is stopped. See the README for revocation and host-policy trust requirements.
