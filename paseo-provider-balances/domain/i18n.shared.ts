/**
 * 文案表。
 *
 * 加一条 = 在下面的对象里加一项，两种语言都得写，否则 `tsc --noEmit` 失败。
 *
 * ## 术语
 *
 * `provider` / `plan` / `credits` 保持原文 —— 它们是 Paseo 和各家服务商界面上
 * 的原词，翻译过来反而对不上用户在别处看到的东西。
 */

import { makeTranslator, type Catalog, type Locale, type Translated } from "./locale.shared";

const CATALOG = {
  // ── 入口 ────────────────────────────────────────────────────────
  nav_open_usage: { zh: "打开 provider 用量", en: "Open provider usage" },
  modal_title: { zh: "Provider 用量", en: "Provider Usage" },

  // ── 主视图 ──────────────────────────────────────────────────────
  loading: { zh: "读取 provider 额度中…", en: "Loading provider balances…" },
  empty: {
    zh: "没有已认证的 provider 返回用量数据",
    en: "No authenticated provider returned usage data",
  },
  no_windows: {
    zh: "provider 可用，但没有返回额度窗口或余额",
    en: "Provider is reachable but returned no usage window or balance",
  },
  connected: { zh: "已连接", en: "Connected" },
  preferred: { zh: "当前优先", en: "Preferred" },
  unavailable: { zh: "不可用", en: "Unavailable" },

  action_refresh: { zh: "刷新", en: "Refresh" },
  action_refreshing: { zh: "刷新中…", en: "Refreshing…" },
  action_refresh_a11y: { zh: "刷新 provider 用量", en: "Refresh provider usage" },
  toggle_unavailable: (show: boolean, n: number) => ({
    zh: `${show ? "隐藏" : "显示"}不可用的 provider（${n}）`,
    en: `${show ? "Hide" : "Show"} unavailable providers (${n})`,
  }),

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
