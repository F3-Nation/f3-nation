# Changelog

## [7.0.8](https://github.com/F3-Nation/f3-nation/compare/map@7.0.7...map@7.0.8) (2026-07-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.4.0

## [7.0.7](https://github.com/F3-Nation/f3-nation/compare/map@7.0.6...map@7.0.7) (2026-07-14)


### Bug Fixes

* **map,shared:** consolidate search trigger to 3 chars, label panel close button ([#607](https://github.com/F3-Nation/f3-nation/issues/607)) ([f1e7751](https://github.com/F3-Nation/f3-nation/commit/f1e7751cb45c8edf82d3a6673d1d02d0a704409e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.3.1
    * @acme/auth bumped to 0.1.4
    * @acme/shared bumped to 0.1.3
    * @acme/tailwind-config bumped to 0.1.3
    * @acme/ui bumped to 0.1.3
    * @acme/validators bumped to 0.1.3

## [7.0.6](https://github.com/F3-Nation/f3-nation/compare/map@7.0.5...map@7.0.6) (2026-07-08)


### Bug Fixes

* **deps:** pin internal @acme/* refs to workspace:* to prevent release-please version drift ([#587](https://github.com/F3-Nation/f3-nation/issues/587)) ([21ded4b](https://github.com/F3-Nation/f3-nation/commit/21ded4bef25dbdd00b2e66e5d8abda516b7dd0b1))
* **map:** mask session replay text and media ([#593](https://github.com/F3-Nation/f3-nation/issues/593)) ([a705d76](https://github.com/F3-Nation/f3-nation/commit/a705d767d4091566f8ed8224f968bc997694205e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.3.0
    * @acme/auth bumped to 0.1.3
    * @acme/db bumped to 0.1.2
    * @acme/mail bumped to 0.1.2
    * @acme/shared bumped to 0.1.2
    * @acme/storage bumped to 0.2.2
    * @acme/tailwind-config bumped to 0.1.2
    * @acme/ui bumped to 0.1.2
    * @acme/validators bumped to 0.1.2

## [7.0.5](https://github.com/F3-Nation/f3-nation/compare/map@7.0.4...map@7.0.5) (2026-07-05)


### Bug Fixes

* **map,admin:** regions in region picker were grayed out ([37cec72](https://github.com/F3-Nation/f3-nation/commit/37cec722b933f6a121283403b3a5eb9fd8900f5e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/api bumped to 0.2.1
    * @acme/auth bumped to 0.1.2
    * @acme/db bumped to 0.1.1
    * @acme/logger bumped to 0.1.1
    * @acme/mail bumped to 0.1.1
    * @acme/shared bumped to 0.1.1
    * @acme/storage bumped to 0.2.1
    * @acme/tailwind-config bumped to 0.1.1
    * @acme/ui bumped to 0.1.1
    * @acme/validators bumped to 0.1.1

## [7.0.4](https://github.com/F3-Nation/f3-nation/compare/map@7.0.3...map@7.0.4) (2026-07-03)


### Bug Fixes

* **repo:** trace libvips into standalone output instead of reinstalling sharp ([#560](https://github.com/F3-Nation/f3-nation/issues/560)) ([fe1dca6](https://github.com/F3-Nation/f3-nation/commit/fe1dca66dbf5f00758b4fef04522ec946d38115d))

## [7.0.3](https://github.com/F3-Nation/f3-nation/compare/map@7.0.2...map@7.0.3) (2026-07-03)


### Bug Fixes

* **repo:** repoint Turbopack hashed sharp symlink after runner reinstall ([#558](https://github.com/F3-Nation/f3-nation/issues/558)) ([c8bec3a](https://github.com/F3-Nation/f3-nation/commit/c8bec3a9067d4620b4f64b25391cce0406e0e4a9))

## [7.0.2](https://github.com/F3-Nation/f3-nation/compare/map@7.0.1...map@7.0.2) (2026-07-03)


### Bug Fixes

* **repo:** purge pnpm-store sharp shadow so runner reinstall loads libvips ([#556](https://github.com/F3-Nation/f3-nation/issues/556)) ([1f6874c](https://github.com/F3-Nation/f3-nation/commit/1f6874c2ad54f3ba464416b28dffbf0a54e79eac))

## [7.0.1](https://github.com/F3-Nation/f3-nation/compare/map@7.0.0...map@7.0.1) (2026-07-02)


### Bug Fixes

* **repo:** reinstall sharp in runner stage to fix ERR_DLOPEN_FAILED ([#550](https://github.com/F3-Nation/f3-nation/issues/550)) ([faf1f68](https://github.com/F3-Nation/f3-nation/commit/faf1f68c4b3930a6db67f8cd09cd57c21a446bbc))

## [7.0.0](https://github.com/F3-Nation/f3-nation/compare/map@6.0.1...map@7.0.0) (2026-07-02)


### ⚠ BREAKING CHANGES

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425))

### Features

* **slackbot:** slackbot monorepo integration ([#425](https://github.com/F3-Nation/f3-nation/issues/425)) ([6f8f8ad](https://github.com/F3-Nation/f3-nation/commit/6f8f8ad0bb0bf308016d7303346124f0410e8295))

## [6.0.1](https://github.com/F3-Nation/f3-nation/compare/map@6.0.0...map@6.0.1) (2026-07-01)


### Bug Fixes

* **repo:** bump node to 24.18.0 to fix GCS upload premature-close regression ([#543](https://github.com/F3-Nation/f3-nation/issues/543)) ([e96348a](https://github.com/F3-Nation/f3-nation/commit/e96348ad6252fb7e9220819d02d5a7114422e5ba))

## [6.0.0](https://github.com/F3-Nation/f3-nation/compare/map@5.1.7...map@6.0.0) (2026-07-01)


### ⚠ BREAKING CHANGES

* **ci:** add GitHub Actions workflows for API and MAP deployment ([#396](https://github.com/F3-Nation/f3-nation/issues/396))

### Features

* AO inherits parent region logo as fallback on the map ([#152](https://github.com/F3-Nation/f3-nation/issues/152)) ([57f1a61](https://github.com/F3-Nation/f3-nation/commit/57f1a61c04852e41d1492eaf8f264cb0ba8b244c))
* **ci:** add GitHub Actions workflows for API and MAP deployment ([#396](https://github.com/F3-Nation/f3-nation/issues/396)) ([87babd4](https://github.com/F3-Nation/f3-nation/commit/87babd47949661b6f140dcd924980d7f153faec9))
* **db:** add phone field to orgs table ([#414](https://github.com/F3-Nation/f3-nation/issues/414)) ([28890b6](https://github.com/F3-Nation/f3-nation/commit/28890b6d306589d34b8570b75108b5b21bbe13b8))
* **map:** implement AO grouping for location markers ([#35](https://github.com/F3-Nation/f3-nation/issues/35)) ([18e3f80](https://github.com/F3-Nation/f3-nation/commit/18e3f80010f8637ad42ce6028589a9bd0c73e144))
* **repo:** local Docker development environment without GCP credentials ([3f02d62](https://github.com/F3-Nation/f3-nation/commit/3f02d62e776a2c013296cfeef0b0e67af9cda89a))
* **repo:** triggering release ([b5e1415](https://github.com/F3-Nation/f3-nation/commit/b5e1415682df6abc3cdfa8653bc3658954fa7d0c))
* **storage:** consolidate GCS uploads into @acme/storage package ([#469](https://github.com/F3-Nation/f3-nation/issues/469)) ([92a712f](https://github.com/F3-Nation/f3-nation/commit/92a712f897ba1a787e81f2bfc6a5878541bddd3c))
* update onboarding docs ([#6](https://github.com/F3-Nation/f3-nation/issues/6)) ([8bc965f](https://github.com/F3-Nation/f3-nation/commit/8bc965fa32e9623c4cb06783c3a90a6dcd7b2c7d))
* upgrade TypeScript to 6.0.2 and ESLint to 10.2.0 ([#233](https://github.com/F3-Nation/f3-nation/issues/233)) ([0eae1e7](https://github.com/F3-Nation/f3-nation/commit/0eae1e7cfdfdc80fc1dc359c24de46c53e989554))


### Bug Fixes

* admin tables display lastAnnualReview one day behind in negative UTC offset timezones ([#159](https://github.com/F3-Nation/f3-nation/issues/159)) ([7b90e8a](https://github.com/F3-Nation/f3-nation/commit/7b90e8a8eb7ee4aa92e24745f1980346b82c8a66))
* **admin,api,auth,map,me:** updated turbo to v2 in docker files ([a033988](https://github.com/F3-Nation/f3-nation/commit/a0339888231ecb5a923feb37574b004da223c022))
* **deps:** resolve 18 high-severity CVEs in prod dependencies ([#383](https://github.com/F3-Nation/f3-nation/issues/383)) ([31f0d50](https://github.com/F3-Nation/f3-nation/commit/31f0d50ac4aaa348c2223b9d3892398c527284e2))
* **env:** add missing placeholders to local dev env examples ([d5f1adf](https://github.com/F3-Nation/f3-nation/commit/d5f1adfbdbf44efbf309ce4df0ce17f0abfb568e))
* **map,api,repo:** map.../admin redirect to admin. and email link updates to new url ([#307](https://github.com/F3-Nation/f3-nation/issues/307)) ([e559d65](https://github.com/F3-Nation/f3-nation/commit/e559d658726ca300d1f66a2ff7f6ff88fa338a5b))
* **map:** make NEXT_PUBLIC_ADMIN_URL optional, derive from channel ([#306](https://github.com/F3-Nation/f3-nation/issues/306)) ([3f9a9a5](https://github.com/F3-Nation/f3-nation/commit/3f9a9a5237e66d932e8fba529c46af69bf8618aa))
* **map:** org-level positions ([b6e7429](https://github.com/F3-Nation/f3-nation/commit/b6e7429c026974e6ebb8c8c2a305fdfd90479c69))
* **map:** restore SSG to eliminate dynamic SSR on every request ([#515](https://github.com/F3-Nation/f3-nation/issues/515)) ([cc0b49f](https://github.com/F3-Nation/f3-nation/commit/cc0b49f63c11b1df6fcffbb15b476322a6609a1f))
* **map:** switching ga tag from build to runtime ([#522](https://github.com/F3-Nation/f3-nation/issues/522)) ([d1a9b47](https://github.com/F3-Nation/f3-nation/commit/d1a9b476b39c969212109dcdcae50f5e051b02c2))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([4d4fdab](https://github.com/F3-Nation/f3-nation/commit/4d4fdabee80cf895f53c6e2ebed0b562e1636b2d))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([13857fe](https://github.com/F3-Nation/f3-nation/commit/13857feb32a97b4d6c87a2953b66b0ff068796b1))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([dc5b3d8](https://github.com/F3-Nation/f3-nation/commit/dc5b3d8f1b6f15a81aae9220a07d3bab04641997))
* **repo:** enforce NODE_ENV=test and serialize packages/api test files ([015c8b2](https://github.com/F3-Nation/f3-nation/commit/015c8b253733f350193c29df0f70e9faa3e6599d))
* **repo:** updated to code were blocking deployment ([3b0e947](https://github.com/F3-Nation/f3-nation/commit/3b0e947cb9d3a2de2566058d8921ce058499acc7))
* **shared:** update node version ([d048840](https://github.com/F3-Nation/f3-nation/commit/d048840651f7d83d06f20e472089bfcfb5b9fbb7))

## [5.1.1](https://github.com/F3-Nation/f3-nation/compare/map@5.1.0...map@5.1.1) (2026-06-18)


### Bug Fixes

* **repo:** updated to code were blocking deployment ([3b0e947](https://github.com/F3-Nation/f3-nation/commit/3b0e947cb9d3a2de2566058d8921ce058499acc7))

## [5.1.0](https://github.com/F3-Nation/f3-nation/compare/map@5.0.0...map@5.1.0) (2026-06-17)


### Features

* **db:** add phone field to orgs table ([#414](https://github.com/F3-Nation/f3-nation/issues/414)) ([28890b6](https://github.com/F3-Nation/f3-nation/commit/28890b6d306589d34b8570b75108b5b21bbe13b8))
* **repo:** triggering release ([b5e1415](https://github.com/F3-Nation/f3-nation/commit/b5e1415682df6abc3cdfa8653bc3658954fa7d0c))

## [5.0.0](https://github.com/F3-Nation/f3-nation/compare/map@4.2.3...map@5.0.0) (2026-06-11)


### ⚠ BREAKING CHANGES

* **ci:** add GitHub Actions workflows for API and MAP deployment ([#396](https://github.com/F3-Nation/f3-nation/issues/396))

### Features

* AO inherits parent region logo as fallback on the map ([#152](https://github.com/F3-Nation/f3-nation/issues/152)) ([57f1a61](https://github.com/F3-Nation/f3-nation/commit/57f1a61c04852e41d1492eaf8f264cb0ba8b244c))
* **ci:** add GitHub Actions workflows for API and MAP deployment ([#396](https://github.com/F3-Nation/f3-nation/issues/396)) ([87babd4](https://github.com/F3-Nation/f3-nation/commit/87babd47949661b6f140dcd924980d7f153faec9))
* enhanced README for onboarding ([65f8096](https://github.com/F3-Nation/f3-nation/commit/65f809662abbdf0c67a3d31ee6fa6eb31a45400b))
* **map:** implement AO grouping for location markers ([#35](https://github.com/F3-Nation/f3-nation/issues/35)) ([18e3f80](https://github.com/F3-Nation/f3-nation/commit/18e3f80010f8637ad42ce6028589a9bd0c73e144))
* **repo:** local Docker development environment without GCP credentials ([3f02d62](https://github.com/F3-Nation/f3-nation/commit/3f02d62e776a2c013296cfeef0b0e67af9cda89a))
* update onboarding docs ([#6](https://github.com/F3-Nation/f3-nation/issues/6)) ([8bc965f](https://github.com/F3-Nation/f3-nation/commit/8bc965fa32e9623c4cb06783c3a90a6dcd7b2c7d))
* upgrade TypeScript to 6.0.2 and ESLint to 10.2.0 ([#233](https://github.com/F3-Nation/f3-nation/issues/233)) ([0eae1e7](https://github.com/F3-Nation/f3-nation/commit/0eae1e7cfdfdc80fc1dc359c24de46c53e989554))


### Bug Fixes

* admin tables display lastAnnualReview one day behind in negative UTC offset timezones ([#159](https://github.com/F3-Nation/f3-nation/issues/159)) ([7b90e8a](https://github.com/F3-Nation/f3-nation/commit/7b90e8a8eb7ee4aa92e24745f1980346b82c8a66))
* **admin,api,auth,map,me:** updated turbo to v2 in docker files ([a033988](https://github.com/F3-Nation/f3-nation/commit/a0339888231ecb5a923feb37574b004da223c022))
* **deps:** resolve 18 high-severity CVEs in prod dependencies ([#383](https://github.com/F3-Nation/f3-nation/issues/383)) ([31f0d50](https://github.com/F3-Nation/f3-nation/commit/31f0d50ac4aaa348c2223b9d3892398c527284e2))
* **env:** add missing placeholders to local dev env examples ([d5f1adf](https://github.com/F3-Nation/f3-nation/commit/d5f1adfbdbf44efbf309ce4df0ce17f0abfb568e))
* **map,api,repo:** map.../admin redirect to admin. and email link updates to new url ([#307](https://github.com/F3-Nation/f3-nation/issues/307)) ([e559d65](https://github.com/F3-Nation/f3-nation/commit/e559d658726ca300d1f66a2ff7f6ff88fa338a5b))
* **map:** make NEXT_PUBLIC_ADMIN_URL optional, derive from channel ([#306](https://github.com/F3-Nation/f3-nation/issues/306)) ([3f9a9a5](https://github.com/F3-Nation/f3-nation/commit/3f9a9a5237e66d932e8fba529c46af69bf8618aa))
* **map:** org-level positions ([b6e7429](https://github.com/F3-Nation/f3-nation/commit/b6e7429c026974e6ebb8c8c2a305fdfd90479c69))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([4d4fdab](https://github.com/F3-Nation/f3-nation/commit/4d4fdabee80cf895f53c6e2ebed0b562e1636b2d))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([13857fe](https://github.com/F3-Nation/f3-nation/commit/13857feb32a97b4d6c87a2953b66b0ff068796b1))
* **repo:** address PR [#282](https://github.com/F3-Nation/f3-nation/issues/282) review comments ([dc5b3d8](https://github.com/F3-Nation/f3-nation/commit/dc5b3d8f1b6f15a81aae9220a07d3bab04641997))
* **repo:** enforce NODE_ENV=test and serialize packages/api test files ([015c8b2](https://github.com/F3-Nation/f3-nation/commit/015c8b253733f350193c29df0f70e9faa3e6599d))
* **shared:** update node version ([d048840](https://github.com/F3-Nation/f3-nation/commit/d048840651f7d83d06f20e472089bfcfb5b9fbb7))

## Changelog
