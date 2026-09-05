/**
 * 数字与时间的格式化。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ⭐ **不许用 `toLocaleString` / `Intl`。这是一条实测出来的硬规矩。**
 *
 * 安卓上的 Paseo 跑 Hermes，而 React Native 的 Hermes 常常是**不带 Intl**
 * 构建的。0.7.0 在 `classifyNumber` 里写了一句 `value.toLocaleString()`，
 * 结果安卓时间线上直接是：
 *
 * ```
 * Plugin failed: Object is not a function
 * ```
 *
 * web 端完全正常（那边跑 react-native-web + 浏览器的 Intl），本机把 67 条
 * 真实通知全渲染一遍也零失败 —— 因为运行时根本不是同一个。隔着设备边界猜是
 * 猜不出来的，最后是靠 `tests/render.test.ts` 把 `Number.prototype.toLocaleString`
 * 换成抛异常的桩，才在同一个组件路径上复现出来。
 *
 * 所以这里全部手写。副作用是好的：**输出与语言环境无关**，
 * 同一份数据在谁的机器上都长一样，截图对得上。
 * ═══════════════════════════════════════════════════════════════════
 */

/** `12000` → `12,000`。负号与小数部分都保留。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const [whole = "", fraction] = Math.abs(value).toString().split(".");
  // 指数记法（1e21 以上）就别硬分组了，原样给出去
  if (whole.includes("e") || whole.includes("E")) return String(value);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * `2026-09-04T16:56:31Z` → `09-04 16:56`（本地时区）。
 *
 * 刻意不带年份 —— 用量重置、任务完成这些都是近期的事，年份只占地方。
 * 跨年的话月份本身就能看出来。
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
