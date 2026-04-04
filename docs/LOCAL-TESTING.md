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
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Step 5: Run the Server

```bash
# Development mode with hot reload
npm run dev

# Production build
npm start
```

**Note**: All logs write to **stderr** for MCP protocol compatibility. You'll see logs in your terminal, but they won't interfere with the JSON-RPC messages on stdout.

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

## MCP Best Practices Implemented

**Protocol Compliance**:
- **Stderr Logging**: All logs write to stderr (prevents JSON-RPC corruption)
- **Capabilities**: Server declares resources and tools capabilities
- **Graceful Shutdown**: SIGTERM/SIGINT handlers
- **Error Handling**: Structured error responses with `isError` flag
- **Schema Validation**: Zod schemas for all inputs

## Available MCP Tools for Testing

1. **query_bigquery**
   ```json
   {
     "name": "query_bigquery",
     "arguments": {
       "query": "SELECT * FROM dataset.table LIMIT 10",
       "dryRun": false
     }
   }
   ```

2. **list_datasets**
   ```json
   {
     "name": "list_datasets",
     "arguments": {}
   }
   ```

3. **list_tables**
   ```json
   {
     "name": "list_tables",
     "arguments": {
       "datasetId": "analytics_dev"
     }
   }
   ```

4. **get_table_schema**
   ```json
   {
     "name": "get_table_schema",
     "arguments": {
       "datasetId": "analytics_dev",
       "tableId": "users"
     }
   }
   ```

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
- `index.js` - Main entry point
- `auth/` - Authentication modules
- `bigquery/` - BigQuery client
- `config/` - Configuration
- `mcp/` - MCP server, handlers, schemas
- `security/` - Security middleware
- `tenancy/` - Multi-tenant components
- `telemetry/` - OpenTelemetry instrumentation
- `monitoring/` - Health monitoring
- `utils/` - Utilities

### Common Issues

**Issue**: `Cannot find module`
**Solution**: Run `npm run build` again

**Issue**: `Permission denied` on test script
**Solution**: `chmod +x scripts/test-mcp-server.sh`

**Issue**: TypeScript errors
**Solution**: Run `npm run typecheck` to see details

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

Target: 80%+ across statements, branches, functions, and lines.

```bash
npm run test:coverage

# View coverage report
open coverage/lcov-report/index.html
```

## Next Steps

After local testing succeeds:
1. Deploy to GCP (see `docs/wif-deployment-guide.md`)
2. Set up monitoring and alerts (see `docs/MONITORING-GUIDE.md`)
3. Configure tenant policies (see `src/config/tenants.yaml`)
