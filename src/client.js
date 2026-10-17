window.__ModuleLoader__.load({
  id: 'dsh-always-allow',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Only the platform seed modules are resolvable from a client bundle, so
    // React comes from the seed table and the panel is built with
    // createElement rather than JSX (nothing here is compiled).
    const React = require('react')
    const h = React.createElement

    const NS = 'always-allow'
    const APPROVAL_NS = 'approval'
    const name = 'dsh-always-allow'
    const inject = ['slots', 'locale']

    // Styles ship with the bundle: one owned <style data-plugin-css> tag, the
    // same marker the framework's own CSS injector writes, so the module
    // system can reclaim it on unload. Only theme tokens are used, never a
    // hard-coded palette.
    const CSS = `
.always-allow__root {
  display: flex; flex-direction: column; align-items: center;
  padding: 8px calc(var(--dsh-composer-side-clearance) + 16px) 12px;
}
.always-allow__card {
  overflow: hidden; width: 100%;
  max-width: var(--dsh-chat-content-width);
  border: 1px solid var(--dsw-alias-state-warn-secondary);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-shadow-lv2);
}
.always-allow__strip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-state-warn-primary);
  font-size: 13px; line-height: 18px;
}
.always-allow__strip-dot {
  width: 8px; height: 8px; flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
}
.always-allow__body {
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 16px 0; box-sizing: border-box;
}
.always-allow__headline {
  color: var(--dsw-alias-label-primary);
  font-size: 15px; font-weight: 500; line-height: 24px;
}
.always-allow__command {
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 13px; line-height: 20px; word-break: break-all;
  white-space: pre-wrap; margin: 0; max-height: 160px; overflow-y: auto;
}
.always-allow__row {
  display: flex; justify-content: flex-end;
  align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 14px 16px;
}
.always-allow__note {
  flex: 1 1 auto; min-width: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 18px;
}
.always-allow__note--error { color: var(--dsw-alias-state-error-primary); }
.always-allow__btn {
  font: inherit; font-size: 13px; line-height: 18px; cursor: pointer;
  padding: 5px 14px; border-radius: var(--dsw-radius-xl);
  border: 1px solid var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.always-allow__btn:disabled { opacity: 0.6; cursor: default; }
.always-allow__btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.always-allow__btn--reject:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  border-color: transparent;
}
.always-allow__btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-bg, var(--dsw-alias-label-primary));
  color: var(--dsw-alias-button-primary-label, var(--dsw-alias-bg-layer-1));
}
`

    /** Install the owned stylesheet once per page. */
    function installStyles(id) {
      if (typeof document === 'undefined') return
      const tagId = `${id}/always-allow.css`
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = id
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    const zh = {
      'waiting': '等待审批',
      'detail.aria': '审批详情',
      'escalation': '工具 {toolName} 请求越权执行',
      'reject': '拒绝',
      'allowOnce': '允许一次',
      'allowForever': '永久放行',
      'saving': '正在保存…',
      'saved': '已永久放行',
      'failed': '保存失败',
      'blocked.unsafe': '这条命令带 shell 语法，无法作为字面前缀保存',
      'blocked.compound': '这是一条复合命令（含管道、重定向或引号），没有单一前缀可以描述它',
      'blocked.too-broad': '这条命令需要带上子命令才能安全放行',
      'blocked.never': '这类命令永不通过前缀放行',
      'blocked.empty': '这条调用没有可用的命令文本',
    }
    const en = {
      'waiting': 'Waiting for approval',
      'detail.aria': 'Approval details',
      'escalation': 'Tool {toolName} requests privileged execution',
      'reject': 'Reject',
      'allowOnce': 'Allow once',
      'allowForever': 'Always allow',
      'saving': 'Saving…',
      'saved': 'Always allowed',
      'failed': 'Could not save',
      'blocked.unsafe': 'This command carries shell syntax, so it has no literal prefix',
      'blocked.compound': 'This is a compound command (pipe, redirect, or quoting) with no single prefix',
      'blocked.too-broad': 'This command needs a subcommand to be allowed safely',
      'blocked.never': 'This command is never allowed by a prefix',
      'blocked.empty': 'This call has no command text to build a rule from',
    }

    /**
     * POST one `/always-allow/<endpoint>` request.
     *
     * Same-origin `fetch` carries the page's session cookie, and the host route
     * re-applies the Connection trust check, so this cannot be triggered by a
     * foreign page.
     */
    async function call(endpoint, payload) {
      const response = await fetch(`/always-allow/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    /**
     * Interpolate `{name}` placeholders.
     * @param text - template.
     * @param vars - substitution table.
     */
    function format(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
    }

    /**
     * The approval card with a third decision: always allow this command.
     *
     * It replaces the stock `conversation.composer` entry, so it reproduces that
     * card exactly and adds one button. The two stock decisions are answered
     * through the same `PendingApproval` handle the stock panel uses, so they
     * behave identically; the third first writes the rule, then answers
     * `allowed-once`, so the approval flow itself is unchanged.
     */
    function AlwaysAllowPanel(props) {
      const approval = props.matched
      const [answered, setAnswered] = React.useState(false)
      const [note, setNote] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const waiting = React.useRef(false)

      const callId = approval?.callId
      const [proposal, setProposal] = React.useState({ status: 'idle' })

      React.useEffect(() => {
        if (callId === undefined) {
          setProposal({ status: 'idle' })
          return undefined
        }
        let live = true
        setProposal({ status: 'loading' })
        void call('propose', { callId }).then((value) => {
          if (live) setProposal(value?.ok === true ? { status: 'ready', proposal: value } : { status: 'blocked', result: value })
        }, () => {
          if (live) setProposal({ status: 'unavailable' })
        })
        return () => { live = false }
      }, [callId])

      React.useEffect(() => {
        setAnswered(false)
        setNote(undefined)
        setBusy(false)
        waiting.current = false
      }, [approval?.key])

      if (approval === undefined) return null
      const t = props.t

      const answer = (outcome) => {
        if (waiting.current || !approval.answerable) return
        waiting.current = true
        setAnswered(true)
        void approval.answer(outcome).catch(() => {
          if (!approval.answerable) return
          waiting.current = false
          setAnswered(false)
        })
      }

      const allowForever = () => {
        if (busy || !approval.answerable) return
        setBusy(true)
        setNote(undefined)
        void call('save', { callId }).then((value) => {
          if (value?.ok === true) {
            answer('allowed-once')
            return
          }
          const code = String(value?.code ?? '')
          const key = `blocked.${code}`
          const localized = t(key)
          setNote({
            error: true,
            text: localized === key ? String(value?.message ?? t('failed')) : `${t('failed')}: ${localized}`,
          })
          setBusy(false)
        }, (error) => {
          setNote({ error: true, text: `${t('failed')}: ${String(error?.message ?? error)}` })
          setBusy(false)
        })
      }

      const reason = approval.displayReason === undefined
        ? approval.reason
        : props.resolveReason(approval.displayReason)
      const headline = reason ?? format(t('escalation'), { toolName: approval.toolName })
      const detail = callId === undefined ? null : props.renderSlot('conversation.approval.detail', { callId })

      const foreverLabel = proposal.status === 'ready'
        ? `${t('allowForever')} ${proposal.proposal.command}${proposal.proposal.args.length > 0 ? ` ${proposal.proposal.args.join(' ')}` : ''}*`
        : t('allowForever')

      return h('div', { className: 'always-allow__root' },
        h('div', { className: 'always-allow__card', 'aria-busy': answered },
          h('div', { className: 'always-allow__strip' },
            h('span', { className: 'always-allow__strip-dot' }),
            t('waiting')),
          h('div', { className: 'always-allow__body', role: 'group', 'aria-label': t('detail.aria') },
            h('div', { className: 'always-allow__headline' }, headline),
            detail === null ? null : h('div', { className: 'always-allow__command' }, detail)),
          h('div', { className: 'always-allow__row' },
            note === undefined
              ? null
              : h('div', {
                className: `always-allow__note${note.error ? ' always-allow__note--error' : ''}`,
              }, note.text),
            h('button', {
              type: 'button',
              className: 'always-allow__btn always-allow__btn--reject',
              disabled: answered,
              onClick: () => { answer('rejected') },
            }, t('reject')),
            proposal.status === 'ready' || proposal.status === 'loading'
              ? h('button', {
                type: 'button',
                className: 'always-allow__btn',
                disabled: answered || busy || proposal.status !== 'ready',
                onClick: allowForever,
              }, busy ? t('saving') : foreverLabel)
              : null,
            h('button', {
              type: 'button',
              className: 'always-allow__btn always-allow__btn--primary',
              disabled: answered,
              onClick: () => { answer('allowed-once') },
            }, t('allowOnce')))))
    }

    /**
     * Inject the panel's data face.
     * @param bind - locale binder for this dictionary.
     */
    const panelInject = (bind) => () => ({ t: bind })

    /**
     * Browser plugin body.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const slots = ctx.get('slots')
      const locale = ctx.get('locale')
      if (slots === undefined || locale === undefined) return

      installStyles(name)
      ctx.effect(() => locale.register(NS, { zh, en }), 'always-allow: dictionaries')

      // The chain elects the first entry whose `select` returns non-null.
      // Only a pending approval returns non-null here, so the stock composer
      // entries are unaffected; a plain `allowed-once` falls through to the
      // stock panel normally. Priority 0 places this ahead of the stock
      // approval entry (priority 1) without depending on assembly order.
      ctx.effect(() => slots.inject('conversation.composer', () => slots.register({
        name: 'conversation.composer',
        priority: 0,
        select: ({ pendingInteraction }) =>
          (pendingInteraction?.kind === 'approval' ? pendingInteraction : null),
        locale: NS,
        inject: panelInject(locale.bind(NS)),
        // `conversation.approval.detail` is deliberately NOT declared here: the
        // stock approval entry already owns that child slot, and a slot can be
        // declared only once — a second declaration throws at registration.
        // Rendering an existing child slot needs no declaration of its own, so
        // the panel reuses the stock one instead of claiming it.
      }, AlwaysAllowPanel)), 'always-allow: approval panel')
    }

    exports.NS = NS
    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
