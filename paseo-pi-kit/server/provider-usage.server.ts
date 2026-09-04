import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { daemonUrl } from "./daemon.server";
import type { output as ZodOutput } from "zod";
import { providerUsageRpc } from "../domain/contracts.shared";

let daemonClient: DaemonClient | null = null;
let connecting: Promise<DaemonClient> | null = null;

async function connect(): Promise<DaemonClient> {
  if (daemonClient?.isConnected) return daemonClient;
  if (connecting) return connecting;
  connecting = (async () => {
    if (daemonClient) await daemonClient.close().catch(() => {});
    const client = new DaemonClient({
      url: await daemonUrl(),
      clientId: `paseo-pi-kit-usage-${process.pid}`,
      clientType: "cli",
      connectTimeoutMs: 10_000,
      reconnect: { enabled: false },
    });
    await client.connect();
    daemonClient = client;
    return client;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function listProviderUsage(
  _input: ZodOutput<typeof providerUsageRpc.input>,
): Promise<ZodOutput<typeof providerUsageRpc.output>> {
  try {
    const result = await (await connect()).listProviderUsage();
    return {
      fetchedAt: result.fetchedAt,
      providers: result.providers.map((provider) => ({
        ...provider,
        balances: provider.balances ?? [],
        details: provider.details ?? [],
      })),
    };
  } catch (firstError) {
    if (daemonClient) await daemonClient.close().catch(() => {});
    daemonClient = null;
    try {
      const result = await (await connect()).listProviderUsage();
      return {
        fetchedAt: result.fetchedAt,
        providers: result.providers.map((provider) => ({
          ...provider,
          balances: provider.balances ?? [],
          details: provider.details ?? [],
        })),
      };
    } catch (retryError) {
      console.error("[provider-balances] native Paseo usage query failed", retryError);
      throw retryError instanceof Error ? retryError : firstError;
    }
  }
}

export async function closeProviderUsageClient(): Promise<void> {
  const client = daemonClient;
  daemonClient = null;
  connecting = null;
  if (client) await client.close().catch(() => {});
}
