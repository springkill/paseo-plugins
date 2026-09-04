import type { PluginContext } from "@getpaseo/plugin";
import { providerUsageRpc } from "./domain/contracts.shared";
import {
  closeProviderUsageClient,
  listProviderUsage,
} from "./server/provider-usage.server";
import { contributeProviderUsagePills } from "./ui/usage-pill.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(providerUsageRpc, listProviderUsage);
  plugin.addClientSide(contributeProviderUsagePills);
  return () => closeProviderUsageClient();
}
