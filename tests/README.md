# BigQuery MCP Server - Test Suite

Comprehensive test suite for the BigQuery MCP server with unit tests, integration tests, and performance benchmarks.

## Test Structure

```
tests/
├── unit/
│   ├── auth/
│   │   ├── oidc-authenticator.test.ts     # OIDC JWT validation
│   │   └── auth-middleware.test.ts         # Auth middleware
│   ├── tenancy/
│   │   ├── tenant-config.test.ts          # Tenant config schema
│   │   ├── tenant-registry.test.ts        # Tenant registry
│   │   ├── dataset-policy.test.ts         # Dataset access policy
│   │   └── tenant-context.test.ts         # Tenant context factory
│   ├── mcp/
│   │   ├── annotations.test.ts            # MCP tool annotations
│   │   ├── http-transport.test.ts         # HTTP transport config
│   │   ├── tool-handlers.test.ts          # Tool handler tests
│   │   └── ...
│   ├── bigquery-client.test.ts
│   ├── security-middleware.test.ts         # Includes per-tenant rate limiting
│   └── ...
├── integration/
│   ├── tenant-isolation.test.ts           # Multi-tenant isolation
│   ├── mcp-server.test.ts
│   └── ...
├── performance/             # Performance benchmarks
│   └── benchmarks.test.ts
├── fixtures/                # Test data and mocks
│   ├── datasets.ts
│   └── mocks.ts
├── setup.ts                 # Global test setup
├── jest.config.ts           # Jest configuration
└── README.md               # This file
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm test -- tests/unit
```

### Integration Tests Only
```bash
npm test -- tests/integration
```

### Performance Benchmarks
```bash
npm test -- tests/performance
```

### Watch Mode
```bash
npm test -- --watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Test Coverage Goals

- **Statements**: >80%
- **Branches**: >80%
- **Functions**: >80%
- **Lines**: >80%

## Test Categories

### Unit Tests

#### BigQuery Client (`unit/bigquery-client.test.ts`)
- Constructor and initialization
- Query execution
- Dry run cost estimation
- Dataset operations
- Table operations
- Schema retrieval
- Error handling
- Connection testing

#### Security Middleware (`unit/security-middleware.test.ts`)
- Rate limiting
- Prompt injection detection
- Input validation (SQL, dataset IDs, table IDs)
- Sensitive data detection and redaction
- Tool validation
- Security audit logging
- Request/response validation

#### OIDC Authentication (`auth/oidc-authenticator.test.ts`, `auth/auth-middleware.test.ts`)
- JWT signature validation against JWKS endpoint
- Issuer and audience claim verification
- Scope enforcement and missing scope errors
- Clock tolerance and token expiry handling
- Auth middleware bypass for unauthenticated tools
- Principal extraction from validated tokens

#### Multi-Tenant Isolation (`tenancy/`)
- Tenant config schema validation (`tenant-config.test.ts`)
- Tenant registry lookup and caching (`tenant-registry.test.ts`)
- Dataset access policy enforcement (`dataset-policy.test.ts`)
- Tenant context resolution from JWT claims (`tenant-context.test.ts`)
- OIDC subject pattern matching against `tenants.yaml`
- Default tenant fallback behavior

#### Dataset Policy (`tenancy/dataset-policy.test.ts`)
- Allowed and denied dataset access rules
- Per-tenant dataset isolation
- Policy evaluation order and precedence
- Error handling for unlisted datasets

#### Tool Annotations (`mcp/annotations.test.ts`)
- MCP tool metadata correctness
- Annotation schema compliance
- Required vs optional annotation fields

### Integration Tests

#### MCP Server (`mcp-server.test.ts`)
- Complete request/response flow
- Tool handler integration
- Security middleware integration
- Resource handlers
- Error propagation
- Performance under load

#### Multi-Tenant Isolation (`tenant-isolation.test.ts`)
- Cross-tenant data access prevention
- Per-tenant dataset policy enforcement end-to-end
- Tenant resolution through the full request pipeline
- Authentication to tenant binding verification

#### Security (`security.test.ts`)
- End-to-end request validation
- Multi-layer security enforcement
- Attack chain detection
- Rate limiting across requests
- Response data validation
- Audit trail verification

### Performance Tests

#### Benchmarks (`benchmarks.test.ts`)
- Query execution speed (<100ms simple queries)
- Batch query processing (100 queries <5s)
- Large result set handling (10k rows <1s)
- Security validation speed (<10ms per request)
- Concurrent operation handling
- Memory efficiency
- Rate limiter cleanup

## Writing Tests

### AAA Pattern (Arrange-Act-Assert)

```typescript
it('should do something', () => {
  // Arrange - Set up test data and mocks
  const input = 'test';
  const expected = 'result';

  // Act - Execute the code under test
  const result = functionUnderTest(input);

  // Assert - Verify the result
  expect(result).toBe(expected);
});
```

### Using Fixtures

```typescript
import { mockDatasets, mockQueryResults } from '../fixtures/datasets.js';
import { createMockBigQueryClient } from '../fixtures/mocks.js';

it('should use fixtures', async () => {
  const mockClient = createMockBigQueryClient();
  mockClient.getDatasets.mockResolvedValue([mockDatasets]);
  // ... test implementation
});
```

### Async Tests

```typescript
it('should handle async operations', async () => {
  // Arrange
  const promise = asyncFunction();

  // Act & Assert
  await expect(promise).resolves.toBe(expected);
});

it('should handle errors', async () => {
  await expect(asyncFunction()).rejects.toThrow('Error message');
});
```

### Performance Tests

```typescript
it('should execute within time limit', async () => {
  const startTime = performance.now();

  await performOperation();

  const duration = performance.now() - startTime;
  expect(duration).toBeLessThan(100); // <100ms

  console.log(`Operation took: ${duration.toFixed(2)}ms`);
});
```

## Mock Strategy

- **BigQuery Client**: Fully mocked using jest.mock()
- **Google Auth**: Mocked for local testing
- **Telemetry**: Mocked to avoid external dependencies
- **Timers**: Use jest.useFakeTimers() for time-dependent tests

## CI/CD Integration

Tests are configured to run in CI/CD pipelines with:
- Automatic test execution on PR
- Coverage reporting
- Performance regression detection
- Security vulnerability scanning

## Debugging Tests

### Run Single Test
```bash
npm test -- -t "test name"
```

### Debug Mode
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Verbose Output
```bash
npm test -- --verbose
```

## Performance Benchmarks

Current performance targets:

| Operation | Target | Current |
|-----------|--------|---------|
| Simple query | <100ms | ~50ms |
| 100 queries | <5s | ~2.5s |
| 10k rows | <1s | ~500ms |
| Security validation | <10ms | ~3ms |
| 1000 validations | <5s | ~2s |

## Best Practices

1. **Isolation**: Each test should be independent
2. **Clarity**: Test names should describe what they test
3. **Coverage**: Aim for edge cases and error paths
4. **Performance**: Keep tests fast (<1s per test)
5. **Mocking**: Mock external dependencies consistently
6. **Assertions**: Use specific assertions over generic ones
7. **Cleanup**: Always clean up in afterEach/afterAll

## Troubleshooting

### Tests Timing Out
- Increase timeout: `jest.setTimeout(10000)`
- Check for unresolved promises
- Verify mock implementations

### Flaky Tests
- Check for race conditions
- Use proper async/await
- Verify mock state cleanup

### Coverage Not Meeting Threshold
- Identify uncovered lines: `npm run test:coverage`
- Add tests for edge cases
- Test error handling paths

## Contributing

When adding new features:
1. Write tests first (TDD)
2. Ensure coverage remains >80%
3. Add integration tests for new workflows
4. Update this README if adding test categories
