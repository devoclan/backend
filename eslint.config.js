// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

/**
 * Architecture boundary map. Mirrors ARCHITECTURE.md §1/§10: domain has zero
 * outward dependencies, application may only depend on its own module's
 * domain plus shared/blockchain, infrastructure implements domain ports,
 * interface only talks to its own module's application layer, and no module
 * may reach into another module's domain/infrastructure directly.
 */
const moduleElementTypes = [
  { type: 'domain', pattern: 'src/modules/*/domain/*' },
  { type: 'application', pattern: 'src/modules/*/application/*' },
  { type: 'infrastructure', pattern: 'src/modules/*/infrastructure/*' },
  { type: 'interface', pattern: 'src/modules/*/interface/*' },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        ...moduleElementTypes.map((el) => ({ ...el, capture: ['module'] })),
        { type: 'shared', pattern: 'src/shared/*' },
        { type: 'blockchain', pattern: 'src/blockchain/*' },
        { type: 'bootstrap', pattern: 'src/@(app|server).ts', mode: 'file' },
        { type: 'workers', pattern: 'src/workers/*' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'domain', allow: ['domain'] },
            { from: 'application', allow: ['domain', 'application', 'shared'] },
            {
              from: 'infrastructure',
              allow: ['domain', 'application', 'infrastructure', 'shared', 'blockchain'],
            },
            { from: 'interface', allow: ['application', 'domain', 'shared'] },
            {
              from: ['bootstrap', 'workers'],
              allow: [
                'shared',
                'blockchain',
                'domain',
                'application',
                'infrastructure',
                'interface',
              ],
            },
            { from: 'shared', allow: ['shared'] },
            { from: 'blockchain', allow: ['blockchain', 'shared'] },
          ],
        },
      ],
      'boundaries/no-private': ['error'],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
