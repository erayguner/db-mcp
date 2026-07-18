export default {
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  clearMocks: true,
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^(\\.{1,2}/.*)\\.ts$': '$1',
    '^../../src/(.*)\\.js$': '<rootDir>/src/$1.ts',
    '^../../../src/(.*)\\.js$': '<rootDir>/src/$1.ts',
    '^../../src/(.*)$': '<rootDir>/src/$1',
    '^../../../src/(.*)$': '<rootDir>/src/$1',
    '^@modelcontextprotocol/sdk/server/index$':
      '<rootDir>/__mocks__/@modelcontextprotocol/sdk/server/index.js',
    '^@modelcontextprotocol/sdk/server/stdio$':
      '<rootDir>/__mocks__/@modelcontextprotocol/sdk/server/stdio.js',
    '^../../src/telemetry/(.*)$': '<rootDir>/src/telemetry/$1.ts',
    '^../../../src/bigquery/client$': '<rootDir>/__mocks__/src/bigquery/client.js',
    '^../../src/bigquery/client$': '<rootDir>/__mocks__/src/bigquery/client.js',
  },
  moduleDirectories: ['node_modules', '<rootDir>', '<rootDir>/src', '<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        diagnostics: false,
        tsconfig: {
          module: 'ES2022',
          moduleResolution: 'bundler',
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@modelcontextprotocol)/)'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  /**
   * Coverage floors.
   *
   * 20 suites (439 tests) sat disabled for months while CI reported green,
   * because coverage was uploaded but never enforced. These thresholds are set
   * just below current measured coverage so the build fails if it regresses —
   * ratchet them upward as coverage improves, never downward to go green.
   *
   * Note Jest excludes any path-keyed group below from the `global` group, so
   * `global` here does NOT mean whole-repo — it covers only the files outside
   * `src/bigquery/`, `src/tenancy/` and `src/governance/`. Its floors are set
   * against that subset, which measured markedly lower than the repo as a whole
   * (the repo overall sits in the low-60s for statements, up from 27%).
   */
  coverageThreshold: {
    global: {
      statements: 38,
      branches: 31,
      functions: 41,
      lines: 39,
    },
    // The core query path regressed to ~1% once before. Hold it high.
    './src/bigquery/': {
      statements: 80,
      branches: 63,
      functions: 82,
      lines: 80,
    },
    './src/tenancy/': {
      statements: 72,
      branches: 74,
      functions: 70,
      lines: 70,
    },
    './src/governance/': {
      statements: 80,
      branches: 67,
      functions: 80,
      lines: 82,
    },
  },
  verbose: true,
};
