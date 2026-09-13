# Contributing

We welcome focused bug fixes, compatibility updates, tests, and documentation improvements.

## Before opening an issue

Search existing issues first. Use the security reporting process in [SECURITY.md](SECURITY.md) for vulnerabilities or possible credential exposure. Never post access tokens, credential files, raw authenticated responses, or unsanitized headers.

## Development setup

Install the supported Node.js version and dependencies:

```bash
npm ci
```

Run the complete local check before submitting a change:

```bash
npm run check
```

This runs formatting and lint checks, TypeScript validation, the test suite, and a package dry run.

## Pull requests

Keep each pull request focused on one behavior or maintenance concern. Include:

- The problem and intended behavior
- Tests for behavior changes
- Any provider response examples in sanitized form
- Compatibility or security implications

Do not weaken credential validation, redirect restrictions, response-size limits, or filesystem permission checks to work around an integration problem. Open an issue first when a provider contract appears to have changed.

Maintainers may decline changes that broaden the extension beyond direct Codex and Claude subscription usage or create an ongoing support burden the project cannot sustain.
