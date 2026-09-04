/**
 * 临时诊断探针 —— 查清 transformer 在真实 app 里到底收到了什么。
 *
 * 一直查不出根因的原因很实在：transformer 跑在 Paseo 应用里，
 * 它的输入和返回值在 app 之外观测不到。离线怎么测都是绿的。
 *
 * 所以这里把每次 `transform()` 的输入摘要塞进缓冲区，由 `addClientSide`
 * 定时通过 RPC 送回服务端打进 daemon 日志。
 *
 * ⛔ 定位到问题就整个删掉。
 */

const buffer: string[] = [];
let seq = 0;

export function record(line: string): void {
  if (buffer.length > 60) return;
  buffer.push(`#${++seq} ${line}`);
}

export function drain(): string[] {
  return buffer.splice(0, buffer.length);
}

/** 摘要一个时间线条目，不泄露完整正文。 */
export function describeItem(value: unknown): string {
  if (value === null || typeof value !== "object") return `item=${typeof value}`;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).join(",");
  const text = typeof item.text === "string" ? item.text : undefined;
  return `type=${String(item.type)} keys=[${keys}]`
    + ` textLen=${text?.length ?? "n/a"}`
    + ` head=${JSON.stringify(text?.slice(0, 48) ?? null)}`;
}
