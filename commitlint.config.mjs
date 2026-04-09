/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'api',
        'auth',
        'map',

        // packages
        'db',
        'env',
        'mail',
        'shared',
        'sso',
        'ui',
        'validators',

        // tooling
        'eslint',
        'prettier',
        'tsconfig',
        'scripts',
        'github',

        // cross-cutting
        'deps',
        'ci',
        'repo',
        'release',
      ],
    ],
    'scope-empty': [2, 'never'],
  },
};
