import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import type { ClaudeCodeTokenState } from "./claude-code-auth.ts";
import type {
  CoordinatedAcquisitionAttempt,
  ProviderAcquisitionCoordinator,
} from "./provider-acquisition-coordinator.ts";

/** Claude Code refreshes only an expired or nearly expired token. */
const RENEW_WITHIN_MS = 5 * 60_000;
const CLAUDE_CODE_TIMEOUT_MS = 120_000;
const CLAUDE_CODE_ARGUMENTS = [
  "-p",
  "hi",
  "--model",
  "haiku",
  "--no-session-persistence",
] as const;
// A token in these would let Claude Code skip renewing its stored login.
const INHERITED_CREDENTIAL_VARIABLES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

export class ClaudeCodeRunFailed extends Data.TaggedError(
  "ClaudeCodeRunFailed",
)<{ readonly diagnostic: string }> {}

export type ClaudeCodeTokenRenewalResult =
  | "renewed"
  | "not-due"
  | "deferred"
  | "unavailable";

export interface ClaudeCodeTokenRenewalDependencies {
  readonly readTokenState: Effect.Effect<ClaudeCodeTokenState | undefined>;
  readonly runClaudeCode: Effect.Effect<void, ClaudeCodeRunFailed>;
  readonly acquisitionCoordinator: ProviderAcquisitionCoordinator;
  readonly now?: () => number;
}

interface RenewedToken {
  readonly expiresAtMs: number;
}

function decodeRenewedToken(value: unknown): RenewedToken | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const expiresAtMs = Reflect.get(value, "expiresAtMs");
  return Number.isSafeInteger(expiresAtMs) && expiresAtMs > 0
    ? { expiresAtMs }
    : undefined;
}

/**
 * Keeps Claude Code's stored login fresh by running Claude Code when its token
 * is about to expire. One Pi process runs it; the others reuse the outcome.
 */
export function createClaudeCodeTokenRenewal(
  dependencies: ClaudeCodeTokenRenewalDependencies,
): Effect.Effect<ClaudeCodeTokenRenewalResult> {
  const now = dependencies.now ?? Date.now;

  const renew = (
    before: ClaudeCodeTokenState,
  ): Effect.Effect<CoordinatedAcquisitionAttempt<RenewedToken>> =>
    dependencies.runClaudeCode.pipe(
      Effect.zipRight(dependencies.readTokenState),
      Effect.map(
        (after): CoordinatedAcquisitionAttempt<RenewedToken> =>
          after !== undefined && after.expiresAtMs > before.expiresAtMs
            ? { kind: "success", value: { expiresAtMs: after.expiresAtMs } }
            : before.expiresAtMs > now()
              ? {
                  kind: "temporary",
                  retryAtMs: before.expiresAtMs,
                  diagnostic: "Claude Code did not renew a token near expiry",
                }
              : {
                  kind: "terminal",
                  diagnostic: "Claude Code did not renew an expired token",
                },
      ),
      Effect.catchTag("ClaudeCodeRunFailed", (error) =>
        Effect.succeed({
          kind: "terminal" as const,
          diagnostic: error.diagnostic,
        }),
      ),
    );

  return Effect.gen(function* () {
    const state = yield* dependencies.readTokenState;
    if (state === undefined) return "unavailable";
    if (state.expiresAtMs - now() > RENEW_WITHIN_MS) return "not-due";
    const outcome = yield* dependencies.acquisitionCoordinator
      .coordinate<RenewedToken>({
        provider: "claude-code-token-renewal",
        credential: state.renewalCredential,
        ...(state.accountId === undefined ? {} : { account: state.accountId }),
        decode: decodeRenewedToken,
        reusableUntilMs: (token) => token.expiresAtMs - RENEW_WITHIN_MS,
        acquire: renew(state),
      })
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return outcome?.kind === "success" &&
      outcome.value.expiresAtMs > state.expiresAtMs
      ? "renewed"
      : "deferred";
  });
}

function runFailureDiagnostic(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "Claude Code failed to run";
  }
  const code = Reflect.get(error, "code");
  const signal = Reflect.get(error, "signal");
  if (code === "ENOENT") return "Claude Code executable not found";
  if (Reflect.get(error, "killed") === true) return "Claude Code timed out";
  if (typeof code === "number") return `Claude Code exited with code ${code}`;
  if (typeof signal === "string") return `Claude Code stopped by ${signal}`;
  return typeof code === "string"
    ? `Claude Code failed to run: ${code}`
    : "Claude Code failed to run";
}

/** Runs one minimal Claude Code prompt against its stored login. */
export function makeRunClaudeCode(
  options: {
    readonly command?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  } = {},
): Effect.Effect<void, ClaudeCodeRunFailed> {
  return Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "pi-claude-renewal-"))),
    (cwd) =>
      Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            const env = { ...(options.env ?? process.env) };
            for (const name of INHERITED_CREDENTIAL_VARIABLES) delete env[name];
            const child = execFile(
              options.command ?? "claude",
              CLAUDE_CODE_ARGUMENTS,
              {
                cwd,
                env,
                timeout: options.timeoutMs ?? CLAUDE_CODE_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
              },
              (error) => (error === null ? resolve() : reject(error)),
            );
            child.stdin?.end();
          }),
        catch: (error) =>
          new ClaudeCodeRunFailed({ diagnostic: runFailureDiagnostic(error) }),
      }),
    (cwd) =>
      Effect.promise(() =>
        rm(cwd, { recursive: true, force: true }).catch(() => undefined),
      ),
  );
}
