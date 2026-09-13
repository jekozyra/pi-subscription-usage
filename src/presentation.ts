export type WeeklySubscriptionUsageStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available";
      readonly usedPercent: number;
      readonly stale: boolean;
      readonly weeklyWindowResetsAtMs?: number;
      readonly sessionUsedPercent?: number;
      readonly sessionWindowResetsAtMs?: number;
      readonly availableLimitResetCredits?: number;
    };

export type MonitoredProviderName = "Codex" | "Claude";

export interface ProviderSubscriptionUsagePresentation {
  readonly providerName: MonitoredProviderName;
  readonly detail: string;
  readonly color: "dim" | "warning" | "error";
}

export interface SubscriptionUsagePresentation {
  readonly text: string;
  readonly color: "dim" | "warning" | "error";
}

export type FooterUsageColor =
  | "dim"
  | "success"
  | "warning"
  | "error"
  | "accent";

export interface FooterUsageSegment {
  readonly text: string;
  readonly color: FooterUsageColor;
}

export interface SubscriptionUsageLines {
  readonly claude: readonly FooterUsageSegment[];
  readonly codex: readonly FooterUsageSegment[];
}

export function formatResetCountdown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "now";

  const totalMinutes = Math.max(1, Math.floor(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d${hours > 0 ? `${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
  return `${minutes}m`;
}

export function presentProviderSubscriptionUsage(
  providerName: MonitoredProviderName,
  status: WeeklySubscriptionUsageStatus,
  nowMs = Date.now(),
): ProviderSubscriptionUsagePresentation {
  if (status.kind !== "available") {
    return {
      providerName,
      detail: status.kind === "loading" ? "wk loading…" : "wk unavailable",
      color: "dim",
    };
  }

  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round(status.usedPercent)),
  );
  const filledCells = Math.round(usedPercent / 10);
  const bar = "━".repeat(filledCells) + "─".repeat(10 - filledCells);

  const resetCountdownSuffix =
    status.weeklyWindowResetsAtMs === undefined
      ? ""
      : ` ${formatResetCountdown(status.weeklyWindowResetsAtMs - nowMs)}`;
  const limitResetCreditsSuffix =
    status.availableLimitResetCredits === undefined
      ? ""
      : ` ↻${status.availableLimitResetCredits}`;

  return {
    providerName,
    detail: `wk ${bar} ${usedPercent}%${resetCountdownSuffix}${limitResetCreditsSuffix}${status.stale ? " ~" : ""}`,
    color: usedPercent >= 90 ? "error" : usedPercent >= 75 ? "warning" : "dim",
  };
}

const CLAUDE_SESSION_WINDOW_MS = 5 * 60 * 60_000;
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60_000;

export function usagePaceColor(
  usedPercent: number,
  resetsAtMs: number | undefined,
  windowDurationMs: number,
  nowMs: number,
): FooterUsageColor {
  if (usedPercent >= 90) return "error";
  if (resetsAtMs === undefined) return "dim";
  const elapsedPercent =
    Math.min(
      1,
      Math.max(0, (nowMs - (resetsAtMs - windowDurationMs)) / windowDurationMs),
    ) * 100;
  const aheadBy = usedPercent - elapsedPercent;
  return aheadBy > 25 ? "error" : aheadBy > 10 ? "warning" : "success";
}

function usageSegment(
  usedPercent: number,
  resetsAtMs: number | undefined,
  durationMs: number,
  nowMs: number,
): FooterUsageSegment {
  const reset =
    resetsAtMs === undefined
      ? "reset unavailable"
      : `resets ${formatResetCountdown(resetsAtMs - nowMs)}`;
  return {
    text: `${Math.round(usedPercent)}% · ${reset}`,
    color: usagePaceColor(usedPercent, resetsAtMs, durationMs, nowMs),
  };
}

export function presentSubscriptionUsageLines(
  statuses: Readonly<
    Record<MonitoredProviderName, WeeklySubscriptionUsageStatus>
  >,
  nowMs = Date.now(),
): SubscriptionUsageLines {
  const claude = statuses.Claude;
  const codex = statuses.Codex;
  const claudeLine: FooterUsageSegment[] = [{ text: "Claude  ", color: "dim" }];
  if (claude.kind !== "available") {
    claudeLine.push({
      text: claude.kind === "loading" ? "loading…" : "unavailable",
      color: "dim",
    });
  } else {
    claudeLine.push({ text: "session ", color: "dim" });
    claudeLine.push(
      claude.sessionUsedPercent === undefined
        ? { text: "unavailable", color: "dim" }
        : usageSegment(
            claude.sessionUsedPercent,
            claude.sessionWindowResetsAtMs,
            CLAUDE_SESSION_WINDOW_MS,
            nowMs,
          ),
      { text: "      week ", color: "dim" },
      usageSegment(
        claude.usedPercent,
        claude.weeklyWindowResetsAtMs,
        WEEKLY_WINDOW_MS,
        nowMs,
      ),
    );
    if (claude.stale) claudeLine.push({ text: " ~", color: "dim" });
  }

  const codexLine: FooterUsageSegment[] = [{ text: "Codex   ", color: "dim" }];
  if (codex.kind !== "available") {
    codexLine.push({
      text: codex.kind === "loading" ? "loading…" : "unavailable",
      color: "dim",
    });
  } else {
    codexLine.push(
      { text: "week ", color: "dim" },
      usageSegment(
        codex.usedPercent,
        codex.weeklyWindowResetsAtMs,
        WEEKLY_WINDOW_MS,
        nowMs,
      ),
    );
    if (codex.availableLimitResetCredits !== undefined) {
      codexLine.push({
        text: `      limit resets available: ${codex.availableLimitResetCredits}`,
        color: "accent",
      });
    }
    if (codex.stale) codexLine.push({ text: " ~", color: "dim" });
  }
  return { claude: claudeLine, codex: codexLine };
}

/** Backwards-compatible single-provider presentation for the Codex seam. */
export function presentCodexQuotaStatus(
  status: WeeklySubscriptionUsageStatus,
  nowMs = Date.now(),
): SubscriptionUsagePresentation {
  const presentation = presentProviderSubscriptionUsage("Codex", status, nowMs);
  return {
    text: `${presentation.providerName} ${presentation.detail}`,
    color: presentation.color,
  };
}
