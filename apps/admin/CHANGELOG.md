# Changelog

## [2.1.3](https://github.com/F3-Nation/f3-nation/compare/admin@2.1.2...admin@2.1.3) (2026-07-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.4.1
    * @acme/validators bumped to 0.2.0

## [2.1.2](https://github.com/F3-Nation/f3-nation/compare/admin@2.1.1...admin@2.1.2) (2026-07-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.4.0

## [2.1.1](https://github.com/F3-Nation/f3-nation/compare/admin@2.1.0...admin@2.1.1) (2026-07-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.3.1
    * @acme/shared bumped to 0.1.3
    * @acme/sso bumped to 0.2.1
    * @acme/tailwind-config bumped to 0.1.3
    * @acme/ui bumped to 0.1.3
    * @acme/validators bumped to 0.1.3

## [2.1.0](https://github.com/F3-Nation/f3-nation/compare/admin@2.0.5...admin@2.1.0) (2026-07-08)


### Features

* **sso,me,admin:** consolidating auth code ([#579](https://github.com/F3-Nation/f3-nation/issues/579)) ([bfae7a9](https://github.com/F3-Nation/f3-nation/commit/bfae7a9ed5e9ea06516edb996dd625252659d1b1))


### Bug Fixes

* **deps:** pin internal @acme/* refs to workspace:* to prevent release-please version drift ([#587](https://github.com/F3-Nation/f3-nation/issues/587)) ([21ded4b](https://github.com/F3-Nation/f3-nation/commit/21ded4bef25dbdd00b2e66e5d8abda516b7dd0b1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.3.0
    * @acme/mail bumped to 0.1.2
    * @acme/shared bumped to 0.1.2
    * @acme/sso bumped to 0.2.0
    * @acme/storage bumped to 0.2.2
    * @acme/tailwind-config bumped to 0.1.2
    * @acme/ui bumped to 0.1.2
    * @acme/validators bumped to 0.1.2

## [2.0.5](https://github.com/F3-Nation/f3-nation/compare/admin@2.0.4...admin@2.0.5) (2026-07-05)


### Bug Fixes

* **map,admin:** regions in region picker were grayed out ([37cec72](https://github.com/F3-Nation/f3-nation/commit/37cec722b933f6a121283403b3a5eb9fd8900f5e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.2.1
    * @acme/logger bumped to 0.1.1
    * @acme/mail bumped to 0.1.1
    * @acme/shared bumped to 0.1.1
    * @acme/sso bumped to 0.1.1
    * @acme/storage bumped to 0.2.1
    * @acme/tailwind-config bumped to 0.1.1
    * @acme/ui bumped to 0.1.1
    * @acme/validators bumped to 0.1.1

## [2.0.4](https://github.com/F3-Nation/f3-nation/compare/admin@2.0.3...admin@2.0.4) (2026-07-03)


### Bug Fixes

* **repo:** trace libvips into standalone output instead of reinstalling sharp ([#560](https://github.com/F3-Nation/f3-nation/issues/560)) ([fe1dca6](https://github.com/F3-Nation/f3-nation/commit/fe1dca66dbf5f00758b4fef04522ec946d38115d))

## [2.0.3](https://github.com/F3-Nation/f3-nation/compare/admin@2.0.2...admin@2.0.3) (2026-07-03)


### Bug Fixes

* **repo:** repoint Turbopack hashed sharp symlink after runner reinstall ([#558](https://github.com/F3-Nation/f3-nation/issues/558)) ([c8bec3a](https://github.com/F3-Nation/f3-nation/commit/c8bec3a9067d4620b4f64b25391cce0406e0e4a9))

## [2.0.2](https://github.com/F3-Nation/f3-nation/compare/admin@2.0.1...admin@2.0.2) (2026-07-03)


### Bug Fixes

* **repo:** purge pnpm-store sharp shadow so runner reinstall loads libvips ([#556](https://github.com/F3-Nation/f3-nation/issues/556)) ([1f6874c](https://github.com/F3-Nation/f3-nation/commit/1f6874c2ad54f3ba464416b28dffbf0a54e79eac))

## [2.0.1](https://github.com/F3-Nation/f3-nation/compare/admin@2.0.0...admin@2.0.1) (2026-07-02)


### Bug Fixes

* **repo:** reinstall sharp in runner stage to fix ERR_DLOPEN_FAILED ([#550](https://github.com/F3-Nation/f3-nation/issues/550)) ([faf1f68](https://github.com/F3-Nation/f3-nation/commit/faf1f68c4b3930a6db67f8cd09cd57c21a446bbc))

## [2.0.0](https://github.com/F3-Nation/f3-nation/compare/admin@1.4.1...admin@2.0.0) (2026-07-02)


### ⚠ BREAKING CHANGES

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425))

### Features

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425)) ([6f8f8ad](https://github.com/F3-Nation/f3-nation/commit/6f8f8ad0bb0bf308016d7303346124f0410e8295))

## [1.4.1](https://github.com/F3-Nation/f3-nation/compare/admin@1.4.0...admin@1.4.1) (2026-07-01)


### Bug Fixes

* **repo:** bump node to 24.18.0 to fix GCS upload premature-close regression ([#543](https://github.com/F3-Nation/f3-nation/issues/543)) ([e96348a](https://github.com/F3-Nation/f3-nation/commit/e96348ad6252fb7e9220819d02d5a7114422e5ba))

## [1.4.0](https://github.com/F3-Nation/f3-nation/compare/admin@1.3.1...admin@1.4.0) (2026-07-01)


### Features

* **admin:** add Short Location Description field to Region editor ([#470](https://github.com/F3-Nation/f3-nation/issues/470)) ([a90514d](https://github.com/F3-Nation/f3-nation/commit/a90514d02d270885905e3dede5d46869fb442c3b)), closes [#84](https://github.com/F3-Nation/f3-nation/issues/84)
* **storage:** consolidate GCS uploads into @acme/storage package ([#469](https://github.com/F3-Nation/f3-nation/issues/469)) ([92a712f](https://github.com/F3-Nation/f3-nation/commit/92a712f897ba1a787e81f2bfc6a5878541bddd3c))

## [1.3.1](https://github.com/F3-Nation/f3-nation/compare/admin@1.3.0...admin@1.3.1) (2026-06-18)


### Bug Fixes

* **repo:** updated to code were blocking deployment ([3b0e947](https://github.com/F3-Nation/f3-nation/commit/3b0e947cb9d3a2de2566058d8921ce058499acc7))

## [1.3.0](https://github.com/F3-Nation/f3-nation/compare/admin@1.2.2...admin@1.3.0) (2026-06-17)


### Features

* **db:** add phone field to orgs table ([#414](https://github.com/F3-Nation/f3-nation/issues/414)) ([28890b6](https://github.com/F3-Nation/f3-nation/commit/28890b6d306589d34b8570b75108b5b21bbe13b8))
* **repo:** triggering release ([b5e1415](https://github.com/F3-Nation/f3-nation/commit/b5e1415682df6abc3cdfa8653bc3658954fa7d0c))

## [1.2.2](https://github.com/F3-Nation/f3-nation/compare/admin@1.2.1...admin@1.2.2) (2026-06-11)


### Bug Fixes

* **me:** verify JWT signature at handler layer and fix refresh-rotation race ([#400](https://github.com/F3-Nation/f3-nation/issues/400)) ([853eed5](https://github.com/F3-Nation/f3-nation/commit/853eed58d3d1596a3f03b613b517436af871822f))

## [1.2.1](https://github.com/F3-Nation/f3-nation/compare/admin@1.2.0...admin@1.2.1) (2026-06-03)


### Bug Fixes

* **admin:** admin portal minor issues ([#386](https://github.com/F3-Nation/f3-nation/issues/386)) ([ef28ce5](https://github.com/F3-Nation/f3-nation/commit/ef28ce50441138c8ba443a82d9b1a00a84e51005))

## [1.2.0](https://github.com/F3-Nation/f3-nation/compare/admin@1.1.1...admin@1.2.0) (2026-05-31)


### Features

* **storage,db,auth,admin:** fixed turbo install, enhanced storage and local seed data ([#334](https://github.com/F3-Nation/f3-nation/issues/334)) ([249039b](https://github.com/F3-Nation/f3-nation/commit/249039b241142bb2a956b23c4f647db561810bba))

## [1.1.1](https://github.com/F3-Nation/f3-nation/compare/admin@1.1.0...admin@1.1.1) (2026-05-29)


### Bug Fixes

* **admin,api,auth,map,me:** updated turbo to v2 in docker files ([a033988](https://github.com/F3-Nation/f3-nation/commit/a0339888231ecb5a923feb37574b004da223c022))
* **admin,api:** add pagination to user search and postition assignment ([#332](https://github.com/F3-Nation/f3-nation/issues/332)) ([97fb544](https://github.com/F3-Nation/f3-nation/commit/97fb54437aff05b80bfaecd3518abcb14d92fbc6))

## [1.1.0](https://github.com/F3-Nation/f3-nation/compare/admin@1.0.3...admin@1.1.0) (2026-05-29)


### Features

* **api:** adding "region in a box" support ([#288](https://github.com/F3-Nation/f3-nation/issues/288)) ([1758acf](https://github.com/F3-Nation/f3-nation/commit/1758acfc46ed6bb411984410ebc305a22b27ead2))
* **me,storage:** move storage interaction to shared package, add emulator to storage ([74fa3d5](https://github.com/F3-Nation/f3-nation/commit/74fa3d5321c4b5e8c6c95fdf645d464ba244d353))
