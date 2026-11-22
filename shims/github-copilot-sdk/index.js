// Mock @github/copilot-sdk — no-op CopilotClient.
// Satisfies VS Code's `require("@github/copilot-sdk")`.

class CopilotClient {
  constructor(_options) {
    this.state = "disconnected";
  }

  async start() {}
  async stop() {}

  async connect() {
    this.state = "connected";
  }

  async disconnect() {
    this.state = "disconnected";
  }

  async createSession(_config) {
    throw new Error("Copilot is not available (mock)");
  }

  async listSessions() {
    return [];
  }

  async listModels() {
    return [];
  }

  async getStatus() {
    return { state: "disconnected" };
  }

  async getAuthStatus() {
    return { status: "NotSignedIn" };
  }

  onLifecycleEvent(_handler) {
    return { dispose() {} };
  }
}

class CopilotSession {
  constructor() {}
  on(_handler) {
    return { dispose() {} };
  }
  async send(_message) {}
  async disconnect() {}
}

// Connection descriptors — plain data objects, same shape as the real SDK's
// factories. VS Code 4.146+ imports this by name in server-main.js and
// agentHostMain.js (`RuntimeConnection.forStdio({ path })`).
const RuntimeConnection = {
  forStdio: (opts = {}) => ({ kind: "stdio", ...opts }),
  forTcp: (opts = {}) => ({ kind: "tcp", ...opts }),
  forUri: (url, opts = {}) => ({ kind: "uri", url, ...opts }),
  forInProcess: (opts = {}) => ({ kind: "inprocess", ...opts }),
};

// Base class for custom request routing. agentHostMain.js subclasses it at
// module load, so it must be a real class.
class CopilotRequestHandler {
  async sendRequest(_request, _ctx) {
    throw new Error("Copilot is not available (mock)");
  }
  async openWebSocket(_ctx) {
    throw new Error("Copilot is not available (mock)");
  }
}

function defineTool(_def) {
  return _def;
}

function approveAll() {
  return true;
}

function createAttributedPermissionResult(result, decisionContext) {
  const inner = result && result.kind === "attributed" ? result.result : result;
  return { kind: "attributed", result: inner, decisionContext };
}

const SYSTEM_PROMPT_SECTIONS = {};

module.exports = {
  CopilotClient,
  CopilotSession,
  CopilotRequestHandler,
  RuntimeConnection,
  defineTool,
  approveAll,
  createAttributedPermissionResult,
  SYSTEM_PROMPT_SECTIONS,
};
