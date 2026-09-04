# paseo-plugins

[`paseo-pi-kit`](paseo-pi-kit) —— 一个 [Paseo](https://github.com/getpaseo/paseo) 插件，
四块功能各自可开关。

| 功能 | 做什么 |
|---|---|
| 任务列表 | 把 Pi 的 todo 工具调用和 Paseo 原生 todo 换成进度卡，composer 显示完成数 |
| Subagents | subagent 调用卡片、实时子任务状态、独立面板与 composer pill |
| Pi 通知卡片 | 把后台任务 / workflow / subagent 督导等通知从裸文本还原成结构化卡片 |
| Provider 用量 | 在 composer 上显示各 provider 的额度窗口与余额 |

在「Pi Kit 设置」面板里逐个开关（命令面板搜 `Pi Kit`）。

> v0.3.0 之前这里是两个插件（`paseo-pi-todos` / `paseo-provider-balances`），
> 已合并。旧的装法请先 `paseo plugin remove` 再按下面装。

Rumen（把 agent 写掉、而你没读的代码变成可见的知识债）在
[springkill/paseo-rumen](https://github.com/springkill/paseo-rumen)，单独一个仓库。

## 安装

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit
```

`源:子路径` 是 Paseo 的 monorepo 语法 —— 一个仓库里装某一个插件。

钉版本、追更新：

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit --ref v0.3.0
paseo plugin status              # 有没有新版
paseo plugin update --all        # 追更新
```

卸载：`paseo plugin remove paseo-pi-kit`

## ⚠️ 安装前请知道

Paseo 的插件是**受信任、不沙箱**的：

- **后端代码在你的机器上以你的身份运行**，能读写文件、起进程、访问 Paseo daemon
- `paseo-plugin.json` 里声明了 `build` 命令（`npm install`），
  **它也会在你的机器上执行**
- 前端代码跑在 Paseo 应用内

装任何第三方插件都等于信任它的作者。先看代码，或者只装你自己审过的版本
（`--ref` 钉到某个 commit）。

## 依赖

绝大部分代码没有运行时依赖 —— Paseo 自己用 esbuild 编译，SDK / `react` /
`react-native` / `zod` / `@tanstack/react-query` 都由宿主提供，而对
`@getpaseo/client` 的引用几乎全是 `import type`（编译期擦除）。

**唯一的例外**是 provider 用量：它要发一个 `PaseoApi` 没暴露的请求，
用了 `@getpaseo/client/internal/daemon-client` 这个**值导入**，必须打进 bundle。
所以 manifest 里带 `build`。**这一条只在 git 安装/更新时执行**；
目录来源的插件不跑 `build`，本地开发要自己 `npm install`。

## 功能开关

```
$PASEO_HOME/plugin-features.json    # { "todos": true, "subagents": false, … }
```

开关分两层生效，因为 Paseo SDK 的注册 API 没有注销句柄：

- **时间线卡片立即生效** —— transformer 永远注册，但在 `transform()` 里读开关，
  关掉就返回 `undefined`，条目原样落回默认渲染
- **面板 / 命令面板项 / composer pill 要重载才消失** —— 它们只能在加载时决定

插件**不会自己重载**：实测过在插件进程里调 `reloadPlugin(自己)`，daemon 打完
`Stopping plugin` 就不再拉起，插件停在 `failed`。所以第二类改动后由你自己跑
`paseo plugin reload paseo-pi-kit`，设置面板里会提示。

## 界面语言

本插件与 [paseo-rumen](https://github.com/springkill/paseo-rumen)
**共用同一个语言设置**，在任何一个里改，另一个下次渲染就跟上：

```
$PASEO_HOME/plugin-locale.json      # { "locale": "auto" | "zh" | "en" }
```

判定优先级（唯一裁决点在服务端）：

```
1. <插件>_LANG          RUMEN_LANG / PI_TODOS_LANG / PROVIDER_BALANCES_LANG
2. PASEO_PLUGIN_LANG    所有插件一起强制
3. 共享设置             UI 上点出来的
4. 客户端语言           Paseo 能从手机/浏览器访问，谁在看跟谁走
5. 宿主机 LC_ALL / LC_MESSAGES / LANG
6. en
```

⭐ **用户设置压过环境推断。** `LANG` 是环境在*告诉*我们这台机器习惯什么语言 ——
那是推断；设置里点出来的是*决定*。反过来的话，用户设成英文、换个终端又变回中文，
而他找不到是谁改的。

⚠️ **Paseo 本身没有语言设置 API**（它的界面只有英文，没有 i18n 框架），
所以"跟 Paseo 统一"只能这样自己实现。刻意**不**往 Paseo 的 `config.json` 里塞键 ——
它顶层 schema 是 passthrough，技术上塞得进去，但 Paseo 哪天收紧就静默失效。

文案完整性由**类型检查**保证：每条文案的所有语言写在同一个对象字面量里，
漏一种就是缺少必需属性，`tsc --noEmit` 直接失败。没有对账脚本，因为不需要。

## 目录结构

按层分：`domain/` `server/` `ui/` `tests/`，见 [STRUCTURE.md](STRUCTURE.md)。

⚠️ 文件名后缀 `.client` / `.server` / `.shared` 是承重的 —— 编译器靠它切前后端，目录名不参与判定。

## 开发

```bash
cd paseo-pi-kit
npm install
npm run typecheck
npm test                   # pi-todos 有测试

paseo plugin install "$(pwd)"          # 按目录装，本地改完 reload 即可
paseo plugin reload paseo-pi-kit
paseo plugin logs paseo-pi-kit
```

改源码只需 `reload`，不用重启 Paseo。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
