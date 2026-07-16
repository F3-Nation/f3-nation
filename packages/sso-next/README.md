# @f3nation/sso-next

Next.js adapter for F3 SSO.

This package keeps framework-specific route helpers separate from the core
`@f3nation/sso` client so non-Next consumers can depend only on the core SDK.

## Installation

```bash
pnpm add @f3nation/sso-next --filter your-app
```

## Includes

- `createSsoAdapter`
- `buildSsoCookieOptions`
- `handleLoginRoute`
- `handleCallbackRoute`
- `handleLogoutRoute`

## Peer Dependencies

- `next >= 15`
