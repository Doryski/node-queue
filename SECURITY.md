# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by opening a private security advisory on GitHub or contacting the maintainers directly.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

This tool:
- Runs a local daemon with Unix socket communication
- Intercepts and proxies test runner commands
- Does not transmit data over the network
- Stores logs and PID files in `~/.node-queue/`

The daemon only listens on a local Unix socket and does not accept network connections.
