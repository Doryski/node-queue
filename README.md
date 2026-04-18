# node-queue

[![CI](https://github.com/doryski/node-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/doryski/node-queue/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@doryski/node-queue)](https://www.npmjs.com/package/@doryski/node-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CPU-based process queue daemon that throttles test runners (vitest, jest, playwright) to prevent system overload during development.

## Features

- **CPU Monitoring**: Continuously monitors system CPU usage (overall and system/kernel)
- **Daemon Architecture**: Background daemon manages queued processes via Unix socket
- **Test Runner Interception**: Transparently intercepts vitest, jest, and playwright commands
- **CLI Management**: Full CLI for daemon control, installation, and status monitoring
- **Session Metrics**: Tracks queue statistics, wait times, and peak usage
- **Graceful Fallback**: Falls back to direct execution if daemon is unavailable

## Installation

```bash
npm install -g @doryski/node-queue
# or
pnpm add -g @doryski/node-queue
```

## Quick Start

### 1. Install and start the daemon

```bash
# Install shims and PATH configuration
npx node-queue install

# Start the daemon (runs in background)
npx node-queue start

# Or run in foreground for debugging
npx node-queue start -f
```

### 2. Check status

```bash
npx node-queue status
```

### 3. Use normally

Once installed, your test commands (vitest, jest, playwright) will automatically be queued when CPU usage is high.

## CLI Commands

| Command | Description |
|---------|-------------|
| `start [-f]` | Start daemon (use `-f` for foreground) |
| `stop` | Stop the daemon |
| `status` | Show daemon status, CPU stats, and queue |
| `install` | Install PATH modification and build shims |
| `uninstall` | Remove PATH modification and LaunchAgent |
| `build` | Build shims only (without PATH installation) |
| `logs [-f] [-n N]` | Show daemon logs (use `-f` to follow) |
| `install-project [-r]` | Patch node_modules/.bin in the current project (auto-run by the pnpm/npm wrappers) |
| `uninstall-project` | Remove patches from node_modules/.bin |
| `patch-all --base <dir>` | Recursively patch every project under `<dir>`. Registers the base for future re-runs |
| `patch-all` | Re-run `patch-all` against every previously registered base |
| `patch-all --forget <dir>` | Remove a base from the registry |

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_QUEUE_BYPASS=1` | Skip queueing, run directly |
| `NODE_QUEUE_TIMEOUT=N` | Custom timeout in milliseconds (default: 60000) |
| `NODE_QUEUE_DEBUG=1` | Enable debug logging in shims |

### Thresholds

Default thresholds (in `src/config.ts`):
- `maxOverallCpu`: 50% - Queue when overall CPU exceeds this
- `maxSystemCpu`: 20% - Queue when system/kernel CPU exceeds this

## Auto-Patch Wrappers

The library only intercepts commands that go through the shims on your `PATH`. Locally-resolved binaries (anything in `./node_modules/.bin`, which is what `pnpm exec vitest`, `npm test`, and editor test runners use) are **not** intercepted until you patch them with `install-project`. To avoid running that manually after every `pnpm install`, `node-queue install` offers to add **pnpm/npm shell wrappers** to your shell rc file.

When accepted, the installer appends a guarded block to `~/.zshrc` / `~/.bashrc` / fish config (wrapped in `# node-queue auto-patch wrappers` ... `# node-queue auto-patch wrappers end` markers):

- `pnpm install|i|add` → runs the real `pnpm`, then runs `node-queue install-project -p .` if `./node_modules/.bin` exists
- `npm install|i|add` → same, for npm

**Opting out:** answer "no" to the prompt during `install`. **Removing later:** `node-queue uninstall` strips the block cleanly.

### Bulk Patching Existing Projects

For one-shot patching of every project under a directory (useful on a fresh machine, or after upgrading node-queue):

```bash
# Patch everything under ~/projects and register the base
node-queue patch-all --base ~/projects

# Later, re-run against all registered bases (e.g. after re-installing deps across many repos)
node-queue patch-all

# Stop tracking a base
node-queue patch-all --forget ~/projects
```

Registered bases are stored at `~/.node-queue/config.json`. The walker skips `node_modules` (except the top-level `.bin` it finds), `.pnpm`, `.git`, `.next`, `dist`, `build`, and other common build/VCS directories.

## How It Works

1. **Shim Installation**: Creates lightweight shims in `~/.node-queue/bin/` for each intercepted binary
2. **PATH Modification**: Adds shim directory to the front of PATH
3. **Interception**: When you run `vitest` (or other intercepted command), the shim runs instead
4. **Queue Check**: Shim connects to daemon, which checks current CPU usage
5. **Decision**: If CPU is low, command runs immediately. If high, it's queued until CPU drops.

## Intercepted Commands

- `vitest`
- `jest`
- `playwright`

## Programmatic Usage

```typescript
import { createCpuMonitor, createProcessQueue, createMetricsTracker } from '@doryski/node-queue';

// Create a CPU monitor
const monitor = createCpuMonitor(500);
await monitor.start();

// Get current stats
const stats = monitor.getStats();
console.log(`CPU: ${stats.overall}%`);

// Create a queue
const queue = createProcessQueue(100);
```

## Platform Support

- **macOS**: Full support including LaunchAgent for auto-start on login
- **Linux**: Core daemon and queueing work; no systemd service file included yet (PRs welcome)
- **Windows**: Not supported — the daemon uses Unix sockets and POSIX signals

> **Note**: The `install` command's LaunchAgent setup is macOS-only. On Linux, you'll need to manage the daemon process yourself (e.g., via systemd or a process manager).

## License

MIT
