/**
 * 文案表。
 *
 * 加一条 = 在下面的对象里加一项，两种语言都得写，否则 `tsc --noEmit` 失败。
 *
 * ## 文案规范
 *
 * 英文沿用 Paseo 的规则（sentence case / 无尾句号 / 按钮祈使 / 进行时用字面
 * 三点省略号）。中文等价改写：
 *
 * - 标签、按钮**不加句号**
 * - 按钮用动词短语：`刷新` 而不是 `刷新操作`
 * - 进行中用「…中」：`刷新中…`
 * - 空状态是短名词短语：`暂无任务` 而不是 `这里还没有任务哦`
 *
 * ## 术语（与 Pi / Paseo 对齐，不自造）
 *
 * `agent` / `subagent` / `todo` 保持原文 —— 它们是 Pi 的工具名，
 * 翻译过来反而对不上用户在别处看到的东西。
 */

import { makeTranslator, type Catalog, type Locale, type Translated } from "./locale.shared";

const CATALOG = {
  // ── 入口 ────────────────────────────────────────────────────────
  nav_open_todos: { zh: "打开 Pi 任务列表", en: "Open Pi todo list" },
  nav_open_subagents: { zh: "打开 Pi subagents", en: "Open Pi subagents" },
  panel_subagents: { zh: "Pi Subagents", en: "Pi Subagents" },
  modal_todos: { zh: "Pi 任务列表", en: "Pi Todo List" },

  // ── 任务进度 ────────────────────────────────────────────────────
  todo_title: { zh: "Pi 任务进度", en: "Pi task progress" },
  todo_empty: { zh: "暂无任务", en: "No tasks" },
  todo_none_for_agent: {
    zh: "这个 agent 还没有 Pi todo 数据",
    en: "This agent has no Pi todo data yet",
  },
  todo_expand: (n: number) => ({
    zh: `查看全部 ${n} 项`,
    en: `Show all ${n}`,
  }),
  todo_collapse: { zh: "收起任务列表", en: "Collapse" },

  // ── 任务动作（来自 Pi 的 todo 工具）─────────────────────────────
  action_create: (suffix: string) => ({ zh: `新增任务${suffix}`, en: `Added task${suffix}` }),
  action_update: (suffix: string) => ({ zh: `更新任务${suffix}`, en: `Updated task${suffix}` }),
  action_delete: (suffix: string) => ({ zh: `删除任务${suffix}`, en: `Deleted task${suffix}` }),
  action_get: (suffix: string) => ({ zh: `查看任务${suffix}`, en: `Read task${suffix}` }),
  action_clear: { zh: "清空任务", en: "Cleared tasks" },
  action_list: { zh: "刷新任务", en: "Listed tasks" },
  action_snapshot: { zh: "任务状态", en: "Task snapshot" },
  action_default: { zh: "任务状态更新", en: "Tasks updated" },

  // ── 计数 ────────────────────────────────────────────────────────
  count_running: (n: number) => ({ zh: `进行中 ${n}`, en: `${n} in progress` }),
  count_pending: (n: number) => ({ zh: `待处理 ${n}`, en: `${n} pending` }),

  // ── 状态 ────────────────────────────────────────────────────────
  status_pending: { zh: "待处理", en: "Pending" },
  status_in_progress: { zh: "进行中", en: "In progress" },
  status_completed: { zh: "完成", en: "Done" },
  status_running: { zh: "运行中", en: "Running" },
  status_failed: { zh: "失败", en: "Failed" },
  status_canceled: { zh: "取消", en: "Canceled" },
  status_deleted: { zh: "已删除", en: "Deleted" },

  // ── Subagents ───────────────────────────────────────────────────
  subagents_none_for_agent: {
    zh: "这个 Pi agent 还没有 subagent 调用",
    en: "This Pi agent has no subagent calls yet",
  },
  subagents_none_current: {
    zh: "当前 agent 还没有 subagent 调用",
    en: "The current agent has no subagent calls yet",
  },
  subagents_summary: (active: number, total: number, calls: number) => ({
    zh: `${active} 个运行中 · 共 ${total} 个子任务 · 最近 ${calls} 次调用`,
    en: `${active} running · ${total} subtasks · ${calls} recent calls`,
  }),
  subagents_scoped_to: (agentId: string) => ({
    zh: `仅显示当前 agent：${agentId}`,
    en: `Scoped to the current agent: ${agentId}`,
  }),
  subagents_starting: { zh: "启动中…", en: "Starting…" },
  subagents_no_output: { zh: "没有输出", en: "No output" },
  subagents_expand_output: { zh: "展开子任务输出", en: "Show subtask output" },
  subagents_collapse_output: { zh: "收起子任务输出", en: "Hide subtask output" },

  // ── Pi 通知卡片 ─────────────────────────────────────────────────
  notice_background_task: { zh: "后台任务", en: "Background task" },
  notice_workflow: { zh: "Workflow", en: "Workflow" },
  notice_supervisor_decision: { zh: "等你裁决", en: "Awaiting your decision" },
  notice_supervisor_progress: { zh: "Subagent 进度", en: "Subagent progress" },
  notice_attention: { zh: "Subagent 需要关注", en: "Subagent needs attention" },
  notice_web_search: { zh: "网页内容已抓取", en: "Web content fetched" },

  notice_status_completed: { zh: "完成", en: "Completed" },
  notice_status_failed: { zh: "失败", en: "Failed" },
  notice_status_stopped: { zh: "已停止", en: "Stopped" },
  notice_status_running: { zh: "运行中", en: "Running" },

  notice_exit_code: (code: number) => ({ zh: `退出码 ${code}`, en: `exit ${code}` }),
  notice_child_runs: (n: number) => ({
    zh: `${n} 个子运行`,
    en: `${n} child run${n === 1 ? "" : "s"}`,
  }),
  notice_agent: (name: string) => ({ zh: `agent ${name}`, en: `agent ${name}` }),
  notice_child_index: (n: number) => ({ zh: `子任务 #${n}`, en: `child #${n}` }),
  notice_fetched: (done: number, total: number) => ({
    zh: `${done}/${total} 个 URL`,
    en: `${done}/${total} URLs`,
  }),
  notice_output_file: { zh: "输出", en: "Output" },
  notice_signal: { zh: "信号", en: "Signal" },
  notice_hint: { zh: "建议", en: "Hint" },
  notice_run: { zh: "Run", en: "Run" },
  notice_awaiting_reply: {
    zh: "它停在这里等你回话 —— 不回就不会往下走",
    en: "It is blocked waiting for your reply",
  },
  notice_expand: { zh: "展开全文", en: "Show full text" },
  notice_collapse: { zh: "收起", en: "Collapse" },

  // ── 语言 ────────────────────────────────────────────────────────
  settings_language: { zh: "界面语言", en: "Interface language" },
  settings_language_auto: { zh: "自动", en: "Auto" },
  settings_language_shared: {
    zh: "三个 Paseo 插件共用这一个设置",
    en: "Shared by all three Paseo plugins",
  },
  settings_language_locked: {
    zh: "环境变量已锁定语言，此处设置不生效",
    en: "An environment variable pins the language; this setting has no effect",
  },
} as const satisfies Catalog;

export type MessageKey = keyof typeof CATALOG;
export const MESSAGE_KEYS = Object.keys(CATALOG) as MessageKey[];
export type Translator = Translated<typeof CATALOG>;

const CACHE = new Map<Locale, Translator>();

export function translator(locale: Locale): Translator {
  const cached = CACHE.get(locale);
  if (cached) return cached;
  const built = makeTranslator(CATALOG, locale);
  CACHE.set(locale, built);
  return built;
}
