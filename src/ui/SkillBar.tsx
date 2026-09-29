import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { SKILL_KEYS } from '../game/Game';
import { SUPERCELL_TYPES } from '../game/skills/cloud';

export function SkillBar({ game, equipped, touch }: { game: Game; equipped: number; touch: boolean }) {
  const [open, setOpen] = useState(true);
  const [, force] = useState(0);
  const fills = useRef<(HTMLDivElement | null)[]>([]);
  const texts = useRef<(HTMLSpanElement | null)[]>([]);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const item = equipped >= 0 ? game.items[equipped] : null;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!item) return;
      item.skills.forEach((s, i) => {
        const st = game.cds[item.id][i]; const f = fills.current[i], t = texts.current[i], r = rows.current[i];
        if (!st || !f || !t || !r) return;
        const k = st.total > 0 ? st.rem / st.total : 0;
        f.style.transform = `scaleX(${k})`;
        let txt = st.rem > 0 ? `${st.rem.toFixed(st.rem < 10 ? 1 : 0)}s` : st.holding ? 'HOLD' : 'READY';
        if (s.charges) txt = `${st.charges}/${s.charges.max}` + (st.rem > 0 ? ` · ${st.rem.toFixed(1)}s` : '');
        if (st.holding && (game as any).ui_charge) txt = `${(game as any).ui_charge}%`;
        if (t.textContent !== txt) t.textContent = txt;
        r.classList.toggle('ready', st.rem <= 0 && (!s.charges || st.charges > 0));
      });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [item, game]);

  if (!item) return null;
  if (!open) return (
    <button data-panel="skills" onClick={() => setOpen(true)} className="sf-btn font-orb w-full py-2 text-[10px] pointer-events-auto shrink-0">SKILLS ▸</button>
  );
  const held = (i: number, down: boolean) => (down ? game.pressSkill(i) : game.releaseSkill(i));
  return (
    <div data-panel="skills" className="sf-panel w-full flex-none min-h-0 flex flex-col p-2 pointer-events-auto" onPointerDown={e => e.stopPropagation()} style={{ maxHeight: '100%' }}>
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <div className="font-orb text-[10px] sf-glow truncate" style={{ color: item.color }}>{item.glyph} {item.name.toUpperCase()}</div>
        <button className="sf-btn text-[10px] px-1.5 leading-4" onClick={() => setOpen(false)} title="Close">✕</button>
      </div>
      {item.passive && <div className="text-[9px] text-cyan-200/60 mb-1 leading-tight">PASSIVE · {item.passive}</div>}
      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto pr-0.5">
        {item.skills.map((s, i) => (
          <div key={item.id + i} ref={el => { rows.current[i] = el; }} className="skill-row flex items-center gap-1.5 pr-1.5 h-[26px]" title={s.info}>
            <div ref={el => { fills.current[i] = el; }} className="skill-fill" style={{ transform: 'scaleX(0)' }} />
            {touch ? (
              <button className="sf-btn relative z-10 h-full px-2 text-[10px] font-orb shrink-0"
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); held(i, true); }}
                onPointerUp={e => { e.stopPropagation(); held(i, false); }} onPointerLeave={() => held(i, false)} onPointerCancel={() => held(i, false)}>USE</button>
            ) : (
              <span className="relative z-10 w-5 h-5 ml-0.5 shrink-0 grid place-items-center text-[10px] font-orb border border-cyan-300/50 text-cyan-100 bg-cyan-400/10">{SKILL_KEYS[i].toUpperCase()}</span>
            )}
            <span className="relative z-10 flex-1 text-[11px] font-semibold truncate leading-none">{s.name}</span>
            <span ref={el => { texts.current[i] = el; }} className="relative z-10 text-[10px] font-orb text-cyan-100 tabular-nums">READY</span>
          </div>
        ))}
        {item.id === 'cloud' && (
          <div className="flex gap-1 mt-0.5">
            {SUPERCELL_TYPES.map((t, i) => (
              <button key={t.id} className={`sf-btn flex-1 text-[9px] py-0.5 font-orb ${game.sel.supercell === i ? 'on' : ''}`} onClick={() => { game.sel.supercell = i; force(x => x + 1); }}>{t.id}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
