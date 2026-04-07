/**
 * Options for `createServer()` from VS Code server
 * (`code-server/lib/vscode/out/server-main.js`).
 *
 * Scope: only options that are actually consumed when the server is embedded
 * via `createServer(null, opts)` — i.e. reached through `zF`/`jF`/`uM`/`AF`
 * directly, or read from `environmentService.args` during request handling,
 * workbench construction, or extension host setup.
 *
 * Options that only fire through the `spawnCli`/`YH` argv-parsing entry
 * (license prompt, extension install/list/uninstall, host/port listen,
 * `--folder-uri`, `--locate-shell-integration-path`, etc.) are intentionally
 * omitted — passing them to `createServer()` has no effect.
 */
export interface VSCodeServerOptions {
  // --- Server bootstrap ---

  /** The path under which the web UI and the code server is provided. Defaults to `'/'`. */
  "server-base-path"?: string;

  /** The path to a socket file for the server to listen to. Also toggles Windows management-connection socket transfer. */
  "socket-path"?: string;

  /** Print startup timing breakdown to stdout once the server is ready. */
  "print-startup-performance"?: boolean;

  // --- Connection & Auth ---

  /** A secret that must be included with all requests. */
  "connection-token"?: string;

  /** Path to a file that contains the connection token. */
  "connection-token-file"?: string;

  /** Run without a connection token. Only use this if the connection is secured by other means. */
  "without-connection-token"?: boolean;

  auth?: string;

  "github-auth"?: string;

  // --- Data & extensions dirs ---

  /** Specifies the directory that server data is kept in. */
  "server-data-dir"?: string;
  "user-data-dir"?: string;
  "extensions-dir"?: string;
  "extensions-download-dir"?: string;
  "builtin-extensions-dir"?: string;

  /** The path to the directory where agent plugins are located. */
  "agent-plugins-dir"?: string;

  // --- Defaults ---

  /** The workspace folder to open when no input is specified in the browser URL. A relative or absolute path resolved against the current working directory. */
  "default-folder"?: string;

  /** The workspace to open when no input is specified in the browser URL. A relative or absolute path resolved against the current working directory. */
  "default-workspace"?: string;

  locale?: string;

  // --- Logging ---

  log?: string;
  logsPath?: string;

  // --- Network ---

  "disable-websocket-compression"?: boolean;
  "use-host-proxy"?: boolean;

  // --- Files ---

  "disable-file-downloads"?: boolean;
  "disable-file-uploads"?: boolean;
  "file-watcher-polling"?: string;

  // --- Telemetry & updates ---

  /** Sets the initial telemetry level. Valid levels are: `'off'`, `'crash'`, `'error'` and `'all'`. */
  "telemetry-level"?: string;
  "disable-telemetry"?: boolean;
  "disable-update-check"?: boolean;
  "disable-experiments"?: boolean;

  // --- Features ---

  "enable-sync"?: boolean;
  "enable-proposed-api"?: string[];
  "disable-workspace-trust"?: boolean;
  "disable-getting-started-override"?: boolean;
  "link-protection-trusted-domains"?: string[];

  // --- Remote & shutdown ---

  "enable-remote-auto-shutdown"?: boolean;
  "remote-auto-shutdown-without-delay"?: boolean;
  "without-browser-env-var"?: boolean;
  /** Override the reconnection grace time window in seconds. Defaults to `10800` (3 hours). */
  "reconnection-grace-time"?: string;

  // --- Agent host ---

  /** The path to a socket file for the agent host WebSocket server to listen on. */
  "agent-host-path"?: string;
  /** The port the agent host WebSocket server should listen on. */
  "agent-host-port"?: string;

  // --- Debugging ---

  "inspect-ptyhost"?: string;
  "inspect-brk-ptyhost"?: string;
  "inspect-agenthost"?: string;
  "inspect-brk-agenthost"?: string;
  "enable-smoke-test-driver"?: boolean;

  // --- Crash reporter ---

  "crash-reporter-directory"?: string;
  "crash-reporter-id"?: string;

  // --- Shell env ---

  "force-disable-user-env"?: boolean;
  "force-user-env"?: boolean;
}
