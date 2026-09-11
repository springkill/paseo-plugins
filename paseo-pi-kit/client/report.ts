/**
 * 客户端 → daemon 日志的回传通道。
 *
 * ## 为什么需要它
 *
 * 卡片跑在 Paseo **应用**里（浏览器 / iOS / 安卓），它的 `console` 在 app 之外
 * 观测不到 —— daemon 日志只有服务端那半边。宿主的 `SurfaceErrorBoundary`
 * 抓到渲染异常后也只是 `console.warn`，等于什么都没留下。
 *
 * 实测代价：安卓上报 `Plugin failed: Object is not a function`，本机把同一批
 * 真实数据全渲染一遍却零失败（运行时不是一个），隔着设备边界完全无从下手。
 *
 * 所以 `ui/card-boundary.client.tsx` 接住渲染异常之后，把 message + 调用栈
 * 塞进这个缓冲区，由 `addClientSide` 定时通过 RPC 送回服务端打进 daemon 日志：
 *
 * ```bash
 * grep 'pi-kit report' ~/.paseo/daemon.log
 * ```
 *
 * ⚠️ 只上报**异常**，不上报正常流量。这里曾经记录每次 `transform()` 的输入
 * 摘要，日志噪音大到没法看 —— 那是临时排查用的，问题定位完就该收掉。
 */

import { Platform } from "react-native";

const buffer: string[] = [];
let seq = 0;

export function record(line: string): void {
  // 上限是防呆：真出问题时时间线上每张卡片都会报一条
  if (buffer.length > 60) return;
  buffer.push(`#${++seq} ${line}`);
}

export function drain(): string[] {
  return buffer.splice(0, buffer.length);
}

/**
 * 客户端的运行时指纹。
 *
 * ⭐ 这条是**排障的起点**，不是锦上添花。
 *
 * 同一个插件在 Mac 上正常、安卓上炸，查了大半天才意识到最基本的问题一直没答案：
 * 报上来的日志到底是哪台设备发的？那台设备有没有 Intl？是不是 Hermes？
 * 没有这行，一切都只能靠猜 —— 实测为此空转了好几轮。
 *
 * - `platform`  web / ios / android（原生走 react-native，web 走 react-native-web）
 * - `hermes`    有没有 HermesInternal —— 判断引擎的标准做法
 * - `intl`      Hermes 常常不带 Intl，而那正好是一整类 bug 的根源
 */
export function clientFingerprint(): string {
  const parts: string[] = [];
  try {
    parts.push(`platform=${String((Platform as { OS?: unknown } | undefined)?.OS ?? "?")}`);
  } catch {
    parts.push("platform=throw");
  }
  parts.push(`hermes=${typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== "undefined"}`);
  parts.push(`intl=${typeof (globalThis as { Intl?: unknown }).Intl}`);
  parts.push(`numFmt=${typeof (12345).toLocaleString === "function"}`);
  return parts.join(" ");
}

/**
 * 把**宿主自己**打的插件错误日志接过来，转发到 daemon 日志。
 *
 * ⭐ 为什么必须这么做
 *
 * 宿主的 `SurfaceErrorBoundary` 在插件界面渲染失败时是这样处理的
 * （从 web-ui 产物里读出来的）：
 *
 * ```js
 * componentDidCatch(error, info) {
 *   console.warn("[Plugins] Surface render failed", error, info.componentStack)
 * }
 * render() { return this.state.error
 *   ? <Text>Plugin failed: {this.state.error}</Text>
 *   : this.props.children }
 * ```
 *
 * 也就是说：**屏幕上只有一句话，完整的错误和组件栈全在 `console.warn` 里**。
 * 而客户端跑在 app 里，那个 console 在 app 之外根本读不到 ——
 * daemon 日志只有服务端那半边。
 *
 * 更要命的是宿主在插件组件外面还套了两层自己的组件：
 *
 * ```
 * SurfaceErrorBoundary → PluginRuntimeBoundary → PluginClientStateProvider → 插件组件
 * ```
 *
 * 中间两层抛异常的话，插件自己的错误边界**根本不会挂载**，
 * 于是「屏幕上有红字、但插件的上报通道一条都没有」—— 实测就卡在这个组合上，
 * 隔着设备边界查了大半天。
 *
 * 插件和 app 在同一个 JS realm 里，`console` 是全局的。所以这里接一层：
 * **只转发 `[Plugins]` 开头的那些**，其余原样放行，卸载时还原。
 */
export function captureHostPluginLogs(): () => void {
  const target = globalThis.console as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;
  if (!target) return () => {};
  const saved: Record<string, ((...args: unknown[]) => void) | undefined> = {};
  let inside = false;

  for (const level of ["warn", "error"] as const) {
    const original = target[level];
    if (typeof original !== "function") continue;
    saved[level] = original;
    target[level] = (...args: unknown[]) => {
      original.apply(target, args);
      // ⚠️ 防重入：record 本身不打 console，但宿主的实现将来可能变
      if (inside) return;
      const head = typeof args[0] === "string" ? args[0] : "";
      if (!head.startsWith("[Plugins]")) return;
      inside = true;
      try {
        for (const chunk of describeArgs(level, args)) record(chunk);
      } catch {
        // 诊断通道自己绝不能把界面带崩
      } finally {
        inside = false;
      }
    };
  }

  return () => {
    for (const [level, original] of Object.entries(saved)) {
      if (original) target[level] = original;
    }
  };
}

/** 把 console 参数摊平成若干行 —— 上报通道每行上限 400 字符。 */
function describeArgs(level: string, args: unknown[]): string[] {
  const parts: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string") parts.push(arg);
    else if (arg instanceof Error) parts.push(`${arg.name}: ${arg.message}`, `stack ${(arg.stack ?? "").split("\n").slice(1, 8).join(" | ")}`);
    else {
      try { parts.push(JSON.stringify(arg) ?? String(arg)); } catch { parts.push(String(arg)); }
    }
  }
  const joined = `HOST ${level}: ${parts.filter(Boolean).join(" ")}`.replace(/\s+/g, " ");
  // 切成 380 字符一段，保住组件栈那一大截
  const lines: string[] = [];
  for (let index = 0; index < joined.length && lines.length < 8; index += 380) {
    lines.push(joined.slice(index, index + 380));
  }
  return lines;
}
