# Changelog

All notable changes to this project are documented here. Releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Renewed an expiring Claude Code login by running Claude Code once, so Claude usage no longer disappears after a few hours without Claude Code activity. Set `PI_SUBSCRIPTION_USAGE_RENEW_CLAUDE_CODE=0` to opt out.

### Fixed

- Accepted Claude's idle five-hour window, which reports no reset time, instead of marking all Claude usage unavailable
- Treated a missing Claude utilization value as unknown rather than zero
- Paused Claude requests for fifteen minutes after a response that doesn't match the expected shape, instead of retrying every minute and tripping the provider rate limit
- Kept Claude usage and shared backoff across OAuth token refreshes when Claude Code records the signed-in account

### Added

- Recorded the last Claude failure reason in the shared state file for troubleshooting

## [0.1.1] - 2026-10-22

### Fixed

- Restored Claude usage when `XDG_RUNTIME_DIR` is unset but a private `/run/user/<uid>` exists
- Prevented fractional retry deadlines from invalidating shared backoff and amplifying Claude requests across Pi processes
- Preserved valid Claude weekly usage when an optional five-hour window has already expired
- Preserved status output from other extensions when the custom subscription footer is active
- Rendered each extension status on its own footer line

## [0.1.0] - 2026-09-13

### Added

- Live Codex weekly subscription usage and available limit-reset credits
- Live Claude five-hour session and seven-day subscription usage
- Independent provider polling, activity refreshes, retry backoff, and stale-data handling
- Secure cross-process Claude acquisition coordination on Linux
- Provider-reported reset countdowns synchronized across Pi sessions
- A subscription-focused three-line Pi footer
