/**
 * 界面语言：判定逻辑与文案表机制。
 *
 * ## 三个插件共用一个设置
 *
 * Paseo **没有**语言设置 API（查过：它的界面本身只有英文，没有 i18n 框架）。
 * 所以"跟 Paseo 统一"只能自己实现。如果每个插件各存各的设置，用户就得设三次 ——
 * 那不叫统一。
 *
 * 于是三个插件读写**同一个文件**：
 *
 * ```
 * $PASEO_HOME/plugin-locale.json      // { "locale": "auto" | "zh" | "en" }
 * ```
 *
 * 在任何一个插件里改语言，另外两个下次渲染就跟上。
 *
 * ⚠️ 刻意**不**往 Paseo 自己的 `config.json` 里塞键。它顶层 schema 是
 * passthrough，技术上塞得进去，但那是滥用逃生口 —— Paseo 哪天收紧 schema，
 * 设置会静默消失。自己的文件语义自己控制。
 *
 * ## 完整性靠类型检查
 *
 * 每条文案的所有语言写在同一个对象字面量里，由 `satisfies Catalog` 约束：
 * 漏一种语言就是缺少必需属性，`tsc --noEmit` 直接失败。没有对账脚本，因为不需要。
 */

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** `auto` = 按环境判定；否则是用户在设置里点出来的决定。 */
export type LocalePreference = "auto" | Locale;

export const LOCALE_NATIVE_NAME: Record<Locale, string> = { zh: "中文", en: "English" };

/**
 * 解析 BCP-47 / POSIX 风格的语言标签。
 *
 * `zh_CN.UTF-8`、`zh-Hans`、`zh`、`en_US` 都认。
 * `C` / `POSIX` 不是语言 —— 等同于「没设置」，返回 null 让上游继续往下找。
 */
export function localeFromTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const head = tag.split(/[.@]/)[0]?.replace(/_/g, "-").toLowerCase();
  const language = head?.split("-")[0];
  if (language === "zh") return "zh";
  if (language === "en") return "en";
  return null;
}

/**
 * 界面语言判定。**唯一的裁决点在服务端**，客户端只负责报告自己是什么语言。
 *
 * 优先级：
 *
 * ```
 * 1. <插件>_LANG        单个插件强制（作用域最窄，排最前）
 * 2. PASEO_PLUGIN_LANG  所有插件强制
 * 3. 共享设置           三个插件共用，UI 上点出来的
 * 4. 客户端语言         谁在看跟谁走
 * 5. 宿主机 LC_ALL / LC_MESSAGES / LANG
 * 6. en
 * ```
 *
 * ⭐ **用户设置压过环境推断。** `LANG` 是环境在*告诉*我们这台机器习惯什么语言 ——
 * 那是推断；设置里点出来的是*决定*。推断不该盖过决定，否则用户设成英文，
 * 换个终端又变回中文，而他找不到是谁改的。
 *
 * ⭐ **客户端语言排在宿主机之前。** Paseo 可以从手机或浏览器访问，
 * 那时看界面的人和跑 daemon 的机器不是同一个。
 *
 * 认不出来一律退到英文 —— 「认不出就说英文」比「认不出就说中文」更不容易让人卡住。
 */
export function resolveLocale(input: {
  env?: Record<string, string | undefined>;
  /** 本插件专用的环境变量名，如 `RUMEN_LANG`。 */
  envKey?: string;
  saved?: LocalePreference | null;
  clientHint?: string | null;
}): Locale {
  const env = input.env ?? {};
  if (input.envKey) {
    const forced = localeFromTag(env[input.envKey]);
    if (forced) return forced;
  }
  const shared = localeFromTag(env.PASEO_PLUGIN_LANG);
  if (shared) return shared;
  if (input.saved && input.saved !== "auto") return input.saved;
  const hinted = localeFromTag(input.clientHint);
  if (hinted) return hinted;
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const fromEnv = localeFromTag(env[key]);
    if (fromEnv) return fromEnv;
  }
  return "en";
}

/** 环境变量锁死时，设置项无效，UI 要说明。 */
export function lockedByEnv(env: Record<string, string | undefined>, envKey?: string): boolean {
  return Boolean(
    (envKey && localeFromTag(env[envKey])) || localeFromTag(env.PASEO_PLUGIN_LANG),
  );
}

// ── 文案表机制 ──────────────────────────────────────────────────────

/** 每条文案必须给全所有语言，缺一个就编译不过。 */
export type Message = { readonly [L in Locale]: string };
export type CatalogEntry = Message | ((...args: never[]) => Message);
export type Catalog = Readonly<Record<string, CatalogEntry>>;

export type Translated<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => Message
    ? (...args: A) => string
    : string;
};

/**
 * 把一份 catalog 编译成某语言的文案表。
 *
 * 调用点长这样：`t.label_done` / `t.tasks_count(3)` —— 参数类型与个数由
 * catalog 里的定义推出来，写错了编译不过。
 */
export function makeTranslator<T extends Catalog>(catalog: T, locale: Locale): Translated<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(catalog)) {
    out[key] = typeof entry === "function"
      ? (...args: never[]) => (entry as (...a: never[]) => Message)(...args)[locale]
      : entry[locale];
  }
  return Object.freeze(out) as Translated<T>;
}
