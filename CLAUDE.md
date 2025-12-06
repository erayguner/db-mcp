# Claude Code Configuration - BigQuery MCP Server

## Project Overview

This is an enterprise-grade MCP (Model Context Protocol) server for Google Cloud Platform BigQuery with Workload Identity Federation authentication. It provides secure, keyless access to BigQuery through the Model Context Protocol.

## Build Commands

```bash
npm run build       # Build TypeScript
npm run dev         # Development with hot reload
npm run start       # Start production server
npm run test        # Run all tests
npm run lint        # Run ESLint
npm run lint:fix    # Fix linting issues
npm run format      # Format with Prettier
npm run typecheck   # TypeScript type checking
```

## Code Style & Best Practices

- **Modular Design**: Keep files under 500 lines
- **Environment Safety**: Never hardcode secrets
- **Test-First**: Write tests before implementation
- **Clean Architecture**: Separate concerns
- **TypeScript Strict Mode**: All code must pass strict type checking

## File Organization

- `/src` - TypeScript source code
- `/tests` - All test files (unit, integration, performance)
- `/docs` - Documentation files
- `/terraform` - Infrastructure as Code
- `/scripts` - Deployment and utility scripts
- `/examples` - Usage examples

## Key Architecture

1. **Workload Identity Federation** - Keyless authentication using OIDC
2. **MCP Protocol Layer** - JSON-RPC compliant tool handlers
3. **Security Middleware** - Rate limiting, injection detection
4. **BigQuery Integration** - Connection pooling, query optimization

## Important Reminders

- Do what has been asked; nothing more, nothing less
- ALWAYS prefer editing existing files to creating new ones
- NEVER proactively create documentation files unless explicitly requested
- Never save working files or tests to the root folder
