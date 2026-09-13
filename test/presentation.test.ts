import assert from "node:assert/strict";
import { test } from "vitest";

import {
  presentCodexQuotaStatus,
  presentProviderSubscriptionUsage,
  presentSubscriptionUsageLines,
  usagePaceColor,
} from "../src/presentation.ts";

test("fresh weekly quota usage is presented as a ten-cell used bar", () => {
  assert.deepEqual(
    presentCodexQuotaStatus(
      {
        kind: "available",
        usedPercent: 63,
        stale: false,
        weeklyWindowResetsAtMs: Date.UTC(2026, 8, 14, 14),
        availableLimitResetCredits: 2,
      },
      Date.UTC(2026, 8, 11, 12),
    ),
    {
      text: "Codex wk ━━━━━━──── 63% 3d2h ↻2",
      color: "dim",
    },
  );
});

test("quota presentation rounds, clamps, colors, and marks freshness", () => {
  const cases = [
    {
      status: { kind: "available", usedPercent: -2, stale: false } as const,
      expected: { text: "Codex wk ────────── 0%", color: "dim" },
    },
    {
      status: { kind: "available", usedPercent: 66, stale: false } as const,
      expected: { text: "Codex wk ━━━━━━━─── 66%", color: "dim" },
    },
    {
      status: { kind: "available", usedPercent: 75, stale: true } as const,
      expected: { text: "Codex wk ━━━━━━━━── 75% ~", color: "warning" },
    },
    {
      status: { kind: "available", usedPercent: 90, stale: false } as const,
      expected: { text: "Codex wk ━━━━━━━━━─ 90%", color: "error" },
    },
    {
      status: { kind: "available", usedPercent: 101, stale: false } as const,
      expected: { text: "Codex wk ━━━━━━━━━━ 100%", color: "error" },
    },
  ];

  for (const { status, expected } of cases) {
    assert.deepEqual(presentCodexQuotaStatus(status), expected);
  }
});

test("weekly reset countdown uses compact hour, minute, and elapsed forms", () => {
  const nowMs = Date.UTC(2026, 8, 11, 12);
  const status = {
    kind: "available" as const,
    usedPercent: 20,
    stale: false,
  };

  const cases = [
    [23 * 60 * 60_000 + 59 * 60_000 + 30_000, "23h59m"],
    [2 * 60 * 60_000 + 30 * 60_000, "2h30m"],
    [59 * 60_000 + 30_000, "59m"],
    [42 * 60_000, "42m"],
    [0, "now"],
  ] as const;

  for (const [remainingMs, expected] of cases) {
    assert.equal(
      presentCodexQuotaStatus(
        { ...status, weeklyWindowResetsAtMs: nowMs + remainingMs },
        nowMs,
      ).text,
      `Codex wk ━━──────── 20% ${expected}`,
    );
  }
});

test("zero limit reset credits are shown while an unavailable count is omitted", () => {
  assert.equal(
    presentCodexQuotaStatus({
      kind: "available",
      usedPercent: 20,
      stale: false,
      availableLimitResetCredits: 0,
    }).text,
    "Codex wk ━━──────── 20% ↻0",
  );
  assert.equal(
    presentCodexQuotaStatus({
      kind: "available",
      usedPercent: 20,
      stale: false,
    }).text,
    "Codex wk ━━──────── 20%",
  );
});

test("Claude retains its weekly label and shares Codex thresholds", () => {
  assert.deepEqual(
    presentProviderSubscriptionUsage("Claude", {
      kind: "available",
      usedPercent: 90,
      stale: true,
    }),
    {
      providerName: "Claude",
      detail: "wk ━━━━━━━━━─ 90% ~",
      color: "error",
    },
  );
  assert.deepEqual(
    presentProviderSubscriptionUsage("Claude", {
      kind: "unavailable",
    }),
    {
      providerName: "Claude",
      detail: "wk unavailable",
      color: "dim",
    },
  );
});

test("subscription footer lines show session, weekly, reset, and credit details", () => {
  const nowMs = Date.UTC(2026, 8, 13, 12);
  assert.deepEqual(
    presentSubscriptionUsageLines(
      {
        Claude: {
          kind: "available",
          usedPercent: 68,
          stale: false,
          sessionUsedPercent: 42,
          sessionWindowResetsAtMs: nowMs + 83 * 60_000,
          weeklyWindowResetsAtMs: nowMs + (3 * 24 + 4) * 60 * 60_000,
        },
        Codex: {
          kind: "available",
          usedPercent: 31,
          stale: false,
          weeklyWindowResetsAtMs: nowMs + (5 * 24 + 2) * 60 * 60_000,
          availableLimitResetCredits: 2,
        },
      },
      nowMs,
    ),
    {
      claude: [
        { text: "Claude  ", color: "dim" },
        { text: "session ", color: "dim" },
        { text: "42% · resets 1h23m", color: "success" },
        { text: "      week ", color: "dim" },
        { text: "68% · resets 3d4h", color: "warning" },
      ],
      codex: [
        { text: "Codex   ", color: "dim" },
        { text: "week ", color: "dim" },
        { text: "31% · resets 5d2h", color: "success" },
        { text: "      limit resets available: 2", color: "accent" },
      ],
    },
  );
});

test("pace color compares usage with elapsed time and hard-stops at 90%", () => {
  const duration = 100_000;
  const now = 50_000;
  const reset = 100_000;
  assert.equal(usagePaceColor(60, reset, duration, now), "success");
  assert.equal(usagePaceColor(61, reset, duration, now), "warning");
  assert.equal(usagePaceColor(76, reset, duration, now), "error");
  assert.equal(usagePaceColor(90, reset, duration, now), "error");
  assert.equal(usagePaceColor(20, undefined, duration, now), "dim");
});

test("loading and unavailable statuses have compact neutral presentations", () => {
  assert.deepEqual(presentCodexQuotaStatus({ kind: "loading" }), {
    text: "Codex wk loading…",
    color: "dim",
  });
  assert.deepEqual(presentCodexQuotaStatus({ kind: "unavailable" }), {
    text: "Codex wk unavailable",
    color: "dim",
  });
});
