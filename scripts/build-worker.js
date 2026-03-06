const esbuild = require("esbuild");
const path = require("path");

esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, "../worker/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: path.resolve(__dirname, "../worker/dist/worker.js"),
  format: "cjs",
  packages: "external",
  tsconfig: path.resolve(__dirname, "../tsconfig.json"),
  sourcemap: false,
  minify: false,
});

console.log("Worker built successfully → worker/dist/worker.js");
