import { useRef, useState, type ReactNode } from 'react';
import type { Game } from '../game/Game';
import { PRESETS, MAX_ZOOM, MIN_ZOOM } from '../game/Game';
import type { GraphicsSettings } from '../game/types';

export function Inventory({ game, equipped }: { game: Game; equipped: number }) {
  const keyLabel = (i: number) => (i < 9 ? String(i + 1) : i === 9 ? '0' : '-');
  return (
    <div data-panel="inventory" className="inventory-dock absolute bottom-2 left-0 right-0 px-2 flex justify-center pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
      <div data-panel="inventory-row" className="inventory-row flex gap-1 items-end justify-center" style={{ maxWidth: 'var(--inv-max)' }}>
        {game.items.map((it, i) => (
          <button key={it.id} className={`slot ${equipped === i ? 'eq' : ''}`} style={{ animationDelay:`${Math.min(i,8)*28}ms` }} onClick={() => game.toggleEquip(i)} title={`${it.name} (${it.type})`} aria-label={`Equip ${it.name}`} aria-pressed={equipped === i} data-ui-sound="none">
            <span className="slot-key font-orb">{keyLabel(i)}</span>
            <span className="slot-type font-orb" style={{ color: it.type === 'fruit' ? '#b4d0a4' : '#d7bd86' }}>{it.type === 'fruit' ? 'FRUIT' : 'SWORD'}</span>
            <span className="slot-icon" style={{ color: it.color, textShadow: `0 0 12px ${it.color}` }}>{it.glyph}</span>
            <span className="slot-name">{it.name.replace(' Fruit', '').replace(' (Thunder)', '').replace(' (Quake)', '')}</span>
            {equipped === i && <span className="slot-active" style={{ background: it.color, boxShadow: `0 0 10px ${it.color}` }} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center justify-between gap-3 py-1 border-b border-cyan-300/10 text-[12px]"><span className="text-cyan-100/80">{label}</span><span className="flex items-center gap-2">{children}</span></label>;
}

export function Settings({ settings, closing, onChange, onClose, onExited }: { settings: GraphicsSettings; closing: boolean; onChange: (s: GraphicsSettings) => void; onClose: () => void; onExited: () => void }) {
  const set = <K extends keyof GraphicsSettings>(k: K, v: GraphicsSettings[K]) => onChange({ ...settings, [k]: v });
  const num = (k: keyof GraphicsSettings, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => (
    <><input type="range" min={min} max={max} step={step} value={settings[k] as number} onChange={e => set(k, +e.target.value as any)} className="w-28" /><span className="w-12 text-right font-orb text-[10px]">{fmt(settings[k] as number)}</span></>
  );
  const tog = (k: keyof GraphicsSettings) => <button className={`sf-btn px-2 text-[10px] font-orb ${settings[k] ? 'on' : ''}`} onClick={() => set(k, !settings[k] as any)} data-ui-sound="toggle">{settings[k] ? 'ON' : 'OFF'}</button>;
  return (
    <div className={`ui-modal-shell absolute inset-0 grid place-items-center bg-black/70 pointer-events-auto z-50 ${closing ? 'ui-modal-closing' : ''}`} onPointerDown={e => e.stopPropagation()} onAnimationEnd={e => { if (e.target === e.currentTarget && closing) onExited(); }}>
      <div className="ui-modal-backdrop absolute inset-0" onClick={onClose} />
      <div data-panel="settings-dialog" className={`sf-panel relative z-[1] w-[420px] max-w-[94vw] max-h-[88vh] overflow-y-auto p-4 ${closing ? 'ui-panel-closing' : ''}`}>
        <div className="flex justify-between items-center mb-2"><h2 className="font-orb text-sm sf-glow text-cyan-200">SETTINGS // ARENA SYSTEMS</h2><button className="sf-btn px-2 text-xs" onClick={onClose} data-ui-sound="close">✕</button></div>
        <div className="flex gap-1 mb-2">
          {(['low', 'medium', 'high', 'ultra'] as const).map(p => <button key={p} className={`sf-btn flex-1 py-1 text-[10px] font-orb ${settings.preset === p ? 'on' : ''}`} onClick={() => onChange({ ...settings, ...PRESETS[p], preset: p })} data-ui-sound="toggle">{p.toUpperCase()}</button>)}
        </div>
        <div className="settings-section mt-4 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">GAMEPLAY</div>
        <Row label="Sandbox Mode"><button className={`sf-btn px-2 text-[10px] font-orb ${settings.sandbox ? 'on' : ''}`} onClick={() => set('sandbox', !settings.sandbox)}>{settings.sandbox ? 'ON' : 'OFF'}</button></Row>
        <p className="text-[10px] text-cyan-200/45 py-1">Unlimited health · incoming damage disabled · all skill cooldowns reset to zero.</p>
        <div className="settings-section mt-3 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">GRAPHICS</div>
        <Row label="Render Resolution">{num('resolution', 0.4, 1.5, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
        <Row label="Shadows">{tog('shadows')}</Row>
        <Row label="Shadow Resolution"><select value={settings.shadowRes} onChange={e => set('shadowRes', +e.target.value)} className="text-[11px] px-1">{[512, 1024, 2048, 4096].map(v => <option key={v} value={v}>{v}</option>)}</select></Row>
        <Row label="Bloom / Glow">{tog('bloom')}</Row>
        <Row label="Bloom Strength">{num('bloomStrength', 0, 2.5, 0.05)}</Row>
        <Row label="FXAA Anti-Aliasing">{tog('antialiasFxaa')}</Row>
        <Row label="Motion Interpolation (60 Hz)">{tog('frameInterpolation')}</Row>
        <p className="text-[10px] text-cyan-200/45 py-1">Linear motion-vector pose blending for the player, enemies, and camera. Uses a fixed 60 Hz simulation and a one-tick presentation delay; not AI or optical-flow frame generation.</p>
        <Row label="Particle Density">{num('particles', 0.1, 1, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
        <Row label="Debris Density">{num('debris', 0.1, 1, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
        <Row label="Cloud Detail">{num('clouds', 0.3, 1.5, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
        <Row label="Max Lightning Bolts">{num('maxBolts', 20, 500, 10, v => `${v}`)}</Row>
        <Row label="Draw Distance">{num('drawDistance', 5000, 60000, 1000, v => `${(v / 1000).toFixed(0)} km`)}</Row>
        <Row label="Atmospheric Fog">{tog('fog')}</Row>
        <Row label="Exposure">{num('exposure', 0.5, 2, 0.05)}</Row>
        <Row label="Camera Shake Strength">{num('shake', 0, 2, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
        <Row label="Positional Shake">{tog('positionShake')}</Row>
        <Row label="Rotational Shake">{tog('rotationShake')}</Row>
        <Row label="Show FPS">{tog('showFps')}</Row>
        <p className="text-[10px] text-cyan-200/50 mt-2">Settings apply instantly. Lightning segments re-rotate every 0.01s via GPU-expanded ribbons (no geometry rebuilds).</p>
      </div>
    </div>
  );
}

export function MobileControls({ game }: { game: Game }) {
  const base = useRef<HTMLDivElement>(null); const [knob, setKnob] = useState({ x: 0, y: 0 }); const id = useRef<number | null>(null);
  const move = (cx: number, cy: number) => { const r = base.current!.getBoundingClientRect(); let x = (cx - (r.left + r.width / 2)) / (r.width / 2), y = (cy - (r.top + r.height / 2)) / (r.height / 2); const l = Math.hypot(x, y); game.touchSprint = l > 1.05; if (l > 1) { x /= l; y /= l; } game.joy.x = x; game.joy.y = y; setKnob({ x, y }); };
  const end = () => { id.current = null; game.joystickActive = false; game.touchSprint = false; game.joy.x = 0; game.joy.y = 0; setKnob({ x: 0, y: 0 }); };
  return (
    <>
      <div ref={base} className="mobile-joystick absolute left-5 bottom-24 w-32 h-32 rounded-full border border-cyan-300/40 bg-cyan-400/5 pointer-events-auto touch-none"
        onPointerDown={e => { e.stopPropagation(); id.current = e.pointerId; game.joystickActive = true; e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX, e.clientY); }}
        onPointerMove={e => { if (id.current === e.pointerId) move(e.clientX, e.clientY); }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        <div className="absolute -bottom-5 left-0 right-0 text-center font-orb text-[8px] text-cyan-100/55 pointer-events-none">PUSH PAST RIM TO RUN</div>
        <div className="absolute w-12 h-12 rounded-full bg-cyan-300/30 border border-cyan-200/70 shadow-[0_0_16px_rgba(51,224,255,.5)]" style={{ left: `calc(50% - 24px + ${knob.x * 40}px)`, top: `calc(50% - 24px + ${knob.y * 40}px)` }} />
      </div>
      <button className="mobile-jump absolute right-5 bottom-20 pointer-events-auto font-orb" onPointerDown={e => { e.stopPropagation(); e.preventDefault(); game.jump(); }} aria-label="Jump">
        <span className="mobile-jump-icon" aria-hidden="true">↑</span><span>JUMP</span>
      </button>
    </>
  );
}

/** Zoom control usable on PC, laptop (touchpad), mobile, console & TV remotes (focusable buttons + slider). */
export function ZoomControl({ game, zoom }: { game: Game; zoom: number }) {
  return (
    <div data-panel="zoom" className="sf-panel w-full shrink-0 mt-auto p-1.5 flex items-center gap-1 justify-between pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
      <button className="sf-btn w-7 h-7 font-orb text-sm" onClick={() => game.zoomBy(-10)} aria-label="Zoom in">+</button>
      <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={1} value={zoom} onChange={e => game.setZoom(+e.target.value)} className="flex-1 min-w-0" aria-label="Camera distance" />
      <button className="sf-btn w-7 h-7 font-orb text-sm" onClick={() => game.zoomBy(10)} aria-label="Zoom out">−</button>
      <span className="font-orb text-[9px] w-11 text-right text-cyan-100 shrink-0">{zoom.toFixed(0)}m</span>
    </div>
  );
}
