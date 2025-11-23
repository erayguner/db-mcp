module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
  },
  transform: {
    '^.+\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@modelcontextprotocol)/)',
  ],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'tests/integration/',
    'tests/bigquery/',
    'src/bigquery/__tests__/',
    'src/tests/bigquery/',
    'tests/unit/mcp/server-factory.test.ts',
    'tests/unit/mcp/integration.test.ts',
    'tests/unit/config.test.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 10,
      lines: 15,
      statements: 15,
    },
  },
};
