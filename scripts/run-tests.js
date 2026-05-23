import { runCLI } from 'jest';
import path from 'path';
import fs from 'fs';

async function main() {
  const rootDir = process.cwd();
  const config = {
    roots: [path.join(rootDir, 'src'), path.join(rootDir, 'tests')],
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    setupFilesAfterEnv: [path.join(rootDir, 'tests', 'setup.ts')],
    testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    transform: {
      '^.+\\.tsx?$': ['ts-jest', { useESM: true, diagnostics: false }],
    },
    verbose: true,
    collectCoverageFrom: [
      'src/**/*.ts',
      '!src/**/*.d.ts',
      '!src/**/__tests__/**',
      '!src/**/*.test.ts',
      '!src/**/*.spec.ts',
    ],
  };

  try {
    const { results } = await runCLI(
      {
        // Run all tests; could narrow with testPathPattern
        json: true,
        runInBand: true,
        // Output JSON to file we can read
        outputFile: path.join(rootDir, 'programmatic-jest-results.json'),
        config: JSON.stringify(config),
      },
      [rootDir]
    );

    const summary = {
      success: results.success,
      numTotalTests: results.numTotalTests,
      numPassedTests: results.numPassedTests,
      numFailedTests: results.numFailedTests,
      numPendingTests: results.numPendingTests,
      numTodoTests: results.numTodoTests,
      startTime: results.startTime,
      endTime: Date.now(),
      testResults: results.testResults.map((tr) => ({
        name: tr.testFilePath,
        status: tr.status,
        assertionResults: tr.assertionResults.map((a) => ({ title: a.title, status: a.status })),
      })),
    };

    fs.writeFileSync(
      path.join(rootDir, 'programmatic-jest-summary.json'),
      JSON.stringify(summary, null, 2)
    );
  } catch (err) {
    fs.writeFileSync(path.join(rootDir, 'programmatic-jest-error.log'), String(err.stack || err));
    process.exitCode = 1;
  }
}

await main();
