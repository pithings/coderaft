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

function defineTool(_def) {
  return _def;
}

function approveAll() {
  return true;
}

const SYSTEM_PROMPT_SECTIONS = {};

module.exports = {
  CopilotClient,
  CopilotSession,
  defineTool,
  approveAll,
  SYSTEM_PROMPT_SECTIONS,
};
