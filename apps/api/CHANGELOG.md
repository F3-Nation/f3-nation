# Changelog

## [6.1.3](https://github.com/F3-Nation/f3-nation/compare/api@6.1.2...api@6.1.3) (2026-07-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.4.1
  * devDependencies
    * @acme/db bumped to 0.2.0

## [6.1.2](https://github.com/F3-Nation/f3-nation/compare/api@6.1.1...api@6.1.2) (2026-07-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.4.0

## [6.1.1](https://github.com/F3-Nation/f3-nation/compare/api@6.1.0...api@6.1.1) (2026-07-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.3.1
    * @acme/shared bumped to 0.1.3

## [6.1.0](https://github.com/F3-Nation/f3-nation/compare/api@6.0.5...api@6.1.0) (2026-07-08)


### Features

* **api:** adding slack messaging API routes ([#542](https://github.com/F3-Nation/f3-nation/issues/542)) ([951e126](https://github.com/F3-Nation/f3-nation/commit/951e12600a4a49d6c0cc87e30c9648a227f777f1))


### Bug Fixes

* **deps:** pin internal @acme/* refs to workspace:* to prevent release-please version drift ([#587](https://github.com/F3-Nation/f3-nation/issues/587)) ([21ded4b](https://github.com/F3-Nation/f3-nation/commit/21ded4bef25dbdd00b2e66e5d8abda516b7dd0b1))
* **map:** mask session replay text and media ([#593](https://github.com/F3-Nation/f3-nation/issues/593)) ([a705d76](https://github.com/F3-Nation/f3-nation/commit/a705d767d4091566f8ed8224f968bc997694205e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.3.0
    * @acme/auth bumped to 0.1.3
    * @acme/db bumped to 0.1.2
    * @acme/shared bumped to 0.1.2
    * @acme/ui bumped to 0.1.2
    * @acme/validators bumped to 0.1.2

## [6.0.5](https://github.com/F3-Nation/f3-nation/compare/api@6.0.4...api@6.0.5) (2026-07-05)


### Bug Fixes

* **map,admin:** regions in region picker were grayed out ([37cec72](https://github.com/F3-Nation/f3-nation/commit/37cec722b933f6a121283403b3a5eb9fd8900f5e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.2.1
    * @acme/auth bumped to 0.1.2
    * @acme/db bumped to 0.1.1
    * @acme/logger bumped to 0.1.1
    * @acme/shared bumped to 0.1.1
    * @acme/ui bumped to 0.1.1
    * @acme/validators bumped to 0.1.1

## [6.0.4](https://github.com/F3-Nation/f3-nation/compare/api@6.0.3...api@6.0.4) (2026-07-03)


### Bug Fixes

* **repo:** trace libvips into standalone output instead of reinstalling sharp ([#560](https://github.com/F3-Nation/f3-nation/issues/560)) ([fe1dca6](https://github.com/F3-Nation/f3-nation/commit/fe1dca66dbf5f00758b4fef04522ec946d38115d))

## [6.0.3](https://github.com/F3-Nation/f3-nation/compare/api@6.0.2...api@6.0.3) (2026-07-03)


### Bug Fixes

* **repo:** repoint Turbopack hashed sharp symlink after runner reinstall ([#558](https://github.com/F3-Nation/f3-nation/issues/558)) ([c8bec3a](https://github.com/F3-Nation/f3-nation/commit/c8bec3a9067d4620b4f64b25391cce0406e0e4a9))

## [6.0.2](https://github.com/F3-Nation/f3-nation/compare/api@6.0.1...api@6.0.2) (2026-07-03)


### Bug Fixes

* **repo:** purge pnpm-store sharp shadow so runner reinstall loads libvips ([#556](https://github.com/F3-Nation/f3-nation/issues/556)) ([1f6874c](https://github.com/F3-Nation/f3-nation/commit/1f6874c2ad54f3ba464416b28dffbf0a54e79eac))

## [6.0.1](https://github.com/F3-Nation/f3-nation/compare/api@6.0.0...api@6.0.1) (2026-07-02)


### Bug Fixes

* **repo:** reinstall sharp in runner stage to fix ERR_DLOPEN_FAILED ([#550](https://github.com/F3-Nation/f3-nation/issues/550)) ([faf1f68](https://github.com/F3-Nation/f3-nation/commit/faf1f68c4b3930a6db67f8cd09cd57c21a446bbc))

## [6.0.0](https://github.com/F3-Nation/f3-nation/compare/api@5.2.1...api@6.0.0) (2026-07-02)


### ⚠ BREAKING CHANGES

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425))

### Features

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425)) ([6f8f8ad](https://github.com/F3-Nation/f3-nation/commit/6f8f8ad0bb0bf308016d7303346124f0410e8295))

## [5.2.1](https://github.com/F3-Nation/f3-nation/compare/api@5.2.0...api@5.2.1) (2026-07-01)


### Bug Fixes

* **repo:** bump node to 24.18.0 to fix GCS upload premature-close regression ([#543](https://github.com/F3-Nation/f3-nation/issues/543)) ([e96348a](https://github.com/F3-Nation/f3-nation/commit/e96348ad6252fb7e9220819d02d5a7114422e5ba))

## [5.2.0](https://github.com/F3-Nation/f3-nation/compare/api@5.1.1...api@5.2.0) (2026-07-01)


### Features

* **storage:** consolidate GCS uploads into @acme/storage package ([#469](https://github.com/F3-Nation/f3-nation/issues/469)) ([92a712f](https://github.com/F3-Nation/f3-nation/commit/92a712f897ba1a787e81f2bfc6a5878541bddd3c))

## [5.1.1](https://github.com/F3-Nation/f3-nation/compare/api@5.1.0...api@5.1.1) (2026-06-18)


### Bug Fixes

* **repo:** updated to code were blocking deployment ([3b0e947](https://github.com/F3-Nation/f3-nation/commit/3b0e947cb9d3a2de2566058d8921ce058499acc7))

## [5.1.0](https://github.com/F3-Nation/f3-nation/compare/api@5.0.0...api@5.1.0) (2026-06-17)


### Features

* **repo:** triggering release ([b5e1415](https://github.com/F3-Nation/f3-nation/commit/b5e1415682df6abc3cdfa8653bc3658954fa7d0c))

## [5.0.0](https://github.com/F3-Nation/f3-nation/compare/api@4.3.2...api@5.0.0) (2026-06-11)


### ⚠ BREAKING CHANGES

* **ci:** add GitHub Actions workflows for API and MAP deployment ([#396](https://github.com/F3-Nation/f3-nation/issues/396))

### Features

* **api:** adding "region in a box" support ([#288](https://github.com/F3-Nation/f3-nation/issues/288)) ([1758acf](https://github.com/F3-Nation/f3-nation/commit/1758acfc46ed6bb411984410ebc305a22b27ead2))
* **ci:** add GitHub Actions workflows for API and MAP deployment ([#396](https://github.com/F3-Nation/f3-nation/issues/396)) ([87babd4](https://github.com/F3-Nation/f3-nation/commit/87babd47949661b6f140dcd924980d7f153faec9))
* **me:** initial release of F3 Me ([a76aa31](https://github.com/F3-Nation/f3-nation/commit/a76aa315e944f61b6b5a6d5bb35ce141a3e90469))
* upgrade TypeScript to 6.0.2 and ESLint to 10.2.0 ([#233](https://github.com/F3-Nation/f3-nation/issues/233)) ([0eae1e7](https://github.com/F3-Nation/f3-nation/commit/0eae1e7cfdfdc80fc1dc359c24de46c53e989554))


### Bug Fixes

* **admin,api,auth,map,me:** updated turbo to v2 in docker files ([a033988](https://github.com/F3-Nation/f3-nation/commit/a0339888231ecb5a923feb37574b004da223c022))
* **api:** add NEXT_PUBLIC_AUTH_URL to local dev env template ([7991a48](https://github.com/F3-Nation/f3-nation/commit/7991a48e0c330581e692502b80ea8893666cd7e2))
* **deps:** resolve 18 high-severity CVEs in prod dependencies ([#383](https://github.com/F3-Nation/f3-nation/issues/383)) ([31f0d50](https://github.com/F3-Nation/f3-nation/commit/31f0d50ac4aaa348c2223b9d3892398c527284e2))
* **me,api:** removed pii from api ([#279](https://github.com/F3-Nation/f3-nation/issues/279)) ([f491290](https://github.com/F3-Nation/f3-nation/commit/f49129095147a248d64134b3007f607c559ba7d5))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([4d4fdab](https://github.com/F3-Nation/f3-nation/commit/4d4fdabee80cf895f53c6e2ebed0b562e1636b2d))
* **repo:** enforce NODE_ENV=test and serialize packages/api test files ([015c8b2](https://github.com/F3-Nation/f3-nation/commit/015c8b253733f350193c29df0f70e9faa3e6599d))
* **shared:** update node version ([d048840](https://github.com/F3-Nation/f3-nation/commit/d048840651f7d83d06f20e472089bfcfb5b9fbb7))

## Changelog
