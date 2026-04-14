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
| `install-project [-r]` | Patch node_modules/.bin (use `-r` for workspaces) |
| `uninstall-project` | Remove patches from node_modules/.bin |

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
