import { Context, Effect, Exit, Fiber, Layer, Scope } from "effect";

import {
  type ClaudeProviderMonitorDependencies,
  ClaudeProviderMonitorService,
  claudeProviderMonitorLayer,
} from "./claude-provider-monitor.ts";
import {
  type CodexProviderMonitorDependencies,
  codexProviderMonitorLayer,
} from "./codex-provider-monitor.ts";
import type {
  MonitoredProviderName,
  WeeklySubscriptionUsageStatus,
} from "./presentation.ts";
import {
  type ProviderMonitor,
  ProviderMonitorService,
} from "./provider-monitor.ts";

export interface WeeklySubscriptionUsageSessionDependencies {
  readonly codex: Omit<CodexProviderMonitorDependencies, "publish">;
  readonly makeClaudeDependencies: () => Omit<
    ClaudeProviderMonitorDependencies,
    "publish"
  >;
  readonly now: Effect.Effect<number>;
  readonly present: (
    statuses: Readonly<
      Record<MonitoredProviderName, WeeklySubscriptionUsageStatus>
    >,
    nowMs: number,
  ) => Effect.Effect<void>;
}

export interface WeeklySubscriptionUsageSession {
  readonly start: (
    dependencies: WeeklySubscriptionUsageSessionDependencies,
  ) => Effect.Effect<void>;
  readonly observeCodexResponse: (
    responseHeaders: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void>;
  readonly refreshAfterActivity: (
    providerName: MonitoredProviderName,
  ) => Effect.Effect<void>;
  readonly refreshForAccountChange: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MINUTES = 24 * 60;

function nextCountdownPresentationDelay(
  statuses: Readonly<
    Record<MonitoredProviderName, WeeklySubscriptionUsageStatus>
  >,
  nowMs: number,
): number | undefined {
  let nextDelay: number | undefined;
  for (const status of Object.values(statuses)) {
    if (status.kind !== "available") continue;
    for (const resetAtMs of [
      status.sessionWindowResetsAtMs,
      status.weeklyWindowResetsAtMs,
    ]) {
      if (resetAtMs === undefined || !Number.isFinite(resetAtMs)) continue;
      const remainingMs = resetAtMs - nowMs;
      if (remainingMs <= 0) continue;
      const totalMinutes = Math.floor(remainingMs / MINUTE_MS);
      const delay =
        totalMinutes <= 1
          ? remainingMs
          : (remainingMs %
              (totalMinutes >= DAY_MINUTES ? HOUR_MS : MINUTE_MS)) +
            1;
      nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
    }
  }
  return nextDelay;
}

interface Session {
  readonly id: number;
  readonly scope: Scope.CloseableScope;
  readonly codexMonitor: ProviderMonitor;
  readonly claudeMonitor: ProviderMonitor;
}

/** Owns replacement, scoped monitor lifetime, and suppression of late work. */
export function makeWeeklySubscriptionUsageSession(): Effect.Effect<WeeklySubscriptionUsageSession> {
  return Effect.gen(function* () {
    const transitionGate = yield* Effect.makeSemaphore(1);
    let session: Session | undefined;
    let nextSessionId = 0;

    const closeSession = (candidate: Session | undefined) =>
      Effect.gen(function* () {
        if (candidate === undefined) return;
        if (session === candidate) session = undefined;
        yield* Scope.close(candidate.scope, Exit.void);
      });

    const runInSessionScope = (
      candidate: Session,
      effect: Effect.Effect<void>,
    ) =>
      Effect.suspend(() => {
        if (session !== candidate) return Effect.void;
        return Effect.forkIn(
          effect.pipe(Effect.catchAllCause(() => Effect.void)),
          candidate.scope,
        ).pipe(Effect.flatMap(Fiber.await), Effect.asVoid);
      });

    const start = (dependencies: WeeklySubscriptionUsageSessionDependencies) =>
      Effect.gen(function* () {
        const id = yield* Effect.sync(() => ++nextSessionId);
        const candidate = yield* transitionGate.withPermits(1)(
          Effect.gen(function* () {
            yield* closeSession(session);
            if (id !== nextSessionId) return undefined;

            const scope = yield* Scope.make();
            let installed = false;
            return yield* Effect.gen(function* () {
              if (id !== nextSessionId) return undefined;
              const statuses: Record<
                MonitoredProviderName,
                WeeklySubscriptionUsageStatus
              > = {
                Codex: { kind: "loading" },
                Claude: { kind: "loading" },
              };
              const presentCurrent = Effect.gen(function* () {
                if (session?.id !== id) return;
                const now = yield* dependencies.now;
                if (session?.id !== id) return;
                yield* dependencies.present(statuses, now);
              });
              const countdownGate = yield* Effect.makeSemaphore(1);
              let countdownFiber: Fiber.RuntimeFiber<void> | undefined;
              const countdownLoop = Effect.forever(
                Effect.gen(function* () {
                  if (session?.id !== id) return yield* Effect.interrupt;
                  const now = yield* dependencies.now;
                  const delay = nextCountdownPresentationDelay(statuses, now);
                  if (delay === undefined) return yield* Effect.never;
                  yield* Effect.sleep(delay);
                  yield* presentCurrent;
                }),
              );
              const restartCountdown = countdownGate.withPermits(1)(
                Effect.gen(function* () {
                  const previous = countdownFiber;
                  countdownFiber = undefined;
                  if (previous !== undefined) yield* Fiber.interrupt(previous);
                  if (session?.id !== id) return;
                  countdownFiber = yield* Effect.forkIn(countdownLoop, scope);
                }),
              );
              const publish =
                (providerName: MonitoredProviderName) =>
                (status: WeeklySubscriptionUsageStatus) =>
                  Effect.gen(function* () {
                    if (session?.id !== id) return;
                    statuses[providerName] = status;
                    yield* presentCurrent;
                    yield* restartCountdown;
                  });
              const monitorLayers = Layer.merge(
                codexProviderMonitorLayer({
                  ...dependencies.codex,
                  publish: publish("Codex"),
                }),
                claudeProviderMonitorLayer({
                  ...dependencies.makeClaudeDependencies(),
                  publish: publish("Claude"),
                }),
              );
              const services = yield* Layer.buildWithScope(
                monitorLayers,
                scope,
              );
              if (id !== nextSessionId) return undefined;
              const created = {
                id,
                scope,
                codexMonitor: Context.get(services, ProviderMonitorService),
                claudeMonitor: Context.get(
                  services,
                  ClaudeProviderMonitorService,
                ),
              };
              session = created;
              installed = true;
              return created;
            }).pipe(
              Effect.ensuring(
                Effect.suspend(() =>
                  installed ? Effect.void : Scope.close(scope, Exit.void),
                ),
              ),
            );
          }),
        );
        if (candidate === undefined) return;
        yield* runInSessionScope(
          candidate,
          Effect.all(
            [candidate.codexMonitor.start, candidate.claudeMonitor.start].map(
              (start) => start.pipe(Effect.catchAllCause(() => Effect.void)),
            ),
            { concurrency: "unbounded" },
          ).pipe(Effect.asVoid),
        );
      });

    const withCurrentSession = (
      operation: (candidate: Session) => Effect.Effect<void>,
    ) =>
      Effect.suspend(() => {
        const candidate = session;
        return candidate === undefined
          ? Effect.void
          : runInSessionScope(candidate, operation(candidate));
      });

    return {
      start,
      observeCodexResponse: (responseHeaders) =>
        withCurrentSession((candidate) =>
          candidate.codexMonitor.observeResponse(responseHeaders),
        ),
      refreshAfterActivity: (providerName) =>
        withCurrentSession((candidate) =>
          providerName === "Codex"
            ? candidate.codexMonitor.refreshAfterActivity
            : candidate.claudeMonitor.refreshAfterActivity,
        ),
      refreshForAccountChange: withCurrentSession((candidate) =>
        Effect.all(
          [
            candidate.codexMonitor.refreshForAccountChange,
            candidate.claudeMonitor.refreshForAccountChange,
          ].map((refresh) =>
            refresh.pipe(Effect.catchAllCause(() => Effect.void)),
          ),
          { concurrency: "unbounded" },
        ).pipe(Effect.asVoid),
      ),
      shutdown: Effect.gen(function* () {
        yield* Effect.sync(() => {
          nextSessionId += 1;
        });
        yield* transitionGate.withPermits(1)(closeSession(session));
      }),
    } satisfies WeeklySubscriptionUsageSession;
  });
}
