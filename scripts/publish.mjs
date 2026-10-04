/**
 * Publish the built single-file game.
 *
 *   npm run build   ->   vite build (from dev.html)   ->   scripts/publish.mjs
 *
 * Vite emits dist/dev.html, a self-contained page (all JS and CSS inlined). This script puts
 * that same file where it needs to be:
 *
 *   index.html                  served by GitHub Pages at the branch root, and by serve.py
 *   docs/index.html             the same build under the docs/ folder, for Pages setups that
 *                               point at /docs instead of the root
 *   docs/arena-<version>.html   a versioned copy: a new filename is never a cached response,
 *                               which is useful when a browser has an old copy of the main URL
 *
 * No dependencies and no assumptions about the working directory.
 */
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "dist", "dev.html");

if (!existsSync(built)) {
  console.error("dist/dev.html not found — run this through `npm run build`.");
  process.exit(1);
}

const html = readFileSync(built, "utf8");
if (/<script[^>]+src=/.test(html) || /fonts\.googleapis/.test(html)) {
  console.error("Refusing to publish: the build still references external resources.");
  process.exit(1);
}

const version = createHash("sha1").update(html).digest("hex").slice(0, 7);
const targets = [
  path.join(root, "index.html"),
  path.join(root, "docs", "index.html"),
  path.join(root, "docs", `arena-${version}.html`),
];

mkdirSync(path.join(root, "docs"), { recursive: true });

// keep only the newest versioned copy so the repository does not grow forever
const docsDir = path.join(root, "docs");
for (const name of readdirSync(docsDir)) {
  if (/^arena-[0-9a-f]{7}\.html$/.test(name) && name !== `arena-${version}.html`) {
    unlinkSync(path.join(docsDir, name));
    console.log(`removed old build docs/${name}`);
  }
}

for (const target of targets) {
  copyFileSync(built, target);
  const kb = Math.round(readFileSync(target).length / 1024);
  console.log(`published ${path.relative(root, target)} (${kb} KB)`);
}

// The HTML remains single-file; these small static resources power installability and offline launch.
const staticAssets = readdirSync(path.join(root, "dist")).filter((name) => name !== "dev.html");
for (const directory of [root, docsDir]) {
  for (const asset of staticAssets) {
    const source = path.join(root, "dist", asset);
    if (!existsSync(source)) {
      console.error(`Missing PWA asset in build output: dist/${asset}`);
      process.exit(1);
    }
    const destination = path.join(directory, asset);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, force: true });
    console.log(`published ${path.relative(root, destination)}`);
  }
}

console.log(`\nGitHub Pages:   https://seamless45-cpu.github.io/magiccloudfruits/`);
console.log(`Versioned copy: .../magiccloudfruits/docs/arena-${version}.html`);
console.log(`Local:          python3 serve.py  ->  http://localhost:5173/`);
