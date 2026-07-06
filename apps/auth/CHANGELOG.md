# Changelog

## [2.0.5](https://github.com/F3-Nation/f3-nation/compare/auth@2.0.4...auth@2.0.5) (2026-07-05)


### Bug Fixes

* **map,admin:** regions in region picker were grayed out ([37cec72](https://github.com/F3-Nation/f3-nation/commit/37cec722b933f6a121283403b3a5eb9fd8900f5e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/db bumped to 0.1.1
    * @acme/logger bumped to 0.1.1
    * @acme/shared bumped to 0.1.1
  * devDependencies
    * @acme/tailwind-config bumped to 0.1.1

## [2.0.4](https://github.com/F3-Nation/f3-nation/compare/auth@2.0.3...auth@2.0.4) (2026-07-03)


### Bug Fixes

* **repo:** trace libvips into standalone output instead of reinstalling sharp ([#560](https://github.com/F3-Nation/f3-nation/issues/560)) ([fe1dca6](https://github.com/F3-Nation/f3-nation/commit/fe1dca66dbf5f00758b4fef04522ec946d38115d))

## [2.0.3](https://github.com/F3-Nation/f3-nation/compare/auth@2.0.2...auth@2.0.3) (2026-07-03)


### Bug Fixes

* **repo:** repoint Turbopack hashed sharp symlink after runner reinstall ([#558](https://github.com/F3-Nation/f3-nation/issues/558)) ([c8bec3a](https://github.com/F3-Nation/f3-nation/commit/c8bec3a9067d4620b4f64b25391cce0406e0e4a9))

## [2.0.2](https://github.com/F3-Nation/f3-nation/compare/auth@2.0.1...auth@2.0.2) (2026-07-03)


### Bug Fixes

* **repo:** purge pnpm-store sharp shadow so runner reinstall loads libvips ([#556](https://github.com/F3-Nation/f3-nation/issues/556)) ([1f6874c](https://github.com/F3-Nation/f3-nation/commit/1f6874c2ad54f3ba464416b28dffbf0a54e79eac))

## [2.0.1](https://github.com/F3-Nation/f3-nation/compare/auth@2.0.0...auth@2.0.1) (2026-07-02)


### Bug Fixes

* **repo:** reinstall sharp in runner stage to fix ERR_DLOPEN_FAILED ([#550](https://github.com/F3-Nation/f3-nation/issues/550)) ([faf1f68](https://github.com/F3-Nation/f3-nation/commit/faf1f68c4b3930a6db67f8cd09cd57c21a446bbc))

## [2.0.0](https://github.com/F3-Nation/f3-nation/compare/auth@1.3.2...auth@2.0.0) (2026-07-02)


### ⚠ BREAKING CHANGES

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425))

### Features

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425)) ([6f8f8ad](https://github.com/F3-Nation/f3-nation/commit/6f8f8ad0bb0bf308016d7303346124f0410e8295))

## [1.3.2](https://github.com/F3-Nation/f3-nation/compare/auth@1.3.1...auth@1.3.2) (2026-07-01)


### Bug Fixes

* **repo:** bump node to 24.18.0 to fix GCS upload premature-close regression ([#543](https://github.com/F3-Nation/f3-nation/issues/543)) ([e96348a](https://github.com/F3-Nation/f3-nation/commit/e96348ad6252fb7e9220819d02d5a7114422e5ba))

## [1.3.1](https://github.com/F3-Nation/f3-nation/compare/auth@1.3.0...auth@1.3.1) (2026-06-18)


### Bug Fixes

* **repo:** updated to code were blocking deployment ([3b0e947](https://github.com/F3-Nation/f3-nation/commit/3b0e947cb9d3a2de2566058d8921ce058499acc7))

## [1.3.0](https://github.com/F3-Nation/f3-nation/compare/auth@1.2.1...auth@1.3.0) (2026-06-17)


### Features

* **repo:** triggering release ([b5e1415](https://github.com/F3-Nation/f3-nation/commit/b5e1415682df6abc3cdfa8653bc3658954fa7d0c))

## [1.2.1](https://github.com/F3-Nation/f3-nation/compare/auth@1.2.0...auth@1.2.1) (2026-06-11)


### Bug Fixes

* **auth:** pin max-instances, enforce S256 PKCE, rate-limit userinfo/revoke ([#399](https://github.com/F3-Nation/f3-nation/issues/399)) ([0a7c904](https://github.com/F3-Nation/f3-nation/commit/0a7c904c6c21a3b99342b448f764614e3f87bde5))

## [1.2.0](https://github.com/F3-Nation/f3-nation/compare/auth@1.1.5...auth@1.2.0) (2026-05-31)


### Features

* **storage,db,auth,admin:** fixed turbo install, enhanced storage and local seed data ([#334](https://github.com/F3-Nation/f3-nation/issues/334)) ([249039b](https://github.com/F3-Nation/f3-nation/commit/249039b241142bb2a956b23c4f647db561810bba))


### Bug Fixes

* **auth:** register skips onboarding, validates phone, magic link respects callbackUrl ([#257](https://github.com/F3-Nation/f3-nation/issues/257), [#258](https://github.com/F3-Nation/f3-nation/issues/258), [#281](https://github.com/F3-Nation/f3-nation/issues/281)) ([#336](https://github.com/F3-Nation/f3-nation/issues/336)) ([4c59132](https://github.com/F3-Nation/f3-nation/commit/4c591329d8b57c6f4b812941dda770c75eed872b))

## [1.1.5](https://github.com/F3-Nation/f3-nation/compare/auth@1.1.4...auth@1.1.5) (2026-05-29)


### Bug Fixes

* **admin,api,auth,map,me:** updated turbo to v2 in docker files ([a033988](https://github.com/F3-Nation/f3-nation/commit/a0339888231ecb5a923feb37574b004da223c022))
