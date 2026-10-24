import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Effect } from "effect";

import {
  readClaudeCodeTokenState,
  resolveClaudeSubscriptionAuthentication,
  usesClaudeCodeCredentials,
} from "./src/claude-code-auth.ts";
import {
  createClaudeCodeTokenRenewal,
  makeRunClaudeCode,
} from "./src/claude-code-token-renewal.ts";
import { createAcquireClaudeSubscriptionUsage } from "./src/claude-subscription-usage-acquisition.ts";
import { createAcquireDedicatedWeeklyQuotaUsage } from "./src/dedicated-weekly-quota-acquisition.ts";
import { createFileProviderAcquisitionCoordinator } from "./src/provider-acquisition-coordinator.ts";
import { registerWeeklySubscriptionUsage } from "./src/register.ts";

const STATUS_KEY = "pi-subscription-usage";
const COORDINATION_WARNING_SHOWN = Symbol.for(
  "pi-subscription-usage/coordination-warning-shown",
);

function showCoordinationWarningOnce(notify: () => void): void {
  const processState = globalThis as typeof globalThis & {
    [COORDINATION_WARNING_SHOWN]?: boolean;
  };
  if (processState[COORDINATION_WARNING_SHOWN] === true) return;
  processState[COORDINATION_WARNING_SHOWN] = true;
  notify();
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function displayDirectory(cwd: string): string {
  const home = homedir();
  return cwd === home
    ? "~"
    : cwd.startsWith(`${home}/`)
      ? `~${cwd.slice(home.length)}`
      : cwd;
}

/** Matches the token format of Pi's built-in footer. */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** Context usage as Pi's built-in footer shows it, or nothing when unknown. */
export function contextUsageSegment(
  ctx: Pick<ExtensionContext, "getContextUsage" | "model">,
):
  | { readonly text: string; readonly color: "dim" | "warning" | "error" }
  | undefined {
  let usage: ReturnType<ExtensionContext["getContextUsage"]>;
  try {
    usage = ctx.getContextUsage();
  } catch {
    usage = undefined;
  }
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  if (!(contextWindow > 0)) return undefined;
  const percent = usage?.percent ?? null;
  const text = `${percent === null ? "?" : `${percent.toFixed(1)}%`}/${formatTokens(contextWindow)}`;
  const value = percent ?? 0;
  return {
    text,
    color: value > 90 ? "error" : value > 70 ? "warning" : "dim",
  };
}

function installSubscriptionFooter(ctx: ExtensionContext): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    return {
      dispose: unsubscribe,
      invalidate() {},
      render(width: number): string[] {
        const model = ctx.model;
        const effort = ctx.thinkingLevel;
        const modelText = model
          ? `(${model.provider}) ${model.id}${effort ? ` • ${effort}` : ""}`
          : "no model selected";
        const directory = displayDirectory(ctx.cwd);
        const context = contextUsageSegment(ctx);
        const modelWidth = visibleWidth(modelText);
        // Context usage sits at the far right. The directory gives way first,
        // then context usage; the model stays.
        const showContext =
          context !== undefined &&
          width - modelWidth - visibleWidth(context.text) - 2 >= 2;
        const rightWidth =
          modelWidth + (showContext ? visibleWidth(context.text) + 2 : 0);
        const right = `${theme.fg("dim", modelText)}${
          showContext ? `  ${theme.fg(context.color, context.text)}` : ""
        }`;
        const leftWidth = Math.max(0, width - rightWidth - 1);
        const left = truncateToWidth(directory, leftWidth, "…");
        const padding = " ".repeat(
          Math.max(1, width - visibleWidth(left) - rightWidth),
        );
        const heading = truncateToWidth(
          `${theme.fg("dim", left)}${padding}${right}`,
          width,
          "",
        );
        const extensionStatuses = footerData.getExtensionStatuses();
        const usageLines = extensionStatuses.get(STATUS_KEY)?.split("\n") ?? [
          theme.fg("dim", "Claude  loading…"),
          theme.fg("dim", "Codex   loading…"),
        ];
        const otherStatusLines = Array.from(extensionStatuses.entries())
          .filter(([key]) => key !== STATUS_KEY)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, text]) => sanitizeStatusText(text))
          .filter((text) => text !== "");
        return [
          heading,
          ...usageLines.map((line) => truncateToWidth(line, width, "")),
          ...otherStatusLines.map((line) => truncateToWidth(line, width, "")),
        ];
      },
    };
  });
}

const TOKEN_RENEWAL_OPT_OUT = "PI_SUBSCRIPTION_USAGE_RENEW_CLAUDE_CODE";

export default function piUsage(pi: ExtensionAPI): void {
  const acquisitionCoordinator = createFileProviderAcquisitionCoordinator();
  const renewClaudeCodeToken = createClaudeCodeTokenRenewal({
    readTokenState: Effect.promise(() => readClaudeCodeTokenState()),
    runClaudeCode: makeRunClaudeCode(),
    acquisitionCoordinator,
  });
  registerWeeklySubscriptionUsage(pi, {
    acquireDedicatedWeeklyQuotaUsage: createAcquireDedicatedWeeklyQuotaUsage({
      fetch,
    }),
    acquireClaudeSubscriptionUsage: (ctx) =>
      createAcquireClaudeSubscriptionUsage({
        fetch,
        acquisitionCoordinator,
        resolveAuthentication: Effect.tryPromise(() =>
          resolveClaudeSubscriptionAuthentication(ctx),
        ).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
        onCoordinationUnavailable: () =>
          showCoordinationWarningOnce(() =>
            ctx.ui.notify(
              "Claude usage unavailable: secure Linux runtime directory required",
              "warning",
            ),
          ),
      }),
    ...(process.env[TOKEN_RENEWAL_OPT_OUT] === "0"
      ? {}
      : {
          renewClaudeCodeToken: (ctx: ExtensionContext) =>
            Effect.promise(() => usesClaudeCodeCredentials(ctx)).pipe(
              Effect.flatMap((uses) =>
                uses
                  ? renewClaudeCodeToken
                  : Effect.succeed("unavailable" as const),
              ),
            ),
        }),
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") installSubscriptionFooter(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
