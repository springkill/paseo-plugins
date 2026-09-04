# Paseo Pi Kit

给 [Paseo](https://github.com/getpaseo/paseo) 里的
[Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
会话提供四块功能，默认全部启用。

*[English](README.md)* · *[仓库根目录](../README.zh-CN.md)*

## 功能

### 任务列表

把 Pi 的 `todo` 工具调用（以及 Paseo 原生 `todo` 条目）换成进度卡：进度条、
按状态着色、显示进行中的任务和接下来要做的。composer pill 显示 `完成数/总数`
和当前 `activeForm`，点开是完整列表。

### Subagents

把 Pi 的 `subagent` 调用变成卡片：运行状态、角色、模型、工具数、tokens、耗时、
成本、acceptance 与最终输出。异步 workflow 直接读会话记录的实时 `status.json`，
所以子任务的 running / completed / failed **在调用还没结束时**就能看到，
而不是等整个调用完成。

另外提供 `Subagents` composer pill（`运行中/总数`）和绑定当前精确 agent 的
**Pi Subagents** 面板。

### Pi 通知卡片

Pi 用结构化的 `custom_message` 发后台任务、workflow、subagent 督导、网页抓取等
通知。Paseo 把它们拍平成普通助手消息，于是你看到的是裸的
`<background-task-notification>` XML、给模型抄的工具调用样板，以及被
`JSON.stringify` 转义又从字符串中间截断的 workflow 返回值。

这块把结构还原回来：四个 Pi 插件发出的九种消息，每一种都是照着生产它的那个
`format*()` 函数逆向写的。workflow 完成通知**按子任务展开**，而不是把截断的
JSON 原样倒出来。

⚠️ 发给**父 agent** 的那些（supervisor 请求、control notice）折叠成一行，绝不做成
需要你操作的样子 —— 它们的 `Reply with: …` 是只有模型能发的工具调用。真正需要你
回答的提问会弹带选项的 Paseo 对话框，走的是完全另一条通路。

格式对照表见 [`docs/pi-message-formats.md`](docs/pi-message-formats.md)。

### Provider 用量

composer pill 显示各 provider 的额度窗口与余额，带重置时间和用尽预估。

## 安装

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit
```

钉版本用 `--ref paseo-pi-kit-v0.3.3`，见[发版说明](../README.zh-CN.md#发版与版本号)。

⚠️ Paseo 插件是**受信任、不沙箱**的。本插件声明了 `build` 命令（`npm install`），
它会在你的机器上执行 —— 见[仓库 README](../README.zh-CN.md#-安装前请知道)。

## 它读什么

只读当前 agent 的 canonical timeline、Pi 自己的 session JSONL，以及该 session
启动并明确记录的
`/tmp/pi-subagents-uid-*/async-subagent-runs/<runId>/status.json`。读之前会校验
agent ID、provider、session realpath、当前用户的异步运行根目录和 `runId`。
不修改任务、session 或运行状态，也没有网络访问。

唯一的例外是 provider 用量：它要向本机 Paseo daemon 请求公开 `PaseoApi` 没暴露的
数据。这也是本插件唯一有运行时依赖的原因。

## 一层兼容代码

`domain/pi-notice-parser.shared.ts` 是**临时的**，标了 `COMPAT(pi-custom-message)`。

Pi 的通知带完整 `details`，Pi 自己也用 `pi.registerMessageRenderer()` 在 TUI 里
结构化渲染。但 Paseo 的 Pi provider（`pi/history-mapper.js` 的
`mapCustomMessage`）会先试 `hooks.mapCustomMessage` —— **没有任何 provider 提供
这个钩子**，所以永远走默认分支，`details` 整个丢掉，只剩给人看的 `content`。
这一层把那段文本反解回来。

同一个 mapper 也不看 `display`，所以 Pi 标了「只给模型看」的消息（goal 契约、
压缩提示）同样会漏进时间线 —— 那些折叠成一行。

上游接上钩子后，把这一层连同渲染器、测试和格式文档一起删。判断时机的方法写在那个
文件的头部注释里。

⚠️ 它是**静默失效**的：一旦时间线条目不再是 `assistant_message`，transformer 就
不再触发，卡片安静地消失，没有任何报错。

## 开发

```bash
npm install
npm run typecheck
npm test
paseo plugin reload paseo-pi-kit
```

⚠️ `paseo plugin ls` 和 daemon 日志**只能看到服务端那一半** —— 客户端 bundle 崩了
它照样显示 `running`。`tests/client-bundle.test.ts` 用 Paseo 自己的编译器把真正的
客户端 bundle 编出来、拿假宿主跑 `contribute()`；`tests/entrypoint-boundary.test.ts`
抓 `.server` 的值被引用在客户端 bundle 会保留的位置。这两条都是因为那个 bug 真的
发出去过一次。
