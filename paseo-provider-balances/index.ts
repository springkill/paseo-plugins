import type { PluginContext } from "@getpaseo/plugin";
import { localeRpc, providerUsageRpc, setLocaleRpc } from "./domain/contracts.shared";
import {
  closeProviderUsageClient,
  listProviderUsage,
} from "./server/provider-usage.server";
import { getLocale, setLocale } from "./server/locale.server";
import { contributeProviderUsagePills } from "./ui/usage-pill.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(providerUsageRpc, listProviderUsage);
  plugin.handle(localeRpc, getLocale);
  plugin.handle(setLocaleRpc, setLocale);
  plugin.addClientSide(contributeProviderUsagePills);
  return () => closeProviderUsageClient();
}
