# Changelog

All notable changes to this project are documented here. Releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

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
