import { useEffect, useRef, useState, type MouseEvent, type AnimationEvent } from 'react';
import { Game, PRESETS, defaultSettings } from './game/Game';
import type { GraphicsSettings } from './game/types';
import type { UiSoundKind } from './game/audio';
import { SkillBar } from './ui/SkillBar';
import { Inventory, Settings, MobileControls, ZoomControl } from './ui/Panels';
import { UpdateLog } from './ui/UpdateLog';

type Snap = ReturnType<Game['snapshot']>;
const fmt = (n: number) => (n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));

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
    sandbox: bool(s.sandbox, d.sandbox),
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
    positionShake: bool(s.positionShake, d.positionShake),
    rotationShake: bool(s.rotationShake, d.rotationShake),
    showFps: bool(s.showFps, d.showFps),
    antialiasFxaa: bool(s.antialiasFxaa, d.antialiasFxaa),
    frameInterpolation: bool(s.frameInterpolation, d.frameInterpolation),
    frameInterpolationMethod: s.frameInterpolationMethod === 'frameHold' ? 'frameHold' : 'linear',
    motionBlur: bool(s.motionBlur, d.motionBlur),
    motionBlurStrength: num(s.motionBlurStrength, 0.5, 0.96, d.motionBlurStrength),
    lightningSegments: num(s.lightningSegments, 6, 36, d.lightningSegments),
    lightningJitter: num(s.lightningJitter, 0, 2.5, d.lightningJitter),
    lightningBranches: num(s.lightningBranches, 0, 6, d.lightningBranches),
    lightningJaggedness: num(s.lightningJaggedness, 0.1, 3, d.lightningJaggedness),
    lightningWidth: num(s.lightningWidth, 0.4, 2.5, d.lightningWidth),
    lightningHeight: num(s.lightningHeight, 0.5, 2.5, d.lightningHeight),
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
  const [closingSettings, setClosingSettings] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);
  const [closingUpdates, setClosingUpdates] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const [leavingTitle, setLeavingTitle] = useState(false);
  const [showGui, setShowGui] = useState(true);
  const [guiClosing, setGuiClosing] = useState(false);
  const [help, setHelp] = useState(true);
  const [helpClosing, setHelpClosing] = useState(false);
  const settingsOpenRef = useRef(showSettings); settingsOpenRef.current = showSettings;
  const settingsClosingRef = useRef(closingSettings); settingsClosingRef.current = closingSettings;
  const helpOpenRef = useRef(help); helpOpenRef.current = help;
  const helpClosingRef = useRef(helpClosing); helpClosingRef.current = helpClosing;
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; m: string; c: string }[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const toggleSound = () => { const next=!soundEnabled; game?.audio.setEnabled(next); setSoundEnabled(next); };
  const enterArena = () => {
    if (!game || leavingTitle) return;
    game.audio.unlock(); game.paused = false; setLeavingTitle(true);
  };
  const onUiClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest('button');
    if (!button || button.disabled || button.dataset.uiSound === 'none') return;
    game?.audio.uiSound((button.dataset.uiSound as UiSoundKind | undefined) ?? 'click');
  };
  const openSettings = () => { setClosingSettings(false); setShowSettings(true); };
  const closeSettings = () => { if (showSettings) setClosingSettings(true); };
  const finishSettingsClose = () => { setShowSettings(false); setClosingSettings(false); };
  const openUpdates = () => { setClosingUpdates(false); setShowUpdates(true); };
  const closeUpdates = () => { if (showUpdates) setClosingUpdates(true); };
  const finishUpdatesClose = () => { setShowUpdates(false); setClosingUpdates(false); };
  const toggleHelp = () => { if (help && !helpClosing) setHelpClosing(true); else { setHelpClosing(false); setHelp(true); } };
  const toggleGui = () => { if (showGui) { setGuiClosing(true); if (showSettings) closeSettings(); } else { setShowGui(true); setGuiClosing(false); } };
  const onGuiCloseAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => { if (e.target === e.currentTarget && guiClosing) { setShowGui(false); setGuiClosing(false); } };

  useEffect(() => {
    // Cross-fade the HTML safety loader into React's title card instead of cutting between them.
    const boot = document.getElementById('boot');
    clearTimeout((window as unknown as { __bootTimer?: number }).__bootTimer);
    clearTimeout((window as unknown as { __bootSlowTimer?: number }).__bootSlowTimer);
    if (!boot) return;
    const frame = requestAnimationFrame(() => boot.classList.add('boot-leaving'));
    const remove = window.setTimeout(() => boot.remove(), 560);
    return () => { cancelAnimationFrame(frame); clearTimeout(remove); };
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
      console.error('[MagicCloud] failed to start', e);
      setFatal((e instanceof Error ? `${e.name}: ${e.message}` : String(e)) + ' · ' + navigator.userAgent);
      return;
    }
    g.onFatal = m => setFatal(`Render loop stopped — ${m}`);
    setGame(g); (window as any).game = g;
    let tid = 0;
    g.onToast = (m, c) => { const id = ++tid; setToasts(t => [...t.slice(-4), { id, m, c }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2200); };
    const iv = setInterval(() => setSnap(g.snapshot()), 100);
    let raf = 0; const ov = () => { raf = requestAnimationFrame(ov); if (overlay.current) { overlay.current.style.background = g.overlay.color; overlay.current.style.opacity = String(Math.min(0.85, g.overlay.a)); } }; ov();
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') {
        if (settingsOpenRef.current && !settingsClosingRef.current) { g.audio.uiSound('close'); setClosingSettings(true); }
        else if (!settingsOpenRef.current) { g.audio.uiSound('open'); setClosingSettings(false); setShowSettings(true); }
      }
      if (e.key === 'h' || e.key === 'H') {
        if (helpOpenRef.current && !helpClosingRef.current) { g.audio.uiSound('close'); setHelpClosing(true); }
        else { g.audio.uiSound('open'); setHelpClosing(false); setHelp(true); }
      }
    };
    window.addEventListener('keydown', kd);
    return () => { clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); g.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeSettings = (s: GraphicsSettings) => { setSettings(clampSettings(s)); game?.applySettings(clampSettings(s)); localStorage.setItem('f1090gfx', JSON.stringify(clampSettings(s))); };
  const touch = game?.isTouch ?? false;
  const item = game && snap && snap.equipped >= 0 ? game.items[snap.equipped] : null;

  return (
    <div className="fixed inset-0 overflow-hidden" onClickCapture={onUiClickCapture}>
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
      {game && snap && !showTitle && (showGui || guiClosing) && (
        <div className={`absolute inset-0 pointer-events-none ${guiClosing ? 'ui-hud-closing' : ''}`} onAnimationEnd={onGuiCloseAnimationEnd}>
          <div className="damage-indicator-layer absolute inset-0 overflow-hidden" aria-hidden="true">
            {snap.damageIndicators.map(d => <div key={d.id} className={`damage-indicator ${d.crit ? 'damage-indicator-crit' : ''}`} style={{ left: `${d.x}%`, top: `${d.y}%` }}>{d.crit && <span>CRIT </span>}{fmt(d.amount)}</div>)}
          </div>
          {/* Left rail: vitals and controls stack in one column, so they cannot overlap */}
          <div className="absolute left-2 top-2 hud-rail-left w-[250px] max-sm:w-[44vw] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'var(--hud-bottom)' }}>
          <div data-panel="vitals" className="sf-panel p-2.5 w-full shrink-0 pointer-events-auto">
            <div className="flex justify-between items-baseline"><span className="font-orb text-[11px] sf-glow text-cyan-200">MAGIC CLOUD // OPERATOR</span>{settings.sandbox && <span className="text-[9px] font-orb text-emerald-200 sandbox-tag">SANDBOX</span>}{snap.invincible && <span className="text-[9px] font-orb text-yellow-200">INVULN</span>}</div>
            <div className="hex-bar mt-1.5"><div className="h-full" style={{ width: `${(snap.hp / snap.maxHp) * 100}%`, background: 'linear-gradient(90deg,#16ffb0,#33e0ff)', boxShadow: '0 0 10px #33e0ff' }} /></div>
            <div className="flex justify-between text-[10px] mt-0.5 font-orb text-cyan-100/80"><span>HP {fmt(snap.hp)} / {fmt(snap.maxHp)}</span><span>{((snap.hp / snap.maxHp) * 100).toFixed(0)}%</span></div>
            <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px]">
              <div><div className="text-cyan-300/60">KILLS</div><div className="font-orb">{snap.kills}</div></div>
              <div><div className="text-cyan-300/60">DPS</div><div className="font-orb">{fmt(snap.dps)}</div></div>
              <div><div className="text-cyan-300/60">HOSTILES</div><div className="font-orb">{snap.alive}</div></div>
            </div>
            {item?.id === 'gblade' && <div className="mt-1.5"><div className="flex justify-between text-[9px] font-orb text-violet-200"><span>LIGHTNING CHARGE</span><span>{snap.charge.toFixed(0)}%</span></div><div className="hex-bar"><div className="h-full" style={{ width: `${snap.charge}%`, background: 'linear-gradient(90deg,#7a5cff,#e080ff)', boxShadow: '0 0 8px #b080ff' }} /></div></div>}
            {snap.buffs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{snap.buffs.map(b => <span key={b.k} className="text-[9px] font-orb px-1.5 py-0.5 border border-rose-300/50 bg-rose-500/15 text-rose-100">{b.k.toUpperCase()} {b.rem.toFixed(1)}s</span>)}</div>}
          </div>
          {help && !touch && (
            <div data-panel="controls" className={`sf-panel p-2.5 w-full text-[10.5px] leading-snug pointer-events-auto ui-scroll min-h-0 ${helpClosing ? 'ui-panel-closing' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget && helpClosing) { setHelp(false); setHelpClosing(false); } }}>
              <div className="flex justify-between font-orb text-[10px] text-cyan-200 mb-1"><span>CONTROLS</span><button className="sf-btn px-1" onClick={toggleHelp} data-ui-sound="close">✕</button></div>
              <div><b className="text-cyan-300">WASD</b> move · <b className="text-cyan-300">Shift</b> sprint · <b className="text-cyan-300">Space</b> jump</div>
              <div><b className="text-cyan-300">LMB / E</b> M1 attack / fire (manual)</div>
              <div><b className="text-cyan-300">RMB drag</b> orbit · <b className="text-cyan-300">P</b> view · <b className="text-cyan-300">Wheel / +/- / PgUp/PgDn</b> zoom (≤900m)</div>
              <div><b className="text-cyan-300">Z X C V B F G N M L K J</b> skills (hold for charge skills)</div>
              <div><b className="text-cyan-300">1-9, 0, -</b> equip / unequip · <b className="text-cyan-300">O/Esc</b> graphics · <b className="text-cyan-300">H</b> help</div>
              <div className="text-cyan-200/60 mt-1">Controller: LS move · RS orbit · LT zoom in · Select zoom out · RT fire · A jump · X/Y/B/LB/RB/D-pad skills · Start cycle item</div>
            </div>
          )}
          </div>
          {/* Right rail: telemetry, skills and zoom stack in one column, so they cannot overlap */}
          <div className="absolute right-2 top-2 hud-rail-right w-[236px] max-sm:w-[44vw] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'var(--hud-bottom)' }}>
          <button className="telemetry-toggle sf-btn self-end pointer-events-auto font-orb" onClick={() => setShowTelemetry(v => !v)} aria-expanded={showTelemetry} aria-label={showTelemetry ? 'Hide range telemetry' : 'Show range telemetry'}>{showTelemetry ? 'RANGE ▾' : 'RANGE ▸'}</button>
          {showTelemetry && <div data-panel="telemetry" className="sf-panel telemetry-panel p-2 w-full text-[9px] shrink-0 pointer-events-auto">
            <div className="telemetry-head"><span className="font-orb text-[10px] sf-glow text-cyan-200">FIELD TELEMETRY</span>{settings.showFps && <span className="font-orb telemetry-fps" style={{ color:snap.fps>45?'#a8d8a4':snap.fps>25?'#e5d49f':'#d99183' }}>{snap.fps} FPS · {snap.bolts}B · {snap.effects}FX</span>}</div>
            <div className="telemetry-grid">
              <div className="telemetry-cell"><span>AIM GND</span><b>{snap.aimDist.toFixed(1)}m</b></div>
              <div className="telemetry-cell"><span>AIM 3D</span><b>{snap.aim3D.toFixed(1)}m</b></div>
              <div className="telemetry-cell"><span>NEAREST</span><b>{snap.nearest.toFixed(0)}m</b></div>
              <div className="telemetry-cell"><span>CAMERA</span><b>{game.firstPerson?'FP':`${snap.camDist.toFixed(0)}m`}</b></div>
              <div className="telemetry-cell"><span>POSITION</span><b>{snap.pos[0].toFixed(0)},{snap.pos[1].toFixed(0)}</b></div>
              <div className="telemetry-cell"><span>HOSTILES</span><b>{snap.alive}</b></div>
            </div>
            <div className="telemetry-actions pointer-events-auto">
              <button className="sf-btn font-orb" onClick={openSettings} data-ui-sound="open" title="Settings" aria-label="Settings">SET</button>
              <button className={`sf-btn font-orb ${game.firstPerson ? 'on' : ''}`} onClick={() => game.toggleFirstPerson()} title="Toggle first/third person" aria-label="Toggle camera">{game.firstPerson?'FP':'TP'}</button>
              <button className="sf-btn font-orb" onClick={toggleHelp} data-ui-sound="toggle" title="Controls" aria-label="Controls">HELP</button>
              <button className={`sf-btn font-orb ${soundEnabled ? 'on' : ''}`} onClick={toggleSound} title={soundEnabled?'Mute weather audio':'Enable weather audio'} aria-label={soundEnabled?'Mute weather audio':'Enable weather audio'}>SND</button>
            </div>
          </div>}
          {/* Toasts */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
            {toasts.map(t => <div key={t.id} className="toast-in sf-panel px-4 py-1 font-orb text-[11px] tracking-widest" style={{ color: t.c, textShadow: `0 0 10px ${t.c}` }}>{t.m}</div>)}
          </div>
          <SkillBar game={game} equipped={snap.equipped} touch={touch} />
          <ZoomControl game={game} zoom={snap.zoomTarget} />
          </div>
          <Inventory game={game} equipped={snap.equipped} />
          {!item && <div className="absolute left-1/2 -translate-x-1/2 font-orb text-[10px] text-cyan-200/70 sf-glow" style={{ bottom: 'calc(var(--hud-bottom) + 4px)' }}>SELECT A FRUIT OR SWORD FROM INVENTORY {touch ? '' : '(1-9, 0, -)'}</div>}
          {touch && item && <div className="mobile-tap-hint absolute left-1/2 -translate-x-1/2 font-orb text-[9px] text-cyan-100/75" style={{ bottom: 'calc(var(--hud-bottom) + 4px)' }}>TAP SCREEN TO ATTACK</div>}
          {touch && <MobileControls game={game} />}
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 opacity-60"><div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-300" /><div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-300" /></div>
        </div>
      )}
      {showTitle && !fatal && (
        <div className={`title-screen absolute inset-0 z-40 grid place-items-center p-5 pointer-events-auto ${leavingTitle ? 'title-screen-exit' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget && leavingTitle) setShowTitle(false); }}>
          <div className="title-card main-menu-card sf-panel w-full max-w-[780px] p-5 sm:p-8">
            <header className="menu-header flex items-center justify-between gap-4">
              <div className="flex items-center gap-3"><div className="title-mark"><span>MC</span><i /></div><div><p className="font-orb text-[9px] tracking-[.3em] text-cyan-100/60">OPEN FIELD // OPERATIONS</p><p className="mt-1 text-[10px] text-cyan-100/40">COMBAT SIMULATION · EST. 2026</p></div></div>
              <div className="menu-release font-orb text-[9px]">BUILD 1.5.0 <span>●</span></div>
            </header>
            <div className="title-rule my-5" />
            <div className="menu-columns grid grid-cols-1 md:grid-cols-[1.1fr_.9fr] gap-6 md:gap-8">
              <section className="menu-brief min-w-0">
                <p className="menu-kicker font-orb text-[9px] tracking-[.28em] text-amber-200/80">FIELD COMMAND // READY</p>
                <h1 className="mt-3 font-orb text-4xl sm:text-6xl font-bold leading-none tracking-[.08em] text-white sf-glow">MAGIC<br/><span className="menu-title-second">CLOUD</span></h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-cyan-50/65">Choose your power. Read the weather. Take the arena.</p>
                <div className="menu-readouts mt-6 grid grid-cols-3 gap-2">
                  <div><b>FIELD</b><span>OPEN</span></div><div><b>WEATHER</b><span>LIVE</span></div><div><b>HOSTILES</b><span>ACTIVE</span></div>
                </div>
                <div className="menu-threat-strip mt-3 flex items-center gap-2"><span className="menu-threat-lamp"/><span>NEW THREATS IDENTIFIED</span><b>STALKER · CASTER · BRUTE</b></div>
                {help && <p className={`menu-control-note mt-5 text-[9px] leading-relaxed text-cyan-100/45 ${helpClosing ? 'ui-panel-closing' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget && helpClosing) { setHelp(false); setHelpClosing(false); } }}>WASD MOVE · SHIFT RUN · SPACE JUMP · RMB ORBIT · LMB ATTACK · Z/X/C/V/B/F/G/N/M/L/K/J SKILLS</p>}
              </section>
              <nav className="menu-actions flex flex-col gap-2" aria-label="Main menu">
                <p className="font-orb mb-1 text-[9px] tracking-[.2em] text-cyan-100/45">SELECT OPERATION</p>
                <button className="play-btn menu-enter w-full px-4 py-4 text-left" onClick={enterArena} data-ui-sound="transition" disabled={!game || leavingTitle}>
                  <span className="menu-action-index">01 / DEPLOY</span><strong className="block mt-1 font-orb text-base tracking-[.16em]">{leavingTitle ? 'ENTERING ARENA' : 'ENTER ARENA'} <span className="float-right">↗</span></strong><small className="mt-1 block text-[9px] tracking-[.08em]">DROP INTO THE OPEN FIELD</small>
                </button>
                <div className="menu-utility-grid grid grid-cols-2 gap-2">
                  <button className="menu-utility sf-btn" onClick={openSettings} data-ui-sound="open"><b>02</b><span>SETTINGS</span><i>↗</i></button>
                  <button className="menu-utility sf-btn" onClick={toggleHelp} data-ui-sound="toggle"><b>03</b><span>CONTROLS</span><i>↗</i></button>
                  <button className="menu-utility sf-btn" onClick={openUpdates} data-ui-sound="open"><b>04</b><span>UPDATE LOG</span><i>↗</i></button>
                  <button className={`menu-utility sf-btn ${soundEnabled ? 'on' : ''}`} onClick={toggleSound} disabled={!game} data-ui-sound="toggle"><b>05</b><span>{soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</span><i>{soundEnabled ? '♫' : '×'}</i></button>
                </div>
              </nav>
            </div>
            <footer className="menu-footer mt-5 flex items-center justify-between gap-3"><span>ARENA SYSTEMS · SANDBOX AVAILABLE IN SETTINGS</span><span>ALL SYSTEMS {game ? 'ONLINE' : 'BOOTING'}</span></footer>
          </div>
        </div>
      )}
      {showSettings && showGui && <Settings settings={settings} closing={closingSettings} onChange={changeSettings} onClose={closeSettings} onExited={finishSettingsClose} />}
      {showUpdates && showTitle && <UpdateLog closing={closingUpdates} onClose={closeUpdates} onExited={finishUpdatesClose} />}
      {game && snap && !showTitle && (
        <button className={`gui-toggle ${showGui ? 'gui-toggle-visible' : 'gui-toggle-hidden'}`} onClick={toggleGui} data-ui-sound={showGui ? "close" : "open"} aria-label={showGui ? 'Hide interface' : 'Show interface'} title={showGui ? 'Hide interface' : 'Show interface'}>
          <span aria-hidden="true">{showGui ? '◉' : '◌'}</span><span>{showGui ? 'HIDE GUI' : 'SHOW GUI'}</span>
        </button>
      )}
    </div>
  );
}
