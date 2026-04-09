/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'map',

        // apps & packages (exist in both apps/ and packages/)
        'api',
        'auth',

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
