import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { readFile } from "node:fs/promises";
import type { output as ZodOutput } from "zod";
import { providerUsageRpc } from "../domain/contracts.shared";

let daemonClient: DaemonClient | null = null;
let connecting: Promise<DaemonClient> | null = null;

async function daemonUrl(): Promise<string> {
  const home = process.env.HOME;
  if (!home) throw new Error("Paseo plugin process has no HOME");
  const raw = await readFile(`${home}/.paseo/config.json`, "utf8");
  const config = JSON.parse(raw) as { daemon?: { listen?: string; auth?: { password?: string } } };
  if (config.daemon?.auth?.password) {
    throw new Error("Provider balance plugin does not support password-protected local daemons");
  }
  const listen = config.daemon?.listen ?? "127.0.0.1:6767";
  if (listen.startsWith("/") || listen.startsWith("unix:")) {
    throw new Error(`Provider balance plugin cannot connect to Unix daemon socket: ${listen}`);
  }
  if (/^\d+$/.test(listen)) return `ws://127.0.0.1:${listen}/ws`;
  const normalized = listen
    .replace(/^0\.0\.0\.0:/, "127.0.0.1:")
    .replace(/^\[?::\]?:/, "127.0.0.1:");
  return `ws://${normalized}/ws`;
}

async function connect(): Promise<DaemonClient> {
  if (daemonClient?.isConnected) return daemonClient;
  if (connecting) return connecting;
  connecting = (async () => {
    if (daemonClient) await daemonClient.close().catch(() => {});
    const client = new DaemonClient({
      url: await daemonUrl(),
      clientId: `paseo-provider-balances-${process.pid}`,
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
