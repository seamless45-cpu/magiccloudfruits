import type { AnimationEvent, CSSProperties } from 'react';

const PATCHES = [
  { tag: 'WEATHER // MICROBURST', title: '10× stronger surface outflow', detail: 'Amplified the sampled pressure-driven cold-pool jet tenfold while keeping the stable bounded solver, downburst footprint, and wind direction intact. The faster outflow also reaches dust, hail, enemies, and the player.' },
  { tag: 'LIGHTNING', title: 'Explosive ground-strike impacts', detail: 'Lightning impacts now bloom into a bright flash, expanding ground ring, and radial sparks for storm strikes and direct bolts. Impact bursts can be switched off or resized in Settings without changing damage.' },
  { tag: 'SETTINGS + DISPLAY', title: 'Tabbed controls and fullscreen deployment', detail: 'Reorganized the long settings sheet into Core, Visuals, Lightning, and Audio sections. Entering the arena requests fullscreen from the deployment click; if the browser declines, play continues windowed.' },
  { tag: 'PWA + INSTALLATION', title: 'Install MagicCloud as a Chrome app', detail: 'Added a standalone web-app manifest, 192px and 512px launcher icons (including a maskable icon), Chrome’s native install action, and an offline app-shell cache. PWA assets publish correctly from both the repository root and /docs.' },
  { tag: 'MAIN MENU', title: 'Compact storm-console deployment deck', detail: 'Replaced the oversized menu card with a tighter field briefing, live arena readouts, a clear deployment action, and quick settings, controls, update-log, and sound buttons. The install action and new-release indicator are visible up front.' },
  { tag: 'BOOT + ACCESSIBILITY', title: 'Large, honest loading progress', detail: 'Expanded the thin meter into a high-contrast progress bar with a clear percentage and accessible progress semantics. It advances only at real startup milestones—app module, WebGL, arena construction, and first rendered frame—and stays put during stalls.' },
  { tag: 'MEDIA + BRANDING', title: 'MP4 music, precise trims, and MagicCloud favicon', detail: 'Load local audio or video files, including MP4 and WebM. Set looping start/end points in 0.1-second steps; playback pitch follows speed. Added a compact favicon rendition of the cloud wizard logo.' },
  { tag: 'SCI-FI INTERFACE + AUDIO', title: 'Fullscreen, local music deck, and console feedback', detail: 'Added fullscreen controls and a local music player with always-on looping, independent volume, and pitch-following playback speed in 0.01 steps. Switches, sliders, and UI cues now use custom sci-fi styling and layered synthesized sounds.' },
  { tag: 'COMBAT FEEDBACK', title: 'Floating damage indicators', detail: 'Damage numbers pop above hit targets, critical hits stand out, and rapid repeat hits aggregate to keep the display readable.' },
  { tag: 'LIGHTNING', title: 'Taller strikes and adjustable bolt geometry', detail: 'Lightning strike columns are twice as tall. Advanced controls tune segment detail, jitter, branches, jaggedness, width, and height.' },
  { tag: 'PRESENTATION', title: 'Real boot milestones and smoother motion trails', detail: 'The loading console now advances on WebGL checks, arena construction, and the first rendered frame instead of timer-driven stages. Motion trails are softer by default and normalized across frame rates to reduce ghosting.' },
  { tag: 'ENEMIES', title: 'Three new arena archetypes', detail: 'Gale Stalkers rush in, Storm Casters fire aimed energy shots, and armored Cloudbreakers resist knockback.' },
  { tag: 'STORM SUPPRESSION', title: 'Rolling cell behavior restored; underbase rain coverage fixed', detail: 'Removed the extra parent canopy and restored rolling cell deployments around the player. Precipitation now spans the full visible underbase (1.3× the nominal cloud radius) instead of leaving its outer edge dry.' },
  { tag: 'QUAKE + POLE', title: 'Bigger colliding tsunami walls; two Pole techniques', detail: 'Seaquake waves are five times wider and taller, detonate when converging waves collide, and Pole gains Thunder Lance and Storm Vault.' },
  { tag: 'GRAPHICS + HUD', title: 'Interpolation method drawer and scrollable panels', detail: 'Choose linear pose blending or frame hold/duplication. HUD rails and dialogs now scroll on short displays, with landscape layouts reflowed to preserve skill-panel space.' },
  { tag: 'PRECIPITATION', title: 'Raised cell-cloud particle emitters', detail: 'Storm Suppression rain particles now start above the opaque cloud underbase, reducing depth-occlusion gaps without raising particle counts.' },
  { tag: 'MAIN MENU', title: 'Operations console redesign', detail: 'A split field briefing and operation selector adds live status readouts, threat intelligence, and clearer navigation.' },
  { tag: 'AUDIO + TRANSITIONS', title: 'Dedicated feedback bus', detail: 'UI clicks and arena transitions bypass ambience fades; added a distinct Storm Caster shot cue and sharper menu transitions.' },
  { tag: 'PERFORMANCE', title: 'Lighter interface motion', detail: 'Removed painted masks, filters and continuous skill-row shimmer while keeping the larger panel and HUD transitions.' },
  { tag: 'WEATHER SYSTEMS', title: 'Pressure-driven microburst outflow', detail: 'The surface jet now emerges from an advected cold-pool pressure field rather than a preset expanding ring. Derecho and squall-line gust fronts keep their wider footprint.' },
  { tag: 'COMBAT', title: 'Storm force affects the arena', detail: 'Downburst winds push enemies outward instead of only damaging them. Microburst source clouds are 30% more compact.' },
  { tag: 'MOBILE CONTROLS', title: 'Independent joystick and camera', detail: 'Dragging the movement stick while orbiting the camera no longer triggers pinch zoom.' },
  { tag: 'INTERFACE + AUDIO', title: 'Combat-console presentation', detail: 'HUD panels deploy and retract with mechanical shutters. Added menu, button, skill, equipment, storm-gust and arena-transition cues.' },
];

export function UpdateLog({ closing, onClose, onExited }: { closing: boolean; onClose: () => void; onExited: () => void }) {
  const finish = (e: AnimationEvent<HTMLDivElement>) => { if (e.target === e.currentTarget && closing) onExited(); };
  return (
    <div className={`ui-modal-shell absolute inset-0 z-[55] grid place-items-center p-4 ${closing ? 'ui-modal-closing' : ''}`} onAnimationEnd={finish} onPointerDown={e => e.stopPropagation()}>
      <div className="ui-modal-backdrop absolute inset-0" onClick={onClose} />
      <section data-panel="updates" className={`update-log-panel sf-panel relative z-[1] w-full max-w-[620px] max-h-[88vh] overflow-hidden p-5 sm:p-7 ${closing ? 'ui-panel-closing' : ''}`} aria-labelledby="update-log-title" aria-modal="true" role="dialog">
        <header className="flex items-start justify-between gap-4 border-b border-emerald-200/20 pb-4">
          <div>
            <div className="font-orb text-[9px] tracking-[.28em] text-emerald-200/75">FIELD BULLETIN // 02 OCT 2026</div>
            <h2 id="update-log-title" className="mt-1 font-orb text-xl sm:text-2xl tracking-[.12em] text-white">UPDATE LOG</h2>
            <div className="mt-2 flex items-center gap-2"><span className="update-version font-orb">v1.5.8</span><span className="text-[9px] tracking-[.16em] text-white/45">ARENA SYSTEMS ONLINE</span></div>
          </div>
          <button className="sf-btn px-3 py-2 font-orb text-xs" onClick={onClose} data-ui-sound="close" aria-label="Close update log">CLOSE ×</button>
        </header>
        <div className="update-log-list ui-scroll mt-4 max-h-[58dvh] space-y-2 pr-1">
          {PATCHES.map((patch, i) => <article key={patch.title} className="update-entry" style={{ '--entry-index': i } as CSSProperties}>
            <div className="update-entry-index font-orb">0{i + 1}</div>
            <div className="min-w-0"><div className="font-orb text-[8px] tracking-[.18em] text-amber-300/85">{patch.tag}</div><h3 className="mt-1 text-sm font-semibold text-slate-50">{patch.title}</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-300/75">{patch.detail}</p></div>
            <div className="update-entry-mark" aria-hidden="true">◆</div>
          </article>)}
        </div>
        <footer className="mt-4 flex items-center justify-between border-t border-emerald-200/15 pt-3 text-[8px] font-orb tracking-[.18em] text-emerald-100/45"><span>MAGIC CLOUD // RELEASE NOTES</span><span>END OF TRANSMISSION</span></footer>
      </section>
    </div>
  );
}
