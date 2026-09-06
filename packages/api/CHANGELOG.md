# Changelog

## [0.7.1](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.7.0...pkg-api@0.7.1) (2026-09-06)


### Bug Fixes

* **api:** stop crupdate resetting isActive/highlight/isPrivate on partial updates ([#900](https://github.com/F3-Nation/f3-nation/issues/900)) ([f89b7f7](https://github.com/F3-Nation/f3-nation/commit/f89b7f7e8c0ccb3341ee98c644d7d98836180a4a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.2.3
    * @acme/db bumped to 0.5.0
    * @acme/validators bumped to 0.3.2

## [0.7.0](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.6.0...pkg-api@0.7.0) (2026-08-18)


### Features

* **auth:** issue an id_token on the authorization_code and refresh_token grants ([#749](https://github.com/F3-Nation/f3-nation/issues/749)) ([0a8a25d](https://github.com/F3-Nation/f3-nation/commit/0a8a25d635d618383d57669eff4415b32b6e3fef))


### Bug Fixes

* **api:** raise per-IP rate limit to 500 ([#850](https://github.com/F3-Nation/f3-nation/issues/850)) ([b8e320a](https://github.com/F3-Nation/f3-nation/commit/b8e320a30a6be2f8f79c912a6ae3cf3dedf86c91))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.2.2
    * @acme/db bumped to 0.4.1
    * @acme/validators bumped to 0.3.1

## [0.6.0](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.5.0...pkg-api@0.6.0) (2026-08-12)


### Features

* **health:** add /status to homepage and introduce shared package for reporting ([#657](https://github.com/F3-Nation/f3-nation/issues/657)) ([88e7547](https://github.com/F3-Nation/f3-nation/commit/88e754751e25461e25c7361c878c78e3902daad4))
* **map:** add start date column to workouts table ([#807](https://github.com/F3-Nation/f3-nation/issues/807)) ([c49b48d](https://github.com/F3-Nation/f3-nation/commit/c49b48d6131e13454425d3ce0660e02093bba175))


### Bug Fixes

* **api:** require editor on current org when editing a position ([#814](https://github.com/F3-Nation/f3-nation/issues/814)) ([af7719a](https://github.com/F3-Nation/f3-nation/commit/af7719adac2934f20eee01b36bbd3d572f2d26a6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.2.1
    * @acme/db bumped to 0.4.0
    * @acme/validators bumped to 0.3.0
    * @f3nation/health bumped to 1.1.0

## [0.5.0](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.4.1...pkg-api@0.5.0) (2026-08-05)


### Features

* **api:** adding routes for slack settings and channels ([#693](https://github.com/F3-Nation/f3-nation/issues/693)) ([d6d43e4](https://github.com/F3-Nation/f3-nation/commit/d6d43e47503cf7d65cfcae4b5c6877d5f1a994a8))
* **api:** allow non-editor api users to query attendance on events ([#801](https://github.com/F3-Nation/f3-nation/issues/801)) ([dc5f8ad](https://github.com/F3-Nation/f3-nation/commit/dc5f8ad2979a6e15af3f02948ddf8e7f8e7597e2))
* **api:** implement structured error handling with ORPCError ([#702](https://github.com/F3-Nation/f3-nation/issues/702)) ([ff9beea](https://github.com/F3-Nation/f3-nation/commit/ff9beea4931152001d21bc7dbf7c835f75d4a123))


### Bug Fixes

* **api:** hasPreblast on calendar-home-schedule checks the wrong column ([#695](https://github.com/F3-Nation/f3-nation/issues/695)) ([68a485c](https://github.com/F3-Nation/f3-nation/commit/68a485c2cdcfc82e2fb2dcab0b9029d99bf44517))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.2.0
    * @acme/db bumped to 0.3.0
    * @acme/validators bumped to 0.2.1

## [0.4.1](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.4.0...pkg-api@0.4.1) (2026-07-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.1.5
    * @acme/db bumped to 0.2.0
    * @acme/validators bumped to 0.2.0

## [0.4.0](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.3.1...pkg-api@0.4.0) (2026-07-23)


### Features

* **slackbot, api:** preblast feature refactor + some extras ([#599](https://github.com/F3-Nation/f3-nation/issues/599)) ([f5766df](https://github.com/F3-Nation/f3-nation/commit/f5766dfc3972759a3641221d8cadaca916a911b4))

## [0.3.1](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.3.0...pkg-api@0.3.1) (2026-07-14)


### Bug Fixes

* **api,me:** require filters and cap results on me.users ([#662](https://github.com/F3-Nation/f3-nation/issues/662)) ([70375fc](https://github.com/F3-Nation/f3-nation/commit/70375fc0b396b9f8f0aefd74b407a4ba9aae3b7f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.1.4
    * @acme/db bumped to 0.1.3
    * @acme/shared bumped to 0.1.3
    * @acme/validators bumped to 0.1.3

## [0.3.0](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.2.1...pkg-api@0.3.0) (2026-07-08)


### Features

* **api:** adding slack messaging API routes ([#542](https://github.com/F3-Nation/f3-nation/issues/542)) ([951e126](https://github.com/F3-Nation/f3-nation/commit/951e12600a4a49d6c0cc87e30c9648a227f777f1))


### Bug Fixes

* **deps:** pin internal @acme/* refs to workspace:* to prevent release-please version drift ([#587](https://github.com/F3-Nation/f3-nation/issues/587)) ([21ded4b](https://github.com/F3-Nation/f3-nation/commit/21ded4bef25dbdd00b2e66e5d8abda516b7dd0b1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.1.3
    * @acme/db bumped to 0.1.2
    * @acme/env bumped to 0.1.2
    * @acme/mail bumped to 0.1.2
    * @acme/shared bumped to 0.1.2
    * @acme/storage bumped to 0.2.2
    * @acme/validators bumped to 0.1.2

## [0.2.1](https://github.com/F3-Nation/f3-nation/compare/pkg-api@0.2.0...pkg-api@0.2.1) (2026-07-05)


### Bug Fixes

* **map,admin:** regions in region picker were grayed out ([37cec72](https://github.com/F3-Nation/f3-nation/commit/37cec722b933f6a121283403b3a5eb9fd8900f5e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @acme/auth bumped to 0.1.2
    * @acme/db bumped to 0.1.1
    * @acme/env bumped to 0.1.1
    * @acme/logger bumped to 0.1.1
    * @acme/mail bumped to 0.1.1
    * @acme/shared bumped to 0.1.1
    * @acme/storage bumped to 0.2.1
    * @acme/validators bumped to 0.1.1
