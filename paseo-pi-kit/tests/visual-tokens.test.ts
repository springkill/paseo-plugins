import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 守住卡片的视觉基线。
 *
 * 四张卡片原本各写各的：字号散落在 10/11/12/13/15/17/18/20，圆角有 5/8/9/10/12，
 * 图标 14/15/16/17，进度条轨道色两处不同（一处误用了 `foregroundMuted` ——
 * 那是前景色，在深色主题上亮得像已填满），还有 8 处 `<Text>` **根本没写字号**，
 * 吃 react-native 默认值。单看每张都合理，放在同一条时间线上就很杂。
 *
 * ⭐ 规矩：
 *   - 卡片里不写字面量字号 / 圆角 / 图标尺寸，一律从 ui/tokens.client.tsx 取
 *   - `<Text>` 不写内联样式对象，一律 `style={text(theme, "…")}`
 *
 * 这条测试就是那些规矩的执行者 —— 新加卡片时会立刻挡住。
 * 最后一条尤其重要：内联样式漏掉 fontSize **不会报错**，只会安静地小一号，
 * 靠肉眼是发现不了的。
 */

const UI = join(import.meta.dirname, "..", "ui");
const FILES = readdirSync(UI)
  .filter((name) => name.endsWith(".client.tsx") && name !== "tokens.client.tsx")
  .map((name) => [name, readFileSync(join(UI, name), "utf8")] as const);

test("卡片里不出现字面量字号", () => {
  const offenders = FILES.flatMap(([name, source]) =>
    [...source.matchAll(/fontSize: (\d+)/g)].map((m) => `${name}: fontSize: ${m[1]}`),
  );
  assert.deepEqual(offenders, [], "改用 ui/tokens.client.tsx 的 FONT.*；缺档位就去那里加");
});

test("卡片里不出现字面量圆角", () => {
  const offenders = FILES.flatMap(([name, source]) =>
    [...source.matchAll(/borderRadius: (\d+)/g)].map((m) => `${name}: borderRadius: ${m[1]}`),
  );
  assert.deepEqual(offenders, [], "改用 RADIUS.*");
});

test("卡片里不出现字面量图标尺寸", () => {
  const offenders = FILES.flatMap(([name, source]) =>
    [...source.matchAll(/size=\{(\d+)\}/g)].map((m) => `${name}: size={${m[1]}}`),
  );
  assert.deepEqual(offenders, [], "改用 ICON.card / ICON.row / ICON.inline");
});

/**
 * ⭐ 这条是最重要的一条。
 *
 * `<Text style={{ color: …, fontWeight: … }}>` 漏掉 `fontSize` 时 **tsc 不报错**，
 * 只会安静地退回 react-native 的默认字号，比邻居小一号。上一轮统一就是被这个
 * 打回来的：改完 tokens 之后仍然有 8 处这种写法活着。
 */
test("⭐ <Text> 一律用 text() 取样式，不写内联样式对象", () => {
  const offenders: string[] = [];
  for (const [name, source] of FILES) {
    for (const match of source.matchAll(/style=\{\{/g)) {
      // 往回找最近的一个标签开头，看它是不是 <Text
      const open = source.lastIndexOf("<", match.index);
      if (open < 0) continue;
      const tag = source.slice(open + 1).match(/^[A-Za-z][A-Za-z0-9.]*/)?.[0];
      if (tag !== "Text") continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${name}:${line}`);
    }
  }
  assert.deepEqual(offenders, [], '改成 style={text(theme, "body", { muted: true })}');
});

test("进度条只有一处实现", () => {
  // 手写进度条的特征：百分比宽度
  const offenders = FILES.filter(([, source]) => /width: `\$\{[^}]*\}%`/.test(source)).map(([name]) => name);
  assert.deepEqual(offenders, [], "改用 <ProgressBar>，否则轨道色和圆角迟早又会分叉");
});

test("色调映射只有一处实现", () => {
  const offenders = FILES.filter(([, source]) => /function toneColor\b/.test(source)).map(([name]) => name);
  assert.deepEqual(offenders, [], "改用 tokens.client.tsx 的 toneColor —— 曾经有一份把 warning 映射成灰色");
});

test("面板一律套 PanelShell", () => {
  // 三个面板曾经三种头部：一个没有标题、一个有标题、一个有标题带刷新按钮，
  // 内边距还各写各的（10 / 12 / 14 / 18）。
  const offenders = FILES.filter(([, source]) => /export function \w*Panel\b/.test(source))
    .filter(([, source]) => !source.includes("PanelShell") && !source.includes("ProviderBalancesCard"))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], "面板用 <PanelShell>，别自己拼头部和 ScrollView");
});

test("令牌本身是自洽的", () => {
  const tokens = readFileSync(join(UI, "tokens.client.tsx"), "utf8");
  // ⚠️ 只在 FONT 那一块里解析 —— LINE / RADIUS / SPACE 也有 body / meta / card
  // 这类同名键，全文匹配会串味（第一版就栽在这里）
  function block(start: string, end: string): Record<string, number> {
    const slice = tokens.slice(tokens.indexOf(start), tokens.indexOf(end));
    return Object.fromEntries(
      [...slice.matchAll(/^\s{2}(\w+): (\d+),/gm)].map((m) => [m[1]!, Number(m[2])]),
    ) as Record<string, number>;
  }
  const font = block("export const FONT", "export const LINE");
  const line = block("export const LINE", "const WEIGHT");

  for (const key of ["panelTitle", "cardTitle", "rowTitle", "body", "meta", "chip"]) {
    assert.ok(font[key] !== undefined, `FONT 少了 ${key}`);
    // 行高必须和字号一一对应，否则 text() 会取到 undefined 而**不报错**
    assert.ok(line[key] !== undefined, `LINE 少了 ${key} —— text() 会静默拿到 undefined 行高`);
    assert.ok(line[key]! > font[key]!, `LINE.${key} 应当大于 FONT.${key}`);
  }
  assert.ok(font.panelTitle! > font.cardTitle!, "面板标题应当大于卡片标题");
  assert.ok(font.cardTitle! > font.body!, "卡片标题应当大于正文");
  assert.ok(font.body! >= font.meta!, "正文不应小于元信息");
  assert.ok(font.meta! > font.chip!, "元信息应当大于角标");
});

// ── 面板打开位置 ────────────────────────────────────────────────────

test("⭐ 打开面板一律走 openPanelPreferExplorer", () => {
  // ═════════════════════════════════════════════════════════════════
  // 曾经的规矩是「必须显式带 location: \"explorer\"」—— 因为缺省是 \"workspace\"，
  // 会把面板开成主区的大标签页而不是文件树旁边那个侧边容器。
  //
  // 但那条规矩在**手机上是错的**。宿主的 createPluginNavigation：
  //
  //   if (location !== "explorer") return;              // 默认放置
  //   const paneId = showExplorerSidebar(workspaceKey);
  //   if (!paneId) throw new Error("Explorer is unavailable");
  //
  // 而 explorer 有三种形态：isCompact ? "overlay" : supportsDesktopPaneSplits()
  // ? "pane" : "dock"，且 supportsDesktopPaneSplits() 直接 return isWeb。
  // 窄屏原生端是 overlay，没有可用的 pane —— 于是同步抛异常，点了没反应。
  //
  // ⭐ 现在的规矩：走 openPanelPreferExplorer，先试 explorer，失败退回默认放置。
  // ⚠️ 这个差异本机和 web 端都测不出来，只有窄屏原生端会踩到。
  // ═════════════════════════════════════════════════════════════════
  const sources = [
    ...FILES,
    ["index.ts", readFileSync(join(UI, "..", "index.ts"), "utf8")] as const,
  ];

  // 1. 不许再直接写 location: "explorer"
  const hardcoded = sources
    .filter(([name]) => name !== "open-panel.client.ts")
    .flatMap(([name, source]) =>
      [...source.matchAll(/^(?!\s*(?:\/\/|\*)).*location:\s*"explorer"/gm)].map(
        (m) => `${name}: ${m[0].trim()}`,
      ),
    );
  assert.deepEqual(hardcoded, [], "改用 openPanelPreferExplorer —— 手机上会抛 Explorer is unavailable");

  // 2. 直接调 openPanel 的地方必须是 helper 内部
  const direct = sources
    .filter(([name]) => name !== "open-panel.client.ts")
    .flatMap(([name, source]) =>
      [...source.matchAll(/(?<![\w.])(?:client\.)?openPanel\s*\(/g)]
        .map((m) => `${name}: ${m[0]}`),
    );
  assert.deepEqual(direct, [], "面板开启一律经 openPanelPreferExplorer");

  // 3. helper 自己必须真的带兜底
  const helper = readFileSync(join(UI, "open-panel.client.ts"), "utf8");
  assert.match(helper, /catch/, "helper 必须接住 explorer 不可用");
  assert.match(helper, /open\(panelId, options\)/, "helper 必须有退回默认放置的那一次调用");
});

// ── 结构化数据不许退回 JSON 味 ──────────────────────────────────────

test("⭐ 结构化渲染里不出现花括号 / true / false 字面量", () => {
  // 第一版把结构化数据画成 JSON 树：`true` 原样、`{}` `[]` 原样、数组画成 `[0]`。
  // 信息全在，语义全丢 —— 用户的原话是「很明显是个半成品」。
  // ⚠️ 先剥注释 —— 这个文件的注释里就在讲「不要画 {} / [] / JSON.stringify」，
  // 不剥的话这条测试会照着自己的说明书报错（第一版就是这样）。
  const source = readFileSync(join(UI, "structured.client.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const banned = [
    [/["'`]\{\}["'`]/, "空对象画成 {} —— 改画 —"],
    [/["'`]\[\]["'`]/, "空数组画成 [] —— 改画 —"],
    [/\[\$\{index\}\]/, "数组下标画成 [0] —— 改用从 1 开始的序号"],
    [/JSON\.stringify/, "又在把值 stringify 回去 —— 那就是 JSON 树"],
  ] as const;
  const offenders = banned.filter(([pattern]) => pattern.test(source)).map(([, why]) => why);
  assert.deepEqual(offenders, []);
});
