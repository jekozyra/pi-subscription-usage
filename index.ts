import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Effect } from "effect";

import { resolveClaudeSubscriptionAuthentication } from "./src/claude-code-auth.ts";
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
        const rightWidth = visibleWidth(modelText);
        const leftWidth = Math.max(0, width - rightWidth - 1);
        const left = truncateToWidth(directory, leftWidth, "…");
        const padding = " ".repeat(
          Math.max(1, width - visibleWidth(left) - rightWidth),
        );
        const heading = truncateToWidth(
          `${theme.fg("dim", left)}${padding}${theme.fg("dim", modelText)}`,
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

export default function piUsage(pi: ExtensionAPI): void {
  const acquisitionCoordinator = createFileProviderAcquisitionCoordinator();
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
              "Claude usage unavailable: secure Linux XDG_RUNTIME_DIR required",
              "warning",
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
