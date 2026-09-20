import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

import piUsage from "../index.ts";

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
        ]),
    },
  );

  assert.deepEqual(footer.render(120).slice(1), [
    "Claude  unavailable",
    "Codex   week 10% · resets 5d16h",
    "router auto · context 42%",
  ]);
});

test("warns only once per process when secure coordination is unavailable", async () => {
  const warningSymbol = Symbol.for(
    "pi-subscription-usage/coordination-warning-shown",
  );
  Reflect.deleteProperty(globalThis, warningSymbol);
  const previousRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
  delete process.env.XDG_RUNTIME_DIR;
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
    "Claude usage unavailable: secure Linux XDG_RUNTIME_DIR required",
  ]);
});
