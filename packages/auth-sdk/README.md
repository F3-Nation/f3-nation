# @f3-nation/auth-sdk

A TypeScript SDK abstraction for integrating F3 Nation Auth Provider with your client.

## Usage

```ts
import { AuthClient } from "@f3-nation/auth-sdk";

const auth = new AuthClient("https://your-auth-provider-url");

// Login with email/password
auth
  .loginWithEmail("user@example.com", "password")
  .then((tokens) => {
    // Use tokens.accessToken, tokens.refreshToken, etc.
  })
  .catch((err) => {
    // Handle error
  });

// Get user info
auth.getUser("access-token-here").then((user) => {
  // Use user object
});
```

## Types

See `src/types.ts` for exported interfaces: `AuthUser`, `AuthTokens`.

## Development

- `npm run build` — Build the SDK
- `npm run test` — Run tests
