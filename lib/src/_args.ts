import { parseArgs } from "node:util";

export const cliOptions = {
  // Server
  port: { type: "string", short: "p" },
  host: { type: "string", short: "H" },
  "base-url": { type: "string" },
  "server-base-path": { type: "string" },
  "socket-path": { type: "string" },
  "print-startup-performance": { type: "boolean" },

  // Auth
  token: { type: "string", short: "t" },
  "connection-token": { type: "string" },
  "connection-token-file": { type: "string" },
  "without-connection-token": { type: "boolean" },
  auth: { type: "string" },
  "github-auth": { type: "string" },

  // Defaults
  "default-folder": { type: "string" },
  "default-workspace": { type: "string" },
  locale: { type: "string" },

  // Data dirs
  "server-data-dir": { type: "string" },
  "user-data-dir": { type: "string" },
  "extensions-dir": { type: "string" },
  "extensions-download-dir": { type: "string" },
  "builtin-extensions-dir": { type: "string" },
  "agent-plugins-dir": { type: "string" },

  // Logging
  log: { type: "string", multiple: true },
  "logs-path": { type: "string" },

  // Network
  "disable-websocket-compression": { type: "boolean" },
  "use-host-proxy": { type: "boolean" },

  // Files
  "disable-file-downloads": { type: "boolean" },
  "disable-file-uploads": { type: "boolean" },
  "file-watcher-polling": { type: "string" },

  // Telemetry & updates
  "telemetry-level": { type: "string" },
  "disable-telemetry": { type: "boolean" },
  "disable-update-check": { type: "boolean" },
  "disable-experiments": { type: "boolean" },

  // Features
  "enable-sync": { type: "boolean" },
  "disable-extensions": { type: "boolean" },
  "disable-extension": { type: "string", multiple: true },
  "enable-proposed-api": { type: "string", multiple: true },
  "disable-workspace-trust": { type: "boolean" },
  "disable-getting-started-override": { type: "boolean" },

  // Remote & shutdown
  "enable-remote-auto-shutdown": { type: "boolean" },
  "remote-auto-shutdown-without-delay": { type: "boolean" },
  "without-browser-env-var": { type: "boolean" },
  "reconnection-grace-time": { type: "string" },

  // Agent host
  "agent-host-path": { type: "string" },
  "agent-host-port": { type: "string" },

  // Debugging
  "inspect-ptyhost": { type: "string" },
  "inspect-brk-ptyhost": { type: "string" },
  "inspect-agenthost": { type: "string" },
  "inspect-brk-agenthost": { type: "string" },
  "enable-smoke-test-driver": { type: "boolean" },

  // Crash reporter
  "crash-reporter-directory": { type: "string" },
  "crash-reporter-id": { type: "string" },

  // Shell env
  "force-disable-user-env": { type: "boolean" },
  "force-user-env": { type: "boolean" },

  "no-fork": { type: "boolean" },
  "no-tui": { type: "boolean" },
  open: { type: "boolean", short: "o" },
  help: { type: "boolean", short: "h" },
} as const satisfies NonNullable<Parameters<typeof parseArgs>[0]>["options"];

export const vsKeys = [
  "server-base-path",
  "print-startup-performance",
  "connection-token-file",
  "without-connection-token",
  "auth",
  "github-auth",
  "default-workspace",
  "locale",
  "server-data-dir",
  "user-data-dir",
  "extensions-dir",
  "extensions-download-dir",
  "builtin-extensions-dir",
  "agent-plugins-dir",
  "log",
  "file-watcher-polling",
  "disable-websocket-compression",
  "use-host-proxy",
  "disable-file-downloads",
  "disable-file-uploads",
  "telemetry-level",
  "disable-telemetry",
  "disable-update-check",
  "disable-experiments",
  "enable-sync",
  "disable-extensions",
  "disable-extension",
  "enable-proposed-api",
  "disable-workspace-trust",
  "disable-getting-started-override",
  "enable-remote-auto-shutdown",
  "remote-auto-shutdown-without-delay",
  "without-browser-env-var",
  "reconnection-grace-time",
  "agent-host-path",
  "agent-host-port",
  "inspect-ptyhost",
  "inspect-brk-ptyhost",
  "inspect-agenthost",
  "inspect-brk-agenthost",
  "enable-smoke-test-driver",
  "crash-reporter-directory",
  "crash-reporter-id",
  "force-disable-user-env",
  "force-user-env",
] as const;

export const helpText = `
  Usage: coderaft [options]

  Server:
    -p, --port <port>                    Port to listen on (default: $PORT or 6063)
    -H, --host <host>                    Host/interface to bind
        --base-url <path>                Base URL the server is mounted under (default: /)
        --socket-path <path>             Path to a socket file to listen on
        --print-startup-performance      Print startup timing to stdout

  Auth:
    -t, --token <token>                  Connection token for auth (shorthand)
        --connection-token <token>       Connection token for auth (auto-generated)
        --connection-token-file <path>   Path to file containing connection token
        --without-connection-token       Disable connection token auth
        --auth <type>                    Auth type
        --github-auth <token>            GitHub auth token

  Defaults:
        --default-folder <path>          Default workspace folder
        --default-workspace <path>       Default workspace file
        --locale <locale>                The locale to use (e.g. en-US)

  Data:
        --server-data-dir <path>         Server data directory
        --user-data-dir <path>           User data directory
        --extensions-dir <path>          Extensions directory
        --extensions-download-dir <path> Extensions download directory
        --builtin-extensions-dir <path>  Built-in extensions directory
        --agent-plugins-dir <path>       Agent plugins directory

  Logging:
        --log <level>                    Log level (off, critical, error, warn, info, debug, trace)
        --logs-path <path>               Logs output directory

  Network:
        --disable-websocket-compression  Disable WebSocket compression
        --use-host-proxy                 Enable host proxy

  Files:
        --disable-file-downloads         Disable file downloads
        --disable-file-uploads           Disable file uploads
        --file-watcher-polling <ms>      File watcher polling interval

  Telemetry:
        --telemetry-level <level>        Telemetry level (off, crash, error, all)
        --disable-telemetry              Disable telemetry
        --disable-update-check           Disable update check
        --disable-experiments            Disable experiments

  Features:
        --enable-sync                    Enable settings sync
        --disable-extensions             Disable all installed extensions
        --disable-extension <ext-id>     Disable specific extension (repeatable)
        --enable-proposed-api <ext-id>   Enable proposed API for extension (repeatable)
        --disable-workspace-trust        Disable workspace trust
        --disable-getting-started-override  Disable getting started override

  Remote:
        --enable-remote-auto-shutdown    Enable remote auto shutdown
        --remote-auto-shutdown-without-delay  Auto shutdown without delay
        --without-browser-env-var        Disable browser env var
        --reconnection-grace-time <sec>  Reconnection grace time (default: 10800)

  Agent Host:
        --agent-host-path <path>         Agent host WebSocket socket path
        --agent-host-port <port>         Agent host WebSocket port

  Shell:
        --force-disable-user-env         Force disable user shell env resolution
        --force-user-env                 Force user shell env resolution

  Debugging:
        --inspect-ptyhost <port>         Inspect pty host
        --inspect-brk-ptyhost <port>     Inspect pty host (break on start)
        --inspect-agenthost <port>       Inspect agent host
        --inspect-brk-agenthost <port>   Inspect agent host (break on start)
        --enable-smoke-test-driver       Enable smoke test driver
        --crash-reporter-directory <dir> Crash reporter directory
        --crash-reporter-id <id>         Crash reporter ID

        --no-fork                        Run server in the main process (no subprocess)
        --no-tui                         Disable interactive terminal UI
    -o, --open                           Open in browser on startup
    -h, --help                           Show this help message
`;
