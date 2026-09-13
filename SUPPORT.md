# Support

## Support status

`pi-subscription-usage` is beta software. Support is best-effort because Codex and Claude usage data comes from undocumented first-party interfaces that can change without notice.

## Supported environment

| Component | Supported |
| --- | --- |
| Operating system | Linux |
| Node.js | 22.19 or newer |
| Pi | 0.85.x is tested; newer versions are accepted when CI and manual verification pass |
| Codex authentication | Pi `openai-codex` OAuth login |
| Claude authentication | Claude Code Pro or Max OAuth login |

macOS and Windows are not currently supported because secure cross-process Claude coordination depends on a private Linux `XDG_RUNTIME_DIR`.

## Getting help

Open a GitHub issue using the bug report form. Include:

- Package version or Git commit
- Pi and Node.js versions
- Operating system
- Affected provider
- Expected and actual behavior
- Minimal reproduction steps

Never include credentials, account identifiers, raw authenticated responses, or unsanitized headers.

## Maintenance policy

Only the latest release line receives fixes. We prioritize credential safety, provider compatibility regressions, crashes, incorrect usage values, and runaway polling. Feature requests are considered against maintenance cost and the extension's narrow scope.

There is no uptime or response-time guarantee. If an upstream provider contract changes, the extension may display `unavailable` until a safe compatibility update is released.
