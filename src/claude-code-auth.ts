import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ClaudeAuthentication } from "./claude-subscription-usage-acquisition.ts";

const MAX_CREDENTIAL_BYTES = 1024 * 1024;
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

async function readBoundedCredentialFile(
  path: string,
): Promise<string | undefined> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || !isOwnedByCurrentUser(metadata.uid))
      return undefined;
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      return undefined;
    }

    const buffer = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    return bytesRead > MAX_CREDENTIAL_BYTES
      ? undefined
      : buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readClaudeCodeAuthentication(): Promise<
  ClaudeAuthentication | undefined
> {
  const configuredDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const configDirectory = configuredDirectory || join(homedir(), ".claude");
  const credentialsPath = join(configDirectory, ".credentials.json");

  try {
    const directoryMetadata = await lstat(configDirectory);
    if (
      !directoryMetadata.isDirectory() ||
      directoryMetadata.isSymbolicLink() ||
      !isOwnedByCurrentUser(directoryMetadata.uid) ||
      (process.platform !== "win32" && (directoryMetadata.mode & 0o022) !== 0)
    ) {
      return undefined;
    }

    const text = await readBoundedCredentialFile(credentialsPath);
    if (text === undefined) return undefined;
    const document: unknown = JSON.parse(text);
    if (typeof document !== "object" || document === null) return undefined;
    const oauth = Reflect.get(document, "claudeAiOauth");
    if (typeof oauth !== "object" || oauth === null) return undefined;
    const accessToken = Reflect.get(oauth, "accessToken");
    const expiresAt = Reflect.get(oauth, "expiresAt");
    if (
      typeof accessToken !== "string" ||
      accessToken.trim() === "" ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() + TOKEN_EXPIRY_MARGIN_MS
    ) {
      return undefined;
    }

    return { source: "OAuth", auth: { apiKey: accessToken.trim() } };
  } catch {
    return undefined;
  }
}

function isOAuthAuthentication(
  authentication: ClaudeAuthentication | undefined,
): authentication is ClaudeAuthentication {
  return (
    authentication?.source === "OAuth" &&
    typeof authentication.auth.apiKey === "string" &&
    authentication.auth.apiKey.trim() !== ""
  );
}

export async function resolveClaudeSubscriptionAuthentication(
  ctx: ExtensionContext,
): Promise<ClaudeAuthentication | undefined> {
  const hasClaudeCodeProvider =
    ctx.modelRegistry.find?.("pi-claude-code-provider", "sonnet") !== undefined;
  if (hasClaudeCodeProvider) {
    const claudeCodeAuthentication = await readClaudeCodeAuthentication();
    if (claudeCodeAuthentication !== undefined) return claudeCodeAuthentication;
  }

  try {
    const authentication = await ctx.modelRegistry.getProviderAuth("anthropic");
    if (isOAuthAuthentication(authentication)) return authentication;
  } catch {
    // Fall through to Claude Code credentials.
  }

  return hasClaudeCodeProvider ? undefined : readClaudeCodeAuthentication();
}
