# 目录结构约定（Paseo 0.8）

*[English](STRUCTURE.md)*

```
index.client.tsx   客户端入口 —— 时间线卡片、composer pill
index.server.ts    服务端入口 —— RPC 处理
client/            只进 app bundle（浏览器 / iOS / 安卓 Hermes）
server/            只进 daemon bundle（Node，可用 node:*）
shared/            两边都进：纯逻辑、契约、文案表
tests/
docs/
```

## 边界由编译器强制

0.8 按**目录**划边界，不再看文件名后缀：

```js
directoryTarget(file):
  client/ → client      server/ → server      shared/ → 两边
  index.client.tsx / index.server.ts → 各自入口
  其余一律 "invalid" → 编译报错
```

把 `server/foo.ts` 引进客户端代码会直接编译失败：

```
server-only module cannot be imported into the plugin client bundle: …
```

⚠️ **0.7 不是这样的。** 它靠编译器在 `index.ts` 上做**文本删除**
（`REGISTRATIONS_REMOVED_BY_TARGET` + `collectOppositeTargetImportRanges`）：
对面 target 的 import 整条删掉，不要的注册调用也删掉。

那套**不检查引用**，踩过两次 —— `readFlags is not defined`、cleanup 里的
`closeProviderUsageClient` —— 只能靠 `typeof X === "function"` 守卫兜着，
而且失败时**服务端一切正常**、`paseo plugin ls` 照样显示 `running`。
**0.8 之后这些守卫都可以删。**

## 依赖方向

```
client/  ──▶  shared/  ◀──  server/
```

`shared/` 不引 `client/` 也不引 `server/`。这是它能脱离宿主单测的原因。

## SDK 子路径

| 用途 | 从哪引 |
|---|---|
| `defineRpc` / `defineSettings` / 契约类型 | `@getpaseo/plugin` |
| hooks（`useRpc` / `useAgent` / `useWorkspace`）与客户端类型 | `@getpaseo/plugin/client` |
| `Icon` / `Modal` / `useToast` | `@getpaseo/plugin/client/react-native` |
| 设置界面组件 | `@getpaseo/plugin/client/ui` |
| `PluginServerContext` / 生命周期类型 | `@getpaseo/plugin/server` |

## 清单

```json
{ "id": "…", "requirements": { "paseo": ">=0.8.0" } }
```

不声明 `requirements.paseo` 的话，0.8 直接按「targets pre-0.8」拒绝加载。

⚠️ **客户端 bundle 是在 app 里求值的，用 app 自己的插件运行时。** 所以 daemon
升到 0.8 不代表能用 —— 旧版 app（比如 0.7.2）给不出 `@getpaseo/plugin/client`
这些新子路径，求值直接失败，界面一个都出不来。升级 daemon 前先核对所有已连接
客户端的 `appVersion`。
