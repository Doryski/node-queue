# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-14

### Added

- CPU monitoring with overall and system/kernel tracking
- Background daemon with Unix socket communication
- Test runner interception for vitest, jest, and playwright
- CLI for daemon control, installation, and status monitoring
- Session metrics tracking (queue stats, wait times, peak usage)
- Graceful fallback to direct execution when daemon is unavailable
- LaunchAgent support for auto-start on macOS login
- Project-level node_modules patching with workspace support
