import { useEffect, useRef, useState } from 'react';
import { Game, defaultSettings } from './game/Game';
import type { GraphicsSettings } from './game/types';
import { SkillBar } from './ui/SkillBar';
import { Inventory, Settings, MobileControls, ZoomControl } from './ui/Panels';

type Snap = ReturnType<Game['snapshot']>;
const fmt = (n: number) => (n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));

export default function App() {
  const host = useRef<HTMLDivElement>(null); const overlay = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [settings, setSettings] = useState<GraphicsSettings>(() => { try { return { ...defaultSettings(), ...JSON.parse(localStorage.getItem('f1090gfx') || '{}') }; } catch { return defaultSettings(); } });
  const [showSettings, setShowSettings] = useState(false);
  const [help, setHelp] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; m: string; c: string }[]>([]);

  useEffect(() => {
    const g = new Game(host.current!, settings); setGame(g); (window as any).game = g;
    let tid = 0;
    g.onToast = (m, c) => { const id = ++tid; setToasts(t => [...t.slice(-4), { id, m, c }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2200); };
    const iv = setInterval(() => setSnap(g.snapshot()), 100);
    let raf = 0; const ov = () => { raf = requestAnimationFrame(ov); if (overlay.current) { overlay.current.style.background = g.overlay.color; overlay.current.style.opacity = String(Math.min(0.85, g.overlay.a)); } }; ov();
    const kd = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') setShowSettings(s => !s); if (e.key === 'h' || e.key === 'H') setHelp(h => !h); };
    window.addEventListener('keydown', kd);
    return () => { clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); g.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeSettings = (s: GraphicsSettings) => { setSettings(s); game?.applySettings(s); localStorage.setItem('f1090gfx', JSON.stringify(s)); };
  const touch = game?.isTouch ?? false;
  const item = game && snap && snap.equipped >= 0 ? game.items[snap.equipped] : null;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div ref={host} className="absolute inset-0" />
      <div ref={overlay} className="absolute inset-0 pointer-events-none" style={{ opacity: 0, mixBlendMode: 'screen' }} />
      {game && snap && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Vitals */}
          <div className="sf-panel absolute left-2 top-2 p-2.5 w-[250px] max-sm:w-[190px]">
            <div className="flex justify-between items-baseline"><span className="font-orb text-[11px] sf-glow text-cyan-200">1090 FRUITS // OPERATOR</span>{snap.invincible && <span className="text-[9px] font-orb text-yellow-200">INVULN</span>}</div>
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
          {/* Range telemetry */}
          <div className="sf-panel absolute right-2 top-2 p-2.5 w-[200px] max-sm:w-[160px] text-[10px]">
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
          {!item && <div className="absolute bottom-[78px] left-1/2 -translate-x-1/2 font-orb text-[10px] text-cyan-200/70 sf-glow">SELECT A FRUIT OR SWORD FROM INVENTORY {touch ? '' : '(1-9, 0, -)'}</div>}
          {help && !touch && (
            <div className="sf-panel absolute left-2 top-[150px] p-2.5 w-[250px] text-[10.5px] leading-snug pointer-events-auto">
              <div className="flex justify-between font-orb text-[10px] text-cyan-200 mb-1"><span>CONTROLS</span><button className="sf-btn px-1" onClick={() => setHelp(false)}>✕</button></div>
              <div><b className="text-cyan-300">WASD</b> move · <b className="text-cyan-300">Shift</b> sprint · <b className="text-cyan-300">Space</b> jump</div>
              <div><b className="text-cyan-300">LMB / E</b> M1 attack / fire (manual)</div>
              <div><b className="text-cyan-300">RMB drag</b> orbit · <b className="text-cyan-300">Wheel / +/- / PgUp/PgDn</b> zoom (≤300m)</div>
              <div><b className="text-cyan-300">Z X C V B F G N M L K J</b> skills (hold for charge skills)</div>
              <div><b className="text-cyan-300">1-9, 0, -</b> equip / unequip · <b className="text-cyan-300">O/Esc</b> graphics · <b className="text-cyan-300">H</b> help</div>
              <div className="text-cyan-200/60 mt-1">Controller: LS move · RS orbit · LT zoom in · Select zoom out · RT fire · A jump · X/Y/B/LB/RB/D-pad skills · Start cycle item</div>
            </div>
          )}
          <SkillBar game={game} equipped={snap.equipped} touch={touch} />
          <Inventory game={game} equipped={snap.equipped} />
          <ZoomControl game={game} zoom={snap.zoomTarget} />
          {touch && <MobileControls game={game} />}
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 opacity-60"><div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-300" /><div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-300" /></div>
        </div>
      )}
      {showSettings && <Settings settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
