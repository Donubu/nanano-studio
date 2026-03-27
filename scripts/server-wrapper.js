/**
 * Server wrapper that attaches socket.io to the Next.js standalone server.
 * Replaces `node server.js` in docker-start.sh for production.
 */
const http = require("http");
const path = require("path");

const originalCreateServer = http.createServer;
let serverCaptured = false;

http.createServer = function (...args) {
  const server = originalCreateServer.apply(this, args);

  if (!serverCaptured) {
    serverCaptured = true;
    console.log("[Server Wrapper] HTTP server captured, attaching collaboration...");

    try {
      const collabPath = path.resolve(__dirname, "../lib/collaboration/dist/collab-server.js");
      console.log("[Server Wrapper] Loading collab server from:", collabPath);
      const { initCollabServer } = require(collabPath);
      const io = initCollabServer(server);
      if (io) {
        console.log("[Server Wrapper] Collaboration server attached successfully");
      } else {
        console.warn("[Server Wrapper] Collaboration server returned null (Redis may not be available)");
      }
    } catch (err) {
      console.error("[Server Wrapper] Failed to attach collaboration server:");
      console.error(err.stack || err.message || err);
    }
  }

  return server;
};

console.log("[Server Wrapper] Starting Next.js standalone server...");
require(path.resolve(__dirname, "..", "server.js"));
