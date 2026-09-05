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
