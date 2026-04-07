// Mock @github/copilot-sdk — no-op CopilotClient.
// Satisfies VS Code's `import { CopilotClient } from "@github/copilot-sdk"`.

export class CopilotClient {
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

export class CopilotSession {
  constructor() {}
  on(_handler) {
    return { dispose() {} };
  }
  async send(_message) {}
  async disconnect() {}
}

export function defineTool(_def) {
  return _def;
}

export function approveAll() {
  return true;
}

export const SYSTEM_PROMPT_SECTIONS = {};
