import { EventTypes } from "@acme/shared/app/enums";

// ---------------------------------------------------------------------------
// Org hierarchy
// ---------------------------------------------------------------------------

export const NATION = {
  name: "F3 Nation",
  orgType: "nation" as const,
  isActive: true,
  website: "https://f3nation.com",
  email: "info@f3nation.com",
  description: "The F3 Nation — Fitness, Fellowship, Faith",
};

export const SECTORS = [
  {
    name: "F3 Southeast",
    orgType: "sector" as const,
    isActive: true,
    description: "Southeast Sector",
  },
];

export const AREAS = [
  {
    name: "F3 Western NC",
    orgType: "area" as const,
    isActive: true,
    sectorName: "F3 Southeast",
    description: "Western North Carolina Area",
  },
  {
    name: "F3 Metrolina",
    orgType: "area" as const,
    isActive: true,
    sectorName: "F3 Southeast",
    description: "Charlotte Metro Area",
  },
];

// Regions must include "Boone" — the existing seed.ts insertUsers() expects it.
export const REGIONS = [
  {
    name: "Boone",
    orgType: "region" as const,
    isActive: true,
    areaName: "F3 Western NC",
    email: "f3boone@f3nation.com",
    website: "https://f3boone.com",
    description: "F3 Boone — High Country NC",
  },
  {
    name: "F3 Charlotte",
    orgType: "region" as const,
    isActive: true,
    areaName: "F3 Metrolina",
    email: "f3charlotte@f3nation.com",
    website: "https://f3charlotte.com",
    description: "F3 Charlotte — Queen City",
  },
];

// AOs with lat/long so they show on the map
export const AOS = [
  // Boone AOs (around 36.21, -81.67)
  {
    name: "The Dark Tower",
    orgType: "ao" as const,
    isActive: true,
    regionName: "Boone",
    description: "Boone's flagship AO",
    latitude: 36.2168,
    longitude: -81.6746,
    addressCity: "Boone",
    addressState: "NC",
  },
  {
    name: "The Viaduct",
    orgType: "ao" as const,
    isActive: true,
    regionName: "Boone",
    description: "Trail-focused AO",
    latitude: 36.2098,
    longitude: -81.6801,
    addressCity: "Boone",
    addressState: "NC",
  },
  // Charlotte AOs (around 35.22, -80.84)
  {
    name: "The Colosseum",
    orgType: "ao" as const,
    isActive: true,
    regionName: "F3 Charlotte",
    description: "Uptown Charlotte AO",
    latitude: 35.2271,
    longitude: -80.8431,
    addressCity: "Charlotte",
    addressState: "NC",
  },
  {
    name: "South End Station",
    orgType: "ao" as const,
    isActive: true,
    regionName: "F3 Charlotte",
    description: "South End AO",
    latitude: 35.2135,
    longitude: -80.8523,
    addressCity: "Charlotte",
    addressState: "NC",
  },
  {
    name: "The Foundry",
    orgType: "ao" as const,
    isActive: true,
    regionName: "F3 Charlotte",
    description: "Steele Creek AO",
    latitude: 35.1852,
    longitude: -80.9301,
    addressCity: "Charlotte",
    addressState: "NC",
  },
];

// ---------------------------------------------------------------------------
// Event types (standard F3 workout types)
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  { name: EventTypes.Bootcamp, eventCategory: "first_f" as const },
  { name: EventTypes.Run, eventCategory: "first_f" as const },
  { name: EventTypes.Ruck, eventCategory: "first_f" as const },
  { name: EventTypes.QSource, eventCategory: "third_f" as const },
  { name: EventTypes.Mobility, eventCategory: "first_f" as const },
];

// ---------------------------------------------------------------------------
// Dev users (fictional, safe to commit)
// ---------------------------------------------------------------------------

export const DEV_USERS = [
  {
    email: "dev-admin@f3local.dev",
    f3Name: "Mainframe",
    firstName: "Dev",
    lastName: "Admin",
    emailVerified: new Date().toISOString(),
    role: "admin" as const,
  },
  {
    email: "dev-editor@f3local.dev",
    f3Name: "Patch",
    firstName: "Dev",
    lastName: "Editor",
    emailVerified: new Date().toISOString(),
    role: "editor" as const,
  },
  {
    email: "dev-user@f3local.dev",
    f3Name: "Spotter",
    firstName: "Dev",
    lastName: "User",
    emailVerified: new Date().toISOString(),
    role: null,
  },
];

// ---------------------------------------------------------------------------
// Standard F3 positions seeded per org
// ---------------------------------------------------------------------------

export const POSITIONS = [
  {
    name: "Nant'an",
    description:
      "The cultural and spiritual leader of his PAX, who represents but does not govern.  Encourages Plant/Grow/Serve and ignites the need for male community leadership amongst the Pax.",
    orgType: "region" as const,
  },
  {
    name: "Site Q",
    description:
      "He plants the flag for the AO, makes folks feel welcome, makes sure the disclaimer is correctly spoken, cadence is called, picks up the 6, makes sure the FNGs have a battle buddy, watches for hydration issues, etc.",
    orgType: "region" as const,
  },
  {
    name: "ITQ",
    description:
      "Helping streamline operations so guys can get back out into the gloom.",
    orgType: "region" as const,
  },
];

// ---------------------------------------------------------------------------
// API keys (local dev — used by apps/auth to call the API on behalf of users)
// ---------------------------------------------------------------------------

export interface LocalApiKeySeed {
  key: string;
  name: string;
  description: string;
  /** null = read-only (the system's read-only tier is the absence of a role). */
  role: "editor" | "admin" | null;
  /**
   * When set, the role attaches to this region org instead of the nation,
   * making the key region-scoped (see seedApiKeys). Must match a REGIONS name.
   */
  regionName?: string;
}

export const LOCAL_API_KEYS: LocalApiKeySeed[] = [
  {
    key: "local-api-key",
    name: "Auth Service (local dev)",
    description: "Used by apps/auth to register new users via the API",
    role: "editor",
  },
  {
    // Region-scoped principal: editor on the Boone region org only (NOT the
    // nation), so cross-region RBAC denials (e.g. spec AC-15 — an editor of
    // region S cannot reject in region R) have a deterministic seeded key.
    // The "local-" prefix keeps it inside the obfuscator's
    // --preserve-local-seed allowlist (tooling/scripts/src/obfuscate-db.ts).
    key: "local-boone-editor-key",
    name: "Boone Editor (local dev)",
    description:
      "Editor scoped to the Boone region only — used by e2e tests to exercise cross-region RBAC denial",
    role: "editor",
    regionName: "Boone",
  },
  {
    key: "local-map-key",
    name: "Map App (local dev)",
    description: "Used by apps/map for read-only API access",
    // Read-only access is the absence of a role (defacto "user"); the system
    // only assigns the editor/admin roles. See seedApiKeys.
    role: null,
  },
  {
    key: "local-slackbot-key",
    name: "Slackbot (local dev)",
    description: "Used by apps/slackbot for full Admin access",
    role: "admin",
  },
];

// ---------------------------------------------------------------------------
// OAuth clients (local dev — plaintext secret: local-me-client-secret)
// ---------------------------------------------------------------------------

export const LOCAL_OAUTH_CLIENTS = [
  {
    id: "f3-me-local",
    name: "F3 Me (local dev)",
    // SHA-256 of "local-me-client-secret" — deterministic so it can be committed
    clientSecretHash:
      "6239f25f8cff37f5ab67b37bfbb9ae94abd1805db915f010573412111a8d54fc",
    redirectUris: JSON.stringify(["http://localhost:3003/api/auth/callback"]),
    allowedOrigin: "http://localhost:3003",
    scopes: "openid profile email",
    isActive: true,
  },
  {
    id: "f3-admin-local",
    name: "F3 Admin (local dev)",
    // SHA-256 of "local-admin-client-secret" — deterministic so it can be committed
    clientSecretHash:
      "47c7916194a344bae65495f8eae734a58ad0f37a28449b8f7d6e14535f4246e6",
    redirectUris: JSON.stringify(["http://localhost:3002/api/auth/callback"]),
    allowedOrigin: "http://localhost:3002",
    scopes: "openid profile email",
    isActive: true,
  },
];

// ---------------------------------------------------------------------------
// Attendance types (1=PAX, 2=Q, 3=Co-Q)
// ---------------------------------------------------------------------------
export const ATTENDANCE_TYPES = [
  { id: 1, type: "PAX" },
  { id: 2, type: "Q" },
  { id: 3, type: "Co-Q" },
];

// ---------------------------------------------------------------------------
// Event tags
// ---------------------------------------------------------------------------
export const EVENT_TAGS = [
  { name: "Convergence", color: "Orange" },
  { name: "VQ", color: "Yellow" },
  { name: "F3Versary", color: "White" },
  { name: "Pre-Workout", color: "Black" },
  { name: "Off-The-Books", color: "Black" },
];
