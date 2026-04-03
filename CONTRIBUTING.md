# Contributing

Thanks for your interest in contributing to the BigQuery MCP Server.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies: `npm ci`
3. Create a branch: `git checkout -b my-feature`

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
