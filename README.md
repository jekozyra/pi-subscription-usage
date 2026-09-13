# pi-subscription-usage

A [Pi](https://pi.dev) extension that replaces estimated API cost with live Codex and Claude subscription usage in a focused three-line footer.

```text
~/projects/yolo-faktory                 (openai-codex) gpt-5.6-sol • medium
Claude  session 42% · resets 1h23m      week 68% · resets 3d4h
Codex   week 31% · resets 5d2h          limit resets available: 2
```

## Install

Install this checkout as a global Pi package:

```bash
pi install ~/projects/pi-subscription-usage
```

For one-off local development:

```bash
pi -e .
```},{

## Authentication

Sign in to Pi's `openai-codex` provider with `/login`, and sign in to Claude Code with a Claude Pro or Max subscription. Codex and Claude are both monitored by default, even when another model is selected. Missing or unsuitable authentication leaves that provider visible as `unavailable` rather than removing it.

Claude subscription usage uses the OAuth login from `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json`, matching `pi-claude-code-provider`. The credential file must be owned by the current user, mode `0600` on POSIX, and stored in a current-user-owned configuration directory that is not writable by group or other users. Symlinks and expired access tokens are rejected. The token is sent only to Anthropic's fixed HTTPS usage endpoint and is never logged or persisted by this extension.

Cross-process Claude acquisition currently requires Linux and a private, user-owned `XDG_RUNTIME_DIR` (normally `/run/user/<uid>` with mode `0700`). Without that secure runtime location, Claude remains `unavailable` and the TUI warns once per Pi process. macOS and Windows coordination are not yet supported.

## Display

The extension replaces Pi's default footer with three subscription-focused lines. The first keeps the current directory on the left and Pi's `(provider) model • effort` selection on the right. The remaining lines show Claude's five-hour session and weekly usage windows, followed by Codex weekly usage and available limit-reset credits. Estimated API cost and local token estimates are omitted.

```text
~/projects/yolo-faktory                 (openai-codex) gpt-5.6-sol • medium
Claude  session 42% · resets 1h23m      week 68% · resets 3d4h
Codex   week 31% · resets 5d2h          limit resets available: 2
```

Each usage/reset segment is colored by consumption pace relative to elapsed window time: green through 10 percentage points ahead, yellow from more than 10 through 25 points ahead, and red above 25 points ahead. Usage at 90% or higher is always red. Codex limit-reset credits use the accent color.

| State | Status |
| --- | --- |
| Loading | `Codex wk loading… Claude wk loading…` |
| Available | `Codex wk ━━━━━━──── 63% 3d2h ↻2 Claude wk ━━━━━━━━── 80% 4d1h` |
| Temporarily stale | `Codex wk ━━━━━━──── 63% 3d2h ↻2 ~ Claude wk ━━━━━━━━── 80% 4d1h ~` |
| Unavailable | `Codex wk unavailable Claude wk unavailable` |

Each percentage is provider-reported **weekly subscription usage**. The two providers retain different meanings:

- **Codex weekly quota usage** is the consumed percentage of the account's weighted weekly allowance, not a token count divided by a fixed token limit.
- **Claude subscription usage** is the consumed percentage of the Claude Pro or Max seven-day window.
- **Anthropic API-key rate limits** are request and token capacity for API use. They are not Claude subscription usage and are not shown.
- **OpenRouter usage** concerns OpenRouter keys, spending, and limits. It is not direct Claude subscription usage and is not shown, including when a Claude model is routed through OpenRouter.

Each bar has ten cells. A provider's presentation independently becomes a warning at 75% and an error at 90%.

The weekly reset countdown after the percentage is the remaining time until the provider-reported weekly window reset. It uses compact day/hour, hour/minute, or minute units without spaces between units.

The `↻N` suffix is the provider-reported number of available **limit reset credits**. It is Codex-only and appears when Codex supplies the count, including when the count is zero.

## How it works

The extension runs independent Codex and Claude monitor lifecycles. Codex usage comes from the ChatGPT usage endpoint and opportunistic `x-codex-*` response headers. Claude usage comes from the experimental first-party OAuth usage endpoint using Claude Code's local OAuth login. Each monitor refreshes at startup and after relevant activity, including `pi-claude-code-provider` requests. Codex polls every minute. Claude limits activity refreshes to every three minutes, polls every fifteen minutes, and keeps a failed refresh's last successful observation marked stale until its reported reset time.

Claude acquisitions are coordinated across `/reload`, `/new`, and concurrent Pi processes. A successful observation is reused for three minutes. Temporary failures share their retry deadline; a `429` observes `Retry-After` with a fifteen-minute floor. This prevents each loaded extension instance from independently repeating the same request.

Internally, session-scoped Effect monitors independently own acquisition,
polling, backoff, stale expiration, and interruption. Provider-specific
decoding stays behind small Effect interfaces; Pi event handlers are the only
runtime boundary.

### Security posture

Authenticated requests are restricted to fixed HTTPS origins: `https://chatgpt.com` for Codex and `https://api.anthropic.com` for Claude. Redirects are rejected, requests time out, and response bodies are bounded before schema validation. Credentials and raw provider responses are neither logged nor persisted.

To coordinate Claude requests, sanitized usage percentages, reset timestamps, and retry scheduling metadata are stored only in the OS-managed user-runtime `XDG_RUNTIME_DIR`; they are never written to durable package or project storage. Entries are partitioned by an HMAC of the OAuth credential using an ephemeral runtime secret, so neither the credential nor its plain fingerprint is stored. Runtime entries untouched for twenty-four hours are removed best-effort.

The extension does not spawn provider CLIs or estimate quota from local token history. Claude Code itself refreshes expired OAuth credentials; until it does, the footer reports Claude usage as unavailable.

## Current scope

This release does not implement OpenRouter usage, provider settings, Claude's five-hour window, detail commands, or manual refresh. Refreshes use the built-in schedule.

## Compatibility warning

The Codex ChatGPT usage endpoint and the Claude OAuth usage endpoint are undocumented first-party interfaces. The `x-codex-*` headers are undocumented as well. None has a public compatibility guarantee, and any may change without notice. The extension isolates and parses them defensively and displays `unavailable` when a response no longer matches the expected contract.

See [`docs/research/codex-weekly-usage.md`](docs/research/codex-weekly-usage.md), [`docs/research/codex-limit-reset-credits.md`](docs/research/codex-limit-reset-credits.md), and [`docs/research/claude-oauth-usage-prototype.md`](docs/research/claude-oauth-usage-prototype.md) for sanitized source comparisons and rationale.

## Development

Requires Node.js 22.19 or newer.

```bash
npm install
npm run check
```

## Acknowledgments

Based on [`yasuhito/pi-usage`](https://github.com/yasuhito/pi-usage), with local Claude Code authentication, session-window reporting, and custom footer presentation added.

## License

MIT
