# 目录结构约定

*[English](STRUCTURE.md)*

与 [paseo-rumen](https://github.com/springkill/paseo-rumen) 用同一套分层：

```
index.ts       插件注册
domain/        纯逻辑，无 IO，两端共用（.shared.ts）
server/        插件子进程（.server.ts，可用 node:*）
ui/            Paseo 应用内（.client.tsx）
tests/         *.test.ts
```

## ⚠️ 后缀是承重的，目录不是

Paseo 的编译器按**文件名后缀**切分前后端 bundle：

```js
onResolve({ filter: /\.(?:client|server)(?:\.[cm]?[jt]sx?)?$/ }, ...)
```

目录名不参与判定，重命名目录是安全的；**改后缀会静默改变模块归属**。
`*.shared.ts` 两端都进，所以它不能 import 任何 `node:*`。

违反边界在编译期报错：
`client-only module cannot be imported into the plugin server bundle`

## 入口文件是被按文本过滤的

`index.ts` 有特殊待遇（编译器里的 `filterEntrypoint()`）：对面 target 的 import
**整条删掉**，那个 target 不要的注册调用也删掉 —— 客户端删 `handle`，服务端删掉
全部 `add*`。

所以 `.server` 的值**只能在 `plugin.handle(...)` 里**引用，`.client` 的值只能在
那些 `add*` 里引用。写在别处 —— 裸语句、条件判断、编译器会保留的回调体 ——
就会在另一个 bundle 里留下没有定义的标识符，运行时直接抛。

⚠️ 构建期抓不到：boundary 检查根本看不到那条 import，它在更早的文本阶段就没了。

## 依赖方向

`ui/ → domain/`、`server/ → domain/`，`domain/` 不依赖任何一侧。
`ui/` 不许 import `server/`（会把 `node:*` 泄进前端包），反之亦然。
