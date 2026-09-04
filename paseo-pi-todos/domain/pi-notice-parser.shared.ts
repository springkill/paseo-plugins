/**
 * Pi 的通知类消息解析。
 *
 * ═══════════════════════════════════════════════════════════════════
 * COMPAT(pi-custom-message): 上游修好就整个删掉这个文件。
 *
 * 加于 2026-09-04，针对 @getpaseo/server 0.7.2。
 *
 * **判断能不能删**（一条命令，实测可跑）：
 *
 * ```bash
 * grep -rn --include='*.js' 'mapCustomMessage:' \
 *   "$(npm root -g)/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/agent/providers/pi/" | wc -l
 * ```
 *
 * 找的是**对象字面量属性**（带冒号）—— 那才代表 provider 真的提供了这个钩子。
 * 光找 `mapCustomMessage` 这个名字没用：它作为钩子的*声明*一直都在。
 *
 * - `0` = 仍未提供，这一层还需要（0.7.2 时是 0）
 * - `≥1` = 上游接上了，可以删
 *
 * 一旦上游把 Pi 的 `custom_message` 映射成结构化时间线条目（带 details），
 * 这里连同 `ui/pi-notice.client.tsx`、`PiNoticeSchema`、
 * `tests/pi-notice.test.ts` 和 index.ts 里那个 transformer 一起删。
 *
 * ⚠️ 上游修好时这一层是**静默失效**的：时间线条目不再是 assistant_message，
 * transformer 就不再触发，卡片安静地消失，没有任何报错。所以别指望它自己提醒你 ——
 * 靠上面那条命令定期看一眼。
 * ═══════════════════════════════════════════════════════════════════
 *
 * ## 为什么要在文本层面解析
 *
 * Pi 产生的是带结构的 `custom_message`：
 *
 * ```json
 * { "type": "custom_message", "customType": "background-task-notification",
 *   "content": "<background-task-notification>…</background-task-notification>",
 *   "details": { "name": "…", "status": "completed", "exitCode": 0,
 *                "startTime": …, "endTime": …, "model": "…", "pid": … } }
 * ```
 *
 * 但 Paseo 的 Pi provider（`pi/history-mapper.js` 的 `mapCustomMessage`）是这样映射的：
 *
 * ```js
 * const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
 * if (mappedEvent) return [mappedEvent];
 * return [{ type: "timeline", item: { type: "assistant_message", text } }];
 * ```
 *
 * `hooks.mapCustomMessage` **没有任何 provider 提供**，所以永远走默认分支 ——
 * `details` 整个被丢掉，只剩 `content` 那段给人看的文本，当成一条普通助手消息渲染。
 * 于是用户看到的是原始的 `<background-task-notification>` XML 和
 * "Subagent needs a supervisor decision." 这类裸文本。
 *
 * ⭐ **所以这里只能从文本反解。** 时间线 transformer 是纯同步函数，拿不到 RPC，
 * 也拿不到 `details`。好在这些文本本身格式相当固定，身份字段（runId / taskId /
 * agent / status）都能可靠取出。渲染层再拿这些 id 去服务端补齐 `details` 里
 * 那些文本里没有的东西（耗时、模型、输出大小）。
 *
 * ⚠️ 文本格式是 Pi 的内部约定，不是契约。所以每条规则都写得尽量宽松：
 * 取不到的字段留空而不是整条判失败 —— 少一个耗时不该让整张卡片退回裸文本。
 */

import { PiNoticeSchema, type PiNotice } from "./contracts.shared";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `<tag>值</tag>`。不依赖换行 —— 这段文本在有些渲染路径上会被压成一行。 */
function tag(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match?.[1]?.trim() || undefined;
}

function field(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^${label}:[ \\t]*(.+)$`, "m"));
  return match?.[1]?.trim() || undefined;
}

function normalizeStatus(value: string | undefined): PiNotice["status"] {
  switch ((value ?? "").toLowerCase()) {
    case "completed":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "stopped":
    case "canceled":
    case "cancelled":
      return "stopped";
    case "running":
      return "running";
    default:
      return undefined;
  }
}

// ── 各形态 ──────────────────────────────────────────────────────────

/** `<background-task-notification>` —— 后台任务终态。 */
function parseBackgroundTask(text: string): Partial<PiNotice> | null {
  if (!text.includes("<background-task-notification>")) return null;
  const exit = tag(text, "exit-code");
  return {
    kind: "background_task",
    taskId: tag(text, "task-id"),
    taskName: tag(text, "task-name"),
    status: normalizeStatus(tag(text, "status")) ?? "completed",
    exitCode: exit !== undefined && /^-?\d+$/.test(exit) ? Number(exit) : undefined,
    outputFile: tag(text, "output-file"),
    // guidance 是给模型看的操作提示，对人没有信息量，不进卡片
    body: tag(text, "summary") ?? "",
  };
}

/** `Background task completed: **workflow**` —— workflow 汇总。 */
function parseWorkflow(text: string): Partial<PiNotice> | null {
  const header = text.match(/^Background task (\w+):\s*\*\*(.+?)\*\*/m);
  if (!header) return null;
  const childRuns: PiNotice["childRuns"] = [];

  // `• key=lane-a1 run=<uuid> status=completed`
  for (const match of text.matchAll(/key=(\S+)\s+run=(\S+)\s+status=(\S+)/g)) {
    childRuns.push({ key: match[1]!, runId: match[2]!, status: match[3]! });
  }
  // 没有上面那种就退回 `Child runs: a=<id> (completed), b=<id> (failed)`
  if (childRuns.length === 0) {
    const line = field(text, "Child runs");
    if (line) {
      for (const match of line.matchAll(/([\w-]+)=(\S+?)\s*\(([^)]+)\)/g)) {
        childRuns.push({ key: match[1]!, runId: match[2]!, status: match[3]! });
      }
    }
  }

  const body = text
    .replace(/^Background task \w+:\s*\*\*.+?\*\*\s*/m, "")
    .replace(/^Workflow run:.*$/m, "")
    .replace(/^Child runs:.*$/m, "")
    .trim();

  return {
    kind: "workflow",
    taskName: header[2],
    status: normalizeStatus(header[1]) ?? "completed",
    runId: field(text, "Workflow run"),
    childRuns,
    body,
  };
}

/** `Subagent needs a supervisor decision.` / `Subagent progress update.` */
function parseSupervisor(text: string): Partial<PiNotice> | null {
  const decision = text.startsWith("Subagent needs a supervisor decision");
  const progress = text.startsWith("Subagent progress update");
  if (!decision && !progress) return null;

  const index = field(text, "Child index");
  // 头部之后、`Reply with:` 之前是真正的正文
  const body = text
    .split("\n")
    .slice(1)
    .filter((line) => !/^(Run|Agent|Child index|Child intercom target):/.test(line))
    .join("\n")
    .replace(/^Reply with:[\s\S]*$/m, "")
    .trim();

  return {
    kind: "supervisor",
    variant: decision ? "need_decision" : "progress_update",
    runId: field(text, "Run"),
    agent: field(text, "Agent"),
    childIndex: index !== undefined && /^\d+$/.test(index) ? Number(index) : undefined,
    replyTo: text.match(/replyTo:\s*"([^"]+)"/)?.[1],
    body,
  };
}

/** `Subagent needs attention: <agent>` —— 卡住了要人看一眼。 */
function parseAttention(text: string): Partial<PiNotice> | null {
  const header = text.match(/^Subagent needs attention:\s*(.+)$/m);
  if (!header) return null;
  // `Run: <uuid> step 1`
  const run = field(text, "Run");
  return {
    kind: "attention",
    status: "attention",
    agent: header[1]?.trim(),
    runId: run?.split(/\s+/)[0],
    signal: field(text, "Signal"),
    hint: field(text, "Hint"),
    body: field(text, "Facts") ?? "",
  };
}

/** `Content fetched for 19/19 URLs [id].` */
function parseWebSearch(text: string): Partial<PiNotice> | null {
  const match = text.match(/^Content fetched for (\d+)\/(\d+) URLs/);
  if (!match) return null;
  return {
    kind: "web_search",
    status: "completed",
    fetched: { done: Number(match[1]), total: Number(match[2]) },
    body: "",
  };
}

const PARSERS = [parseBackgroundTask, parseWorkflow, parseSupervisor, parseAttention, parseWebSearch];

/**
 * 从一条被拍平的助手消息里认出 Pi 的通知。
 *
 * 认不出来返回 `null` —— 那就是一条普通的助手消息，不该被我们接管。
 */
export function parsePiNoticeText(text: string): PiNotice | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const parse of PARSERS) {
    const partial = parse(trimmed);
    if (!partial) continue;
    const parsed = PiNoticeSchema.safeParse({ childRuns: [], body: "", ...partial });
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** 时间线条目 → 通知。只认助手消息，别的形态一律放过。 */
export function parsePiNoticeTimelineItem(value: unknown): PiNotice | null {
  const item = record(value);
  if (!item || item.type !== "assistant_message") return null;
  const text = typeof item.text === "string" ? item.text : null;
  return text ? parsePiNoticeText(text) : null;
}
