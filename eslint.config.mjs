import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // New in ESLint 10 — disable for pre-existing code patterns
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '*.js',
      '*.cjs',
      'coverage/',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      'tests/**/*',
      'src/tests/**/*',
      'src/bigquery/__tests__/**',
      '__mocks__/**',
    ],
  }
);
