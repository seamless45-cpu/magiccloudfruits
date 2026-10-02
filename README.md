# MagicCloud — Open Field Combat Arena

A Three.js + React arena brawler: 11 equipable fruits/swords, procedural terrain,
weather supercells, and a GPU-driven lightning system. The arena is generated in code—
there are no external models or audio tracks to load. The small PNG icons are only for
the installable PWA launcher, not game content.

## Run it

Just want to play? No toolchain needed — `index.html` in the repository root contains the
finished, self-contained game. The neighboring manifest, service worker and icons are only
needed for installation and offline-launch support.

```bash
python3 serve.py                 # serve the game on http://localhost:5173

# development
npm install
npm run dev                      # live dev server; "/" forwards to dev.html
npm run build                    # rebuild and publish (see below)
```

`dev.html` is the development entry (it loads `src/main.tsx` through Vite). `npm run build`
compiles the game into one self-contained HTML page; `scripts/publish.mjs` publishes it as
`index.html`, `docs/index.html` and a versioned `docs/arena-<version>.html`, alongside the PWA
manifest, service worker and install icons in both hosting locations:

| Path | Purpose |
| --- | --- |
| `index.html` | the built game — this is what GitHub Pages serves at the branch root |
| `docs/index.html` | the same build, for Pages setups pointed at `/docs` |
| `docs/arena-<version>.html` | a versioned filename, useful when the main URL is cached |
| `manifest.webmanifest`, `sw.js`, `icons/` | install metadata, offline app shell and Chrome app icons (published at the root and under `docs/`) |

Never point GitHub Pages at the repository root *as a dev tree*: the game must be the built
`index.html`, because browsers cannot execute the TypeScript that `dev.html` loads.

`serve.py` sends `Cache-Control: no-store` to prevent stale HTTP-cached builds after a
rebuild. The service worker maintains its own versioned app-shell cache for offline launch.

Routes it serves: `/` and `/index.html` (the game), `/safe` (game in low-graphics safe
mode), the PWA resources (`/manifest.webmanifest`, `/sw.js`, `/icons/*`), and generated
`/docs/*` builds. Requests for old dev-server paths such as `/src/main.tsx` are answered
with a small script that forwards the page to the current build instead of a 404, which
rescues a browser still holding a page from an earlier dev session.

The game itself bundles its scripts, styles and fonts into the HTML; only the small
PWA manifest, service worker and app icons are fetched separately. After the first online
visit, the service worker keeps the game shell available for offline launches.

On HTTPS hosting (including GitHub Pages) or localhost, Chrome can install the game from
its PWA manifest. Use **INSTALL APP** in the main menu to open Chrome's native prompt; if
the browser does not expose a prompt yet, the button shows the browser-menu instructions.

The dev server binds to all interfaces (`server.host: true`) and accepts any
`Host` header (`server.allowedHosts: true`) so it also works behind sandbox /
tunnel / preview domains. Vite 7 rejects unknown hosts by default, which shows up
as `HTTP 403 Blocked request. This host is not allowed.`

## HUD layout

The heads-up display is built from two rails plus a reserved bottom band, so panels cannot
collide at any screen size:

```
+--------------------+                                    +------------------+
| vitals             |                                    | range telemetry  |
| controls (dismiss) |              3D view               | skills (scrolls) |
|                    |                                    | zoom (pinned)    |
+--------------------+------------------------------------+------------------+
|                        inventory (wraps if needed)                        |
+--------------------------------------------------------------------------+
```

Measured in a browser across 5 window sizes x 11 items: no panel overlaps another and none
extends past the viewport. `--hud-bottom` (the height reserved for the inventory row) and
`--inv-max` (the width available between the rails) live in `src/index.css`; both rails stop
at `--hud-bottom`, so a wide inventory wraps instead of covering the skill list.

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move · `Shift` sprint · `Space` jump |
| LMB or `E` | Attack / fire (manual) |
| RMB drag | Orbit camera · wheel, `+`/`-`, `PgUp`/`PgDn` zoom (4–900 m) |
| `Z X C V B F G N M L K J` | Skills (hold for charge skills) |
| `1`–`9`, `0`, `-` | Equip / unequip items |
| `O` or `Esc` | Graphics settings · `H` help |
| Controller | LS move · RS orbit · LT/Select zoom · RT fire · A jump · X/Y/B/LB/RB/D-pad skills · Start cycle item |

## Troubleshooting a blank screen

**Symptom → cause**

| What you see | What it means |
| --- | --- |
| **White screen** | The HTML loaded but the JavaScript never ran — the dev/preview server had stopped, or JS is disabled. Reload once the server is up. |
| Dark screen, "Booting arena…" / "Downloading engine…" | The page loaded but the script has not executed yet; after 4.5s the page reloads itself once with a cache-buster, which clears stale cached copies. |
| Dark screen, "Building arena…" then it starts | Normal on slow machines — the world is being constructed and shaders compiled. |
| Dark screen, "The game script never ran." | The script could not be fetched (server stopped). The message names the exact script. |
| Dark screen, "The engine loaded but the arena did not appear." | The script ran but setup failed — see the browser console for the exception. |
| Dark screen, "3D ARENA FAILED TO START" | The script ran but WebGL2 or a rendering call failed — the red line gives the exact reason. |
| HUD panels visible, 3D world black | GPU cannot render to half-float targets; handled automatically, otherwise lower the graphics preset. |

The app now reports failures instead of showing an empty canvas:

- **"3D ARENA FAILED TO START"** panel — shows a copyable diagnostic line naming the
  exact cause (WebGL2 missing, a render-loop exception, an uncaught error).
- If the interface/HUD is missing entirely, the page never loaded: check that the dev
  server is actually running and that you are on the current URL. Every time the
  sandbox restarts, the dev server must be started again — a previously opened preview
  will otherwise sit on a dead connection.
- If the HUD shows but the world is black, the GPU cannot render to half-float targets
  (needed by the bloom/FXAA composer). The game detects this and automatically falls
  back to direct rendering; if it still fails, lower the graphics preset (settings
  are stored in `localStorage` under `f1090gfx` — clear it to return to defaults).

## Requirements

- A browser with **WebGL2** (three.js r150+ requires it). three@0.186 is pinned.
- Node 18+ for the dev tooling.

## Playable build (GitHub Pages)

`docs/index.html` is the compiled, fully self-contained game — the same file `npm run build`
produces. GitHub Pages is configured to serve the `docs/` folder, so the game is playable at:

    https://seamless45-cpu.github.io/magiccloudfruits/

That URL needs no build step and no dev server. `docs/arena-<version>.html` holds the same
build under a versioned name, which is handy when a browser has cached the main URL — a new
filename is always a fresh copy.

Do not point Pages at the repository root: that serves the Vite dev entry `index.html`, which
loads `/src/main.tsx`. Browsers cannot execute TypeScript, so the page would never boot.
