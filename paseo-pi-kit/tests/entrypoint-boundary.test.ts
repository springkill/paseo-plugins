import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 守住 index.ts 的前后端边界。
 *
 * ## 这条测试为什么存在
 *
 * 踩过一次线上崩：`readFlags is not defined`。typecheck 全绿、构建不报错、
 * `paseo plugin ls` 显示 running、daemon 日志一切正常 —— 只有 Paseo 应用里炸。
 *
 * 根因在 `@getpaseo/server` 的 `plugins/compiler.js` → `filterEntrypoint()`：
 * 它对**入口文件**做文本级删除，
 *
 * 1. `collectOppositeTargetImportRanges` 删掉对面 target 的 import 语句
 * 2. `collectRemovedRegistrationRanges` 删掉不属于该 target 的注册调用，
 *    清单 `REGISTRATIONS_REMOVED_BY_TARGET`：
 *       client → 只删 `handle`
 *       server → 删掉全部 `add*`
 *
 * ⭐ 于是：**`.server` 的东西只能在 `plugin.handle(...)` 里引用**，
 * `.client` 的东西只能在那些 `add*` 里引用。写在别处（裸语句、条件判断、
 * 回调体内）就会在对面 bundle 里留下没有定义的标识符。
 *
 * 构建期抓不到 —— boundary 检查看不到那条 import，它在更早的文本阶段就没了。
 */

const SOURCE = readFileSync(join(import.meta.dirname, "..", "index.ts"), "utf8");

/** 与 compiler.js 的 REGISTRATIONS_REMOVED_BY_TARGET 一致。 */
const REMOVED_BY_TARGET = {
  client: ["handle"],
  server: [
    "addSurface", "addSidebarItem", "addWorkspacePanel", "addCommandCenterItem",
    "addClientSide", "addAttachmentSource", "addTheme",
    "addTimelineTransformer", "addTimelineRenderer",
  ],
} as const;

/** `import { a, b as c } from "./x.server"` → ["a", "c"] */
function importedBindings(source: string, suffix: "client" | "server"): string[] {
  const names: string[] = [];
  const pattern = new RegExp(
    `import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+"[^"]*\\.${suffix}"`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue; // `import type` 会被 tsc 擦除，不进 bundle
    for (const part of match[2]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** 按名字删掉 `plugin.xxx(...)` 整条调用（括号配平，跟编译器删 AST 节点等效）。 */
function stripRegistrations(source: string, names: readonly string[]): string {
  let output = source;
  for (const name of names) {
    for (;;) {
      const at = output.indexOf(`.${name}(`);
      if (at < 0) break;
      let depth = 0;
      let index = output.indexOf("(", at);
      const start = index;
      for (; index < output.length; index++) {
        if (output[index] === "(") depth++;
        else if (output[index] === ")" && --depth === 0) break;
      }
      // 连同前面的 `plugin` 一起去掉，避免留下半截表达式
      const lineStart = output.lastIndexOf("\n", at) + 1;
      output = output.slice(0, lineStart) + output.slice(index + 1);
    }
  }
  return output;
}

for (const target of ["client", "server"] as const) {
  const opposite = target === "client" ? "server" : "client";

  test(`⭐ ${target} bundle 里不会留下 .${opposite} 的悬空引用`, () => {
    const bindings = importedBindings(SOURCE, opposite);
    assert.ok(bindings.length > 0, `index.ts 应当有 .${opposite} 的值导入，否则这条测试没在测东西`);

    // 模拟 filterEntrypoint：删掉本 target 不要的注册调用
    const filtered = stripRegistrations(SOURCE, REMOVED_BY_TARGET[target]);
    // 再删掉 import 语句本身（对面 target 的 import 会被整条删除）
    const body = filtered.replace(/^import[\s\S]*?from\s+"[^"]*";$/gm, "");

    // `typeof X === "function" && X()` 是安全的 —— 对未声明标识符做 typeof 不抛。
    // 把成对出现的守卫连同被守卫的调用一起摘掉再检查。
    const guarded = body.replace(
      /if\s*\(typeof\s+(\w+)\s*===\s*"function"\)\s*\1\([^)]*\);/g,
      "",
    );

    const leaked = bindings.filter((name) =>
      new RegExp(`(^|[^A-Za-z0-9_$.])${name}\\s*[(,)\\.]`).test(guarded),
    );
    assert.deepEqual(
      leaked,
      [],
      `这些 .${opposite} 的绑定在 ${target} bundle 里没有定义，运行时会 ReferenceError：`
        + `${leaked.join(", ")}\n`
        + `把它们的用法挪进 ${target === "client" ? "plugin.handle(...)" : REMOVED_BY_TARGET.server.slice(0, 3).join(" / ")} 里，`
        + `或者改从 .${target} 模块取。`,
    );
  });
}
