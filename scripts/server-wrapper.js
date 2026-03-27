/**
 * Server wrapper that attaches socket.io to the Next.js standalone server.
 * This file replaces the direct `node server.js` call in docker-start.sh.
 *
 * It monkey-patches http.createServer to capture the HTTP server instance,
 * attaches the collaboration WebSocket server, then lets Next.js proceed normally.
 */
const http = require("http");
const path = require("path");

// Store original createServer
const originalCreateServer = http.createServer;

// Flag to only patch once
let serverCaptured = false;

// Monkey-patch http.createServer to capture the server instance
http.createServer = function (...args) {
  const server = originalCreateServer.apply(this, args);

  if (!serverCaptured) {
    serverCaptured = true;

    // Attach socket.io collaboration server
    try {
      // The collab-server module is compiled as part of the Next.js build
      // and available in the standalone output
      const { initCollabServer } = require("../lib/collaboration/dist/collab-server");
      initCollabServer(server);
      console.log("[Server Wrapper] Collaboration server attached");
    } catch (err) {
      console.warn("[Server Wrapper] Could not attach collaboration server:", err.message);
      // Non-fatal: app works without collaboration
    }
  }

  return server;
};

// Now load and run the original Next.js standalone server
require(path.resolve(__dirname, "..", "server.js"));
