import { globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

const eslintConfig = tseslint.config(
  // Next.js core-web-vitals config (includes React, a11y, TypeScript rules)
  ...nextVitals,

  // Global ignores
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Generated test artifacts — huge bundles that overflow the eslint
    // formatter (RangeError: Invalid string length) and are never source.
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
  ]),

  // Shared custom rules with explicit TypeScript plugin registration
  {
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // react-hooks/purity is overly strict — flags standard useState('') calls as impure
      'react-hooks/purity': 'off',
      'no-unused-expressions': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
    },
  },

  // Promote high-signal accessibility rules from warn → error so a11y
  // regressions fail CI instead of being ignorable warnings. The jsx-a11y
  // plugin itself is provided by eslint-config-next/core-web-vitals; here we
  // only raise severities. The codebase is currently clean of these.
  {
    files: ['**/*.tsx'],
    rules: {
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
    },
  },

  // Overrides for test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);

export default eslintConfig;
