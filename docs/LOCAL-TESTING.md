# Local Testing Guide

## Quick Local Test Deployment

This guide shows how to test the MCP BigQuery Server locally without requiring GCP credentials.

## Prerequisites

- Node.js >= 22.0.0
- npm
- No GCP credentials needed for running tests

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Configure Local Environment

```bash
# Copy the local config (sets GCP_PROJECT_ID to a placeholder)
cp .env.local .env
```

## Step 3: Build the Project

```bash
npm run build
```

Output is written to `dist/`.

## Step 4: Run Tests

```bash
# Run all tests (68 suites, 871 tests, none skipped)
npm test

# Run unit tests only
npm run test:unit

# Integration and BDD feature suites
npm run test:integration
npm run test:bdd

# Performance suites, with timing budgets enforced
npm run test:performance

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

BigQuery is mocked through `jest.mock('@google-cloud/bigquery')` in `tests/setup.ts` plus `moduleNameMapper` entries —
there is no environment flag that switches mocking on or off.

### Timing assertions

Timing-sensitive assertions are gated behind `PERF_TIMING_ASSERTIONS=true`, which only `npm run test:performance` sets.
Under `npm test` the budgets are measured but not enforced, so ordinary runs are not flaky on a loaded machine. Setting
`PERF_TIMING_REPORT=true` writes measured timings to stderr.

## Step 5: Run the Server

```bash
# Development mode with hot reload
npm run dev

# Production build
npm start
```

**Note**: All logs write to **stderr** for MCP protocol compatibility. You'll see logs in your terminal, but they won't
interfere with the JSON-RPC messages on stdout.

## Step 6: Test MCP Tools

### Using the Test Script

```bash
./scripts/test-mcp-server.sh
```

This will:

- Build the TypeScript code
- Verify all MCP tools are available
- Show test results

### Manual Testing

```bash
# Start the server and send an MCP command
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## Running with HTTP Transport

For production-like local testing with the HTTP transport:

```bash
# Start server with HTTP transport
MCP_TRANSPORT=http MCP_HTTP_PORT=8080 npm run dev

# In another terminal — list tools
curl -s http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# List prompts
curl -s http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"prompts/list","params":{}}'

# List resources
curl -s http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}'

# Liveness — 200 while the process runs
curl -s http://localhost:8080/health

# Readiness — 503 with the failing dependency named if BigQuery is unreachable
curl -si http://localhost:8080/readiness

# Prometheus metrics — text exposition format
curl -s http://localhost:8080/metrics

# GET /mcp returns 405: the transport is stateless, with no standalone SSE channel
curl -si http://localhost:8080/mcp
```

> JSON-RPC request batching was removed from the MCP spec in revision 2025-06-18. The SDK transport rejects batch
> arrays, so send one request per call.

## MCP Protocol Compliance

See [MCP-COMPLIANCE.md](./MCP-COMPLIANCE.md) for the full compliance matrix.

**Capabilities declared at connection init**:

- **Tools**: 5 BigQuery tools (query, its deprecated alias, list datasets, list tables, get schema)
- **Resources**: Browse datasets, tables, schemas, samples, jobs, and INFORMATION_SCHEMA via `bigquery://` URIs
- **Prompts**: 5 BigQuery-specific prompt templates
- **Logging**: `logging/setLevel` plus `notifications/message` for security refusals
- **Completions**: `completion/complete` for dataset and table IDs

**Transport options**:

- `stdio` (default) — for local Claude/MCP client integration
- `http` — stateless Streamable HTTP for production (Cloud Run); POST `/mcp` only, no standalone SSE channel

**Security**:

- OIDC authentication with JWT verification
- Per-tenant dataset authorization (SQL-level enforcement)
- Rate limiting, prompt injection detection
- Column-level data masking
- Behavioral anomaly detection
- Comprehensive audit logging

**Resilience**:

- Circuit breaker with stale cache fallback
- Connection pooling with health checks
- Graceful shutdown with drain period

## Available MCP Capabilities

### Tools (5)

| Tool               | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `query_bigquery`   | Execute SQL on BigQuery (supports dryRun, maxResults, timeout) |
| `execute_query`    | Deprecated alias for `query_bigquery`                          |
| `list_datasets`    | List all accessible BigQuery datasets                          |
| `list_tables`      | List tables in a dataset                                       |
| `get_table_schema` | Get schema and metadata for a table                            |

### Resources (browsable via `bigquery://` URIs)

| URI Pattern                                                 | Description                       |
| ----------------------------------------------------------- | --------------------------------- |
| `bigquery://datasets`                                       | Catalog of all datasets           |
| `bigquery://datasets/{datasetId}`                           | Dataset detail with table listing |
| `bigquery://datasets/{datasetId}/tables/{tableId}`          | Full table metadata               |
| `bigquery://datasets/{datasetId}/tables/{tableId}/schema`   | Schema-only view                  |
| `bigquery://datasets/{datasetId}/tables/{tableId}/sample`   | Up to 10 preview rows (masked)    |
| `bigquery://jobs/{jobId}`                                   | Job metadata — no result rows     |
| `bigquery://datasets/{datasetId}/information_schema/{view}` | INFORMATION_SCHEMA browse         |

### Prompts (5 AI guidance templates)

| Prompt               | Required Args          | Description                         |
| -------------------- | ---------------------- | ----------------------------------- |
| `analyze_table`      | `datasetId`, `tableId` | Schema analysis + query suggestions |
| `explore_dataset`    | `datasetId`            | Dataset exploration workflow        |
| `write_query`        | `description`          | Natural language to SQL             |
| `optimize_query`     | `query`                | Cost/performance optimization       |
| `data_quality_check` | `datasetId`, `tableId` | Data quality analysis               |

## Running with Real GCP Credentials

To test with actual BigQuery:

1. Install gcloud CLI
2. Authenticate: `gcloud auth application-default login`
3. Update `GCP_PROJECT_ID` in `.env` to your actual project
4. Run the server

## Debugging

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm run dev
```

### Check Build Output

```bash
ls -la dist/
```

Expected directories:

- `index.js` — Main entry point
- `auth/` — Authentication (OIDC, WIF, audit logger)
- `bigquery/` — BigQuery client, connection pool, query cache, graceful degradation
- `config/` — Environment and tenant configuration
- `mcp/` — MCP server factory, handlers (tools, prompts, progress), schemas, resources, tools, transports
- `security/` — Security middleware, anomaly detection, column masking
- `tenancy/` — Multi-tenant config, registry, dataset policies, context
- `telemetry/` — OpenTelemetry tracing and metrics
- `monitoring/` — Readiness registry, effectiveness metrics
- `utils/` — Logger

### Common Issues

**Issue**: `Cannot find module` **Solution**: Run `npm run build` again

**Issue**: `Permission denied` on test script **Solution**: `chmod +x scripts/test-mcp-server.sh`

**Issue**: TypeScript errors **Solution**: Run `npm run typecheck` to see details

## CI/CD Testing

The GitHub Actions workflow automatically:

1. Installs dependencies
2. Runs linter, type checking, and tests in parallel
3. Builds Docker image
4. Runs Trivy security scan

## Docker Testing

```bash
# Build image
docker build -t mcp-bigquery-server .

# Run container
docker run -p 8080:8080 --env-file .env.local mcp-bigquery-server

# Check logs
docker logs <container-id>
```

## Test Coverage

```bash
npm run test:coverage

# View coverage report
open coverage/lcov-report/index.html
```

`jest.config.mjs` enforces `coverageThreshold` floors, so a coverage regression fails the run:

| Scope               | Statements | Branches | Functions | Lines |
| ------------------- | ---------- | -------- | --------- | ----- |
| `./src/bigquery/`   | 80         | 63       | 82        | 80    |
| `./src/governance/` | 80         | 67       | 80        | 82    |
| `./src/tenancy/`    | 72         | 74       | 70        | 70    |
| Everything else     | 38         | 31       | 41        | 39    |

> Jest excludes path-keyed groups from the `global` group, so the last row is **not** a repo-wide floor — it applies
> only to files outside the three directories listed above. Raise the floors as coverage improves; they are ratchets,
> not targets.

## Next Steps

After local testing succeeds:

1. Review MCP protocol compliance: [MCP-COMPLIANCE.md](./MCP-COMPLIANCE.md)
2. Deploy to GCP: [wif-deployment-guide.md](./wif-deployment-guide.md)
3. Set up monitoring: [MONITORING-GUIDE.md](./MONITORING-GUIDE.md)
4. Configure tenant policies and column masking: `src/config/tenants.yaml`
