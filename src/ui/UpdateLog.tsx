import type { AnimationEvent, CSSProperties } from 'react';

const PATCHES = [
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
  { tag: 'WEATHER SYSTEMS', title: 'Outflow and gust-front overhaul', detail: 'Microburst outflow reaches eight times its former range. Derecho and squall-line gust fronts have a 3.72× wider footprint.' },
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
            <div className="font-orb text-[9px] tracking-[.28em] text-emerald-200/75">FIELD BULLETIN // 30 SEP 2026</div>
            <h2 id="update-log-title" className="mt-1 font-orb text-xl sm:text-2xl tracking-[.12em] text-white">UPDATE LOG</h2>
            <div className="mt-2 flex items-center gap-2"><span className="update-version font-orb">v1.5.5</span><span className="text-[9px] tracking-[.16em] text-white/45">ARENA SYSTEMS ONLINE</span></div>
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
