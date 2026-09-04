# Paseo Pi Todos

Paseo 原生 UI 插件，为 Pi 的 `todo` 和 `subagent` 提供任务进度卡、子代理卡片、Composer 状态与独立面板。

## 功能

- Timeline 中以进度条、状态颜色和任务卡替换 `todo` 工具原始输入/输出
- 默认显示进行中任务和接下来的待办，点击可展开完整列表
- Composer Pill 显示完成数、总数及当前 `activeForm`
- 点击 Pill 打开当前 Agent 的完整任务 Modal
- 同时兼容 Pi `todo` 工具调用和 Paseo 原生 `todo` timeline item
- 将 Pi `subagent` timeline 调用替换为原生卡片，显示运行状态、角色、模型、上下文、工具数、tokens、耗时、成本、acceptance 与最终输出
- 异步 workflow 启动后立即读取其 Agent 绑定的 live `status.json`，实时显示 running / completed / failed children；不再等待整个调用完成
- Composer 增加 `Subagents` Pill，实时显示 `运行中数量 / 子任务总数`，点击打开绑定当前精确 Agent ID 的 `Pi Subagents` Modal
- 提供精确 Agent 作用域的 `Pi Subagents` Panel，并在插件 reload 后为已有 Pi Agent 补注册 Pill
- 每个 Agent 使用独立查询缓存，切换对话不会复用其他 Agent 的面板实例
- 桌面、Web 与移动端共用 React Native UI，并使用 Paseo 主题颜色

插件只读取当前 Agent 的 canonical timeline、Pi 自己的 session JSONL，以及该 session 启动并明确记录的 `/tmp/pi-subagents-uid-*/async-subagent-runs/<runId>/status.json`。读取前会校验 Agent ID、provider、session realpath、当前用户的异步运行根目录和 `runId`；不会修改任务、session 或运行状态，也没有外部网络访问。

## 安装

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-todos
```

⚠️ Paseo 插件是**受信任、不沙箱**的：后端代码在你的机器上以你的身份运行。
详见仓库根目录的 [README](../README.md#-安装前请知道)。

## 一层兼容代码

`domain/pi-notice-parser.shared.ts` 是**临时的**，标了 `COMPAT(pi-custom-message)`。

Pi 的通知消息（后台任务、workflow、subagent 督导）本来带完整的 `details`，
但 Paseo 的 `pi/history-mapper` 把它们拍平成了普通助手消息，`details` 丢掉，
用户看到的是裸的 `<background-task-notification>` XML。这一层从文本把它反解回来。

上游一旦提供 `hooks.mapCustomMessage`，把这一层连同渲染器和测试一起删。
判断方法写在那个文件的头部注释里。

## 开发

```bash
cd paseo-pi-todos
npm install
npm run typecheck
npm test
paseo plugin reload paseo-pi-todos
```

首次安装：

```bash
paseo plugin install "$(pwd)"
```
