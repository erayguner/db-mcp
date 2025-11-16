# 🧪 Local Testing Guide

## Quick Local Test Deployment

This guide shows how to test the MCP BigQuery Server locally without requiring GCP credentials.

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- No GCP credentials needed for basic testing

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Configure Local Environment

```bash
# Use the provided local config
cp .env.local .env
```

The local config uses mock mode for testing without real GCP access.

## Step 3: Build the Project

```bash
npm run build
```

Expected output:
```
✓ TypeScript compilation successful
✓ Output in dist/ directory
```

## Step 4: Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

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
./test-mcp-server.sh
```

This will:
- ✅ Build the TypeScript code
- ✅ Verify all MCP tools are available
- ✅ Show test results

### Manual Testing

```bash
# Start the server
node dist/index.js

# In another terminal, send MCP commands via stdin
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## MCP Best Practices Implemented

**Protocol Compliance**:
- ✅ **Stderr Logging**: All logs write to stderr (prevents JSON-RPC corruption)
- ✅ **Capabilities**: Server declares resources and tools capabilities
- ✅ **Graceful Shutdown**: SIGTERM/SIGINT handlers
- ✅ **Error Handling**: Structured error responses with `isError` flag
- ✅ **Schema Validation**: Zod schemas for all inputs

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

## Mock Mode

When `USE_MOCK_BIGQUERY=true` in your `.env` file:
- No real GCP credentials required
- Returns mock data for all queries
- Perfect for local development and testing

## Running with Real GCP Credentials

To test with actual BigQuery:

1. Install gcloud CLI
2. Authenticate: `gcloud auth application-default login`
3. Set `USE_MOCK_BIGQUERY=false` in `.env`
4. Update GCP_PROJECT_ID to your actual project
5. Run the server

## Debugging

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm run dev
```

### Check Build Output

```bash
ls -la dist/
```

Expected files:
- `index.js` - Main entry point
- `auth/` - Authentication modules
- `bigquery/` - BigQuery client
- `config/` - Configuration
- `utils/` - Utilities

### Common Issues

**Issue**: `Cannot find module`
**Solution**: Run `npm run build` again

**Issue**: `Permission denied`
**Solution**: `chmod +x test-mcp-server.sh`

**Issue**: TypeScript errors
**Solution**: Run `npm run typecheck` to see details

## CI/CD Testing

The GitHub Actions workflow automatically:
1. Installs dependencies
2. Runs linter
3. Runs type checking
4. Runs all tests
5. Builds Docker image

To test the CI/CD locally:

```bash
# Install act (GitHub Actions local runner)
brew install act  # macOS

# Run the workflow
act push
```

## Docker Testing

```bash
# Build image
docker build -t mcp-bigquery-server-test .

# Run container
docker run -p 8080:8080 --env-file .env.local mcp-bigquery-server-test

# Check logs
docker logs <container-id>
```

## Performance Testing

```bash
# Install k6
brew install k6  # macOS

# Run load test (if you create load-test.js)
k6 run tests/performance/load-test.js
```

## Test Coverage

Target: 90%+ coverage

```bash
npm test -- --coverage

# View coverage report
open coverage/lcov-report/index.html
```

## Next Steps

After local testing succeeds:
1. Test with real GCP credentials (optional)
2. Deploy to GCP (see `docs/wif-deployment-guide.md`)
3. Set up monitoring and alerts
4. Configure production environment

## Troubleshooting

### Server Won't Start

```bash
# Check for port conflicts
lsof -i :8080

# Kill existing process if needed
kill -9 <PID>
```

### TypeScript Errors

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### Test Failures

```bash
# Run specific test
npm test -- workload-identity.test.ts

# Run with verbose output
npm test -- --verbose
```

## Support

- Documentation: `/docs`
- Issues: Check build logs
- Help: See README.md

---

✅ **Local testing complete** - Ready for GCP deployment!
