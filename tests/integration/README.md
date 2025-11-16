# Integration Test Suite for BigQuery MCP Server

## Overview

This directory contains comprehensive integration tests for the BigQuery MCP (Model Context Protocol) server. The tests validate multi-project support, dataset discovery, connection pooling, Workload Identity Federation authentication, and performance benchmarks.

## Test Files

### 1. `multi-project.test.ts`
Tests multi-project connection management and resource isolation.

**Coverage:**
- Connection initialization for multiple GCP projects
- Separate connection pools per project
- Concurrent operations across projects
- Resource management and isolation
- Cross-project queries
- Error handling and recovery
- Performance metrics per project

**Key Scenarios:**
- Initialize clients for multiple projects simultaneously
- Maintain independent connection pools with different configurations
- Execute concurrent queries across multiple projects
- Isolate failures between projects
- Handle graceful shutdown of individual projects
- Cross-project dataset access

### 2. `dataset-discovery.test.ts`
Tests automatic dataset and table discovery with metadata caching.

**Coverage:**
- Dataset enumeration across projects
- Table discovery and metadata retrieval
- Metadata caching with TTL
- LRU eviction strategies
- Cache invalidation patterns
- Auto-discovery mode
- Cross-project dataset discovery

**Key Scenarios:**
- List all datasets in a project
- Cache dataset listings for performance
- Discover table schemas and metadata
- Implement efficient LRU cache eviction
- Pattern-based cache invalidation
- Handle non-existent datasets gracefully

### 3. `connection-pool.test.ts`
Tests connection pooling behavior under various load conditions.

**Coverage:**
- Pool initialization with min/max connections
- Connection acquisition and release
- Concurrent request handling
- Request queueing when pool exhausted
- Health check mechanisms
- Idle connection cleanup
- Graceful shutdown

**Key Scenarios:**
- Initialize pool with minimum connections
- Handle concurrent acquisitions efficiently
- Queue requests when pool is at capacity
- Timeout acquisition requests appropriately
- Perform periodic health checks
- Remove unhealthy connections
- Clean up idle connections based on TTL
- Graceful shutdown with active connections

### 4. `wif-auth.test.ts`
Tests Workload Identity Federation authentication.

**Coverage:**
- WIF configuration and initialization
- OIDC token exchange for GCP access tokens
- Service account impersonation
- Token caching and expiration
- Multi-tenant scenarios
- Error handling for auth failures
- Security considerations

**Key Scenarios:**
- Exchange OIDC tokens for GCP access tokens
- Cache tokens to minimize API calls
- Respect token expiration times
- Impersonate service accounts
- Support multiple WIF instances for multi-tenancy
- Isolate token caches between tenants
- Handle authentication errors gracefully

### 5. `performance.test.ts`
Comprehensive performance benchmarks and stress tests.

**Coverage:**
- Query execution performance
- Connection pool efficiency
- Caching effectiveness
- Resource utilization
- Retry and error handling performance
- Throughput under sustained load

**Key Scenarios:**
- Execute simple queries within acceptable time limits
- Handle concurrent queries efficiently
- Maintain throughput under sustained load
- Optimize repeated queries with caching
- Acquire connections quickly
- Scale efficiently with concurrent connections
- Implement efficient cache eviction
- Measure cache hit rates
- Handle memory-intensive operations
- Cleanup resources efficiently

## Running Tests

### Run All Integration Tests
```bash
npm run test:integration
```

### Run Specific Test Suite
```bash
npm test tests/integration/multi-project.test.ts
npm test tests/integration/dataset-discovery.test.ts
npm test tests/integration/connection-pool.test.ts
npm test tests/integration/wif-auth.test.ts
npm test tests/integration/performance.test.ts
```

### Run with Coverage
```bash
npm run test:coverage
```

### Watch Mode
```bash
npm run test:watch
```

## Test Configuration

### Environment Variables
Create a `.env.test` file for test configuration:

```env
# GCP Project IDs for testing
TEST_PROJECT_ID=your-test-project
TEST_PROJECT_ID_SECONDARY=your-secondary-project

# Workload Identity Federation (optional)
WIF_POOL_ID=test-wif-pool
WIF_PROVIDER_ID=test-wif-provider
WIF_SERVICE_ACCOUNT=test-sa@project.iam.gserviceaccount.com

# Test Dataset (optional)
TEST_DATASET=test_dataset
TEST_TABLE=test_table

# Performance Test Settings
PERF_TEST_CONCURRENT_QUERIES=20
PERF_TEST_ITERATIONS=5
```

### Mock vs. Real BigQuery

By default, tests run against mock/stub implementations. To test against real BigQuery:

1. Set up GCP credentials:
```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

2. Configure test projects in `.env.test`

3. Run tests with real data flag:
```bash
USE_REAL_BIGQUERY=true npm run test:integration
```

## Test Patterns

### Event-Based Testing
Tests use event emitters to verify asynchronous operations:
```typescript
pool.once('connection:acquired', (data) => {
  expect(data).toHaveProperty('id');
  expect(data).toHaveProperty('acquireTimeMs');
});
```

### Metrics Validation
Tests validate system metrics for correctness:
```typescript
const metrics = client.getPoolMetrics();
expect(metrics.totalConnections).toBeLessThanOrEqual(maxConnections);
expect(metrics.activeConnections + metrics.idleConnections).toBe(metrics.totalConnections);
```

### Performance Benchmarking
Tests measure and validate performance:
```typescript
const start = Date.now();
await client.query({ query: 'SELECT 1' });
const duration = Date.now() - start;
expect(duration).toBeLessThan(2000); // 2 second SLA
```

### Error Scenario Testing
Tests verify graceful error handling:
```typescript
await expect(
  client.query({ query: 'INVALID SQL' })
).rejects.toThrow(/syntax error/i);

// System should remain healthy
expect(client.isHealthy()).toBe(true);
```

## Performance Targets

### Query Execution
- Simple query: < 2 seconds
- Concurrent queries (20): < 10 seconds total
- Average query time: < 1 second

### Connection Pool
- Connection acquisition: < 100ms average
- Pool initialization: < 2 seconds
- Graceful shutdown: < 30 seconds

### Caching
- Cache hit access: < 50ms
- Cache miss access: < 500ms
- LRU eviction overhead: negligible

### Resource Utilization
- Memory growth: stable under load
- Connection count: within configured limits
- Idle connection cleanup: within TTL + 10%

## Test Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

## Troubleshooting

### Tests Timing Out
- Increase Jest timeout: `jest.setTimeout(30000)`
- Check network connectivity
- Verify GCP credentials
- Review connection pool settings

### Authentication Errors
- Verify `GOOGLE_APPLICATION_CREDENTIALS` is set
- Check service account permissions
- Validate WIF configuration
- Ensure projects exist and are accessible

### Connection Pool Issues
- Adjust `maxConnections` for concurrent tests
- Increase `acquireTimeoutMs` if needed
- Check for connection leaks (not releasing)
- Monitor pool metrics during tests

### Flaky Tests
- Add appropriate delays for async operations
- Use event-based assertions instead of timeouts
- Mock external dependencies when possible
- Isolate tests with fresh instances

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always shutdown clients in `afterEach`/`afterAll`
3. **Determinism**: Avoid relying on external state
4. **Performance**: Use `dryRun: true` for fast tests
5. **Mocking**: Mock BigQuery API for unit-like tests
6. **Real Testing**: Periodically run against real BigQuery
7. **Metrics**: Always verify system metrics after operations
8. **Events**: Use event listeners to verify async behavior

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:integration
        env:
          TEST_PROJECT_ID: ${{ secrets.TEST_PROJECT_ID }}
```

### Pre-commit Hook
```bash
#!/bin/bash
npm run test:integration
if [ $? -ne 0 ]; then
  echo "Integration tests failed. Commit aborted."
  exit 1
fi
```

## Contributing

When adding new integration tests:

1. Follow existing test patterns
2. Add descriptive test names
3. Include both success and failure scenarios
4. Verify error handling and recovery
5. Add performance benchmarks if relevant
6. Update this README with new test coverage
7. Ensure tests pass in CI/CD

## Related Documentation

- [BigQuery Client Documentation](../../src/bigquery/README.md)
- [Connection Pool Architecture](../../docs/connection-pool.md)
- [Workload Identity Federation Guide](../../docs/wif-setup.md)
- [Performance Tuning](../../docs/performance.md)
