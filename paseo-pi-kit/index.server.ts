/**
 * Pi Kit —— 服务端入口。
 *
 * ## 0.8 的两入口模型
 *
 * 0.7 是单个 `index.ts`，编译器靠**文本删除**把另一半的注册调用和 import
 * 从 bundle 里抠掉（`REGISTRATIONS_REMOVED_BY_TARGET`）。那套机制在 0.8 没了，
 * 改成按目录划边界：`client/` 只进 app bundle，`server/` 只进 daemon bundle，
 * `shared/` 两边都进，其余位置直接编译报错。
 *
 * 好处很实在：0.7 那套踩过两次坑 —— `readFlags is not defined`（server 符号
 * 漏进 client bundle）和 cleanup 里的 `closeProviderUsageClient`，都得靠
 * `typeof X === "function"` 守卫兜着。**现在编译器直接管住了，守卫可以删。**
 */

import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  latestTodoRpc,
  localeRpc,
  providerUsageRpc,
  reportRpc,
  setLocaleRpc,
  subagentCallsRpc,
} from "./shared/contracts";
import { getLocale, reportClientLines, setLocale } from "./server/locale";
import { closeProviderUsageClient, listProviderUsage } from "./server/provider-usage";
import { listSubagentCalls } from "./server/subagents";
import { getLatestTodo } from "./server/todo";

export default function contribute(server: PluginServerContext) {
  server.handle(latestTodoRpc, getLatestTodo);
  server.handle(subagentCallsRpc, listSubagentCalls);
  server.handle(providerUsageRpc, listProviderUsage);
  server.handle(localeRpc, getLocale);
  server.handle(setLocaleRpc, setLocale);
  server.handle(reportRpc, reportClientLines);

  return () => {
    // ⚠️ 0.7 时这里必须写 `typeof closeProviderUsageClient === "function"` ——
    // 同一个 cleanup 在两个 bundle 里都存在，而 client 那边的 `.server` import
    // 被编译器整条删了，不守卫就 ReferenceError。
    // 0.8 按目录分 bundle，这个文件只进 daemon，守卫是多余的。
    closeProviderUsageClient();
  };
}
