# Changelog

## [0.9.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.8.0...pkg-db@0.9.0) (2026-10-10)


### Features

* **db:** add public-table audit history ([#1060](https://github.com/F3-Nation/f3-nation/issues/1060)) ([10454d8](https://github.com/F3-Nation/f3-nation/commit/10454d8ab47795b984a76b01768642860b7718b6))
* **db:** drop hand-made event_instance_expanded and attendance_expanded views ([#1066](https://github.com/F3-Nation/f3-nation/issues/1066)) ([fd884ea](https://github.com/F3-Nation/f3-nation/commit/fd884ea1c9a5c5f8b8d73a3f02550b9e4eff3675))
* **db:** guarded db:migrate:local|staging|prod commands ([#1183](https://github.com/F3-Nation/f3-nation/issues/1183)) ([b7e5b66](https://github.com/F3-Nation/f3-nation/commit/b7e5b665b3d2193f607e24ca96698411463f5d23))

## [0.8.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.7.0...pkg-db@0.8.0) (2026-10-06)


### Features

* **auth:** resolve [#876](https://github.com/F3-Nation/f3-nation/issues/876) Phase 3's OAuth client-secret-issuance gap ([#1046](https://github.com/F3-Nation/f3-nation/issues/1046)) ([0bf5b66](https://github.com/F3-Nation/f3-nation/commit/0bf5b66daf882e7199643eb9d43ab28c2795087f))
* **db:** connect over a Cloud SQL Unix socket named in DATABASE_URL ([#1118](https://github.com/F3-Nation/f3-nation/issues/1118)) ([d32a88d](https://github.com/F3-Nation/f3-nation/commit/d32a88d79ee19981c9bc901becdaf9cbab292d14))
* **slackbot:** add F3versary announcements ([#943](https://github.com/F3-Nation/f3-nation/issues/943)) ([65c080e](https://github.com/F3-Nation/f3-nation/commit/65c080e3f50114aaea520fca95c7a945938aa3a7))


### Bug Fixes

* **auth,db,api:** let Better Auth start and sign in against the Drizzle schema ([#1143](https://github.com/F3-Nation/f3-nation/issues/1143)) ([2a9026f](https://github.com/F3-Nation/f3-nation/commit/2a9026fe8f9124f68331bb024a160a27f1e26949))
* **db:** clarify local and test database env usage ([#1148](https://github.com/F3-Nation/f3-nation/issues/1148)) ([b11dfe7](https://github.com/F3-Nation/f3-nation/commit/b11dfe79c1a28a90432fd343e3956c6c596425ad))
* **db:** exit non-zero when a migration fails ([#1117](https://github.com/F3-Nation/f3-nation/issues/1117)) ([e636c7f](https://github.com/F3-Nation/f3-nation/commit/e636c7f6fe672510f315b9bad79c2c764c5f6cde))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/env bumped to 0.1.4
    * @acme/shared bumped to 0.4.1

## [0.7.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.6.2...pkg-db@0.7.0) (2026-09-23)


### Features

* **admin,api,db,shared:** surface territory in the admin UI and count AOs at any depth ([#1043](https://github.com/F3-Nation/f3-nation/issues/1043)) ([f9932d2](https://github.com/F3-Nation/f3-nation/commit/f9932d26700c733fb69ee02b703aedab63053f4f))
* **db:** add FK cascade and email-sync trigger for better_auth_user ([#1032](https://github.com/F3-Nation/f3-nation/issues/1032)) ([e95c218](https://github.com/F3-Nation/f3-nation/commit/e95c21840646e9096aa8ab49a19a0e891ca23c12))
* **shared,db,db-python,admin:** add territory organization type ([#1025](https://github.com/F3-Nation/f3-nation/issues/1025)) ([75996ba](https://github.com/F3-Nation/f3-nation/commit/75996ba4e1020fc499bae19d21a7b9d5cc046f78))


### Bug Fixes

* **db:** add territory with ADD VALUE so 0023 survives dependent views ([#1063](https://github.com/F3-Nation/f3-nation/issues/1063)) ([1600218](https://github.com/F3-Nation/f3-nation/commit/16002188f5248fa5e8c07156a2f3b6a288c09cb8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/env bumped to 0.1.3
    * @acme/shared bumped to 0.4.0

## [0.6.2](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.6.1...pkg-db@0.6.2) (2026-09-16)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/shared bumped to 0.3.1

## [0.6.1](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.6.0...pkg-db@0.6.1) (2026-09-11)


### Bug Fixes

* **db,ci:** tune Postgres client pool/timeouts and fix stale auth staging_url ([#901](https://github.com/F3-Nation/f3-nation/issues/901)) ([59ead05](https://github.com/F3-Nation/f3-nation/commit/59ead059226ecffaa3b928b67aa64753170fb613))
* **db:** bound how long a query waits behind a saturated connection pool ([#911](https://github.com/F3-Nation/f3-nation/issues/911)) ([d26f4cb](https://github.com/F3-Nation/f3-nation/commit/d26f4cbd2f57fba6ddcf6f5f6d7c66c5ece8abbe))

## [0.6.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.5.0...pkg-db@0.6.0) (2026-09-10)


### Features

* **api,admin,db,shared:** add OAuth client admin UI ([#957](https://github.com/F3-Nation/f3-nation/issues/957)) ([f09c9c5](https://github.com/F3-Nation/f3-nation/commit/f09c9c5a5d0921833eec876fbcee102999ceed37))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/shared bumped to 0.3.0

## [0.5.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.4.1...pkg-db@0.5.0) (2026-09-08)


### Features

* **auth,db,admin,api:** better auth config for [#876](https://github.com/F3-Nation/f3-nation/issues/876) phase 3 ([#914](https://github.com/F3-Nation/f3-nation/issues/914)) ([4c77b90](https://github.com/F3-Nation/f3-nation/commit/4c77b904dab9a9864d1c9d98f6356e6f211bb086))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/shared bumped to 0.2.0

## [0.4.1](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.4.0...pkg-db@0.4.1) (2026-08-18)


### Bug Fixes

* **auth:** persist nonce, auth_time, and refresh-token scopes on OAuth id_tokens ([#845](https://github.com/F3-Nation/f3-nation/issues/845)) ([4703c9b](https://github.com/F3-Nation/f3-nation/commit/4703c9baa135b043f94e2c4d4752d76966fd3f09))

## [0.4.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.3.0...pkg-db@0.4.0) (2026-08-12)


### Features

* **auth:** support public OAuth clients (PKCE-only, RFC 8252) for native apps ([#692](https://github.com/F3-Nation/f3-nation/issues/692)) ([a19a9df](https://github.com/F3-Nation/f3-nation/commit/a19a9df5ce8ec14732825d4aaf84ce8c81292722))

## [0.3.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.2.0...pkg-db@0.3.0) (2026-08-05)


### Features

* **repo:** ai-native sdlc — previews, e2e, ai review/triage ([#685](https://github.com/F3-Nation/f3-nation/issues/685)) ([1c66c22](https://github.com/F3-Nation/f3-nation/commit/1c66c228727c9fbc4c5575f42e41c5b2576267be))

## [0.2.0](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.1.3...pkg-db@0.2.0) (2026-07-26)


### Features

* **db:** integrate vitest for testing and coverage ([11033f8](https://github.com/F3-Nation/f3-nation/commit/11033f811c96e89df0a9f33103a0ffdfa9d2a263))

## [0.1.3](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.1.2...pkg-db@0.1.3) (2026-07-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/shared bumped to 0.1.3

## [0.1.2](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.1.1...pkg-db@0.1.2) (2026-07-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/env bumped to 0.1.2
    * @acme/shared bumped to 0.1.2

## [0.1.1](https://github.com/F3-Nation/f3-nation/compare/pkg-db@0.1.0...pkg-db@0.1.1) (2026-07-05)


### Bug Fixes

* **map,admin:** regions in region picker were grayed out ([37cec72](https://github.com/F3-Nation/f3-nation/commit/37cec722b933f6a121283403b3a5eb9fd8900f5e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/env bumped to 0.1.1
    * @acme/shared bumped to 0.1.1
