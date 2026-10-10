import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const test = process.argv.includes("--test");

const errorPlugin = {
  name: "watch-errors",
  setup(build) {
    build.onEnd((result) => {
      for (const error of result.errors) {
        console.error(error);
      }
    });
  },
};

/** @type {import("esbuild").BuildOptions} */
const extension = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  external: ["vscode", "@cursor/sdk"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const webview = {
  entryPoints: ["src/webview.ts"],
  outfile: "dist/webview.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const selftest = {
  entryPoints: ["src/selftest.ts"],
  outfile: "dist/selftest.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const previewBoot = {
  entryPoints: ["src/previewBoot.ts"],
  outfile: "dist/previewBoot.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const writePreview = {
  entryPoints: ["src/writePreview.ts"],
  outfile: "dist/writePreview.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const sidepanel = {
  entryPoints: ["browser/sidepanel.ts"],
  outfile: "browser/dist/sidepanel.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const browserBackground = {
  entryPoints: ["browser/background.ts"],
  outfile: "browser/dist/background.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const browserBridge = {
  entryPoints: ["src/browserBridge.ts"],
  outfile: "browser/dist/bridge.js",
  bundle: true,
  external: ["playwright", "@cursor/sdk"],
  format: "cjs",
  platform: "node",
  target: "node18",
  logLevel: "info",
};

const builds = test
  ? [{ ...selftest, external: ["playwright"] }]
  : [extension, webview, previewBoot, writePreview, sidepanel, browserBackground, browserBridge];

if (watch) {
  const contexts = await Promise.all(
    builds.map((options) =>
      esbuild.context({ ...options, logLevel: "silent", plugins: [errorPlugin] }),
    ),
  );
  console.log("[watch] build started");
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("[watch] build finished");
  await new Promise(() => {});
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  if (!test) {
    const { spawnSync } = await import("node:child_process");
    const generated = spawnSync(process.execPath, ["dist/writePreview.js"], { stdio: "inherit" });
    if (generated.status !== 0) {
      process.exit(generated.status ?? 1);
    }
  }
}
