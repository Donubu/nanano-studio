const esbuild = require("esbuild");
const path = require("path");

esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, "../lib/collaboration/collab-server.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: path.resolve(__dirname, "../lib/collaboration/dist/collab-server.js"),
  format: "cjs",
  packages: "external",
  tsconfig: path.resolve(__dirname, "../tsconfig.json"),
  sourcemap: false,
  minify: false,
});

console.log("Collab server built successfully → lib/collaboration/dist/collab-server.js");
