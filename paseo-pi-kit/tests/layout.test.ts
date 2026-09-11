import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 0.8 的目录边界。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ## 这条测试替代了什么
 *
 * 0.7 时前后端边界靠编译器在 `index.ts` 上做**文本删除**：
 * `REGISTRATIONS_REMOVED_BY_TARGET` 把另一半的注册调用整段抠掉，
 * `collectOppositeTargetImportRanges` 把对应的 import 也删掉。
 *
 * 那套机制**不检查引用**，所以踩过两次：
 *
 * - `readFlags is not defined` —— `.server` import 被删了，但用它的语句留着，
 *   client bundle 一跑就炸，而服务端一切正常、`paseo plugin ls` 显示 running
 * - cleanup 里的 `closeProviderUsageClient` 同样的坑，只能靠
 *   `typeof X === "function"` 守卫兜
 *
 * 旧的 tests/entrypoint-boundary.test.ts 就是为了补这个洞而复刻整套删除规则的。
 *
 * ⭐ **0.8 改成按目录划边界，编译器自己就管住了**：`client/` 只进 app bundle，
 * `server/` 只进 daemon，`shared/` 两边都进，其余位置直接编译报错
 * （`Plugin modules belong in client/, server/, or shared/`）。
 * 所以那套复刻已经删掉 —— 真正的判据是 tests/client-bundle.test.ts 里的真编译。
 *
 * 留下这条是因为它**便宜且早**：不用起编译器就能挡住放错位置的文件。
 * ═══════════════════════════════════════════════════════════════════
 */

const ROOT = join(import.meta.dirname, "..");
const ALLOWED_DIRS = new Set(["client", "server", "shared", "tests", "docs", "node_modules", ".git"]);

test("⭐ 源码只在 client/ server/ shared/ 三个目录里", () => {
  const strays = readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !ALLOWED_DIRS.has(entry.name))
    .filter((entry) => readdirSync(join(ROOT, entry.name)).some((name) => /\.tsx?$/.test(name)))
    .map((entry) => entry.name);
  assert.deepEqual(strays, [], "0.8 的编译器只认 client/ server/ shared/");
});

test("⭐ 根目录只放两个入口，别的 .ts 都不许有", () => {
  const rootSources = readdirSync(ROOT).filter((name) => /\.tsx?$/.test(name));
  assert.deepEqual(
    rootSources.toSorted(),
    ["index.client.tsx", "index.server.ts"],
    "根目录的 .ts/.tsx 只能是这两个入口 —— 0.8 按文件名发现入口",
  );
});

test("⭐ 两个入口都在（缺一个就少半边功能）", () => {
  assert.ok(existsSync(join(ROOT, "index.client.tsx")), "缺 index.client.tsx：卡片和 pill 全没了");
  assert.ok(existsSync(join(ROOT, "index.server.ts")), "缺 index.server.ts：所有 RPC 都没人处理");
});

test("⭐ 清单声明了 requirements.paseo", () => {
  // 不声明的话 0.8 直接按「targets pre-0.8」拒绝加载：
  // "This plugin has no requirements.paseo and targets Paseo before 0.8."
  const manifest = JSON.parse(readFileSync(join(ROOT, "paseo-plugin.json"), "utf8")) as {
    requirements?: { paseo?: string };
  };
  assert.equal(manifest.requirements?.paseo, ">=0.8.0");
});
