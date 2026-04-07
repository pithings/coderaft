// No-op shim for @microsoft/1ds-core-js (Microsoft 1DS telemetry core).
// Silently drops all telemetry events.

class AppInsightsCore {
  pluginVersionString = "Unknown";
  initialize(_config, _extensions) {}
  addTelemetryInitializer(_initializer) {}
  track(_event) {}
  unload(_isAsync, callback) {
    if (typeof callback === "function") callback();
  }
}

module.exports = { AppInsightsCore };
