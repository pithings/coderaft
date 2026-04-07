#!/usr/bin/env node

// Mock @github/copilot CLI — no-op server.
// The real package is a 129MB binary distribution with native prebuilds.
// This stub satisfies resolution by @github/copilot-sdk without shipping native binaries.

console.error("[mock] @github/copilot CLI stub — no copilot backend available");
process.exit(1);
