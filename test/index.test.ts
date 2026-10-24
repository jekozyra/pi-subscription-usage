import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

import piUsage, { contextUsageSegment, formatTokens } from "../index.ts";

// Loading the real entry point must never run Claude Code from the test suite.
process.env.PI_SUBSCRIPTION_USAGE_RENEW_CLAUDE_CODE = "0";

test("package entry point registers the Codex quota lifecycle", () => {
  const events: string[] = [];
  const pi = {
    on: (event: string) => {
      events.push(event);
    },
  } as unknown as ExtensionAPI;

  piUsage(pi);

  assert.deepEqual(events.sort(), [
    "after_provider_response",
    "agent_settled",
    "model_select",
    "session_shutdown",
    "session_shutdown",
    "session_start",
    "session_start",
  ]);
});

test("custom footer preserves statuses from other extensions", async () => {
  type Handler = (event: unknown, context: unknown) => void | Promise<void>;
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;
  let footerFactory:
    | ((...args: unknown[]) => { render: (width: number) => string[] })
    | undefined;
  const ctx = {
    mode: "tui",
    cwd: "/workspace",
    model: { provider: "openai-codex", id: "gpt-5.6-sol" },
    thinkingLevel: "medium",
    ui: {
      setFooter: (factory: typeof footerFactory) => {
        footerFactory = factory;
      },
    },
  };
  piUsage(pi);

  const footerHandler = handlers.get("session_start")?.at(-1);
  assert.ok(footerHandler);
  await footerHandler({}, ctx);
  assert.ok(footerFactory);
  const footer = footerFactory(
    { requestRender: () => undefined },
    { fg: (_color: string, text: string) => text },
    {
      onBranchChange: () => () => undefined,
      getExtensionStatuses: () =>
        new Map([
          [
            "pi-subscription-usage",
            "Claude  unavailable\nCodex   week 10% · resets 5d16h",
          ],
          ["typesafe-router", "router auto · context 42%"],
          ["pi-background-tasks", "◇ Agents: 2 done"],
        ]),
    },
  );

  assert.deepEqual(footer.render(120).slice(1), [
    "Claude  unavailable",
    "Codex   week 10% · resets 5d16h",
    "◇ Agents: 2 done",
    "router auto · context 42%",
  ]);
});

test("warns only once per process when secure coordination is unavailable", async () => {
  const warningSymbol = Symbol.for(
    "pi-subscription-usage/coordination-warning-shown",
  );
  Reflect.deleteProperty(globalThis, warningSymbol);
  const previousRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = "/";
  const warnings: string[] = [];

  type Handler = (event: unknown, context: unknown) => Promise<void>;
  const load = () => {
    const handlers = new Map<string, Handler[]>();
    const pi = {
      on: (event: string, handler: Handler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
    } as unknown as ExtensionAPI;
    piUsage(pi);
    return handlers;
  };
  const ctx = {
    mode: "tui",
    modelRegistry: {
      getProviderAuth: async (provider: string) =>
        provider === "anthropic"
          ? { source: "OAuth", auth: { apiKey: "secret" } }
          : undefined,
    },
    ui: {
      notify: (message: string) => warnings.push(message),
      setStatus: () => undefined,
      setFooter: () => undefined,
      theme: { fg: (_color: string, text: string) => text },
    },
  };

  try {
    const first = load();
    for (const handler of first.get("session_start") ?? [])
      await handler({}, ctx);
    for (const handler of first.get("session_shutdown") ?? [])
      await handler({}, ctx);
    const reloaded = load();
    for (const handler of reloaded.get("session_start") ?? [])
      await handler({}, ctx);
    for (const handler of reloaded.get("session_shutdown") ?? [])
      await handler({}, ctx);
  } finally {
    if (previousRuntimeDirectory === undefined) {
      delete process.env.XDG_RUNTIME_DIR;
    } else {
      process.env.XDG_RUNTIME_DIR = previousRuntimeDirectory;
    }
    Reflect.deleteProperty(globalThis, warningSymbol);
  }

  assert.deepEqual(warnings, [
    "Claude usage unavailable: secure Linux runtime directory required",
  ]);
});

test("context usage matches Pi's footer format and thresholds", () => {
  const segment = (
    usage:
      | { tokens: number | null; contextWindow: number; percent: number | null }
      | undefined,
    model?: { contextWindow?: number },
  ) =>
    contextUsageSegment({
      getContextUsage: () => usage,
      model,
    } as unknown as Parameters<typeof contextUsageSegment>[0]);

  assert.deepEqual(
    segment({ tokens: 76_000, contextWindow: 200_000, percent: 38 }),
    { text: "38.0%/200k", color: "dim" },
  );
  assert.deepEqual(
    segment({ tokens: 0, contextWindow: 1_000_000, percent: 70.5 }),
    { text: "70.5%/1.0M", color: "warning" },
  );
  assert.deepEqual(
    segment({ tokens: 0, contextWindow: 200_000, percent: 90.1 }),
    { text: "90.1%/200k", color: "error" },
  );
  assert.deepEqual(
    segment({ tokens: 249_999, contextWindow: 1_000_000, percent: 25 }),
    { text: "25.0%/1.0M", color: "dim" },
  );
  assert.deepEqual(
    segment({ tokens: 250_000, contextWindow: 1_000_000, percent: 25 }),
    { text: "25.0%/1.0M", color: "warning" },
  );
  assert.deepEqual(
    segment({ tokens: null, contextWindow: 200_000, percent: null }),
    { text: "?/200k", color: "dim" },
  );
  assert.deepEqual(segment(undefined, { contextWindow: 128_000 }), {
    text: "?/128k",
    color: "dim",
  });
  assert.equal(segment(undefined), undefined);
  assert.equal(
    contextUsageSegment({
      getContextUsage: () => {
        throw new Error("no session");
      },
    } as unknown as Parameters<typeof contextUsageSegment>[0]),
    undefined,
  );
  assert.deepEqual(
    [999, 1_500, 45_000, 2_500_000, 12_000_000].map(formatTokens),
    ["999", "1.5k", "45k", "2.5M", "12M"],
  );
});

test("the heading shows context usage right of the model and drops it when narrow", async () => {
  type Handler = (event: unknown, context: unknown) => void | Promise<void>;
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;
  let footerFactory:
    | ((...args: unknown[]) => { render: (width: number) => string[] })
    | undefined;
  const ctx = {
    mode: "tui",
    cwd: "/workspace/project",
    model: { provider: "anthropic", id: "opus", contextWindow: 200_000 },
    thinkingLevel: "high",
    getContextUsage: () => ({
      tokens: 150_000,
      contextWindow: 200_000,
      percent: 75,
    }),
    ui: {
      setFooter: (factory: typeof footerFactory) => {
        footerFactory = factory;
      },
    },
  };
  piUsage(pi);
  await handlers.get("session_start")?.at(-1)?.({}, ctx);
  assert.ok(footerFactory);
  const footer = footerFactory(
    { requestRender: () => undefined },
    {
      fg: (color: string, text: string) =>
        `\x1b[${color === "warning" ? 33 : 2}m${text}\x1b[0m`,
    },
    {
      onBranchChange: () => () => undefined,
      getExtensionStatuses: () => new Map(),
    },
  );
  const strip = (line: string | undefined) =>
    line?.replace(/\p{Cc}\[[0-9;]*m/gu, "");

  assert.equal(
    strip(footer.render(60)[0]),
    "/workspace/project       (anthropic) opus • high  75.0%/200k",
  );
  assert.ok(footer.render(60)[0]?.includes("\x1b[33m75.0%/200k"));
  assert.equal(
    strip(footer.render(42)[0]),
    "/work… (anthropic) opus • high  75.0%/200k",
  );
  assert.equal(strip(footer.render(30)[0]), "/work… (anthropic) opus • high");
});
