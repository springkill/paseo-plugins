# Paseo Provider Balances

Paseo 0.7+ 的 Provider 用量插件。在每个 Agent 的 Composer 中增加一个小型 Gauge Pill；点击后显示所有 provider 的原生 Paseo 用量卡片。

## 功能

- 使用 Paseo daemon 自带的 `provider.usage.list` 数据源，不读取或保存 provider 凭据
- 与 Paseo 自身策略一致：5 分钟 stale cache、打开时刷新、支持手动刷新
- 可用 provider 优先，不可用 provider 默认折叠
- 展示 plan、用量窗口、剩余百分比、重置时间、credits/余额与 provider 错误
- 在 Pi Agent 中优先展示实际模型路由对应的 provider；无法识别时默认优先 Codex
- 仅注册 Composer Pill 和点击 Modal，不增加全屏 Surface 或侧边栏入口

当前 Paseo 插件 API 无法修改发送按钮左侧的内置上下文圆环，也不能向其 Hover 卡片注入内容。因此插件使用相邻的 Gauge Pill 作为入口。

## 开发

```bash
cd paseo-provider-balances
npm install
npm run typecheck
```

## 安装

Paseo 插件是**受信任、非沙箱**代码 —— 后端在你的机器上以你的身份运行，
本插件 manifest 里的 `build` 命令（`npm install`）也会在你的机器上执行。
确认源码可信后：

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-provider-balances
paseo plugin ls
```

本地开发用目录安装：

```bash
npm install                       # 目录来源不跑 build，依赖要自己装
paseo plugin install "$(pwd)"
```

修改源码后：

```bash
npm run typecheck
paseo plugin reload paseo-provider-balances
```

## 限制

插件后端使用 Paseo 0.7 的原生 Provider Usage RPC，并通过 daemon 本机 WebSocket 回连。当前实现支持常规 TCP listen（例如 `127.0.0.1:6767`），不支持启用了密码认证的 daemon 或 Unix socket listen。
