# MCP BigQuery Server Documentation

## Overview

This directory contains comprehensive documentation for the MCP BigQuery Server - an enterprise-grade Model Context Protocol server for Google Cloud BigQuery integration with security-first design.

**Project Status**: Production Ready
**Last Updated**: December 2025

---

## 📖 Documentation Index

### 🎯 Getting Started

#### [USAGE-GUIDE.md](./USAGE-GUIDE.md)
**Complete usage guide for all deployment modes (800+ lines)**

Covers:
- **Local Development** (Mock mode - no GCP needed)
- **Development Mode** (Real GCP testing)
- **Production Mode** (Cloud Run deployment)
- Using with Claude Desktop (configuration examples)
- Testing the MCP server
- Environment variable reference
- Security configuration by environment
- Troubleshooting common issues
- Best practices for each mode

**When to read**: First time setup, configuring for different environments, or troubleshooting deployment issues. **START HERE** if you want to use the server.

---

### Architecture & Design

#### [architecture/](./architecture/)
**Complete system architecture and design documentation**

The architecture documentation is organized into focused modules:
- [System Overview](./architecture/01-system-overview.md) - High-level system design
- [Component Architecture](./architecture/02-component-architecture.md) - Component structure and interactions
- [Data Flow](./architecture/03-data-flow.md) - Request/response patterns and data processing
- [Security Architecture](./architecture/04-security-architecture.md) - Security design and implementation
- [Error Handling](./architecture/05-error-handling.md) - Error handling strategies
- [Observability](./architecture/06-observability.md) - Monitoring and logging architecture
- [Scalability](./architecture/07-scalability.md) - Performance and scaling considerations

**When to read**: Understanding the overall system design, component interactions, and architectural decisions.

---

### 🔒 Security

#### [SECURITY.md](./SECURITY.md)
**Comprehensive security implementation guide**

Covers:
- Security middleware architecture
- Rate limiting (100 req/min prod, 1000 req/min dev)
- Prompt injection detection (30+ patterns)
- SQL injection prevention
- Sensitive data detection and redaction (20+ patterns)
- Tool validation and whitelisting
- Rug pull prevention (tool description change detection)
- Security audit logging
- Configuration and environment variables
- Cloud Armor and infrastructure security

**When to read**: Implementing security features, understanding security controls, or conducting security audits.

---

#### [wif-security-guide.md](./wif-security-guide.md)
**Workload Identity Federation security best practices**

Covers:
- Zero service account key approach
- OIDC token validation
- Google Workspace authentication
- Short-lived credentials (1-hour tokens)
- Principle of least privilege
- Audit logging for compliance
- Token lifecycle management

**When to read**: Setting up authentication, understanding keyless security model, or conducting security reviews.

---

### 🚀 Deployment & Operations

#### [wif-deployment-guide.md](./wif-deployment-guide.md)
**Step-by-step deployment guide for Workload Identity Federation**

Covers:
- Prerequisites and preparation
- Terraform infrastructure deployment
- Workload Identity Pool creation
- OIDC provider configuration (Google Workspace + GitHub Actions)
- Service account setup
- Cloud Run deployment
- Testing and validation
- Troubleshooting common issues

**When to read**: Deploying the MCP server to Google Cloud, setting up CI/CD, or troubleshooting deployment issues.

---

#### [DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md)
**Docker containerization and deployment guide**

Covers:
- Multi-stage Docker build
- Container optimization (142MB production image)
- Security hardening (non-root user, minimal base)
- Environment variable configuration
- Local testing with Docker
- Cloud Run deployment
- Health checks and monitoring

**When to read**: Building Docker images, local container testing, or deploying to Cloud Run.

---

#### [LOCAL-TESTING.md](./LOCAL-TESTING.md)
**Local development and testing guide**

Covers:
- Development environment setup
- Running tests (unit, integration, security)
- Mock mode for local development
- TypeScript build and compilation
- Debugging techniques
- Common issues and solutions

**When to read**: Setting up local development environment, running tests, or debugging issues.

---

#### Deployment Scripts

**[deploy-refactored-mcp.sh](../scripts/deploy-refactored-mcp.sh)**
- Automated deployment script for refactored MCP layer
- Pre-deployment validation and health checks
- Environment-specific configuration
- Rollback support on failures

**[rollback-mcp.sh](../scripts/rollback-mcp.sh)**
- Automated rollback to previous stable version
- State preservation and recovery
- Service continuity during rollback

**[validate-mcp.sh](../scripts/validate-mcp.sh)**
- MCP protocol compliance validation
- Schema and interface verification
- Tool registration and capability checks
- Integration testing

**When to use**: Deploying refactored MCP layer, validating changes, or recovering from deployment issues.

---

#### [HIVE_MIND_ANALYSIS.md](./HIVE_MIND_ANALYSIS.md)
**Distributed agent coordination and analysis**

Covers:
- Multi-agent coordination patterns
- Swarm intelligence implementation
- Task orchestration strategies
- Performance analysis and metrics
- Best practices for distributed development

**When to read**: Understanding agent collaboration, coordinating complex multi-agent tasks, or optimizing swarm performance.

---

### 📊 Monitoring & Observability

#### [MONITORING-GUIDE.md](./MONITORING-GUIDE.md)
**Complete monitoring and observability setup**

Covers:
- Architecture overview (Cloud Trace, Logging, Monitoring)
- OpenTelemetry instrumentation
- Alert policies (11 configured including 5 security alerts)
- Custom dashboards (20+ widgets)
- Log-based metrics
- SLO tracking (availability + latency)
- Notification channels (Email, Slack, PagerDuty)
- Troubleshooting and debugging

**When to read**: Setting up monitoring, configuring alerts, creating dashboards, or troubleshooting production issues.

---

### 🔄 MCP Layer Refactoring

#### [MCP_REFACTORING_SUMMARY.md](./MCP_REFACTORING_SUMMARY.md)
**Complete summary of MCP layer refactoring improvements**

Covers:
- Protocol compliance enhancements
- Performance optimizations
- Code quality improvements
- Test coverage expansion
- Breaking changes and migration notes
- Benefits and impact analysis

**When to read**: Understanding refactoring changes, upgrading to refactored version, or reviewing improvement metrics.

---

#### [MCP_MIGRATION_GUIDE.md](./MCP_MIGRATION_GUIDE.md)
**Step-by-step migration guide for MCP layer refactoring**

Covers:
- Pre-migration checklist
- Environment preparation
- Configuration updates
- Backward compatibility
- Testing strategy
- Rollback procedures
- Production migration timeline

**When to read**: Planning migration to refactored MCP layer, executing migration, or troubleshooting migration issues.

---

#### [TEST-COVERAGE-REPORT.md](./TEST-COVERAGE-REPORT.md)
**Comprehensive test coverage analysis**

Covers:
- Unit test coverage metrics
- Integration test scenarios
- Security test validation
- Performance benchmarks
- Coverage gaps and improvements
- Regression test suite

**When to read**: Reviewing test quality, identifying coverage gaps, or validating changes before deployment.

---

#### [CLEANUP_REPORT.md](./CLEANUP_REPORT.md)
**Code cleanup and optimization report**

Covers:
- Removed deprecated code
- Consolidated duplicate logic
- Optimized imports and dependencies
- Improved code organization
- Performance enhancements
- Technical debt reduction

**When to read**: Understanding code quality improvements, reviewing cleanup changes, or conducting code reviews.

---

#### [refactoring-improvements.md](./refactoring-improvements.md)
**Detailed refactoring improvements and patterns**

Covers:
- Architectural improvements
- Design pattern implementations
- Code structure enhancements
- Error handling refinements
- Type safety improvements
- Best practices adoption

**When to read**: Learning from refactoring patterns, understanding architectural decisions, or applying improvements to other components.

---

### 🔧 Workload Identity Federation (WIF)

#### [wif-architecture.md](./wif-architecture.md)
**Deep dive into Workload Identity Federation architecture**

Covers:
- WIF concepts and benefits
- Identity pool and provider configuration
- OIDC token flow diagrams
- Service account impersonation
- Multi-environment support (dev, staging, prod)
- Security considerations
- Best practices

**When to read**: Understanding keyless authentication, designing identity architecture, or implementing WIF for other services.

---

## 🎯 Quick Start by Use Case

### "I want to use this locally right now"
1. **Start here**: [USAGE-GUIDE.md](./USAGE-GUIDE.md) - Local Development section
2. Run `npm install && npm run dev` with mock mode
3. Configure Claude Desktop to use the server
4. Test with sample queries

### "I want to test with real GCP data"
1. **Start here**: [USAGE-GUIDE.md](./USAGE-GUIDE.md) - Development Mode section
2. Set up GCP service account
3. Configure environment variables
4. Test with real BigQuery datasets

### "I want to deploy to production"
1. **Start here**: [USAGE-GUIDE.md](./USAGE-GUIDE.md) - Production Mode section
2. Follow [wif-deployment-guide.md](./wif-deployment-guide.md) for infrastructure
3. Reference [DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md) for container details
4. Review [wif-security-guide.md](./wif-security-guide.md) for security best practices

### "I want to migrate to refactored MCP layer"
1. Review [MCP_REFACTORING_SUMMARY.md](./MCP_REFACTORING_SUMMARY.md) for changes
2. Follow [MCP_MIGRATION_GUIDE.md](./MCP_MIGRATION_GUIDE.md) step-by-step
3. Validate with [TEST-COVERAGE-REPORT.md](./TEST-COVERAGE-REPORT.md)
4. Use deployment scripts for automated migration

### "I want to understand the security implementation"
1. Read [SECURITY.md](./SECURITY.md) for middleware details
2. Review [wif-security-guide.md](./wif-security-guide.md) for authentication
3. Check [architecture/04-security-architecture.md](./architecture/04-security-architecture.md) for design context

### "I want to develop locally"
1. Follow [USAGE-GUIDE.md](./USAGE-GUIDE.md) for environment setup
2. Follow [LOCAL-TESTING.md](./LOCAL-TESTING.md) for testing
3. Reference [architecture/](./architecture/) for component design

### "I want to set up monitoring"
1. Read [MONITORING-GUIDE.md](./MONITORING-GUIDE.md) for complete setup
2. Deploy monitoring module from Terraform
3. Configure notification channels

### "I want to understand the architecture"
1. Start with [architecture/](./architecture/) for complete overview
2. Review [wif-architecture.md](./wif-architecture.md) for authentication details
3. Check component code in `/src` directory

### "I want to coordinate multi-agent tasks"
1. Read [HIVE_MIND_ANALYSIS.md](./HIVE_MIND_ANALYSIS.md) for patterns
2. Review [refactoring-improvements.md](./refactoring-improvements.md) for best practices
3. Use coordination tools for distributed development

---

## Documentation Structure

```
docs/
├── README.md                         ← You are here
│
├── Getting Started
│   └── USAGE-GUIDE.md                (Complete usage guide - START HERE)
│
├── Architecture & Design
│   ├── architecture/                 (Modular architecture docs)
│   │   ├── 01-system-overview.md
│   │   ├── 02-component-architecture.md
│   │   ├── 03-data-flow.md
│   │   ├── 04-security-architecture.md
│   │   ├── 05-error-handling.md
│   │   ├── 06-observability.md
│   │   └── 07-scalability.md
│   └── wif-architecture.md           (WIF authentication)
│
├── Security
│   ├── SECURITY.md                   (Security implementation)
│   └── wif-security-guide.md         (Authentication security)
│
├── Deployment & Operations
│   ├── wif-deployment-guide.md       (Full deployment)
│   ├── DOCKER-DEPLOYMENT.md          (Container deployment)
│   ├── LOCAL-TESTING.md              (Local development)
│   └── MONITORING-GUIDE.md           (Observability setup)
│
└── Reference
    ├── MCP_REFACTORING_SUMMARY.md    (Refactoring overview)
    ├── MCP_MIGRATION_GUIDE.md        (Migration instructions)
    └── TEST-COVERAGE-REPORT.md       (Test coverage analysis)
```

---

## 🏆 Key Features Documented

### MCP Protocol Compliance (v2.0.1)
- ✅ **Stderr Logging**: All logs to stderr (prevents JSON-RPC corruption)
- ✅ **Server Capabilities**: Explicit resources and tools declaration
- ✅ **Graceful Shutdown**: SIGTERM/SIGINT signal handlers
- ✅ **Error Handling**: Structured error responses with `isError` flag
- ✅ **Schema Validation**: Zod schemas for all tool inputs
- ✅ **Async Operations**: Consistent async/await patterns

### Security Features
- ✅ Rate limiting (sliding window algorithm)
- ✅ Prompt injection detection (30+ patterns)
- ✅ SQL injection prevention
- ✅ Sensitive data redaction (20+ patterns)
- ✅ Tool validation and whitelisting
- ✅ Rug pull detection
- ✅ Comprehensive security audit logging
- ✅ Zero service account keys (100% keyless via WIF)
- ✅ MCP-compliant logging (security events to stderr)

### Infrastructure Features
- ✅ Terraform-managed infrastructure (5 modules)
- ✅ Workload Identity Federation (Google Workspace + GitHub Actions)
- ✅ Cloud Armor WAF and DDoS protection
- ✅ VPC Service Controls
- ✅ Customer-managed encryption (CMEK)
- ✅ Multi-environment support (dev, staging, prod)

### Monitoring Features
- ✅ OpenTelemetry instrumentation
- ✅ 11 alert policies (6 operational + 5 security)
- ✅ Custom Cloud Monitoring dashboard
- ✅ Distributed tracing with Cloud Trace
- ✅ Log-based metrics
- ✅ SLO tracking

### Application Features
- ✅ 4 MCP tools (query_bigquery, list_datasets, list_tables, get_table_schema)
- ✅ Type-safe TypeScript implementation
- ✅ Comprehensive test coverage (29 tests passing)
- ✅ Docker containerization (142MB optimized image)
- ✅ CI/CD with GitHub Actions

---

## Finding What You Need

| Topic | Document |
|-------|----------|
| Getting started | [USAGE-GUIDE.md](./USAGE-GUIDE.md) - **START HERE** |
| Architecture | [architecture/](./architecture/) |
| Security | [SECURITY.md](./SECURITY.md) |
| Deployment | [wif-deployment-guide.md](./wif-deployment-guide.md) |
| Docker/Containers | [DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md) |
| Local development | [LOCAL-TESTING.md](./LOCAL-TESTING.md) |
| Monitoring | [MONITORING-GUIDE.md](./MONITORING-GUIDE.md) |
| Authentication (WIF) | [wif-architecture.md](./wif-architecture.md) |
| MCP refactoring | [MCP_REFACTORING_SUMMARY.md](./MCP_REFACTORING_SUMMARY.md) |
| Migration | [MCP_MIGRATION_GUIDE.md](./MCP_MIGRATION_GUIDE.md) |
| Test coverage | [TEST-COVERAGE-REPORT.md](./TEST-COVERAGE-REPORT.md) |

---

## 📊 Documentation Stats

| Metric | Count |
|--------|-------|
| Total Documentation Files | 16 |
| Total Lines of Documentation | ~10,000+ |
| Architecture Diagrams | 10+ |
| Code Examples | 100+ |
| Security Patterns Documented | 30+ |
| Deployment Steps | 200+ |
| Configuration Examples | 25+ |
| Deployment Scripts | 3 |
| Refactoring Guides | 5 |

---

## 🤝 Contributing to Documentation

When adding or updating documentation:

1. **Update this README.md** - Add your new document to the index
2. **Follow existing format** - Maintain consistent structure and style
3. **Include code examples** - Practical examples improve understanding
4. **Add diagrams** - Visual representations clarify complex concepts
5. **Cross-reference** - Link related documents together
6. **Keep current** - Update docs when implementation changes

---

## 📞 Support & Resources

### Project Resources
- Main README: [../README.md](../README.md)
- Source Code: [../src/](../src/)
- Terraform Modules: [../terraform/](../terraform/)
- Tests: [../tests/](../tests/)

### External Resources
- [Workload Identity Federation Docs](https://cloud.google.com/iam/docs/workload-identity-federation)
- [BigQuery API Reference](https://cloud.google.com/bigquery/docs/reference)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [MCP Security Best Practices](https://mcpmanager.ai/blog/mcp-security-best-practices/)

---

**Last Updated**: December 2025
**Documentation Version**: 2.2.0
**Status**: Current and Production Ready
