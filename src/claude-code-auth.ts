import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ClaudeAuthentication } from "./claude-subscription-usage-acquisition.ts";

const MAX_CREDENTIAL_BYTES = 1024 * 1024;
const MAX_GLOBAL_CONFIG_BYTES = 16 * 1024 * 1024;
const TOKEN_EXPIRY_MARGIN_MS = 30_000;
const MAX_REMEMBERED_ACCOUNTS = 8;

// Token digest -> account. Claude Code rewrites .claude.json often; once a
// token is attributed, a later unreadable read must not change its identity.
const accountsByToken = new Map<string, string>();

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

async function isTrustedDirectory(path: string): Promise<boolean> {
  const metadata = await lstat(path);
  return (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    isOwnedByCurrentUser(metadata.uid) &&
    (process.platform === "win32" || (metadata.mode & 0o022) === 0)
  );
}

async function readBoundedOwnedFile(
  path: string,
  maximumBytes: number,
  forbiddenModeBits: number,
): Promise<string | undefined> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || !isOwnedByCurrentUser(metadata.uid))
      return undefined;
    if (
      process.platform !== "win32" &&
      (metadata.mode & forbiddenModeBits) !== 0
    ) {
      return undefined;
    }

    const buffer = Buffer.alloc(maximumBytes + 1);
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
    return bytesRead > maximumBytes
      ? undefined
      : buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Reads the signed-in account Claude Code records beside its OAuth token. */
async function readClaudeCodeAccount(
  globalConfigDirectory: string,
): Promise<string | undefined> {
  try {
    if (!(await isTrustedDirectory(globalConfigDirectory))) return undefined;
    const text = await readBoundedOwnedFile(
      join(globalConfigDirectory, ".claude.json"),
      MAX_GLOBAL_CONFIG_BYTES,
      0o022,
    );
    if (text === undefined) return undefined;
    const document: unknown = JSON.parse(text);
    if (typeof document !== "object" || document === null) return undefined;
    const account = Reflect.get(document, "oauthAccount");
    if (typeof account !== "object" || account === null) return undefined;
    const accountUuid = Reflect.get(account, "accountUuid");
    const organizationUuid = Reflect.get(account, "organizationUuid");
    if (typeof accountUuid !== "string" || accountUuid.trim() === "")
      return undefined;
    // Usage limits belong to the account within one organization.
    return `${accountUuid.trim()}/${
      typeof organizationUuid === "string" ? organizationUuid.trim() : ""
    }`;
  } catch {
    return undefined;
  }
}

async function accountForToken(
  token: string,
  globalConfigDirectory: string,
): Promise<string | undefined> {
  const digest = createHash("sha256").update(token).digest("hex");
  const remembered = accountsByToken.get(digest);
  if (remembered !== undefined) return remembered;
  const account = await readClaudeCodeAccount(globalConfigDirectory);
  if (account === undefined) return undefined;
  if (accountsByToken.size >= MAX_REMEMBERED_ACCOUNTS) {
    const oldest = accountsByToken.keys().next().value;
    if (oldest !== undefined) accountsByToken.delete(oldest);
  }
  accountsByToken.set(digest, account);
  return account;
}

async function readClaudeCodeAuthentication(): Promise<
  ClaudeAuthentication | undefined
> {
  const configuredDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const configDirectory = configuredDirectory || join(homedir(), ".claude");
  const credentialsPath = join(configDirectory, ".credentials.json");

  try {
    if (!(await isTrustedDirectory(configDirectory))) return undefined;

    const text = await readBoundedOwnedFile(
      credentialsPath,
      MAX_CREDENTIAL_BYTES,
      0o077,
    );
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

    const token = accessToken.trim();
    const accountId = await accountForToken(
      token,
      configuredDirectory || homedir(),
    );
    return {
      source: "OAuth",
      auth: { apiKey: token },
      ...(accountId === undefined ? {} : { accountId }),
    };
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
