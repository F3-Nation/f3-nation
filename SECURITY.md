# Security Policy

## Supported Versions

Security support applies only to the latest released version of each app and shared package in this repository (as built and deployed from `main`).

## Reporting a Vulnerability

**All vulnerability reports MUST be submitted through GitHub's private vulnerability reporting process.** This allows the maintainers to assess the report, collaborate on remediation, and coordinate disclosure in a responsible manner.

Please do not include secrets, tokens, or personal data unless they are essential to demonstrate the vulnerability.

## Threat Model

This repository is a public monorepo that includes authentication, admin, member-facing, and API code, plus shared packages and deployment automation. Security issues in scope generally include anything that could let an attacker:

- Bypass authentication or authorization
- Access or modify another user's data
- Leak tokens, credentials, or personal data
- Forge or tamper with session, OAuth, CSRF, or webhook flows
- Execute injected code, scripts, or commands
- Abuse file uploads, external fetches, or other trust boundaries

The most common in-scope classes for this repo are:

- IDORs and privilege escalation in app or API routes
- OAuth, session, cookie, or CSRF validation bugs
- PII exposure in responses, logs, analytics, or fixtures
- Secret handling mistakes in runtime config, build output, or deployment scripts
- XSS, SSRF, and injection issues in user-controlled input paths
- Multi-instance race conditions that undermine security decisions

## Security Expectations

The repository is designed around a few baseline protections:

- Authentication is handled with explicit server-side validation; access should never rely on client-visible state alone.
- Sensitive cookies and tokens should remain `httpOnly` and server-controlled.
- User input should be validated at the boundary before it reaches internal logic.
- Logs, fixtures, and test data should not contain real secrets or real personal data.
- Anything exposed to the browser should be treated as public.
- Sensitive cookies should use `HttpOnly`, `Secure`, and an appropriate `SameSite` value. Tokens should remain server-controlled and should not be stored in browser-readable storage unless required by the flow.
Reports that show a break in one of those protections are especially helpful, even if the impact is not fully proven yet.

## Response Expectations

Severity, scope, and disclosure timing are handled case by case. If you are unsure whether something is security-sensitive, report it anyway.

## Out of Scope

Questions about feature behavior, missing documentation, or general support should use the normal issue tracker.

The following are usually out of scope unless they create a concrete security impact in this repo:

- Purely theoretical issues without a reachable attack path
- Problems that require full device, browser, or runtime compromise first
- Third-party outages or bugs outside this repository's control
- Minor hardening suggestions that do not affect confidentiality, integrity, or availability
