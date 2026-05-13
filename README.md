# GCP BigQuery MCP Server

[![CI](https://github.com/erayguner/db-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/erayguner/db-mcp/actions/workflows/deploy.yml)
[![MegaLinter](https://github.com/erayguner/db-mcp/actions/workflows/megalinter.yml/badge.svg)](https://github.com/erayguner/db-mcp/actions/workflows/megalinter.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.29-purple)](https://modelcontextprotocol.io)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-v2-blueviolet)](https://opentelemetry.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Enterprise-grade MCP (Model Context Protocol) server for Google Cloud Platform BigQuery with **Workload Identity Federation** authentication. Provides secure, keyless access to BigQuery through the Model Context Protocol.

## Key Features

- **Zero Service Account Keys** - 100% Workload Identity Federation
- **Google Workspace Integration** - OIDC user authentication
- **MCP Protocol Compliant** - Follows official MCP SDK best practices (2025-06-18 spec)
- **Gemini Enterprise Ready** - OAuth 2.0 discovery (RFC 8414/9728), strict Streamable HTTP transport
- **Resource Templates** - RFC 6570 URI templates for dataset/table/schema/sample/job/INFORMATION_SCHEMA
- **Cost Elicitation Gate** - Per-query dry-run guardrail that surfaces high-cost confirmations to clients
- **Multi-tenant** - YAML allowlist + IAM Conditions on BigQuery datasets
- **Security Middleware** - Rate limiting, prompt injection detection, data redaction
- **Model Armor Pre-flight** - Optional content-safety screening before tool execution
- **Private Service Connect** - Optional private ingress for enterprise consumers
- **Customer-Managed Encryption** - CMEK for BigQuery datasets
- **Comprehensive Audit Logging** - 7-year retention for compliance
- **Terraform Infrastructure** - Complete IaC for reproducible deployments
- **Cloud Run Deployment** - Serverless, auto-scaling architecture
- **OpenTelemetry** - Distributed tracing and per-tenant metrics

## Project Structure

```
db-mcp/
├── src/                       # TypeScript source code
│   ├── auth/                  # WIF authentication modules
│   ├── bigquery/              # BigQuery client, discovery, optimization
│   ├── mcp/                   # MCP protocol handlers and tools
│   ├── security/              # Security middleware
│   ├── monitoring/            # Health checks and monitoring
│   ├── telemetry/             # OpenTelemetry instrumentation
│   ├── config/                # Configuration management
│   └── utils/                 # Logging utilities
├── tests/                     # Unit, integration, and performance tests
├── terraform/                 # Infrastructure as Code
│   └── modules/               # Reusable Terraform modules
├── docs/                      # Comprehensive documentation
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

### Prerequisites

- GCP Project with billing enabled
- Terraform >= 1.5.0
- Node.js >= 22.0.0
- Docker (for containerization)

### Installation

```bash
# Clone and install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Build the project
npm run build
```

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

```bash
# Build Docker image
docker build -t mcp-bigquery-server .

# Deploy infrastructure with Terraform
cd terraform
terraform init
terraform apply

# Deploy to Cloud Run
gcloud run deploy mcp-bigquery-server \
  --image gcr.io/YOUR_PROJECT/mcp-bigquery-server \
  --region us-central1
```

## MCP Tools

The server provides these MCP tools:

| Tool | Description |
|------|-------------|
| `query_bigquery` | Execute SQL queries on BigQuery datasets |
| `list_datasets` | List all available BigQuery datasets |
| `list_tables` | List tables in a specific dataset |
| `get_table_schema` | Get schema information for a table |

**Server Capabilities**:
- Resources: BigQuery datasets listing
- Tools: Query execution and schema inspection
- Stderr Logging: All logs to stderr (JSON-RPC compatible)
- Graceful Shutdown: SIGTERM/SIGINT handling

## Architecture

```
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
4. **Monitoring** - Health checks, OpenTelemetry tracing, Cloud Monitoring integration

## Documentation

| Document | Description |
|----------|-------------|
| [Usage Guide](docs/USAGE-GUIDE.md) | Complete guide for local dev, testing, and production |
| [Gemini Enterprise Deployment](docs/GEMINI-ENTERPRISE-DEPLOYMENT.md) | Runbook for registering as a Gemini Enterprise custom MCP connector |
| [MCP Compliance](docs/MCP-COMPLIANCE.md) | MCP 2025-06-18 spec compliance matrix and gap implementations |
| [Architecture](docs/architecture/) | System design and component documentation |
| [Security](docs/SECURITY.md) | Security middleware and best practices |
| [WIF Guide](docs/wif-architecture.md) | Workload Identity Federation details |
| [Deployment](docs/wif-deployment-guide.md) | Full production deployment guide |
| [Docker](docs/DOCKER-DEPLOYMENT.md) | Container configuration |
| [Monitoring](docs/MONITORING-GUIDE.md) | Observability setup |
| [Documentation Index](docs/README.md) | Complete documentation map |

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:performance

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

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

- **Cloud Monitoring**: Pre-configured dashboards with `tenant_id` dimension on `mcp.tool.calls.total` and `mcp.tool.call.duration`
- **Cloud Logging**: Structured JSON logs
- **Cloud Trace**: Distributed tracing via OpenTelemetry with `tenant.id` span attribute
- **Audit Logs**: 7-year retention in BigQuery
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

**Status**: Production Ready
**Version**: 1.0.0
**Last Updated**: April 2026
