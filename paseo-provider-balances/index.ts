import type { PluginContext } from "@getpaseo/plugin";
import { providerUsageRpc } from "./contracts.shared";
import {
  closeProviderUsageClient,
  listProviderUsage,
} from "./provider-usage.server";
import { contributeProviderUsagePills } from "./usage-pill.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(providerUsageRpc, listProviderUsage);
  plugin.addClientSide(contributeProviderUsagePills);
  return () => closeProviderUsageClient();
}
