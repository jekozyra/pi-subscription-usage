# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest `0.1.x` release | Yes |
| Older versions | No |

Until version 1.0, only the latest release receives security fixes.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private **Report a vulnerability** form on the repository Security tab.

Include the affected version, operating system, Pi version, impact, and minimal reproduction steps. Remove access tokens, credential contents, account identifiers, raw authenticated responses, and unsanitized headers.

We aim to acknowledge a report within seven days and provide an initial assessment within fourteen days. These are best-effort targets, not a service-level agreement.

Security-sensitive areas include credential handling, authenticated request destinations, redirect behavior, bounded response parsing, runtime-directory permissions, cross-process coordination, and accidental secret persistence or logging.
