import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { LOCALES } from "./locale.shared";

export const LocaleSchema = z.enum(LOCALES);
export const LocalePreferenceSchema = z.enum(["auto", ...LOCALES]);

/** 界面语言。**三个 Paseo 插件共用同一个设置**（$PASEO_HOME/plugin-locale.json）。 */
export const localeRpc = defineRpc({
  name: "provider-balances.locale",
  input: z.object({ clientLocale: z.string().max(35).optional() }),
  output: z.object({
    preference: LocalePreferenceSchema,
    resolved: LocaleSchema,
    lockedByEnv: z.boolean(),
  }),
});

export const setLocaleRpc = defineRpc({
  name: "provider-balances.set-locale",
  input: z.object({
    preference: LocalePreferenceSchema,
    clientLocale: z.string().max(35).optional(),
  }),
  output: z.object({
    preference: LocalePreferenceSchema,
    resolved: LocaleSchema,
    lockedByEnv: z.boolean(),
  }),
});

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
