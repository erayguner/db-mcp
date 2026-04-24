# Contributing

Thanks for your interest in contributing to the BigQuery MCP Server.

## Getting Started

1. Fork the repository and clone your fork.
1. Install dependencies: `npm ci`
1. Install pre-commit hooks (one-time per clone):

   ```bash
   pip install pre-commit  # or: brew install pre-commit
   pre-commit install --install-hooks
   ```

1. Create a branch: `git checkout -b my-feature`

## Pre-commit Hooks

The repo ships with `.pre-commit-config.yaml`. Two stages run automatically:

- **pre-commit** (fast, on every commit): prettier, eslint, gitleaks, yamllint, markdownlint, shellcheck, terraform
  fmt/tflint, hadolint, and standard hygiene checks.
- **pre-push** (slow, on push): `tsc --noEmit`, `npm test`, `terraform validate`, and Checkov security scan of
  Terraform.

Run all hooks manually before pushing:

```bash
pre-commit run --all-files                    # pre-commit stage
pre-commit run --all-files --hook-stage pre-push
```

## Development

```bash
npm run dev          # Start with hot reload
npm run typecheck    # Type checking
npm run lint         # Lint
npm run test         # Run tests
npm run build        # Production build
```

## Pull Requests

- Keep PRs focused on a single change.
- Ensure `npm run typecheck && npm run lint && npm test` passes.
- Follow existing code style (Prettier + ESLint enforce this).
- Add tests for new functionality.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new BigQuery tool
fix: handle empty dataset response
docs: update deployment guide
```

## Code of Conduct

Be respectful and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
