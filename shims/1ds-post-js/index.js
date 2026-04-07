// No-op shim for @microsoft/1ds-post-js (Microsoft 1DS telemetry transport).
// Silently drops all telemetry posts.

class PostChannel {
  identifier = "PostChannel";
}

module.exports = { PostChannel };
