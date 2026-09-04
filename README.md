# paseo-plugins

两个 [Paseo](https://github.com/getpaseo/paseo) 插件。

| 插件 | 做什么 |
|---|---|
| [`paseo-pi-todos`](paseo-pi-todos) | 把 agent 的 todo 列表和子 agent 状态提到 workspace 面板上 |
| [`paseo-provider-balances`](paseo-provider-balances) | 在 composer 上显示各 provider 的用量与余额 |

Rumen（把 agent 写掉、而你没读的代码变成可见的知识债）在
[springkill/paseo-rumen](https://github.com/springkill/paseo-rumen)，单独一个仓库。

## 安装

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-todos
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-provider-balances
```

`源:子路径` 是 Paseo 的 monorepo 语法 —— 一个仓库里装某一个插件。

钉版本、追更新：

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-todos --ref v0.1.0
paseo plugin status              # 有没有新版
paseo plugin update --all        # 追更新
```

卸载：`paseo plugin remove paseo-pi-todos`

## ⚠️ 安装前请知道

Paseo 的插件是**受信任、不沙箱**的：

- **后端代码在你的机器上以你的身份运行**，能读写文件、起进程、访问 Paseo daemon
- `paseo-provider-balances` 的 `paseo-plugin.json` 里声明了 `build` 命令
  （`npm install`），**它也会在你的机器上执行**
- 前端代码跑在 Paseo 应用内

装任何第三方插件都等于信任它的作者。先看代码，或者只装你自己审过的版本
（`--ref` 钉到某个 commit）。

## 依赖

- `paseo-pi-todos` 无运行时依赖 —— Paseo 自己用 esbuild 编译，
  SDK / `react` / `react-native` / `zod` / `@tanstack/react-query` 都由宿主提供
- `paseo-provider-balances` 需要 `@getpaseo/client`（它要发一个 `PaseoApi`
  没暴露的 provider usage 请求），所以 manifest 里带 `build` 让 Paseo 装依赖。
  **这一条只在 git 安装/更新时执行**；目录来源的插件不跑 `build`，
  本地开发要自己 `npm install`

## 目录结构

两个插件都按层分：`domain/` `server/` `ui/` `tests/`，见 [STRUCTURE.md](STRUCTURE.md)。

⚠️ 文件名后缀 `.client` / `.server` / `.shared` 是承重的 —— 编译器靠它切前后端，目录名不参与判定。

## 开发

```bash
cd paseo-pi-todos          # 或 paseo-provider-balances
npm install
npm run typecheck
npm test                   # pi-todos 有测试

paseo plugin install "$(pwd)"          # 按目录装，本地改完 reload 即可
paseo plugin reload paseo-pi-todos
paseo plugin logs paseo-pi-todos
```

改源码只需 `reload`，不用重启 Paseo。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
