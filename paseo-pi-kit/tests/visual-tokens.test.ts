import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 守住卡片的视觉基线。
 *
 * 四张卡片原本各写各的：字号散落在 10/11/12/13/15/17/18/20，圆角有 5/8/9/10/12，
 * 两条进度条连轨道色都不一样（一处误用了 `foregroundMuted` —— 那是前景色，
 * 在深色主题上亮得像已填满）。单看每张都合理，放在同一条时间线上就很杂。
 *
 * ⭐ 规矩：**卡片里不写字面量字号 / 圆角 / 进度条，一律从 ui/tokens.client.tsx 取。**
 * 这条测试就是那条规矩的执行者 —— 新加卡片时会立刻挡住。
 */

const UI = join(import.meta.dirname, "..", "ui");
const FILES = readdirSync(UI)
  .filter((name) => name.endsWith(".client.tsx") && name !== "tokens.client.tsx")
  .map((name) => [name, readFileSync(join(UI, name), "utf8")] as const);

test("⭐ 卡片里不出现字面量字号", () => {
  const offenders = FILES.flatMap(([name, source]) =>
    [...source.matchAll(/fontSize: (\d+)/g)].map((m) => `${name}: fontSize: ${m[1]}`),
  );
  assert.deepEqual(offenders, [], "改用 ui/tokens.client.tsx 的 FONT.*；缺档位就去那里加");
});

test("⭐ 卡片里不出现字面量圆角", () => {
  const offenders = FILES.flatMap(([name, source]) =>
    [...source.matchAll(/borderRadius: (\d+)/g)].map((m) => `${name}: borderRadius: ${m[1]}`),
  );
  assert.deepEqual(offenders, [], "改用 RADIUS.*");
});

test("⭐ 进度条只有一处实现", () => {
  // 手写进度条的特征：百分比宽度
  const offenders = FILES.filter(([, source]) => /width: `\$\{[^}]*\}%`/.test(source)).map(([name]) => name);
  assert.deepEqual(offenders, [], "改用 <ProgressBar>，否则轨道色和圆角迟早又会分叉");
});

test("⭐ 色调映射只有一处实现", () => {
  const offenders = FILES.filter(([, source]) => /function toneColor\b/.test(source)).map(([name]) => name);
  assert.deepEqual(offenders, [], "改用 tokens.client.tsx 的 toneColor —— 曾经有一份把 warning 映射成灰色");
});

test("令牌本身是自洽的", () => {
  const tokens = readFileSync(join(UI, "tokens.client.tsx"), "utf8");
  for (const key of ["panelTitle", "cardTitle", "rowTitle", "body", "meta", "chip"]) {
    assert.ok(new RegExp(`\\b${key}:`).test(tokens), `FONT 少了 ${key}`);
  }
  // ⚠️ 只在 FONT 那一块里解析 —— LINE / RADIUS / SPACE 也有 body / meta / card
  // 这类同名键，全文匹配会串味（第一版就栽在这里）
  const block = tokens.slice(tokens.indexOf("export const FONT"), tokens.indexOf("export const LINE"));
  const font = Object.fromEntries(
    [...block.matchAll(/^\s{2}(\w+): (\d+),/gm)].map((m) => [m[1]!, Number(m[2])]),
  ) as Record<string, number>;
  assert.ok(font.panelTitle > font.cardTitle, "面板标题应当大于卡片标题");
  assert.ok(font.cardTitle > font.body, "卡片标题应当大于正文");
  assert.ok(font.body >= font.meta, "正文不应小于元信息");
  assert.ok(font.meta > font.chip, "元信息应当大于角标");
});
