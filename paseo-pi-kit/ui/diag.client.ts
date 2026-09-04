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

/** 宿主 `transformTimelineItem` 里那个 JSON 兼容性校验，原样复刻。 */
export function hostJsonCompatible(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  const object = value as object;
  if (seen.has(object)) return false;
  if (!Array.isArray(object)) {
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) return false;
    if (Reflect.ownKeys(object).some((key) => typeof key !== "string")) return false;
  }
  seen.add(object);
  const values = Array.isArray(object) ? object : Object.values(object);
  const ok = values.every((entry) => hostJsonCompatible(entry, seen));
  seen.delete(object);
  return ok;
}

/** 摘要 transform 交出去的 data，附上宿主视角的裁决。 */
export function describeData(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  const entries = Array.isArray(d?.entries) ? (d!.entries as unknown[]) : [];
  const first = entries[0] as Record<string, unknown> | undefined;
  const children = Array.isArray(first?.childOutputs) ? (first!.childOutputs as unknown[]).length : 0;
  return `kind=${String(d?.kind)} variant=${String(d?.variant)}`
    + ` entries=${entries.length} childOutputs=${children}`
    + ` bytes=${JSON.stringify(data).length}`
    + ` hostJsonOk=${hostJsonCompatible(data)}`;
}
