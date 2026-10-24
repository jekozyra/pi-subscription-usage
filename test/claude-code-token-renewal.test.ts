import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, test } from "vitest";

import type { ClaudeCodeTokenState } from "../src/claude-code-auth.ts";
import {
  ClaudeCodeRunFailed,
  createClaudeCodeTokenRenewal,
  makeRunClaudeCode,
} from "../src/claude-code-token-renewal.ts";
import {
  type CoordinatedAcquisitionOutcome,
  createFileProviderAcquisitionCoordinator,
} from "../src/provider-acquisition-coordinator.ts";

const MINUTE = 60_000;
const NOW = 10_000_000;
const roots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-usage-renewal-"));
  await chmod(path, 0o700);
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function token(expiresAtMs: number, renewalCredential = "refresh-1") {
  return {
    expiresAtMs,
    renewalCredential,
    accountId: "account-a",
  } satisfies ClaudeCodeTokenState;
}

async function fixture(options: {
  readonly expiresAtMs: number;
  readonly renewTo?: number;
  readonly failure?: string;
  readonly now?: () => number;
  readonly runtimeDirectory?: string;
}) {
  let state: ClaudeCodeTokenState | undefined = token(options.expiresAtMs);
  let runs = 0;
  const runtimeDirectory =
    options.runtimeDirectory ?? (await temporaryDirectory());
  const renewal = createClaudeCodeTokenRenewal({
    readTokenState: Effect.sync(() => state),
    runClaudeCode: Effect.suspend(() => {
      runs += 1;
      if (options.failure !== undefined) {
        return Effect.fail(
          new ClaudeCodeRunFailed({ diagnostic: options.failure }),
        );
      }
      if (options.renewTo !== undefined) {
        state = token(options.renewTo, "refresh-2");
      }
      return Effect.void;
    }),
    acquisitionCoordinator: createFileProviderAcquisitionCoordinator({
      runtimeDirectory,
      now: options.now ?? (() => NOW),
    }),
    now: options.now ?? (() => NOW),
  });
  return {
    renewal,
    runtimeDirectory,
    runs: () => runs,
    clearState: () => {
      state = undefined;
    },
  };
}

async function storedOutcome(runtimeDirectory: string) {
  const entries = join(
    runtimeDirectory,
    "pi-subscription-usage",
    "acquisition-v1",
    "entries",
  );
  const [entry] = await readdir(entries);
  if (entry === undefined) throw new Error("no renewal entry");
  assert.ok(entry.startsWith("claude-code-token-renewal-"));
  const [file] = (await readdir(join(entries, entry))).filter((name) =>
    name.endsWith(".json"),
  );
  if (file === undefined) throw new Error("no renewal state");
  return JSON.parse(await readFile(join(entries, entry, file), "utf8"))
    .outcome as CoordinatedAcquisitionOutcome<unknown> & {
    diagnostic?: string;
  };
}

describe("Claude Code token renewal", () => {
  test("leaves a token with time remaining alone", async () => {
    const f = await fixture({ expiresAtMs: NOW + 6 * MINUTE });
    assert.equal(await Effect.runPromise(f.renewal), "not-due");
    assert.equal(f.runs(), 0);
  });

  test("does nothing without a renewable Claude Code login", async () => {
    const f = await fixture({ expiresAtMs: NOW });
    f.clearState();
    assert.equal(await Effect.runPromise(f.renewal), "unavailable");
    assert.equal(f.runs(), 0);
  });

  test("runs Claude Code once for an expiring token and shares the result", async () => {
    const runtimeDirectory = await temporaryDirectory();
    const first = await fixture({
      expiresAtMs: NOW + 4 * MINUTE,
      renewTo: NOW + 8 * 60 * MINUTE,
      runtimeDirectory,
    });
    const second = await fixture({
      expiresAtMs: NOW + 4 * MINUTE,
      renewTo: NOW + 8 * 60 * MINUTE,
      runtimeDirectory,
    });

    assert.equal(await Effect.runPromise(first.renewal), "renewed");
    assert.equal(await Effect.runPromise(second.renewal), "renewed");
    assert.equal(first.runs() + second.runs(), 1);
  });

  test("an expired token is renewed", async () => {
    const f = await fixture({
      expiresAtMs: NOW - MINUTE,
      renewTo: NOW + 8 * 60 * MINUTE,
    });
    assert.equal(await Effect.runPromise(f.renewal), "renewed");
  });

  test("retries at expiry when Claude Code keeps a nearly expired token", async () => {
    let now = NOW;
    const f = await fixture({ expiresAtMs: NOW + 4 * MINUTE, now: () => now });

    assert.equal(await Effect.runPromise(f.renewal), "deferred");
    now = NOW + 3 * MINUTE;
    assert.equal(await Effect.runPromise(f.renewal), "deferred");
    assert.equal(f.runs(), 1);
    now = NOW + 4 * MINUTE;
    await Effect.runPromise(f.renewal);
    assert.equal(f.runs(), 2);
    assert.equal(
      (await storedOutcome(f.runtimeDirectory)).diagnostic,
      "Claude Code did not renew an expired token",
    );
  });

  test("backs off and records why Claude Code could not run", async () => {
    let now = NOW;
    const f = await fixture({
      expiresAtMs: NOW - MINUTE,
      failure: "Claude Code executable not found",
      now: () => now,
    });

    assert.equal(await Effect.runPromise(f.renewal), "deferred");
    now = NOW + 14 * MINUTE;
    await Effect.runPromise(f.renewal);
    assert.equal(f.runs(), 1);
    const outcome = await storedOutcome(f.runtimeDirectory);
    assert.equal(outcome.diagnostic, "Claude Code executable not found");
    assert.equal(
      JSON.stringify(outcome).includes("refresh-1") ||
        JSON.stringify(outcome).includes("account-a"),
      false,
    );
  });
});

describe("running Claude Code", () => {
  async function fakeClaude(script: string) {
    const directory = await temporaryDirectory();
    const command = join(directory, "claude");
    await writeFile(command, `#!/bin/sh\n${script}\n`, { mode: 0o700 });
    return { directory, command };
  }

  test("uses the stored login, a minimal prompt, and a scratch directory", async () => {
    const { directory, command } = await fakeClaude(
      `printf '%s\\n' "$*" "$PWD" "\${CLAUDE_CODE_OAUTH_TOKEN-unset}" "\${ANTHROPIC_API_KEY-unset}" "\${KEEP-unset}" > "${"$OUT"}"`,
    );
    const out = join(directory, "out");

    await Effect.runPromise(
      makeRunClaudeCode({
        command,
        env: {
          PATH: process.env.PATH,
          OUT: out,
          KEEP: "kept",
          CLAUDE_CODE_OAUTH_TOKEN: "agent-token",
          ANTHROPIC_API_KEY: "api-key",
        },
      }),
    );

    const [args, cwd, oauthToken, apiKey, kept] = (
      await readFile(out, "utf8")
    ).split("\n");
    assert.equal(args, "-p hi --model haiku --no-session-persistence");
    assert.ok(cwd?.includes("pi-claude-renewal-"));
    assert.equal(oauthToken, "unset");
    assert.equal(apiKey, "unset");
    assert.equal(kept, "kept");
  });

  test("describes failures without output", async () => {
    const cases: Array<[Promise<string>, string]> = [
      [
        fakeClaude("echo secret-output; exit 3").then((f) => f.command),
        "Claude Code exited with code 3",
      ],
      [fakeClaude("sleep 5").then((f) => f.command), "Claude Code timed out"],
      [
        temporaryDirectory().then((d) => join(d, "missing")),
        "Claude Code executable not found",
      ],
    ];
    for (const [command, diagnostic] of cases) {
      const result = await Effect.runPromise(
        Effect.either(
          makeRunClaudeCode({ command: await command, timeoutMs: 200 }),
        ),
      );
      assert.equal(result._tag, "Left");
      assert.equal(
        result._tag === "Left" && result.left.diagnostic,
        diagnostic,
      );
    }
  });
});
