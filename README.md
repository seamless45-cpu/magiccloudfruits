# 1090 Fruits — 3D Sci-Fi Combat Arena

A Three.js + React fruit-slicing combat arena (see `3d-fruit-game-specifications (3).zip`
for the full design spec).

## Play it

- **Online:** <https://seamless45-cpu.github.io/magiccloudfruits/release/>
  (self-contained build — no bundler needed)
- **From your files:** open `release/index.html` directly in a browser
  (double-click it from your file manager). Everything is inlined into that
  one file, so it works from `file://` too.

## Develop

```bash
npm install
npm run dev      # local dev server with hot reload
npm run build    # production build → dist/ (single self-contained index.html)
```

## Why the site used to show a white screen

GitHub Pages was publishing the raw source tree from the branch root. The
source `index.html` loads `/src/main.tsx`:

1. that absolute path 404s under the `/magiccloudfruits/` subpath, and
2. browsers can't execute raw TypeScript/JSX anyway.

So nothing rendered. Two fixes are in place:

- `release/index.html` — the committed, self-contained production build
  (built with `vite-plugin-singlefile`, relative-safe, works on any subpath
  or straight from the file manager).
- `.github/workflows/deploy-pages.yml` — builds on every push and deploys
  `dist/` to GitHub Pages via `actions/deploy-pages`, so the canonical site
  root serves the real build. After this file lands, switch the Pages source
  to **GitHub Actions** in the repo settings (Settings → Pages → Source) or
  enable it automatically on the first run.

  > Note: pushing this workflow file requires the GitHub App's `workflows`
  > permission. If the push is rejected, reconnect GitHub with workflow
  > access and push again.
