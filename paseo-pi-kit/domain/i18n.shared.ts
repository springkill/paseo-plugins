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
  // 每种通知对应 Pi 哪个插件的哪个函数，见 docs/pi-message-formats.md
  notice_background_task: { zh: "后台任务", en: "Background task" },
  notice_workflow: { zh: "Workflow", en: "Workflow" },
  notice_completion_group: (n: number) => ({
    zh: `${n} 个任务完成`,
    en: `${n} task${n === 1 ? "" : "s"} completed`,
  }),
  // ⚠️ 这三条是 subagent 发给**父 agent**的，不是问你 —— 措辞别暗示需要你操作
  notice_supervisor_decision: { zh: "Subagent 请求上级裁决", en: "Subagent asked its supervisor" },
  notice_supervisor_progress: { zh: "Subagent 进度", en: "Subagent progress" },
  notice_supervisor_interview: { zh: "Subagent 请求结构化答复", en: "Subagent requested a structured reply" },
  notice_control_failed: { zh: "Subagent 失败", en: "Subagent failed" },
  notice_control_long_running: { zh: "Subagent 跑得久", en: "Subagent running long" },
  notice_control_attention: { zh: "Subagent 需要关注", en: "Subagent needs attention" },
  notice_wait: { zh: "等待订阅已触发", en: "Wait subscription fired" },
  notice_web_search: { zh: "网页内容已抓取", en: "Web content fetched" },
  notice_web_search_error: { zh: "网页抓取失败", en: "Web fetch failed" },
  notice_model_only_goal: { zh: "Goal 契约（仅模型可见）", en: "Goal contract (model-only)" },
  notice_model_only_compaction: { zh: "压缩已完成（仅模型可见）", en: "Compaction done (model-only)" },

  notice_status_completed: { zh: "完成", en: "Completed" },
  notice_status_failed: { zh: "失败", en: "Failed" },
  notice_status_paused: { zh: "已暂停", en: "Paused" },
  notice_status_stopped: { zh: "已停止", en: "Stopped" },
  notice_status_running: { zh: "运行中", en: "Running" },
  notice_status_timed_out: { zh: "已超时", en: "Timed out" },
  notice_status_unresolved: { zh: "无法确认", en: "Unresolved" },

  notice_exit_code: (code: number) => ({ zh: `退出码 ${code}`, en: `exit ${code}` }),
  notice_child_runs: (n: number) => ({
    zh: `${n} 个子运行`,
    en: `${n} child run${n === 1 ? "" : "s"}`,
  }),
  notice_trace: (n: number) => ({
    zh: `${n} 条 trace`,
    en: `${n} trace event${n === 1 ? "" : "s"}`,
  }),
  notice_agent: (name: string) => ({ zh: `agent ${name}`, en: `agent ${name}` }),
  notice_child_index: (n: number) => ({ zh: `子任务 #${n}`, en: `child #${n}` }),
  notice_step: (n: number) => ({ zh: `第 ${n} 步`, en: `step ${n}` }),
  notice_fetched: (done: number, total: number) => ({
    zh: `${done}/${total} 个 URL`,
    en: `${done}/${total} URLs`,
  }),
  notice_output_file: { zh: "输出", en: "Output" },
  notice_saved_output: { zh: "已存到", en: "Saved to" },
  notice_signal: { zh: "信号", en: "Signal" },
  notice_recent_failures: { zh: "近期失败", en: "Recent failures" },
  notice_run: { zh: "Run", en: "Run" },
  notice_schedule: (name: string) => ({ zh: `定时任务 ${name}`, en: `schedule ${name}` }),
  notice_handoff: { zh: "并行交接", en: "Parallel handoff" },
  notice_no_preview: (reason: string) => ({
    zh: `无预览（${reason}）`,
    en: `no preview (${reason})`,
  }),
  notice_omitted_previews: (n: number) => ({
    zh: `另有 ${n} 个子任务的预览被 Pi 的预算省掉了`,
    en: `Pi's notice budget omitted ${n} more child preview${n === 1 ? "" : "s"}`,
  }),
  // Pi 把 workflow 返回值硬截断到 1000 字符，截断点常落在字符串中间。
  // 子输出里有同样内容的结构化版本，所以丢掉那段并不损失信息。
  notice_return_dropped: {
    zh: "返回值预览被 Pi 截断，已用下面的子任务输出替代",
    en: "Pi truncated the return preview; child outputs below supersede it",
  },
  notice_model_only_body: {
    zh: "这条是 Pi 发给模型的上下文，它自己的界面从不显示。Paseo 不看 display 标记，所以漏到了这里。",
    en: "Pi sends this to the model only and never shows it. Paseo ignores the display flag, so it leaked here.",
  },
  notice_control_body: {
    zh: "Pi 已经把这条投给父 agent 并唤醒它处理，不需要你操作。",
    en: "Pi already delivered this to the parent agent and woke it to handle; nothing for you to do.",
  },
  notice_supervisor_body: {
    zh: "这是 subagent 发给父 agent 的内部通信，要靠模型调 subagent_supervisor 回复，不需要你操作。Paseo 真正需要你回答的提问会弹带选项的对话框。",
    en: "Internal subagent-to-parent traffic; the model answers it with subagent_supervisor. Questions that actually need you appear as a Paseo dialog with options.",
  },
  notice_expand: { zh: "展开全文", en: "Show full text" },
  notice_collapse: { zh: "收起", en: "Collapse" },

  // ── provider 用量 / 余额 ────────────────────────────────────────
  usage_nav_open_usage: { zh: "打开 provider 用量", en: "Open provider usage" },
  usage_modal_title: { zh: "Provider 用量", en: "Provider Usage" },

  // ── 主视图 ──────────────────────────────────────────────────────
  usage_loading: { zh: "读取 provider 额度中…", en: "Loading provider balances…" },
  usage_empty: {
    zh: "没有已认证的 provider 返回用量数据",
    en: "No authenticated provider returned usage data",
  },
  usage_no_windows: {
    zh: "provider 可用，但没有返回额度窗口或余额",
    en: "Provider is reachable but returned no usage window or balance",
  },
  usage_connected: { zh: "已连接", en: "Connected" },
  usage_preferred: { zh: "当前优先", en: "Preferred" },
  usage_unavailable: { zh: "不可用", en: "Unavailable" },
  usage_action_refresh: { zh: "刷新", en: "Refresh" },
  usage_action_refreshing: { zh: "刷新中…", en: "Refreshing…" },
  usage_action_refresh_a11y: { zh: "刷新 provider 用量", en: "Refresh provider usage" },
  usage_toggle_unavailable: (show: boolean, n: number) => ({
    zh: `${show ? "隐藏" : "显示"}不可用的 provider（${n}）`,
    en: `${show ? "Hide" : "Show"} unavailable providers (${n})`,
  }),

  // ── 功能开关 ────────────────────────────────────────────────────
  settings_panel: { zh: "Pi Kit 设置", en: "Pi Kit Settings" },
  settings_open: { zh: "打开 Pi Kit 设置", en: "Open Pi Kit settings" },
  settings_features: { zh: "功能", en: "Features" },
  settings_features_hint: {
    zh: "关掉后时间线卡片立即消失；面板、命令面板项与 composer pill 要重载插件才消失。",
    en: "Disabling hides timeline cards immediately; panels, command items and composer pills go away after a reload.",
  },
  // ⚠️ 别删：这句是在解释「为什么我关了但菜单还在」
  settings_needs_reload: {
    zh: "时间线卡片已经生效。面板与 composer pill 是加载时注册的，重载后才消失：",
    en: "Timeline cards already changed. Panels and composer pills are registered at load time; reload to drop them:",
  },
  feature_todos: { zh: "任务列表", en: "Todo list" },
  feature_todos_desc: {
    zh: "把 Pi 的 todo 工具调用和 Paseo 原生 todo 换成进度卡，并在 composer 显示完成数",
    en: "Replaces Pi todo tool calls and native todo items with progress cards, plus a composer pill",
  },
  feature_subagents: { zh: "Subagents", en: "Subagents" },
  feature_subagents_desc: {
    zh: "subagent 调用卡片、实时子任务状态、独立面板与 composer pill",
    en: "Subagent call cards, live child status, a dedicated panel and a composer pill",
  },
  feature_notices: { zh: "Pi 通知卡片", en: "Pi notice cards" },
  feature_notices_desc: {
    zh: "把后台任务、workflow、subagent 督导等通知从裸文本还原成结构化卡片",
    en: "Turns background task, workflow and subagent notices from raw text into structured cards",
  },
  feature_balances: { zh: "Provider 用量", en: "Provider usage" },
  feature_balances_desc: {
    zh: "在 composer 显示各 provider 的额度窗口与余额",
    en: "Shows provider quota windows and balances in the composer",
  },

  // ── 语言 ────────────────────────────────────────────────────────

  // ── 语言 ────────────────────────────────────────────────────────
  settings_language: { zh: "界面语言", en: "Interface language" },
  settings_language_auto: { zh: "自动", en: "Auto" },
  settings_language_shared: {
    zh: "本插件与 Rumen 共用这一个设置",
    en: "Shared with the Rumen plugin",
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
