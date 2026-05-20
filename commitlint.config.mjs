/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'admin',
        'map',
        'me',

        // apps & packages (exist in both apps/ and packages/)
        'api',
        'auth',

        // packages
        'db',
        'env',
        'mail',
        'shared',
        'sso',
        'storage',
        'ui',
        'validators',

        // tooling
        'eslint',
        'prettier',
        'tsconfig',
        'scripts',
        'github',
        'tailwind',

        // cross-cutting
        'deps',
        'ci',
        'repo',
        'release',
      ],
    ],
    'scope-empty': [2, 'never'],
  },
  prompt: {
    settings: {
      enableMultipleScopes: true,
      scopeEnumSeparator: ',',
    },
  },
};
