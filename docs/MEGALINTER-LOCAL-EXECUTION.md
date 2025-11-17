# MegaLinter Local Execution Guide

This guide provides instructions for running MegaLinter locally on your development machine.

## Quick Start

### Option 1: Docker (Recommended)

Run MegaLinter using the official Docker image:

```bash
docker run --rm \
  -v $(pwd):/tmp/lint \
  -e VALIDATE_ALL_CODEBASE=true \
  -e APPLY_FIXES=all \
  oxsecurity/megalinter-javascript:v7
```

### Option 2: npx (Fast)

Run MegaLinter directly with npx (no Docker required):

```bash
npx mega-linter-runner --flavor javascript
```

### Option 3: Install Globally

Install MegaLinter globally for repeated use:

```bash
npm install -g mega-linter-runner
mega-linter-runner --flavor javascript
```

## Common Commands

### Run with Auto-Fix

Apply automatic fixes to your code:

```bash
docker run --rm \
  -v $(pwd):/tmp/lint \
  -e APPLY_FIXES=all \
  oxsecurity/megalinter-javascript:v7
```

### Run Specific Linters Only

Run only JavaScript/TypeScript linters:

```bash
docker run --rm \
  -v $(pwd):/tmp/lint \
  -e ENABLE=JAVASCRIPT,TYPESCRIPT \
  oxsecurity/megalinter-javascript:v7
```

Run only security linters:

```bash
docker run --rm \
  -v $(pwd):/tmp/lint \
  -e ENABLE=DOCKERFILE,TERRAFORM \
  oxsecurity/megalinter-javascript:v7
```

### Run on Specific Files/Directories

Lint only the src directory:

```bash
docker run --rm \
  -v $(pwd)/src:/tmp/lint/src \
  oxsecurity/megalinter-javascript:v7
```

### Generate Detailed Reports

Run with all reporters enabled:

```bash
docker run --rm \
  -v $(pwd):/tmp/lint \
  -e FORMATTERS_DISABLE_ERRORS=true \
  -e TEXT_REPORTER=true \
  -e JSON_REPORTER=true \
  -e SARIF_REPORTER=true \
  oxsecurity/megalinter-javascript:v7
```

## Pre-Commit Hook Setup

### Using Husky

Install Husky and create a pre-commit hook:

```bash
npm install --save-dev husky
npx husky install
npx husky add .husky/pre-commit "npx mega-linter-runner --flavor javascript --files \$1"
```

### Using Git Hooks Directly

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npx mega-linter-runner --flavor javascript --files $(git diff --cached --name-only)
```

Make it executable:

```bash
chmod +x .git/hooks/pre-commit
```

## IDE Integration

### VS Code

Install the MegaLinter extension:

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "MegaLinter"
4. Install "MegaLinter by Nicolas Vuillamy"
5. Run "MegaLinter: Lint Workspace" from Command Palette (Ctrl+Shift+P)

### JetBrains IDEs (IntelliJ, WebStorm)

Configure as an External Tool:

1. Go to Settings → Tools → External Tools
2. Click "+" to add new tool
3. Name: "MegaLinter"
4. Program: `docker`
5. Arguments: `run --rm -v $ProjectFileDir$:/tmp/lint oxsecurity/megalinter-javascript:v7`
6. Working directory: `$ProjectFileDir$`

## Performance Optimization

### Use Flavor for Faster Execution

The project uses the `javascript` flavor, which is optimized and ~3x faster than the full MegaLinter:

```bash
# Fast (javascript flavor - 68 linters)
docker run --rm -v $(pwd):/tmp/lint oxsecurity/megalinter-javascript:v7

# Slow (full flavor - 120+ linters)
docker run --rm -v $(pwd):/tmp/lint oxsecurity/megalinter:v7
```

### Validate Only Changed Files

```bash
export VALIDATE_ALL_CODEBASE=false
npx mega-linter-runner --flavor javascript
```

### Use Caching

MegaLinter automatically caches results in `.megalinter/` directory. Keep this directory to speed up subsequent runs.

## Linter-Specific Commands

### ESLint Only

```bash
npm run lint
# or with auto-fix
npm run lint:fix
```

### Prettier Only

```bash
npm run format
```

### TypeScript Type Checking

```bash
npm run typecheck
```

### Dockerfile Linting

```bash
docker run --rm -i hadolint/hadolint < Dockerfile
```

### Terraform Validation

```bash
cd terraform/
terraform init
terraform validate
tflint
```

### npm Security Audit

```bash
npm audit
# or fix automatically
npm audit fix
```

## Troubleshooting

### Docker Permission Issues

If you encounter permission issues with Docker:

```bash
# Linux/macOS
docker run --rm -v $(pwd):/tmp/lint -u $(id -u):$(id -g) oxsecurity/megalinter-javascript:v7

# Windows (PowerShell)
docker run --rm -v ${PWD}:/tmp/lint oxsecurity/megalinter-javascript:v7
```

### Out of Memory Errors

Increase Docker memory allocation or disable resource-intensive linters:

```bash
docker run --rm -v $(pwd):/tmp/lint -m 4g oxsecurity/megalinter-javascript:v7
```

### Slow Performance

1. Use the `javascript` flavor (already configured)
2. Enable parallel execution: `PARALLEL=true`
3. Disable unused linters in `.mega-linter.yml`
4. Use `VALIDATE_ALL_CODEBASE=false` for incremental linting

## Configuration Files

The following configuration files are used:

- `.mega-linter.yml` - Main MegaLinter configuration
- `.eslintrc.cjs` - ESLint rules
- `.prettierrc` - Prettier formatting rules
- `.prettierignore` - Prettier ignore patterns
- `.hadolint.yaml` - Dockerfile linting rules
- `.tflint.hcl` - Terraform linting rules
- `.yamllint.yml` - YAML linting rules
- `.markdownlint.json` - Markdown linting rules
- `.cspell.json` - Spell checking dictionary
- `.jscpd.json` - Copy-paste detection config

## Continuous Integration

The GitHub Actions workflow runs automatically on:

- Pull requests to `main` branch
- Pushes to `main` branch
- Daily at 2 AM UTC (scheduled security scans)
- Manual trigger via workflow dispatch

## Expected Runtime

| Execution Mode | Estimated Time | Notes |
|---------------|----------------|-------|
| Local (incremental) | 30-60 seconds | Only changed files |
| Local (full scan) | 2-4 minutes | All files |
| CI/CD (PR) | 3-5 minutes | With npm install + caching |
| CI/CD (main) | 4-6 minutes | Full validation |
| Security scan (scheduled) | 5-8 minutes | Includes Trivy container scan |

## Resources

- [MegaLinter Documentation](https://megalinter.io/)
- [Supported Linters](https://megalinter.io/latest/supported-linters/)
- [Configuration Options](https://megalinter.io/latest/configuration/)
- [GitHub Actions Integration](https://megalinter.io/latest/install-assisted/#github-actions)
