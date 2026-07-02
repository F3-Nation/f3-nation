# CHANGELOG

<!-- version list -->

## v1.13.0 (2026-06-06)

### Bug Fixes

- Making both inputs required on adding event tag
  ([`27d70da`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/27d70da96967e39a26e57be13fd9ea851a10e51f))

### Features

- Migrated SLT/positions to utilize the API
  ([`361b82e`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/361b82e9d29c43d48c779ee6ae60ef0ee3531054))

### Refactoring

- Added access control header to root path to better reflect status
  ([`be75f6a`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/be75f6a3d748c9cea86864a973959d8c05503495))


## v1.12.0 (2026-06-01)

### Features

- Added context to DR posts so DR users (with possible incorrect home region ids) can be identified
  ([`4126820`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/4126820d3384b7e88febe362aff1576f3cfb8b2c))


## v1.11.2 (2026-05-21)

### Bug Fixes

- Dropping a COQ from the preblast now actually removes them
  ([`0cfcd77`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/0cfcd77972ffff605c2be64540bba747475ce71c))

- Fixed backblast reminders only being sent for closed events
  ([`db813bc`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/db813bcd06c3318f4e079610dbb08ab7df62db4c))


## v1.11.1 (2026-05-20)

### Bug Fixes

- Hotfix for event instance and series forms only showing custom event types and tags
  ([`ec675ac`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/ec675ac58f535a625faaa80a7fbc4c16d045db01))


## v1.11.0 (2026-05-20)

### Bug Fixes

- Cleaned up bot logging messages a bit
  ([`5316f87`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/5316f873fe2611ac3bd857b771e4ba25a54bae5d))

- Fixed error on closing events
  ([`e7ea76a`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/e7ea76a1caf4207fad1a87d20b6c722e349d4436))

- Help response now has stats link that points to the correct user_id
  ([`ccc667d`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/ccc667da179ab4442297b10383ad4c75748e89d4))

### Features

- Added bot logging to Slack ([#211](https://github.com/F3-Nation/f3-nation-slack-bot/pull/211),
  [`bf36107`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/bf361078b31e3a3fc0941866f6d6559a0724c45e))

### Refactoring

- Added application and infrastructure modules to script container build
  ([`a9e00b0`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/a9e00b0e6b228f675e34380728021decfa508004))

- Beginning migration to our API (starting with event tags admin) and other refactorings
  ([`0f30861`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/0f30861ce2edffdf73936ffc2823d582a1d5132c))

- Fixing a production query issue on achievements
  ([`46a1d0a`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/46a1d0a9a0d62308a3ebd13942980ba11d9a3f56))

- Launching achievements in dark release
  ([`2c3d1be`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/2c3d1be9b6a0ef60195b995496c67cd15d35b401))

- Making manual achievement message more consistent with auto achievement
  ([`1d90891`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/1d908919f1d55dcaf790dcf9be2f9b2b929ab08f))

- Updated all dependencies and some additional paxminer cleanup
  ([`cf58eda`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/cf58eda984dde66b40d7bdb5fd115c7a0aec050c))


## v1.10.3 (2026-05-05)

### Bug Fixes

- Fixed users and channels not being tagged in backblast text
  ([`d631b8e`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/d631b8e7c1ae0c74a2203f6b415302cf3e659868))


## v1.10.2 (2026-05-02)


## v1.10.1 (2026-05-02)

### Bug Fixes

- Hotfix for backblast moleskin parsing preventing database save
  ([`504f76f`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/504f76fbbf14fcb4fce13bd25067c7249b7ee07b))


## v1.10.0 (2026-05-02)

### Features

- Added option to change OPEN color on calendar images (Calendar Settings -> General Calendar
  Settings)
  ([`73c0689`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/73c0689a2059cebec6ef5a0d26acf9c2736bea98))

- Added priority ordering of coloring logic
  ([`858b4a7`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/858b4a7c78734ec7ad331d7fb3a3158895f54fb4))

### Refactoring

- Removed handling of map update webhook as the API now has cascading
  ([`fa08c76`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/fa08c76c0b1fb39e7923c3a8fe6eb1febbc2ba1f))


## v1.9.0 (2026-04-30)

### Bug Fixes

- Fixing user mentions in moleskin of downrange cross posts
  ([`392486a`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/392486ae760c7e03fba970cf0c37d537a6e4fa68))

- Preventing invalid trigger error when a new position is added, and other SLT menu enhancements
  ([`0a6bc35`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/0a6bc35ca05c8bd47a04c03fa5cdee846b86ab62))

### Features

- Added boybands to automated downrange posts
  ([`8df4049`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/8df4049c270264eb1f700be3eedbfd99a743ab16))

- Added setting for when Q / preblast reminders go out to Qs
  ([`c076a6a`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/c076a6a6936d5c972ce4648ad8e29bde8618b660))


## v1.8.0 (2026-04-26)

### Features

- Added a missing backblast menu for admins and site Qs, accessible from the New Backblast selection
  screen
  ([`34a808c`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/34a808c666d867ed3b56a687381b117918723e7b))


## v1.7.0 (2026-04-24)

### Features

- Added a new `nearby special events` menu to see upcoming special events in nearby regions
  ([`92c6649`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/92c664913584bf7b1ed285cef720ffa89bc48f1e))


## v1.6.0 (2026-04-23)

### Documentation

- Added new snarky responses for HC and un-HC events; enhance welcome message templates
  ([#197](https://github.com/F3-Nation/f3-nation-slack-bot/pull/197),
  [`11a2172`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/11a2172659f047a3f07bda5b6940e0a3fcbb6507))

### Features

- Added option to only announce HCs or unHCs in preblast and preventing thread spamming
  ([`bd4e272`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/bd4e2722e4a51194a963abb228c0e943df41de32))


## v1.5.2 (2026-04-22)

### Bug Fixes

- Logic on when to run the home region nudge script
  ([`3c90e8e`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/3c90e8e1c8d4882639b070ef9f1a38c1ffaca773))


## v1.5.1 (2026-04-22)

### Bug Fixes

- Fixed divide by zero error on home region nudge script
  ([`ea10c90`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/ea10c90869cfc7640cc8dcdbc40a2845b1d8f47c))


## v1.5.0 (2026-04-21)

### Features

- Added script for nudging users about their home region when it looks like they joined a new one
  ([`cb2f798`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/cb2f798defc1017f4c90ab28568d67a84f855ecd))


## v1.4.2 (2026-04-21)

### Bug Fixes

- Fixed downrange region selector not working for non-admin
  ([`8d53263`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/8d53263423686e4765b5c2e95d43db531672aae9))


## v1.4.1 (2026-04-20)

### Bug Fixes

- Added direct email method and surfacing region contact info on downrange search
  ([`b411e93`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/b411e93e597c6787162e57ce041c5312f2113bbe))

- Fixed user mention and other formatting for downrange posts
  ([`e9dc680`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/e9dc68080bab2b54f70d6064d11c83d923a99ea9))


## v1.4.0 (2026-04-20)

### Bug Fixes

- Fixed query which was preventing preblast reminders from generating
  ([`0ed3404`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/0ed3404286ddf5f974b59d12ad5ce9bf8d4d52e6))

### Features

- Added a downrange feature for automated DR posts and requesting Slack space invites
  ([`a71008d`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/a71008d125ee9af8767e2ff2b15540d98360e16d))


## v1.3.0 (2026-04-18)

### Features

- Feat: added HC / unHC thread callout functionality
  ([`3b36a60`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/3b36a60a38b309773845cf5d98a875d90b5c13e0))


## v1.2.0 (2026-04-18)

### Features

- Added optional location to unscheduled backblast form
  ([`18bd74f`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/18bd74f8702523dbddcc2c17f48ee64bf2b7ab62))


## v1.1.1 (2026-04-15)

### Bug Fixes

- More cleanup
  ([`61e8bbe`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/61e8bbef6c31ac4b102a5b1a4da52977321f35f4))

- Removed leftover PaxMiner migration bits
  ([#192](https://github.com/F3-Nation/f3-nation-slack-bot/pull/192),
  [`f1d283a`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/f1d283a53d065f6f710f26637c33f63478590d31))

### Refactoring

- Removed all legacy paxminer functionality
  ([`61e8bbe`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/61e8bbef6c31ac4b102a5b1a4da52977321f35f4))


## v1.1.0 (2026-04-11)

### Bug Fixes

- Improved user search to sort by relevance and optionally include home region
  ([`adba213`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/adba2139c3a7cb818e863631685d88d7fd1431f7))

### Features

- Added new fields to user form: who brought you, f3 name origin story, and my f3why
  ([`b809f50`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/b809f50d50e0ec42c0fff2e95a8a2caf468c8abb))


## v1.0.3 (2026-04-10)

### Bug Fixes

- Fixed calendar list showing all regions' locations when group by location used
  ([#189](https://github.com/F3-Nation/f3-nation-slack-bot/pull/189),
  [`f8b69dc`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/f8b69dcc26520e93f5c863a5fa11198640cf418a))


## v1.0.2 (2026-04-08)

### Bug Fixes

- Added a better backblast error message for channel not found
  ([`fbc789f`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/fbc789faf298bbe62170e277a420b2b40827a27c))

- Addressed common IntegrityErrors from backblasts and HC calendar events
  ([`210e180`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/210e1806b9e3fc1489730f17d0d2d66cf20945fd))

- Fixed preblast send default behavior to 'send now' for day before event
  ([`12ccbb6`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/12ccbb657a70efa4c61ae4958dc90ca8eb318f35))

- Preventing re-deployment on staging when automerging back to main
  ([`f852377`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/f85237785a3214059fed6f234ff82a9264a6e7dc))


## v1.0.1 (2026-04-08)

### Bug Fixes

- Added CHANGELOG.md and version automation
  ([#188](https://github.com/F3-Nation/f3-nation-slack-bot/pull/188),
  [`7fa0b75`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/7fa0b756e23de1ba1371fb8e673aac8d31b4ba17))

- Removed poetry build step from release automation
  ([`fdddfcb`](https://github.com/F3-Nation/f3-nation-slack-bot/commit/fdddfcb94108a1789860379f7e6da00823e4d536))


## v1.0.0 (2026-04-08)

- Initial Release
