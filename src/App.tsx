import { useEffect, useRef, useState } from 'react';
import { Game, PRESETS, defaultSettings } from './game/Game';
import type { GraphicsSettings } from './game/types';
import { SkillBar } from './ui/SkillBar';
import { Inventory, Settings, MobileControls, ZoomControl } from './ui/Panels';

type Snap = ReturnType<Game['snapshot']>;
const fmt = (n: number) => (n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));

/** Progress hooks for the inline loading screen in index.html (it owns the PLAY button). */
const bootProgress = (p: number, label?: string) =>
  (window as unknown as { __bootProgress?: (p: number, l?: string) => void }).__bootProgress?.(p, label);

/** `?safe=1` starts with minimal graphics: a heavy preset can stall or fail to boot on weak GPUs. */
const safeSettings = (): GraphicsSettings => ({ ...defaultSettings(), ...PRESETS.low, preset: 'low' });

/** Stored settings are user-writable, so validate everything: NaN/out-of-range values would
 *  otherwise be passed straight into pixel ratio, camera planes and shadow map sizes. */
const clampSettings = (raw: unknown): GraphicsSettings => {
  const d = defaultSettings();
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<GraphicsSettings>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const preset = (['low', 'medium', 'high', 'ultra'] as const).includes(s.preset as GraphicsSettings['preset'])
    ? (s.preset as GraphicsSettings['preset']) : d.preset;
  return {
    preset,
    resolution: num(s.resolution, 0.4, 1.5, d.resolution),
    shadows: bool(s.shadows, d.shadows),
    shadowRes: [512, 1024, 2048, 4096].includes(s.shadowRes as number) ? (s.shadowRes as number) : d.shadowRes,
    bloom: bool(s.bloom, d.bloom),
    bloomStrength: num(s.bloomStrength, 0, 2.5, d.bloomStrength),
    particles: num(s.particles, 0.1, 1, d.particles),
    debris: num(s.debris, 0.1, 1, d.debris),
    maxBolts: num(s.maxBolts, 20, 500, d.maxBolts),
    fog: bool(s.fog, d.fog),
    exposure: num(s.exposure, 0.5, 2, d.exposure),
    shake: num(s.shake, 0, 2, d.shake),
    showFps: bool(s.showFps, d.showFps),
    antialiasFxaa: bool(s.antialiasFxaa, d.antialiasFxaa),
    sandbox: bool(s.sandbox, d.sandbox),
    drawDistance: num(s.drawDistance, 1000, 60000, d.drawDistance),
    clouds: num(s.clouds, 0.3, 1.5, d.clouds),
  };
};

/** Weak devices (few cores / little memory) start on a lighter preset so booting stays quick. */
const devicePreset = (): GraphicsSettings => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
  return weak ? { ...defaultSettings(), ...PRESETS.medium, preset: 'medium' } : defaultSettings();
};

/** Safe mode is reachable by path (`/safe`) as well as by query, because a proxy that
 *  strips query strings would otherwise make the escape hatch unreachable. */
const safeRequested = () => {
  const p = location.pathname.replace(/\/+$/, '');
  return p.endsWith('/safe') || p.endsWith('/arena') || new URLSearchParams(location.search).has('safe');
};

const initialSettings = (): GraphicsSettings => {
  try {
    if (safeRequested()) return safeSettings();
    const stored = localStorage.getItem('f1090gfx');
    return stored ? clampSettings(JSON.parse(stored)) : devicePreset();
  } catch {
    return defaultSettings();
  }
};

export default function App() {
  const host = useRef<HTMLDivElement>(null); const overlay = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [settings, setSettings] = useState<GraphicsSettings>(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [help, setHelp] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; m: string; c: string }[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    // React has mounted. The inline loading screen stays on top and is dismissed by its own
    // PLAY button once the first frame is on screen - that is what makes the start deliberate
    // instead of a black flash while shaders compile.
    clearTimeout((window as unknown as { __bootTimer?: number }).__bootTimer);
    bootProgress(0.5, 'Compiling shaders');
  }, []);

  useEffect(() => {
    // Pre-flight: three.js r150+ needs WebGL2. Report precisely what is missing instead of a black screen.
    const probe = document.createElement('canvas');
    const gl2 = probe.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl2) {
      const gl1 = probe.getContext('webgl') || probe.getContext('experimental-webgl');
      setFatal(`WebGL2 context unavailable (WebGL1 ${gl1 ? 'present' : 'absent'}) · ${navigator.userAgent}`);
      return;
    }
    try { (gl2.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.(); } catch { /* ignore */ }
    const onErr = (e: ErrorEvent) => setFatal(f => f ?? `Uncaught error: ${e.message || 'unknown'} (${e.filename}:${e.lineno})`);
    const onRej = (e: PromiseRejectionEvent) => setFatal(f => f ?? `Unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`);
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej);
    let g: Game;
    try { g = new Game(host.current!, settings); } catch (e) {
      console.error('[1090 Fruits] failed to start', e);
      setFatal((e instanceof Error ? `${e.name}: ${e.message}` : String(e)) + ' · ' + navigator.userAgent);
      return;
    }
    g.onFatal = m => setFatal(`Render loop stopped — ${m}`);
    g.onReady = () => bootProgress(1, 'Ready'); // first frame rendered: show PLAY
    setGame(g); (window as any).game = g;
    let tid = 0;
    g.onToast = (m, c) => { const id = ++tid; setToasts(t => [...t.slice(-4), { id, m, c }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2200); };
    const iv = setInterval(() => setSnap(g.snapshot()), 100);
    let raf = 0; const ov = () => { raf = requestAnimationFrame(ov); if (overlay.current) { overlay.current.style.background = g.overlay.color; overlay.current.style.opacity = String(Math.min(0.85, g.overlay.a)); } }; ov();
    const kd = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') setShowSettings(s => !s); if (e.key === 'h' || e.key === 'H') setHelp(h => !h); };
    window.addEventListener('keydown', kd);
    return () => { clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); g.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeSettings = (s: GraphicsSettings) => { setSettings(clampSettings(s)); game?.applySettings(clampSettings(s)); localStorage.setItem('f1090gfx', JSON.stringify(clampSettings(s))); };
  const touch = game?.isTouch ?? false;
  const item = game && snap && snap.equipped >= 0 ? game.items[snap.equipped] : null;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div ref={host} className="absolute inset-0" />
      <div ref={overlay} className="absolute inset-0 pointer-events-none" style={{ opacity: 0, mixBlendMode: 'screen' }} />
      {fatal && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="sf-panel max-w-[620px] p-5 text-[12px] leading-relaxed select-text">
            <div className="font-orb text-[12px] sf-glow text-cyan-200 mb-2">3D ARENA FAILED TO START</div>
            <div className="text-cyan-300/70 mb-2">Diagnostic — copy this line if you report the problem:</div>
            <div className="font-orb text-[10px] text-rose-200/90 break-all mb-3 bg-black/30 p-2">{fatal}</div>
            <div className="mb-1">The 2D interface still works; only the 3D view could not start.</div>
            <div className="text-cyan-300/70 mb-3">Common causes: WebGL2 disabled or unsupported, blocklisted GPU driver, browser running in a restricted/headless mode, or graphics settings that are too heavy.</div>
            <div className="flex gap-2 pointer-events-auto">
              <button className="sf-btn px-3 py-1 font-orb text-[10px]" onClick={() => location.reload()}>RETRY</button>
              <button className="sf-btn px-3 py-1 font-orb text-[10px]" onClick={() => { try { localStorage.removeItem('f1090gfx'); } catch { /* ignore */ } location.href = location.pathname + '?safe=1'; }}>SAFE MODE</button>
            </div>
          </div>
        </div>
      )}
      {game && snap && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Left rail: vitals and controls stack in one column, so they cannot overlap */}
          <div className="absolute left-2 top-2 w-[250px] max-sm:w-[44vw] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'calc(var(--hud-bottom) + var(--ctrl-h))' }}>
          <div data-panel="vitals" className="sf-panel p-2.5 w-full shrink-0 pointer-events-auto">
            <div className="flex justify-between items-baseline"><span className="font-orb text-[11px] sf-glow text-cyan-200">1090 FRUITS // OPERATOR</span>{snap.sandbox && <span className="text-[9px] font-orb text-emerald-200 sf-pulse">SANDBOX</span>}{snap.invincible && !snap.sandbox && <span className="text-[9px] font-orb text-yellow-200">INVULN</span>}</div>
            <div className="hex-bar mt-1.5"><div className="h-full" style={{ width: `${(snap.hp / snap.maxHp) * 100}%`, background: 'linear-gradient(90deg,#16ffb0,#33e0ff)', boxShadow: '0 0 10px #33e0ff' }} /></div>
            <div className="flex justify-between text-[10px] mt-0.5 font-orb text-cyan-100/80"><span>HP {fmt(snap.hp)} / {fmt(snap.maxHp)}</span><span>{((snap.hp / snap.maxHp) * 100).toFixed(0)}%</span></div>
            <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] [@media(max-height:560px)]:hidden">
              <div><div className="text-cyan-300/60">KILLS</div><div className="font-orb">{snap.kills}</div></div>
              <div><div className="text-cyan-300/60">DPS</div><div className="font-orb">{fmt(snap.dps)}</div></div>
              <div><div className="text-cyan-300/60">HOSTILES</div><div className="font-orb">{snap.alive}</div></div>
            </div>
            {item?.id === 'gblade' && <div className="mt-1.5"><div className="flex justify-between text-[9px] font-orb text-violet-200"><span>LIGHTNING CHARGE</span><span>{snap.charge.toFixed(0)}%</span></div><div className="hex-bar"><div className="h-full" style={{ width: `${snap.charge}%`, background: 'linear-gradient(90deg,#7a5cff,#e080ff)', boxShadow: '0 0 8px #b080ff' }} /></div></div>}
            {snap.buffs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{snap.buffs.map(b => <span key={b.k} className="text-[9px] font-orb px-1.5 py-0.5 border border-rose-300/50 bg-rose-500/15 text-rose-100">{b.k.toUpperCase()} {b.rem.toFixed(1)}s</span>)}</div>}
          </div>
          {help && !touch && (
            <div data-panel="controls" className="sf-panel p-2.5 w-full text-[10.5px] leading-snug pointer-events-auto overflow-y-auto min-h-0">
              <div className="flex justify-between font-orb text-[10px] text-cyan-200 mb-1"><span>CONTROLS</span><button className="sf-btn px-1" onClick={() => setHelp(false)}>✕</button></div>
              <div><b className="text-cyan-300">WASD</b> move · <b className="text-cyan-300">Shift</b> sprint · <b className="text-cyan-300">Space</b> jump</div>
              <div><b className="text-cyan-300">LMB / E</b> M1 attack / fire (manual)</div>
              <div><b className="text-cyan-300">RMB drag</b> orbit · <b className="text-cyan-300">Wheel / +/- / PgUp/PgDn</b> zoom (≤300m)</div>
              <div><b className="text-cyan-300">Z X C V B F G N M L K J</b> skills (hold for charge skills)</div>
              <div><b className="text-cyan-300">1-9, 0, -</b> equip / unequip · <b className="text-cyan-300">O/Esc</b> graphics · <b className="text-cyan-300">H</b> help</div>
              <div className="text-cyan-200/60 mt-1">Controller: LS move · RS orbit · LT zoom in · Select zoom out · RT fire · A jump · X/Y/B/LB/RB/D-pad skills · Start cycle item</div>
            </div>
          )}
          </div>
          {/* Right rail: telemetry, skills and zoom stack in one column, so they cannot overlap */}
          <div className="absolute right-2 top-2 w-[236px] max-sm:w-[44vw] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'calc(var(--hud-bottom) + var(--ctrl-h))' }}>
          <div data-panel="telemetry" className="sf-panel p-2.5 w-full text-[10px] shrink-0 pointer-events-auto [@media(max-height:560px)]:hidden">
            <div className="font-orb text-[10px] sf-glow text-cyan-200 mb-1">RANGE TELEMETRY</div>
            <div className="flex justify-between"><span className="text-cyan-300/70">AIM (ground)</span><span className="font-orb tabular-nums">{snap.aimDist.toFixed(2)} m</span></div>
            <div className="flex justify-between"><span className="text-cyan-300/70">AIM (3D)</span><span className="font-orb tabular-nums">{snap.aim3D.toFixed(2)} m</span></div>
            <div className="flex justify-between"><span className="text-cyan-300/70">CAMERA</span><span className="font-orb tabular-nums">{snap.camDist.toFixed(1)} / 300 m</span></div>
            <div className="flex justify-between"><span className="text-cyan-300/70">NEAREST HOSTILE</span><span className="font-orb tabular-nums">{snap.nearest.toFixed(2)} m</span></div>
            <div className="flex justify-between"><span className="text-cyan-300/70">POS</span><span className="font-orb tabular-nums">{snap.pos[0].toFixed(0)}, {snap.pos[1].toFixed(0)}</span></div>
            {settings.showFps && <div className="flex justify-between mt-1 pt-1 border-t border-cyan-300/15"><span className="text-cyan-300/70">FPS · BOLTS · FX</span><span className="font-orb tabular-nums" style={{ color: snap.fps > 45 ? '#7fffc0' : snap.fps > 25 ? '#ffe070' : '#ff7080' }}>{snap.fps} · {snap.bolts} · {snap.effects}</span></div>}
            <div className="flex gap-1 mt-1.5 pointer-events-auto">
              <button className="sf-btn flex-1 py-0.5 font-orb text-[9px]" onClick={() => setShowSettings(true)}>GRAPHICS</button>
              <button className="sf-btn flex-1 py-0.5 font-orb text-[9px]" onClick={() => setHelp(h => !h)}>CONTROLS</button>
            </div>
          </div>
          {/* Toasts */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
            {toasts.map(t => <div key={t.id} className="toast-in sf-panel px-4 py-1 font-orb text-[11px] tracking-widest" style={{ color: t.c, textShadow: `0 0 10px ${t.c}` }}>{t.m}</div>)}
          </div>
          <SkillBar game={game} equipped={snap.equipped} touch={touch} />
          <ZoomControl game={game} zoom={snap.zoomTarget} />
          </div>
          <Inventory game={game} equipped={snap.equipped} />
          {!item && <div className="absolute left-1/2 -translate-x-1/2 font-orb text-[10px] text-cyan-200/70 sf-glow" style={{ bottom: 'calc(var(--hud-bottom) + 4px)' }}>SELECT A FRUIT OR SWORD FROM INVENTORY {touch ? '' : '(1-9, 0, -)'}</div>}
          {touch && <MobileControls game={game} />}
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2 w-8 h-8 opacity-60" style={{ transform: 'translate(-50%,-50%)' }}>
            <div className="absolute inset-0 crosshair"><div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-300" /><div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-300" /></div>
            <div className="absolute inset-1 border border-cyan-300/40 sf-pulse" style={{ borderRadius: '50%' }} />
          </div>
        </div>
      )}
      {showSettings && <Settings settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
