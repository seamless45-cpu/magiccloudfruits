import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Game } from '../game/Game';
import { PRESETS, MAX_ZOOM, MIN_ZOOM } from '../game/Game';
import type { GraphicsSettings } from '../game/types';

export function Inventory({ game, equipped }: { game: Game; equipped: number }) {
  const keyLabel = (i: number) => (i < 9 ? String(i + 1) : i === 9 ? '0' : '-');
  return (
    <div data-panel="inventory" className="inventory-dock absolute bottom-2 left-0 right-0 px-2 flex justify-center pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
      <div
        data-panel="inventory-row"
        className="inventory-row flex gap-1 items-end justify-start"
        style={{ width: 'max-content', maxWidth: 'var(--inv-max)' }}
        role="region"
        aria-label="Inventory slots. Use the mouse wheel or left and right arrow keys to scroll."
        aria-keyshortcuts="ArrowLeft ArrowRight Home End PageUp PageDown"
        tabIndex={0}
        onWheel={e => {
          const row = e.currentTarget;
          if (row.scrollWidth <= row.clientWidth + 1) return;
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (delta === 0) return;
          e.preventDefault();
          e.stopPropagation();
          row.scrollLeft += delta;
        }}
        onKeyDown={e => {
          const row = e.currentTarget;
          const page = Math.max(80, row.clientWidth * 0.78);
          let next: number | null = null;
          if (e.key === 'ArrowLeft') next = row.scrollLeft - 64;
          else if (e.key === 'ArrowRight') next = row.scrollLeft + 64;
          else if (e.key === 'PageUp') next = row.scrollLeft - page;
          else if (e.key === 'PageDown') next = row.scrollLeft + page;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = row.scrollWidth;
          if (next !== null) { e.preventDefault(); row.scrollTo({ left: next, behavior: 'smooth' }); }
        }}
      >
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
  return <div className="settings-row flex items-center justify-between gap-3 py-1 border-b border-cyan-300/10 text-[12px]"><span className="text-cyan-100/80">{label}</span><span className="flex items-center gap-2">{children}</span></div>;
}

type SettingsProps = {
  settings: GraphicsSettings; closing: boolean; onChange: (s: GraphicsSettings) => void; onClose: () => void; onExited: () => void;
  isFullscreen: boolean; fullscreenError: string; onToggleFullscreen: () => void;
  musicAvailable: boolean; musicName: string; masterVolume: number; musicVolume: number; musicRate: number; musicPlaying: boolean; musicError: string;
  musicDuration: number; musicTrimStart: number; musicTrimEnd: number;
  onMusicFile: (file: File) => void; onMasterVolume: (value: number) => void; onMusicVolume: (value: number) => void; onMusicRate: (value: number) => void;
  onMusicTrimStart: (value: number) => void; onMusicTrimEnd: (value: number) => void; onToggleMusic: () => void;
};

export function Settings({ settings, closing, onChange, onClose, onExited, isFullscreen, fullscreenError, onToggleFullscreen, musicAvailable, musicName, masterVolume, musicVolume, musicRate, musicPlaying, musicError, musicDuration, musicTrimStart, musicTrimEnd, onMusicFile, onMasterVolume, onMusicVolume, onMusicRate, onMusicTrimStart, onMusicTrimEnd, onToggleMusic }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<'core' | 'visuals' | 'lightning' | 'audio'>('core');
  const [interpolationMethodsOpen, setInterpolationMethodsOpen] = useState(false);
  const [lightningSettingsOpen, setLightningSettingsOpen] = useState(false);
  const set = <K extends keyof GraphicsSettings>(k: K, v: GraphicsSettings[K]) => onChange({ ...settings, [k]: v });
  const num = (k: keyof GraphicsSettings, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => {
    const value = settings[k] as number;
    const fill = `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`;
    const label = String(k).replace(/([A-Z])/g, ' $1').toLowerCase();
    return <><input type="range" min={min} max={max} step={step} value={value} onChange={e => set(k, +e.target.value as any)} className="sf-range w-28" style={{ '--range-fill': fill } as CSSProperties} aria-label={`Adjust ${label}`} aria-valuetext={fmt(value)} /><span className="sf-range-value w-12 text-right font-orb text-[10px]">{fmt(value)}</span></>;
  };
  const tog = (k: keyof GraphicsSettings, label = String(k)) => {
    const active = Boolean(settings[k]);
    return <button type="button" role="switch" aria-checked={active} aria-label={`Toggle ${label}`} className={`sf-switch ${active ? 'is-on' : ''}`} onClick={() => set(k, !settings[k] as any)} data-ui-sound="toggle">
      <span className="sf-switch-track" aria-hidden="true"><span className="sf-switch-knob" /></span>
      <span className="sf-switch-state" aria-hidden="true">{active ? 'ON' : 'OFF'}</span>
    </button>;
  };
  const musicRange = (value: number, min: number, max: number, step: number, label: string, format: (n: number) => string, onValue: (n: number) => void) => {
    const fill = max > min ? `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%` : '0%';
    return <><input type="range" min={min} max={max} step={step} value={value} onChange={e => onValue(+e.target.value)} className="sf-range w-28" style={{ '--range-fill': fill } as CSSProperties} aria-label={label} aria-valuetext={format(value)} /><span className="sf-range-value w-12 text-right font-orb text-[10px]">{format(value)}</span></>;
  };
  const tabs = [
    { id: 'core', label: 'CORE' },
    { id: 'visuals', label: 'VISUALS' },
    { id: 'lightning', label: 'LIGHTNING' },
    { id: 'audio', label: 'AUDIO' },
  ] as const;
  const activeTabLabel = tabs.find(tab => tab.id === activeTab)?.label ?? 'CORE';
  return (
    <div className={`ui-modal-shell absolute inset-0 grid place-items-center bg-black/70 pointer-events-auto z-50 ${closing ? 'ui-modal-closing' : ''}`} onPointerDown={e => e.stopPropagation()} onAnimationEnd={e => { if (e.target === e.currentTarget && closing) onExited(); }}>
      <div className="ui-modal-backdrop absolute inset-0" onClick={onClose} />
      <div data-panel="settings-dialog" className={`sf-panel ui-scroll relative z-[1] w-[520px] max-w-[94vw] max-h-[88dvh] overflow-y-auto p-4 ${closing ? 'ui-panel-closing' : ''}`}>
        <div className="flex justify-between items-center mb-3"><h2 className="font-orb text-sm sf-glow text-cyan-200">SETTINGS // {activeTabLabel}</h2><button type="button" className="sf-btn px-2 text-xs" onClick={onClose} data-ui-sound="close" aria-label="Close settings">✕</button></div>
        <div className="settings-preset-heading settings-section mb-2 font-orb text-[10px] tracking-[.18em]">GRAPHICS PROFILE</div>
        <div className="flex gap-1 mb-3" role="group" aria-label="Graphics quality preset">
          {(['low', 'medium', 'high', 'ultra'] as const).map(p => <button type="button" key={p} className={`sf-btn flex-1 py-1 text-[10px] font-orb ${settings.preset === p ? 'on' : ''}`} onClick={() => onChange({ ...settings, ...PRESETS[p], preset: p })} aria-pressed={settings.preset === p} data-ui-sound="toggle">{p.toUpperCase()}</button>)}
        </div>
        <div className="settings-tabs" role="group" aria-label="Settings category">
          {tabs.map(tab => <button type="button" key={tab.id} className="settings-tab font-orb" aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} data-ui-sound="toggle">{tab.label}</button>)}
        </div>

        {activeTab === 'core' && <div className="settings-tab-content" aria-label="Core and display settings">
          <div className="settings-section mt-2 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">ARENA + DISPLAY</div>
          <Row label="Fullscreen mode"><button type="button" className="sf-btn fullscreen-control px-2 py-1 text-[9px] font-orb" onClick={onToggleFullscreen} aria-pressed={isFullscreen} data-ui-sound="toggle">{isFullscreen ? 'EXIT FULLSCREEN' : 'ENTER FULLSCREEN'}</button></Row>
          <p className="text-[10px] text-cyan-200/45 py-1">Fullscreen is requested automatically when you deploy. Browser restrictions may keep the arena windowed.</p>
          {fullscreenError && <p role="status" aria-live="polite" className="text-[10px] text-amber-200/90 py-1">Fullscreen was unavailable; continuing windowed. {fullscreenError}</p>}
          <Row label="Sandbox Mode">{tog('sandbox', 'Sandbox mode')}</Row>
          <p className="text-[10px] text-cyan-200/45 py-1">Unlimited health · incoming damage disabled · all skill cooldowns reset to zero.</p>
          <div className="settings-section mt-3 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">IMAGE QUALITY</div>
          <Row label="Render Resolution">{num('resolution', 0.4, 1.5, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
          <p className="text-[10px] text-cyan-200/45 py-1">Resolution is the ceiling; automatic scaling lowers pixel load below 45 FPS and recovers gradually above 58 FPS.</p>
          <Row label="Shadows">{tog('shadows', 'Shadows')}</Row>
          <Row label="Shadow Resolution"><select aria-label="Shadow resolution" value={settings.shadowRes} onChange={e => set('shadowRes', +e.target.value)} className="text-[11px] px-1" data-ui-sound="none">{[512, 1024, 2048, 4096].map(v => <option key={v} value={v}>{v}</option>)}</select></Row>
          <Row label="Bloom / Glow">{tog('bloom', 'Bloom and glow')}</Row>
          <Row label="Bloom Strength">{num('bloomStrength', 0, 2.5, 0.05)}</Row>
          <Row label="FXAA Anti-Aliasing">{tog('antialiasFxaa', 'FXAA anti-aliasing')}</Row>
        </div>}

        {activeTab === 'visuals' && <div className="settings-tab-content" aria-label="Visual effects settings">
          <div className="settings-section mt-2 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">MOTION PIPELINE</div>
          <Row label="Frame Interpolation"><div className="flex gap-1">{tog('frameInterpolation', 'Frame interpolation')}<button type="button" className="sf-btn px-2 text-[9px] font-orb" onClick={() => setInterpolationMethodsOpen(v => !v)} aria-expanded={interpolationMethodsOpen} aria-controls="interpolation-method-drawer" data-ui-sound="toggle">METHODS ▾</button></div></Row>
          {interpolationMethodsOpen && <div id="interpolation-method-drawer" className="interpolation-method-drawer ui-scroll" role="group" aria-label="Frame interpolation method">
            <div className="font-orb text-[9px] tracking-[.14em] text-cyan-100/70 mb-1.5">SELECT RENDER METHOD</div>
            <button type="button" className={`interpolation-method ${settings.frameInterpolationMethod === 'linear' ? 'selected' : ''}`} onClick={() => set('frameInterpolationMethod', 'linear')} aria-pressed={settings.frameInterpolationMethod === 'linear'}>
              <span className="font-orb text-[10px]">LINEAR MOTION BLEND</span><span>Blends previous and current 60 Hz poses for smoother display motion.</span>
            </button>
            <button type="button" className={`interpolation-method ${settings.frameInterpolationMethod === 'frameHold' ? 'selected' : ''}`} onClick={() => set('frameInterpolationMethod', 'frameHold')} aria-pressed={settings.frameInterpolationMethod === 'frameHold'}>
              <span className="font-orb text-[10px]">FRAME HOLD / DUPLICATION</span><span>Holds the latest 60 Hz pose between simulation ticks; no in-between motion is synthesized.</span>
            </button>
          </div>}
          <p className="text-[10px] text-cyan-200/45 py-1">Both methods use a fixed 60 Hz simulation for player, enemies, and camera. Linear mode adds a one-tick presentation delay; no AI or optical-flow generation is claimed.</p>
          <Row label="Motion-Vector Trail Blur">{tog('motionBlur', 'Motion-vector trail blur')}</Row>
          <Row label="Shutter / Trail Length">{num('motionBlurStrength', 0.4, 0.86, 0.02, v => `${Math.round(v * 100)}%`)}</Row>
          <p className="text-[10px] text-cyan-200/45 py-1">Per-frame camera, mesh, instanced, lightning-ribbon, and particle vectors drive a depth-tested shutter trail. No accumulated after-image.</p>
          <div className="settings-section mt-3 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">SCENE + CAMERA</div>
          <Row label="Particle Density">{num('particles', 0.1, 1, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
          <Row label="Debris Density">{num('debris', 0.1, 1, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
          <Row label="Cloud Detail">{num('clouds', 0.3, 1.5, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
          <Row label="Draw Distance">{num('drawDistance', 5000, 60000, 1000, v => `${(v / 1000).toFixed(0)} km`)}</Row>
          <Row label="Atmospheric Fog">{tog('fog', 'Atmospheric fog')}</Row>
          <Row label="Exposure">{num('exposure', 0.5, 2, 0.05)}</Row>
          <Row label="Camera Shake Strength">{num('shake', 0, 2, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
          <Row label="Positional Shake">{tog('positionShake', 'Positional camera shake')}</Row>
          <Row label="Rotational Shake">{tog('rotationShake', 'Rotational camera shake')}</Row>
          <Row label="Show FPS">{tog('showFps', 'Show FPS')}</Row>
        </div>}

        {activeTab === 'lightning' && <div className="settings-tab-content" aria-label="Lightning settings">
          <div className="settings-section mt-2 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">BOLT GEOMETRY</div>
          <Row label="Lightning Segments">{num('lightningSegments', 6, 48, 2, v => `${v}`)}</Row>
          <Row label="Segment Re-alignment">{num('lightningRealignInterval', 0.005, 0.1, 0.005, v => `${Math.round(v * 1000)} ms`)}</Row>
          <p className="text-[10px] text-cyan-200/45 py-1">Segments set bolt detail; re-alignment sets how often the live centerline refreshes (5–100 ms).</p>
          <div className="settings-section mt-3 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">IMPACT FEEDBACK</div>
          <Row label="Lightning Impact Bursts">{tog('lightningImpactEffects', 'Lightning impact bursts')}</Row>
          <Row label="Impact Burst Size">{num('lightningImpactScale', 0.5, 2.5, 0.05, v => `${Math.round(v * 100)}%`)}</Row>
          <p className="text-[10px] text-cyan-200/45 py-1">Ground strikes emit a bright flash, expanding shock ring, and radial sparks. This visual setting does not alter damage.</p>
          <div className="settings-section mt-3 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">PERFORMANCE + ADVANCED</div>
          <Row label="Max Lightning Bolts">{num('maxBolts', 20, 500, 10, v => `${v}`)}</Row>
          <Row label="Advanced Geometry"><button type="button" className="sf-btn px-2 text-[9px] font-orb" onClick={() => setLightningSettingsOpen(v => !v)} aria-expanded={lightningSettingsOpen} aria-controls="advanced-lightning-settings" data-ui-sound="toggle">{lightningSettingsOpen ? 'CLOSE −' : 'TUNE +'}</button></Row>
          {lightningSettingsOpen && <div id="advanced-lightning-settings" className="lightning-settings-drawer ui-scroll" role="group" aria-label="Advanced lightning settings">
            <Row label="Point jitter">{num('lightningJitter', 0, 2.5, 0.05, v => `${v.toFixed(2)}×`)}</Row>
            <Row label="Branches">{num('lightningBranches', 0, 6, 1, v => `${v}`)}</Row>
            <Row label="Jaggedness">{num('lightningJaggedness', 0.1, 3, 0.05, v => `${v.toFixed(2)}×`)}</Row>
            <Row label="Bolt width">{num('lightningWidth', 0.4, 2.5, 0.05, v => `${v.toFixed(2)}×`)}</Row>
            <Row label="Strike height">{num('lightningHeight', 0.5, 2.5, 0.05, v => `${v.toFixed(2)}×`)}</Row>
          </div>}
        </div>}

        {activeTab === 'audio' && <div className="settings-tab-content" aria-label="Audio and music settings">
          <div className="settings-section mt-2 mb-1 font-orb text-[10px] tracking-[.18em] text-cyan-200/70">AUDIO // MASTER + LOCAL MUSIC</div>
          <Row label="Master Volume">{musicRange(masterVolume, 0, 2, 0.01, 'Master game volume, zero to two hundred percent', v => `${Math.round(v * 100)}%`, onMasterVolume)}</Row>
          <p className="text-[10px] text-cyan-200/55 py-1">Controls all game effects, weather, interface sounds, and music. 200% doubles output; a limiter protects peaks.</p>
          <Row label="Audio track">
            <label className={`sf-file-picker ${!musicAvailable ? 'is-disabled' : ''}`}>
              <input type="file" accept="audio/*,video/mp4,video/webm,video/ogg,video/quicktime,.mp3,.wav,.ogg,.opus,.flac,.aac,.m4a,.aiff,.mp4,.m4v,.webm,.mov,.ogv,.mkv,.avi" aria-label="Upload local music or video media" disabled={!musicAvailable} onChange={e => { const file = e.target.files?.[0]; if (file) onMusicFile(file); e.currentTarget.value = ''; }} />
              <span>{musicName ? 'CHANGE TRACK' : 'LOAD TRACK'}</span><b aria-hidden="true">↥</b>
            </label>
          </Row>
          <p className="media-format-note">LOCAL MEDIA: MP3 · WAV · OGG · FLAC · AAC · MP4 · WEBM · MOV &amp; browser-supported formats</p>
          <Row label="Now playing"><span className="music-track-name" title={musicName || 'No local track selected'}>{musicName || 'NO TRACK LOADED'}</span></Row>
          <Row label="Transport + loop">
            <button type="button" className="sf-btn music-transport px-2 py-1 text-[9px] font-orb" onClick={onToggleMusic} disabled={!musicName} data-ui-sound="toggle" aria-label={musicPlaying ? 'Pause music' : 'Play music'}>{musicPlaying ? 'PAUSE ‖' : 'PLAY ▷'}</button>
            <span className="music-loop-status" aria-label="Looping is always on"><i aria-hidden="true" />LOOP ON</span>
          </Row>
          <Row label="Track Volume">{musicRange(musicVolume, 0, 1, 0.01, 'Uploaded music track volume', v => `${Math.round(v * 100)}%`, onMusicVolume)}</Row>
          <Row label="Playback speed">{musicRange(musicRate, 0.5, 1.5, 0.01, 'Music playback speed', v => `${v.toFixed(2)}×`, onMusicRate)}</Row>
          {musicName && musicDuration >= 0.1 && <>
            <div className="music-trim-heading font-orb">TRIM // {musicDuration.toFixed(1)} SEC</div>
            <Row label="Start point">{musicRange(musicTrimStart, 0, Math.max(0, musicDuration - 0.1), 0.1, 'Music trim start', v => `${v.toFixed(1)}s`, onMusicTrimStart)}</Row>
            <Row label="End point">{musicRange(musicTrimEnd, Math.min(musicDuration, musicTrimStart + 0.1), musicDuration, 0.1, 'Music trim end', v => `${v.toFixed(1)}s`, onMusicTrimEnd)}</Row>
          </>}
          <p className="text-[10px] text-cyan-200/50 py-1">Track volume is a per-file trim; the master fader above affects every sound. Playback rate shifts pitch with speed, and looping stays on.</p>
          {musicError && <p role="alert" className="text-[10px] text-rose-200/90 py-1">{musicError}</p>}
          <p className="text-[10px] text-cyan-200/50 mt-2">Settings apply instantly. Local media stays on this device.</p>
        </div>}
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
      <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={1} value={zoom} onChange={e => game.setZoom(+e.target.value)} className="sf-range flex-1 min-w-0" style={{ '--range-fill': `${((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%` } as CSSProperties} aria-label="Camera distance" />
      <button className="sf-btn w-7 h-7 font-orb text-sm" onClick={() => game.zoomBy(10)} aria-label="Zoom out">−</button>
      <span className="font-orb text-[9px] w-11 text-right text-cyan-100 shrink-0">{zoom.toFixed(0)}m</span>
    </div>
  );
}
