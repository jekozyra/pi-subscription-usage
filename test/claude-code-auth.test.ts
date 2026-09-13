import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resolveClaudeSubscriptionAuthentication } from "../src/claude-code-auth.ts";

const originalConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalConfigDirectory === undefined)
    delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDirectory;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function contextWithAuthentication(
  authentication: unknown = undefined,
  hasClaudeCodeProvider = true,
): ExtensionContext {
  return {
    modelRegistry: {
      find: () => (hasClaudeCodeProvider ? {} : undefined),
      getProviderAuth: async () => authentication,
    },
  } as unknown as ExtensionContext;
}

async function makeConfigDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-usage-claude-auth-"));
  temporaryDirectories.push(directory);
  process.env.CLAUDE_CONFIG_DIR = directory;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function writeClaudeCredentials(
  options: { mode?: number; expiresAt?: number } = {},
): Promise<string> {
  const directory = await makeConfigDirectory();
  const credentialsPath = join(directory, ".credentials.json");
  await writeFile(
    credentialsPath,
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "claude-code-token",
        expiresAt: options.expiresAt ?? Date.now() + 60_000,
      },
    }),
    { mode: options.mode ?? 0o600 },
  );
  return credentialsPath;
}

describe("resolveClaudeSubscriptionAuthentication", () => {
  it("prefers Claude Code OAuth when its provider is installed", async () => {
    await writeClaudeCredentials();

    expect(
      await resolveClaudeSubscriptionAuthentication(
        contextWithAuthentication({
          source: "OAuth",
          auth: { apiKey: "pi-token" },
        }),
      ),
    ).toEqual({
      source: "OAuth",
      auth: { apiKey: "claude-code-token" },
    });
  });

  it("falls back to Pi OAuth when Claude Code OAuth is expired", async () => {
    await writeClaudeCredentials({ expiresAt: Date.now() - 1 });

    expect(
      await resolveClaudeSubscriptionAuthentication(
        contextWithAuthentication({
          source: "OAuth",
          auth: { apiKey: "pi-token" },
        }),
      ),
    ).toEqual({ source: "OAuth", auth: { apiKey: "pi-token" } });
  });

  it("rejects an expired token when no Pi OAuth fallback exists", async () => {
    await writeClaudeCredentials({ expiresAt: Date.now() - 1 });

    expect(
      await resolveClaudeSubscriptionAuthentication(
        contextWithAuthentication(),
      ),
    ).toBeUndefined();
  });

  it.runIf(process.platform !== "win32")(
    "rejects a credential file readable by other users",
    async () => {
      await writeClaudeCredentials({ mode: 0o644 });

      expect(
        await resolveClaudeSubscriptionAuthentication(
          contextWithAuthentication(),
        ),
      ).toBeUndefined();
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects a symlinked credential file",
    async () => {
      const target = await writeClaudeCredentials();
      const directory = process.env.CLAUDE_CONFIG_DIR;
      expect(directory).toBeDefined();
      if (directory === undefined) return;
      await rm(target);
      const outside = join(directory, "outside.json");
      await writeFile(
        outside,
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "symlink-token",
            expiresAt: Date.now() + 60_000,
          },
        }),
        { mode: 0o600 },
      );
      await symlink(outside, target);

      expect(
        await resolveClaudeSubscriptionAuthentication(
          contextWithAuthentication(),
        ),
      ).toBeUndefined();
    },
  );
});
