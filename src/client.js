window.__ModuleLoader__.load({
  id: 'dsh-always-allow',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Only the platform seed modules are resolvable from a client bundle, so
    // React comes from the seed table and the banner is built with
    // createElement rather than JSX (nothing here is compiled).
    const React = require('react')
    const h = React.createElement

    const NS = 'always-allow'
    const name = 'dsh-always-allow'
    const inject = ['slots', 'locale']

    // Styles ship with the bundle: one owned <style data-plugin-css> tag, the
    // same marker the framework's own CSS injector writes, so the module
    // system can reclaim it on unload. Only theme tokens are used, never a
    // hard-coded palette.
    const CSS = `
.always-allow, .always-allow__note, .always-allow__done {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 0 8px; padding: 8px 12px;
  border-radius: var(--dsw-radius-xl);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 18px;
}
.always-allow__button {
  font: inherit; font-weight: 500; cursor: pointer;
  padding: 4px 12px; border-radius: var(--dsw-radius-xl);
  border: 1px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.always-allow__button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.always-allow__button:disabled { opacity: 0.6; cursor: default; }
.always-allow__hint {
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
}
.always-allow__done { color: var(--dsw-alias-label-primary); }
.always-allow__note { border-color: var(--dsw-alias-state-warn-secondary); }
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
      'title': '永久放行',
      'saving': '正在保存规则…',
      'saved': '已保存永久放行规则',
      'failed': '保存失败',
      'hint': '写入本工作区的规则文件，由 permission-rules 生效',
      'blocked.unsafe': '这条命令带 shell 语法，无法作为字面前缀保存',
      'blocked.compound': '这是一条复合命令（含管道、重定向或引号），没有单一前缀可以描述它',
      'blocked.too-broad': '这条命令需要带上子命令才能安全放行',
      'blocked.never': '这类命令永不通过前缀放行，请逐次批准',
      'blocked.empty': '这条调用没有可用的命令文本',
    }
    const en = {
      'title': 'Always allow',
      'saving': 'Saving rule…',
      'saved': 'Always-allow rule saved',
      'failed': 'Could not save the rule',
      'hint': 'Writes this workspace rule file, which permission-rules reads',
      'blocked.unsafe': 'This command carries shell syntax, so it has no literal prefix',
      'blocked.compound': 'This is a compound command (pipe, redirect, or quoting) with no single prefix',
      'blocked.too-broad': 'This command needs a subcommand to be allowed safely',
      'blocked.never': 'This command is never allowed by a prefix — approve it one call at a time',
      'blocked.empty': 'This call has no command text to build a rule from',
    }

    /**
     * Read the pending approval's Tool call id from the Session snapshot.
     * `ui-approval` publishes its `PendingApproval` as the session's
     * `pendingInteraction`, so `kind` and `callId` are the only facts needed.
     */
    function pendingCallId(session) {
      const pending = session?.pendingInteraction
      if (pending === undefined || pending === null || pending.kind !== 'approval') return undefined
      return typeof pending.callId === 'string' ? pending.callId : undefined
    }

    /** Call one `/always-allow` endpoint through the page's Connection RPC. */
    /**
     * POST one `/always-allow/<endpoint>` request.
     *
     * Same-origin `fetch` carries the page's session cookie, and the host route
     * re-applies the Connection trust check, so this cannot be triggered by a
     * foreign page. The generic `connection.rpc` channel is deliberately not
     * used: its provider registers routes on its OWN context, which breaks
     * route registration for consumer plugins.
     */
    async function call(endpoint, payload) {
      const response = await fetch(`/always-allow/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      if (!response.ok) throw new Error(`always-allow ${endpoint} failed: HTTP ${response.status}`)
      return await response.json()
    }

    /**
     * Banner above the composer for the pending approval.
     *
     * It renders nothing until an approval is pending AND the host offers a
     * saveable prefix. A host refusal is shown as one short note, so a missing
     * button is never a mystery; a note is never shown for an approval that
     * simply ended.
     */
    function AlwaysAllowBanner(props) {
      const t = props.t
      const session = typeof props.useSession === 'function' ? props.useSession((snapshot) => snapshot) : undefined
      const callId = pendingCallId(session)
      const [state, setState] = React.useState({ status: 'idle' })
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        if (callId === undefined) {
          setState({ status: 'idle' })
          return undefined
        }
        let live = true
        setState({ status: 'loading' })
        void call('propose', { callId }).then((value) => {
          if (!live) return
          if (value?.ok === true) setState({ status: 'ready', proposal: value })
          else setState({ status: 'blocked', result: value })
        }, () => {
          if (live) setState({ status: 'unavailable' })
        })
        return () => { live = false }
      }, [callId])

      if (callId === undefined || state.status === 'idle'
        || state.status === 'loading' || state.status === 'unavailable') return null

      if (state.status === 'blocked') {
        const code = String(state.result?.code ?? '')
        if (code === 'unknown-call') return null
        const key = `blocked.${code}`
        const localized = t(key)
        const message = localized === key ? String(state.result?.message ?? '') : localized
        return h('div', { className: 'always-allow__note' }, message)
      }

      if (state.status === 'saved') {
        return h('div', { className: 'always-allow__done' }, `${t('saved')} · ${state.label}*`)
      }
      if (state.status === 'error') {
        return h('div', { className: 'always-allow__note' }, `${t('failed')}: ${state.message}`)
      }

      const proposal = state.proposal
      const onAlwaysAllow = () => {
        if (busy) return
        setBusy(true)
        setState({ status: 'saving', proposal })
        void call('save', { callId }).then((value) => {
          if (value?.ok === true) setState({ status: 'saved', label: value.label })
          else setState({ status: 'error', message: String(value?.message ?? '') })
        }, (error) => {
          setState({ status: 'error', message: String(error?.message ?? error) })
        }).finally(() => { setBusy(false) })
      }

      const label = `${proposal.command}${proposal.args.length > 0 ? ` ${proposal.args.join(' ')}` : ''}`
      return h('div', { className: 'always-allow' },
        h('button', {
          type: 'button',
          className: 'always-allow__button',
          disabled: busy || state.status === 'saving',
          onClick: onAlwaysAllow,
        }, state.status === 'saving' ? t('saving') : `${t('title')} ${label}*`),
        h('span', { className: 'always-allow__hint' }, t('hint')))
    }

    /**
     * Inject the banner's data face.
     * @param channel - the page's Connection handle.
     * @param bind - locale binder for this dictionary.
     */
    const bannerInject = (bind) => () => ({ t: bind })

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

      ctx.effect(() => slots.inject('conversation.input.dock', () => slots.register({
        name: 'conversation.input.dock',
        id: 'always-allow',
        order: 50,
        locale: NS,
        inject: bannerInject(locale.bind(NS)),
      }, AlwaysAllowBanner)), 'always-allow: banner')
    }

    exports.NS = NS
    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
