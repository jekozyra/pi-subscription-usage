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

Start Pi in TUI mode after installation. The extension replaces the default footer with the current directory and model selection followed by Claude and Codex subscription usage.

Sign in to Pi's `openai-codex` provider with `/login`. Sign in to Claude Code with a Claude Pro or Max subscription. Both providers remain visible when another model is selected.

The displayed values have provider-specific meanings:

- Codex weekly usage is the consumed percentage of the account's weighted weekly allowance.
- Claude session and weekly usage are the consumed percentages of the five-hour and seven-day subscription windows.
- Codex limit-reset credits appear when the provider supplies them, including when the count is zero.
- Anthropic API-key and OpenRouter limits are different products and are not displayed.

Countdowns use absolute provider reset timestamps. They update at each visible boundary without making additional provider requests, so Pi sessions with the same timestamp stay synchronized.

### Authentication

Claude usage reads the OAuth login from `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json`, matching `pi-claude-code-provider`. On POSIX systems, the credential file must be owned by the current user, use mode `0600`, and live in a current-user-owned directory that is not writable by group or other users. The extension rejects symlinks and expired access tokens.

The token is sent only to Anthropic's fixed HTTPS usage endpoint. Credentials and raw provider responses are never logged or persisted.

### Refresh behavior

Each provider refreshes at startup and after relevant activity. Codex polls every minute and also observes `x-codex-*` response headers. Claude limits activity refreshes to once every three minutes and polls every fifteen minutes.

Temporary failures use provider retry deadlines or bounded backoff. A failed Claude refresh retains the last successful observation as stale until its reported reset time when doing so is safe.

### Platform limits

Cross-process Claude acquisition currently requires Linux and a private, user-owned `XDG_RUNTIME_DIR`, normally `/run/user/<uid>` with mode `0700`. Without it, Claude displays `unavailable` and the TUI warns once per Pi process. macOS and Windows coordination are not supported yet.

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
