import type { AnimationEvent, CSSProperties } from 'react';

const PATCHES = [
  { tag: 'STORM SUPPRESSION', title: 'Continuous cloud formation', detail: 'Delayed storm cells now stay anchored to the cast point and form around a broad parent cloud to close gaps across the formation.' },
  { tag: 'UI AUDIO', title: 'Clicks and transitions are audible', detail: 'UI cues now use a dedicated sound bus so short clicks and the arena-entry transition are not buried by the weather ambience fade.' },
  { tag: 'PERFORMANCE', title: 'Lighter interface motion', detail: 'Removed painted masks, filters and continuous skill-row shimmer while keeping the larger panel and HUD transitions.' },
  { tag: 'WEATHER SYSTEMS', title: 'Outflow and gust-front overhaul', detail: 'Microburst outflow reaches eight times its former range. Derecho and squall-line gust fronts have a 3.72× wider footprint, with dust spread across the enlarged front.' },
  { tag: 'COMBAT', title: 'Storm force affects the arena', detail: 'Downburst winds push enemies outward instead of only damaging them. Microburst source clouds are 30% more compact.' },
  { tag: 'MOBILE CONTROLS', title: 'Independent joystick and camera', detail: 'Dragging the movement stick while orbiting the camera no longer triggers pinch zoom.' },
  { tag: 'INTERFACE + AUDIO', title: 'Combat-console presentation', detail: 'HUD panels deploy and retract with mechanical shutters. Added menu, button, skill, equipment, storm-gust and arena-transition sound cues.' },
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
            <div className="mt-2 flex items-center gap-2"><span className="update-version font-orb">v1.4.1</span><span className="text-[9px] tracking-[.16em] text-white/45">ARENA SYSTEMS ONLINE</span></div>
          </div>
          <button className="sf-btn px-3 py-2 font-orb text-xs" onClick={onClose} data-ui-sound="close" aria-label="Close update log">CLOSE ×</button>
        </header>
        <div className="update-log-list mt-4 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
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
