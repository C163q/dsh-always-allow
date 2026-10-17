# dsh-always-allow

**为 DeepSeek Harness 的审批加上「永久放行以 … 开头的命令」。**

原生审批面板只有两个答案：*拒绝* 和 *允许一次*。同一个会话里第十次批准
`git status`，纯粹是噪音。这个插件补上第三个答案 —— 一键生成 **前缀规则** ——
并把它写进 [`dsh-permission-rules`](https://github.com/PerryLink/dsh-permission-rules)
本就已经在读取的工作区规则文件。

这正是 [Codex 的审批方式](https://learn.chatgpt.com/docs/agent-approvals-security#sandbox-and-approvals)
（「永久允许以 `git status` 开头的命令」）与
[opencode 的 `always`](https://opencode.ai/docs/zh-cn/permissions/) 的行为，
建立在 harness 现有的声明式规则引擎之上。

[English](./README.md)

---

## 你会看到什么

当某个 shell 命令的审批挂起时，输入框上方会出现一条：

```
[ 永久放行 git status* ]   写入本工作区的规则文件，由 permission-rules 生效
```

点一下，即追加一条规则，审批随之结束：

```yaml
rules:
  - match:
      tools: [bash, pwsh]
      argv:
        command: "git"
        args: ["status"]
    action: allow
    reason: "Always allow \"git status\" in this workspace (saved from the approval prompt)"
```

此后该工作区里所有 `git status …`（`--short`、`-s` 等）都不再询问，
而 `git push` 仍然会问。

**插件本身从不作答审批。** 它在 `tools/pre-execute` 上只返回中立的
`{kind: 'allow'}` 透传，所以决定权始终在 `permission-rules` —— 只有一个权威，
不是两个。

---

## 安装

前置条件：一个 DeepSeek Harness profile（`dsh` CLI 在 `PATH` 上），并且
**同一个 profile 里已安装并启用 `dsh-permission-rules`**。本插件只负责写它的
规则文件，单独存在时不会有任何效果。

```sh
# 从 npm 安装
dsh plugin --profile web add dsh-always-allow

# 或从本地 checkout / tarball 安装
dsh plugin --profile web add ./dsh-always-allow
dsh plugin --profile web add ./dsh-always-allow-0.1.0.tgz

# 或直接从 git 安装（见下文「git 安装」）
dsh plugin --profile web add github:you/dsh-always-allow#<commit-sha>
```

启动前先确认这一层：

```sh
dsh --profile web --dump-config | grep -A 12 '== dsh-always-allow'
```

应能看到 `# == dsh-always-allow` 下的 `rulesFile`、`toolNames`、`maxTracked`。

卸载：

```sh
dsh plugin --profile web remove dsh-always-allow
```

### 前置操作：关掉 permission-rules 的网络代理

如果你装了 `dsh-permission-rules` 又不想让它给每条 shell 命令重写
`ALL_PROXY` / `HTTP(S)_PROXY`，在 `$DSH_HOME/profiles/web/cordis.patch.yml`
里加入：

```yaml
- id: permission-rules
  name: dsh-permission-rules
  config:
    rulesFile: .dsh/rules.yaml
    badFilePolicy: fail
    maxRules: 256
    patternMode: glob
    watch: true
    network:
      enabled: false      # 代理根本不启动
      injectEnv: false    # 双保险：不改写任何环境变量
  disabled: false
```

patch 行会**整体替换**被覆盖行的 config，所以每个键都要重述。
`network.enabled: false` 时代码路径根本不会进入代理逻辑，子进程环境完全不受影响。

### git 安装

git 安装拉取的是**源码**，pnpm 在你明确授权前会拒绝运行依赖的 `prepare`
脚本 —— 这等同于允许该包的代码在你机器上、在 agent 沙箱之外执行。
把 pnpm 打印的确切键复制进该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，
再重新 `add`。请锁定 commit（`github:you/repo#<sha>`），免得后续推送悄悄换掉
实际运行的代码。

---

## 配置

在 `cordis.patch.yml` 中设置，挂载时校验；非法值会让插件**直接失败**，
而不是悄悄回退到默认值。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `rulesFile` | `.dsh/rules.yaml` | 规则文件；相对路径按会话工作区解析，也可给绝对路径。必须与 `permission-rules` 行的 `rulesFile` 一致。 |
| `toolNames` | `[bash, pwsh]` | 参数中带命令行文本的 shell 工具名。只支持带 `command` 字符串参数的工具。 |
| `maxTracked` | `128` | 浏览器侧记住的挂起审批数（超出时淘汰最旧的）。 |

覆盖示例：

```yaml
- id: always-allow
  name: dsh-always-allow
  config:
    rulesFile: .dsh/rules.yaml
    toolNames: [bash, pwsh, shell]
    maxTracked: 64
```

---

## 会提供哪些前缀

保存的规则绝不能覆盖超出你本次批准的范围。任何存疑的情况**都不给按钮**，
并在提示条上说明原因。

| 命令行 | 按钮 |
| --- | --- |
| `ls -la` | **`ls*`** —— 参数保持自由 |
| `git status --short` | **`git status*`** —— `-s` 与 `--short` 都能命中 |
| `npm install -g x` | **`npm install*`** |
| `git`（裸命令） | 无 —— *需要子命令，否则 `git push --force` 也会被放行* |
| `git push --force` | **`git push*`** —— 仍然可以选择逐次批准 |
| `rm -rf build` | 无 —— *破坏性命令永不通过前缀放行* |
| `echo hi > out` | 无 —— *复合命令，单一前缀无法描述* |
| `FOO=1 git status` | 无 —— *环境变量前缀不是字面前缀* |
| `"my program" --flag` | 无 —— *带引号的命令词不是字面前缀* |

无论参数如何都**永不**前缀放行：`sudo`、`doas`、`su`、`sh`、`bash`、`zsh`、
`xargs`、`env`、`find`、`rm`、`dd`、`chmod`、`chown`、`curl`、`wget`、
`install`、`kill` 等，完整列表见 [`src/prefix.js`](./src/prefix.js)。

新规则**追加**在文件末尾，因此更早、更窄的 `deny` / `ask` 规则仍按
「首个匹配生效」的规则优先。

---

## 安全说明

- 规则写入**工作区**，随项目走，对该目录下启动的每个会话生效。
- HTTP 路由使用与 `/api` 相同的 Connection 信任/凭据校验，
  外部页面无法借你的会话扩大规则。请求仅接受 `POST`，请求体上限 4 KiB，
  进程内串行化（读-改-写不会交错），并通过临时文件 + rename 原子写入，
  因此 `badFilePolicy: fail` 永远不会读到写了一半的文档。
- 前缀规则天然比单次调用更宽。需要精细控制时继续用 *允许一次* ——
  本插件从不会移除这个选项。

---

## 开发

```sh
npm test        # node:test —— 单元测试 + 基于真实 Cordis 上下文的集成测试
npm run check   # 逐个源文件做语法检查
```

集成测试按 Loader 的方式挂载插件；找不到 harness checkout 时会自动跳过。
可用 `DSH_CORDIS_PATH=/path/to/deepseek-harness/vendor/cordis/lib/index.js`
指向其他 checkout。

```
src/index.js        插件入口：命令追踪、路由、原子追加规则
src/prefix.js       纯函数：前缀推导与拒绝原因词表
src/rules-file.js   纯函数：YAML 渲染与插入
src/endpoints.js    与传输无关的 propose/save 操作
src/config.js       配置解析与默认值
src/client.js       浏览器端：审批提示条
test/               node:test 测试
docs/               规则格式与故障排查
```

---

## 许可证

Apache-2.0。
