# 1090 Fruits 3D — Sci-Fi Combat Arena

A Three.js + React arena brawler: 11 equipable fruits/swords, procedural terrain,
weather supercells, and a GPU-driven lightning system. Everything is generated in
code — **there are no image, model, or audio assets to load**, so a blank screen is
always a code/runtime/server problem, never a missing file.

## Run it

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm run build      # production bundle -> dist/index.html (single file)
npm run preview    # serve the built bundle on http://localhost:4173
```

The dev server binds to all interfaces (`server.host: true`) and accepts any
`Host` header (`server.allowedHosts: true`) so it also works behind sandbox /
tunnel / preview domains. Vite 7 rejects unknown hosts by default, which shows up
as `HTTP 403 Blocked request. This host is not allowed.`

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move · `Shift` sprint · `Space` jump |
| LMB or `E` | Attack / fire (manual) |
| RMB drag | Orbit camera · wheel, `+`/`-`, `PgUp`/`PgDn` zoom (4–300 m) |
| `Z X C V B F G N M L K J` | Skills (hold for charge skills) |
| `1`–`9`, `0`, `-` | Equip / unequip items |
| `O` or `Esc` | Graphics settings · `H` help |
| Controller | LS move · RS orbit · LT/Select zoom · RT fire · A jump · X/Y/B/LB/RB/D-pad skills · Start cycle item |

## Troubleshooting a blank screen

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
