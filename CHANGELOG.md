# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-10-27

### Added

- MCP server for BigQuery with Workload Identity Federation
- Tools: query_bigquery, list_datasets, list_tables, get_table_schema
- Security middleware with rate limiting and injection detection
- OpenTelemetry observability (metrics, tracing)
- Multi-tenant isolation with per-tenant dataset policies
- OIDC authentication gateway with JWKS caching
- HTTP transport for Cloud Run deployment
- Docker multi-stage build
- CI/CD with GitHub Actions (lint, typecheck, test, deploy)
- MegaLinter and Trivy security scanning
