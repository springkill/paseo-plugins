# Paseo Plugins

一组 [Paseo](https://github.com/getpaseo/paseo) 实用插件。

*[English](README.md)*

| 插件 | 做什么 |
|---|---|
| [`paseo-pi-kit`](paseo-pi-kit/README.zh-CN.md) | 给 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 会话的四块功能：任务卡、subagent 卡、通知卡、provider 用量 |

每个插件有自己的 README 讲细节。这份只讲它们共用的东西：安装、发版、共同约定。

## 安装

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit
```

`源:子路径` 是 Paseo 的 monorepo 语法 —— 从一个仓库里装其中某一个插件。

钉版本、追更新：

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit --ref paseo-pi-kit-v0.8.3
paseo plugin status              # 有没有新版
paseo plugin update --all
```

卸载：`paseo plugin remove paseo-pi-kit`

## ⚠️ 安装前请知道

Paseo 的插件是**受信任、不沙箱**的：

- **后端代码在你的机器上以你的身份运行**，能读写文件、起进程、访问 Paseo daemon
- `paseo-plugin.json` 里可能声明 `build` 命令（`npm install`），**它也会在你的机器上执行**
- 前端代码跑在 Paseo 应用内

装任何第三方插件都等于信任它的作者。先看代码，或者用 `--ref` 钉到你自己审过的 commit。

## 发版与版本号

**每个插件各自发版。** tag 形如：

```
<插件目录>-v<semver>        例如  paseo-pi-kit-v0.8.3
```

推这样一个 tag，只跑**那一个插件**的检查，然后发一个 GitHub Release，仓库里别的
东西一概不动。所以一个插件出新版不会逼着其它插件跟着升号，别人 `--ref` 钉的也是
「这个插件的这个版本」，而不是「仓库在某天的样子」。

发版步骤：

```bash
cd <插件>
npm version <patch|minor|major> --no-git-tag-version   # 顺带同步 package-lock
cd .. && git commit -am "chore: <插件> <版本>"
git tag "<插件>-v<版本>" && git push origin main "<插件>-v<版本>"
```

如果 `package.json` 的版本跟 tag 对不上、或者目录不存在，发版 job 会直接报错拒绝
—— 忘了 bump 会当场失败，而不是发出一个版本号在撒谎的 Release。

CI 靠 `*/paseo-plugin.json` 自动发现插件，**加新插件不用改 workflow**。

> 这套方案之前的 tag 是仓库级的（`v0.1.0` … `v0.3.3`），它们仍然能解析，
> 但新的 Release 一律用带插件名的形式。

## 共同约定

**界面语言。** 同机的 Paseo 插件**共用同一个设置**，在任何一个里改，
其它的下次渲染就跟上：

```
$PASEO_HOME/plugin-locale.json      # { "locale": "auto" | "zh" | "en" }
```

⚠️ 这个文件**不归任何单个插件独占** —— 卸载某个插件时不要删它。

优先级从高到低：`<PLUGIN>_LANG` → `PASEO_PLUGIN_LANG` → 共享设置 → 客户端自身语言
→ `LC_ALL` / `LC_MESSAGES` / `LANG` → 英文。客户端只负责**报告**自己的语言，判定
一律在服务端 —— 两边各判一次，迟早会判出不一样的结果。

**目录结构。** 见 [STRUCTURE.zh-CN.md](STRUCTURE.zh-CN.md)。一句话：`shared/`
是两端都进的纯逻辑，`server/` 跑在 daemon，`client/` 跑在 Paseo 应用里 ——
Paseo 0.8 起**编译器按目录切分**，越界在编译期报错。入口是
`index.client.tsx` 与 `index.server.ts`。

**需要 Paseo 0.8 及以上。** 每个清单都声明了
`"requirements": { "paseo": ">=0.8.0" }`，不声明的话 0.8 的 daemon 会直接拒绝加载。

⚠️ 注意**客户端 bundle 是由 app 求值的，不是 daemon**。旧版 app（比如 0.7.2）
即使连着 0.8 的 daemon 也跑不了这些插件 —— 求值直接失败，界面一个都出不来。

## 开发

```bash
cd paseo-pi-kit
npm install
npm run typecheck
npm test

paseo plugin install "$(pwd)"          # 按目录装
paseo plugin reload paseo-pi-kit
paseo plugin logs paseo-pi-kit
```

改源码只需 `reload`，不用重启 Paseo。

⚠️ 按目录装**不会**执行 `build` 命令 —— 只有 git 安装/更新才跑。本地开发要自己
`npm install`。

⚠️ `paseo plugin ls` 和 daemon 日志**只能看到服务端那一半**。客户端 bundle 崩了它
照样显示 `running`。`npm test` 会把真正的客户端 bundle 编出来跑一遍，信它，别信
daemon 日志。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
