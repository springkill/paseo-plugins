# 目录结构约定

两个插件用同一套分层，与 [paseo-rumen](https://github.com/springkill/paseo-rumen) 一致：

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

## 依赖方向

`ui/ → domain/`、`server/ → domain/`，`domain/` 不依赖任何一侧。
`ui/` 不许 import `server/`（会把 `node:*` 泄进前端包），反之亦然。
