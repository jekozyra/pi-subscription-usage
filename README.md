# pi-subscription-usage

[![CI](https://github.com/jekozyra/pi-subscription-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/jekozyra/pi-subscription-usage/actions/workflows/ci.yml)

A Pi extension that replaces estimated API cost with live Codex and Claude subscription usage in the TUI footer.

```text
~/projects/yolo-faktory                 (openai-codex) gpt-5.6-sol • medium
Claude  session 42% · resets 1h23m      week 68% · resets 3d4h
Codex   week 31% · resets 5d2h          limit resets available: 2
```

## Overview

`pi-subscription-usage` monitors Codex and Claude independently. It reads provider-reported subscription usage, reset times, and Codex limit-reset credits. It does not estimate quota from tokens or API cost.

The extension uses undocumented first-party interfaces. Provider changes can make a source temporarily unavailable. See [Support](SUPPORT.md) for the compatibility policy.

## Install

Pi requires Node.js 22.19 or newer for this package.

Install a tagged release from GitHub:

```bash
pi install git:github.com/jekozyra/pi-subscription-usage@v0.1.0
```

Review the source before installing it. Pi extensions run with full system access.

To use a local checkout instead, run:

```bash
pi install /absolute/path/to/pi-subscription-usage
```

For one development session without installing the package, run:

```bash
pi -e .
```

## Usage

Start Pi in TUI mode after installation. The extension replaces the default footer with the current directory, context usage, and model selection, followed by Claude and Codex subscription usage. Context usage uses the same format and colors as Pi's footer, such as `38.0%/200k`: yellow above 70% and red above 90%. It shows `?` right after compaction, until the next response. On narrow terminals, the directory is shortened first, then context usage is hidden.

Sign in to Pi's `openai-codex` provider with `/login`. Sign in to Claude Code with a Claude Pro or Max subscription. Both providers remain visible when another model is selected.

The displayed values have provider-specific meanings:

- Codex weekly usage is the consumed percentage of the account's weighted weekly allowance.
- Claude session and weekly usage are the consumed percentages of the five-hour and seven-day subscription windows.
- Codex limit-reset credits appear when the provider supplies them, including when the count is zero.
- Anthropic API-key and OpenRouter limits are different products and are not displayed.

Countdowns use absolute provider reset timestamps. They update at each visible boundary without making additional provider requests, so Pi sessions with the same timestamp stay synchronized.

### Authentication

Claude usage reads the OAuth login from `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json`, matching `pi-claude-code-provider`. On POSIX systems, the credential file must be owned by the current user, use mode `0600`, and live in a current-user-owned directory that is not writable by group or other users. The extension rejects symlinks and expired access tokens.

To keep usage across OAuth token refreshes, the extension also reads the signed-in account from Claude Code's `${CLAUDE_CONFIG_DIR:-~}/.claude.json`. That file must be owned by the current user and not writable by group or other users. When the account can't be read, usage is tied to the access token instead, and a refresh briefly shows `unavailable`.

Claude Code renews its access token only while it runs, so a token can expire whenever you haven't used Claude Code for a few hours. To keep usage visible, the extension checks the token every five minutes and, when it's expired or within five minutes of expiring, runs `claude -p hi --model haiku --no-session-persistence` once from a temporary directory. That uses a small amount of Claude usage, about three times a day. Only one Pi process runs it at a time, inherited `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` values are removed so Claude Code renews its stored login, and failures back off for fifteen minutes. It runs only when Claude usage is read from Claude Code's login and `claude` is on `PATH`. Set `PI_SUBSCRIPTION_USAGE_RENEW_CLAUDE_CODE=0` to turn it off.

The token is sent only to Anthropic's fixed HTTPS usage endpoint. Credentials, account identifiers, and raw provider responses are never logged or persisted.

### Refresh behavior

Each provider refreshes at startup and after relevant activity. Codex polls every minute and also observes `x-codex-*` response headers. Claude limits activity refreshes to once every three minutes and polls every fifteen minutes.

Temporary failures use provider retry deadlines or bounded backoff. A Claude response that doesn't match the expected shape, or a rate-limit response, pauses Claude requests for fifteen minutes. A failed Claude refresh retains the last successful observation as stale until its reported reset time when doing so is safe.

### Platform limits

Cross-process Claude acquisition currently requires Linux and a private, user-owned runtime directory. When `XDG_RUNTIME_DIR` is unset, the extension tries `/run/user/<uid>`; whichever directory is used must exist and have private permissions (normally mode `0700`). If neither is available, Claude displays `unavailable` and the TUI warns once per Pi process. macOS and Windows coordination are not supported yet.

The Codex ChatGPT endpoint, Claude OAuth usage endpoint, and `x-codex-*` headers are undocumented. None has a public compatibility guarantee.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.ts` | Pi package entry point and footer installation |
| `src/register.ts` | Pi event adapter |
| `src/*provider-monitor.ts` | Provider-specific monitoring policies |
| `src/provider-monitor.ts` | Shared scheduling, retry, and lifecycle logic |
| `src/*acquisition.ts` | Authenticated provider requests and defensive decoding |
| `src/presentation.ts` | Footer text, countdowns, and colors |
| `test/` | Unit, lifecycle, and cross-process tests |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report security issues through the process in [SECURITY.md](SECURITY.md), not through a public issue.

## Related docs

- [Support and compatibility](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)
- [Changelog](CHANGELOG.md)

## Maintainers

This project is maintained by [@jekozyra](https://github.com/jekozyra). Support is best-effort because the monitored provider interfaces are undocumented.

## License

[MIT](LICENSE)
