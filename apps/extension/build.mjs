import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    options: "src/options/options.ts",
    popup: "src/popup/popup.ts",
  },
  bundle: true, format: "iife", target: "chrome120", outdir: "dist", logLevel: "info",
});
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/options/options.html", "dist/options.html");
cpSync("src/popup/popup.html", "dist/popup.html");
