import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const webLayers = [
  { type: 'app', pattern: 'apps/web/src/app' },
  { type: 'feature', pattern: 'apps/web/src/features/*', capture: ['name'] },
  { type: 'data', pattern: 'apps/web/src/data' },
  { type: 'i18n', pattern: 'apps/web/src/i18n' },
  { type: 'shared', pattern: 'apps/web/src/shared' },
];

const layer = (type) => ({ element: { type } });

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/src/data/api.gen.ts',
      'apps/web/public/**',
      'apps/api/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Nest resolves injected classes from emitted decorator metadata, so they must be value imports.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh, boundaries },
    settings: {
      'boundaries/elements': webLayers,
      'import/resolver': { typescript: { project: 'apps/web/tsconfig.json' } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: layer('app'),
              allow: { to: [layer('app'), layer('data'), layer('i18n'), layer('shared')] },
            },
            {
              from: layer('app'),
              allow: { to: { element: { type: 'feature', fileInternalPath: 'index.{ts,tsx}' } } },
            },
            {
              from: layer('feature'),
              allow: { to: [layer('data'), layer('i18n'), layer('shared')] },
            },
            {
              from: layer('feature'),
              allow: {
                to: {
                  element: {
                    type: 'feature',
                    captured: { name: '{{from.element.captured.name}}' },
                  },
                },
              },
            },
            {
              from: layer('feature'),
              allow: { to: { element: { type: 'feature', fileInternalPath: 'index.{ts,tsx}' } } },
            },
            { from: layer('data'), allow: { to: [layer('data'), layer('shared')] } },
            { from: layer('i18n'), allow: { to: [layer('i18n'), layer('shared')] } },
            { from: layer('shared'), allow: { to: layer('shared') } },
          ],
        },
      ],
    },
  },
  {
    // Default categories carry no stored name; only the ledger module turns keys into names.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/features/ledger/**', 'apps/web/src/data/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@data/sync',
              importNames: ['useCategories'],
              message: 'Use useCategoryViews from @features/ledger: it localizes default names.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/\\p{L}{2}/u]',
          message: 'Put user-visible text in the i18n catalogs.',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder|alt)$/] :matches(JSXAttribute > Literal, JSXExpressionContainer > Literal)[value=/\\p{L}{2}/u]',
          message: 'Put user-visible text in the i18n catalogs.',
        },
      ],
    },
  },
  {
    // Playwright fixtures destructure their dependencies (even none) and receive a `use` callback.
    files: ['apps/web/e2e/**/*.ts'],
    rules: { 'no-empty-pattern': 'off', 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    // Per-layout screens are presentation only: logic and data access live in the feature's hooks.
    files: ['apps/web/src/features/{transactions,dashboard}/layouts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@data/*', '@tanstack/*'], message: 'Use the feature hooks.' }] },
      ],
    },
  },
  {
    files: ['apps/web/src/shared/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
