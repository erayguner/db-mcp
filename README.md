# GCP BigQuery MCP Server

[![CI](https://github.com/erayguner/db-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/erayguner/db-mcp/actions/workflows/deploy.yml)
[![MegaLinter](https://github.com/erayguner/db-mcp/actions/workflows/megalinter.yml/badge.svg)](https://github.com/erayguner/db-mcp/actions/workflows/megalinter.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.29-purple)](https://modelcontextprotocol.io)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-v2-blueviolet)](https://opentelemetry.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Enterprise-grade MCP (Model Context Protocol) server for Google Cloud Platform BigQuery with **Workload Identity
Federation** authentication. Provides secure, keyless access to BigQuery through the Model Context Protocol.

## Key Features

- **Zero Service Account Keys** - 100% Workload Identity Federation
- **Google Workspace Integration** - OIDC user authentication
- **MCP Protocol Compliant** - Built on the official MCP SDK's `StreamableHTTPServerTransport` (stateless), 2025-11-25
  spec
- **Gemini Enterprise Ready** - OAuth 2.0 discovery (RFC 8414/9728), stateless Streamable HTTP transport
- **Resource Templates + Completions** - RFC 6570 URI templates for dataset/table/schema/sample/job/INFORMATION_SCHEMA,
  with `completion/complete` autocompletion of dataset/table IDs
- **Cost Elicitation Gate** - Per-query dry-run guardrail that surfaces high-cost confirmations to clients
- **Multi-tenant** - YAML allowlist + IAM Conditions on BigQuery datasets
- **Security Middleware** - Rate limiting, prompt injection detection, data redaction
- **Model Armor Pre-flight** - Optional content-safety screening before tool execution
- **Private Service Connect** - Optional private ingress for enterprise consumers
- **Customer-Managed Encryption** - CMEK for BigQuery datasets
- **Comprehensive Audit Logging** - 2555-day (7-year) retention via Cloud Logging log bucket with linked BigQuery
  dataset for compliance
- **Terraform Infrastructure** - Complete IaC for reproducible deployments
- **Cloud Run Deployment** - Serverless, auto-scaling architecture
- **OpenTelemetry** - Distributed tracing and per-tenant metrics

## Project Structure

```text
db-mcp/
├── src/                       # TypeScript source code
│   ├── auth/                  # WIF authentication modules
│   ├── bigquery/              # BigQuery client, discovery, optimization
│   ├── mcp/                   # MCP protocol handlers and tools
│   ├── security/              # Security middleware
│   ├── monitoring/            # Readiness probes and metrics
│   ├── telemetry/             # OpenTelemetry instrumentation
│   ├── config/                # Configuration management
│   └── utils/                 # Logging utilities
├── tests/                     # Unit, integration, and performance tests
├── terraform/                 # Infrastructure as Code
│   └── modules/               # Reusable Terraform modules
├── docs/                      # Documentation (Diátaxis: tutorials/how-to/reference/explanation)
├── scripts/                   # Deployment and utility scripts
├── examples/                  # Usage examples
├── .github/workflows/         # CI/CD automation
└── Dockerfile                 # Production container image
```

## Security Architecture

### Traditional Approach (Avoided)

- Service account keys stored in files/secrets
- Permanent credentials that never expire
- Manual key rotation required
- High risk of credential leakage

### Workload Identity Federation (Implemented)

- **No keys anywhere** in the system
- **1-hour token lifetime** with automatic rotation
- **Attribute-based access** for fine-grained control
- **Complete audit trail** for all access
- **90% reduction** in attack surface

## Quick Start

> **First time here?** [Tutorial 1](docs/tutorials/01-run-the-server-locally.md) walks you from a fresh clone to a
> working MCP conversation in about ten minutes, and needs **no Google Cloud account**.

### Prerequisites

- Node.js >= 22.0.0 — required for everything below
- GCP Project with billing enabled — only for querying real data
- Terraform >= 1.5.0 — only for deployment
- Docker — only for containerization

### Installation

```bash
# Clone and install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Build the project
npm run build
```

`GCP_PROJECT_ID` is the one required setting; the server exits with `Invalid environment configuration` without it. See
[environment variables](docs/reference/environment-variables.md) for the rest.

### Local Development

```bash
# Development mode with hot reload
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck
```

### Production Deployment

All production infrastructure — including the Cloud Run service — is managed by Terraform. Container images are stored
in Artifact Registry (`europe-west2-docker.pkg.dev`). Direct `gcloud run deploy` commands are not used in production.

```bash
# Build and push container image to Artifact Registry
docker build -t europe-west2-docker.pkg.dev/YOUR_PROJECT/db-mcp/mcp-bigquery-server:latest .
docker push europe-west2-docker.pkg.dev/YOUR_PROJECT/db-mcp/mcp-bigquery-server:latest

# Deploy infrastructure with Terraform (provisions Cloud Run + all supporting resources)
cd terraform
terraform init
terraform apply
```

## MCP Tools

The server provides these MCP tools:

| Tool               | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `query_bigquery`   | Run a GoogleSQL query and return the result rows                       |
| `execute_query`    | Deprecated alias for `query_bigquery`; retained for existing clients   |
| `list_datasets`    | List datasets the caller may access, with location and timestamps      |
| `list_tables`      | List tables in one dataset, with row counts and byte sizes where known |
| `get_table_schema` | Column names, types and modes for one table, plus optional metadata    |

Tool annotations are tenant-aware: `readOnlyHint` is `false` and `destructiveHint` `true` for the SQL-executing tools
when the tenant's write mode permits writes, since clients use `readOnlyHint` to auto-approve calls without prompting.

**Server Capabilities**:

- Resources: `bigquery://` URIs for datasets, tables, schemas, samples, jobs, and INFORMATION_SCHEMA
- Tools: Query execution and schema inspection, with a union output schema covering executed, dry-run, and
  cost-confirmation responses
- Prompts: 5 BigQuery-specific templates
- Logging: `logging/setLevel` plus `notifications/message` for security refusals
- Progress: `notifications/progress` when the client supplies a `_meta.progressToken`
- Stderr Logging: All logs to stderr (JSON-RPC compatible)
- Graceful Shutdown: SIGTERM/SIGINT handling

## Architecture

```text
Client Request
  ↓
MCP Protocol Layer (JSON-RPC)
  ↓
Security Middleware (rate limiting, injection detection)
  ↓
Workload Identity Federation
  ↓ (OIDC Token)
Identity Pool
  ↓ (Attribute Mapping)
Service Account Impersonation
  ↓ (1-hour access token)
BigQuery API
```

### Core Components

1. **Workload Identity Federation** - Identity pools for dev/staging/prod with OIDC providers
2. **Security Middleware** - Rate limiting, prompt injection detection, SQL injection prevention
3. **BigQuery Integration** - Connection pooling, query optimization, dataset discovery
4. **Monitoring** - Liveness/readiness probes, Prometheus `/metrics`, OpenTelemetry tracing, Cloud Monitoring

## Documentation

Documentation is organised with [Diátaxis](https://diataxis.fr/) — start with
**[the documentation index](docs/README.md)**, or go straight to the section that matches what you are doing:

| Section                             | For                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 📚 [Tutorials](docs/tutorials/)     | Learning the server by using it. Start at [Tutorial 1](docs/tutorials/01-run-the-server-locally.md) — 10 minutes, no GCP account. |
| 🔧 [How-to guides](docs/how-to/)    | Accomplishing a specific task: deploy, configure a tenant, mask columns, troubleshoot.                                            |
| 📖 [Reference](docs/reference/)     | Looking things up: tool schemas, environment variables, HTTP endpoints.                                                           |
| 💡 [Explanation](docs/explanation/) | Understanding the design: architecture, WIF, security model, trade-offs.                                                          |

Most-used pages:

| Document                                                                           | Description                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Tutorial 1 — Run the server locally](docs/tutorials/01-run-the-server-locally.md) | First contact: build it, start it, list its tools.         |
| [MCP tools reference](docs/reference/mcp-tools.md)                                 | Every tool's input schema, output shapes, and annotations. |
| [Environment variables](docs/reference/environment-variables.md)                   | Every variable, its default, and the ones read by nothing. |
| [Deploy with Terraform](docs/how-to/deploy-with-terraform.md)                      | Full production deployment.                                |
| [Register with Gemini Enterprise](docs/how-to/register-with-gemini-enterprise.md)  | Custom MCP connector registration runbook.                 |
| [Troubleshoot the server](docs/how-to/troubleshoot-the-server.md)                  | Startup, request, BigQuery and policy failures.            |
| [Architecture](docs/explanation/architecture/)                                     | System design, component documentation, ADRs.              |
| [MCP compliance matrix](docs/reference/mcp-compliance-matrix.md)                   | MCP 2025-11-25 spec coverage and gap implementations.      |

## Testing

```bash
# Run all tests — 69 suites, 891 tests, none skipped
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:bdd

# Performance suites, with timing budgets enforced
npm run test:performance

# Run with coverage (jest.config.mjs enforces coverageThreshold floors)
npm run test:coverage

# Watch mode
npm run test:watch
```

Timing-sensitive assertions are gated behind `PERF_TIMING_ASSERTIONS=true`, set only by `npm run test:performance`, so
ordinary runs measure timing budgets without enforcing them. See
[how to run the test suite](docs/how-to/run-the-test-suite.md) for the coverage floors.

## Development Commands

```bash
npm run build       # Build TypeScript
npm run dev         # Development with hot reload
npm run start       # Start production server
npm run lint        # Run ESLint
npm run lint:fix    # Fix linting issues
npm run format      # Format with Prettier
npm run typecheck   # TypeScript type checking
```

## CI/CD

GitHub Actions workflow automatically:

1. Runs tests on pull requests
2. Builds and pushes Docker image
3. Deploys to Cloud Run on main branch
4. Uses Workload Identity Federation (no keys)

## Monitoring

- **Cloud Monitoring**: Pre-configured dashboards with `tenant_id` dimension on `mcp.tool.calls.total` and
  `mcp.tool.call.duration`
- **Cloud Logging**: Structured JSON logs
- **Cloud Trace**: Distributed tracing via OpenTelemetry with `tenant.id` span attribute
- **Audit Logs**: 2555-day retention in Cloud Logging log bucket, linked to BigQuery for long-term analysis
- **Alerts**: Email/Slack notifications

## Compliance

- **GDPR**: Data residency and access logging
- **HIPAA**: Access controls and audit trails
- **SOC 2**: Identity management and monitoring
- **PCI-DSS**: Authentication and authorization

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

- Built with [MCP SDK](https://github.com/modelcontextprotocol)
- Powered by [Google Cloud BigQuery](https://cloud.google.com/bigquery)
- Infrastructure by [Terraform](https://www.terraform.io)

---

**Status**: Production Ready **Version**: 1.0.0 **Last Updated**: April 2026
