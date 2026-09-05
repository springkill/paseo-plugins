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
