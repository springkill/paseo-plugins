import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

const ToneSchema = z.enum(["default", "ok", "warning", "danger"]);

const UsageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number().nullable().optional(),
  remainingPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
  runsOutAt: z.string().nullable().optional(),
  shortfallPct: z.number().nullable().optional(),
  tone: ToneSchema.optional(),
});

const BalanceSchema = z.object({
  id: z.string(),
  label: z.string(),
  used: z.number().nullable().optional(),
  remaining: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
  unit: z.enum(["tokens", "usd", "credits", "requests"]),
  resetsAt: z.string().nullable().optional(),
  tone: ToneSchema.optional(),
});

const DetailSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  tone: ToneSchema.optional(),
});

export const providerUsageRpc = defineRpc({
  name: "provider-balances.list",
  input: z.object({}),
  output: z.object({
    fetchedAt: z.string(),
    providers: z.array(
      z.object({
        providerId: z.string(),
        displayName: z.string(),
        status: z.enum(["available", "unavailable", "error"]),
        planLabel: z.string().nullable(),
        sourceLabel: z.string().nullable().optional(),
        fetchedAt: z.string().nullable().optional(),
        nextRefreshAt: z.string().nullable().optional(),
        windows: z.array(UsageWindowSchema),
        balances: z.array(BalanceSchema).optional(),
        details: z.array(DetailSchema).optional(),
        error: z.string().nullable().optional(),
      }),
    ),
  }),
});
