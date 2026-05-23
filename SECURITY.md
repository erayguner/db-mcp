# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email security concerns to the repository owner via GitHub private vulnerability reporting.
3. Include a description of the vulnerability, steps to reproduce, and any potential impact.

You can expect an initial response within 48 hours. We will work with you to understand and address the issue before any
public disclosure.

## Security Practices

- All authentication uses Workload Identity Federation (keyless).
- Secrets are never committed to the repository.
- Dependencies are monitored via Dependabot and MegaLinter.
- Container images are scanned with Trivy on every PR.
- See [docs/security-architecture.md](docs/security-architecture.md) for the full security architecture.
