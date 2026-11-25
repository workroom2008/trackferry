import { useEffect, useRef } from 'react';

/**
 * Blast mode for the big lyrics. Every new line is broken into characters and set off by one of
 * several effects, picked at random and never the same twice in a row, so a song keeps changing
 * its look. Each effect randomises its own direction, colour and strength on top of that.
 *
 * All of it is CSS animation on the real characters: no canvas, nothing drawn over the text, so
 * it stays sharp and the line keeps its own box.
 */
export type BlastKind = 'shatter' | 'vortex' | 'rise' | 'lightning' | 'glass' | 'implode' | 'wave' | 'confetti';

export const blastKinds: BlastKind[] = ['shatter', 'vortex', 'rise', 'lightning', 'glass', 'implode', 'wave', 'confetti'];

export const blastNames: Record<BlastKind, string> = {
  shatter: '碎片爆裂', vortex: '星尘漩涡', rise: '光柱升腾', lightning: '闪电裂网',
  glass: '玻璃碎裂', implode: '塌缩爆发', wave: '冲击波', confetti: '彩带爆炸',
};

/** Picks a kind that is not the one before it, so the show keeps changing. */
export function nextKind(prev: BlastKind | null): BlastKind {
  const pool = prev ? blastKinds.filter((k) => k !== prev) : blastKinds;
  return pool[Math.floor(Math.random() * pool.length)];
}

interface Plan { hue: number; spin: number; reach: number }

/** One character's flight for a given effect. */
function frames(kind: BlastKind, i: number, n: number, p: Plan): Keyframe[] {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + (p.spin * Math.PI) / 180;
  const r = p.reach;
  const mid = r * (0.55 + Math.random() * 0.65);
  const up = -(20 + Math.random() * 60);
  switch (kind) {
    case 'shatter': {
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r * 0.8 + up;
      return [
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.3) rotate(${p.spin * 0.4}deg)`, opacity: 1, filter: 'blur(0)', offset: 0.3 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.6) rotate(${p.spin}deg)`, opacity: 0.1, filter: 'blur(2px)', offset: 0.66 },
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0)' },
      ];
    }
    case 'vortex': {
      const cx = Math.cos(a) * mid, cy = Math.sin(a) * mid * 0.5;
      return [
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${cx}px, ${cy}px) rotate(${p.spin * 0.6}deg) scale(1.4)`, opacity: 0.95, offset: 0.34 },
        { transform: `translate(${cx * 0.25}px, ${-mid * 0.5}px) rotate(${p.spin * 1.6}deg) scale(0.5)`, opacity: 0.2, offset: 0.72 },
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
      ];
    }
    case 'rise':
      return [
        { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0)' },
        { transform: `translate(0, ${-r * 0.7}px) scale(1.5)`, opacity: 1, filter: 'blur(0)', offset: 0.35 },
        { transform: `translate(${(Math.random() - 0.5) * 40}px, ${-r * 1.25}px) scale(0.4)`, opacity: 0, filter: 'blur(3px)', offset: 0.7 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0)' },
      ];
    case 'lightning': {
      const jag = () => (Math.random() - 0.5) * 60;
      return [
        { transform: 'translate(0,0)', opacity: 1, filter: 'brightness(1)' },
        { transform: `translate(${jag()}px, ${jag()}px)`, opacity: 1, filter: 'brightness(2.6)', offset: 0.15 },
        { transform: 'translate(0,0)', opacity: 0.2, filter: 'brightness(3.4)', offset: 0.3 },
        { transform: `translate(${jag()}px, ${jag() * 0.5}px)`, opacity: 1, filter: 'brightness(2)', offset: 0.45 },
        { transform: 'translate(0,0)', opacity: 1, filter: 'brightness(1)' },
      ];
    }
    case 'glass': {
      const dx = (Math.random() - 0.5) * r * 1.8, dy = 120 + Math.random() * 160;
      return [
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1, filter: 'blur(0)' },
        { transform: `translate(${dx * 0.3}px, -30px) rotate(${(Math.random() - 0.5) * 40}deg) scale(1.25)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 260}deg) scale(0.55)`, opacity: 0, filter: 'blur(2px)', offset: 0.72 },
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1, filter: 'blur(0)' },
      ];
    }
    case 'implode': {
      const dx = Math.cos(a) * mid * 2.2, dy = Math.sin(a) * mid * 1.4;
      return [
        { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0, filter: 'blur(4px)' },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) scale(0.7)`, opacity: 0.85, offset: 0.45 },
        { transform: 'translate(0,0) scale(1.45)', opacity: 1, filter: 'blur(0)', offset: 0.72 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0)' },
      ];
    }
    case 'wave':
      return [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(0,-14px) scale(1.35)', opacity: 1, offset: 0.3 },
        { transform: 'translate(0,6px) scale(0.9)', opacity: 0.55, offset: 0.55 },
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
      ];
    case 'confetti': {
      const dx = (Math.random() - 0.5) * r * 2.4, dy = -(40 + Math.random() * 140);
      const spin = (Math.random() - 0.5) * 720;
      return [
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy}px) rotate(${spin * 0.5}deg) scale(1.3)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${dy * 0.25 + 90}px) rotate(${spin}deg) scale(0.7)`, opacity: 0.15, offset: 0.72 },
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
      ];
    }
  }
}

/** Runs one line through an effect. `seed` changes on every new line, which restarts it. */
export function BlastLine({ text, seed, kind, sung = -1 }: { text: string; seed: number; kind: BlastKind; sung?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const chars = Array.from(root.querySelectorAll<HTMLElement>('i'));
    const n = chars.length || 1;
    const plan: Plan = {
      hue: [190, 205, 28, 42, 320, 265][Math.floor(Math.random() * 6)],
      spin: (Math.random() - 0.5) * 460,
      reach: 30 + Math.random() * 70,
    };
    root.style.setProperty('--hue', String(plan.hue));
    const dur = kind === 'wave' ? 780 : kind === 'lightning' ? 520 : 1000 + Math.random() * 500;
    chars.forEach((el, i) => {
      el.animate(frames(kind, i, n, plan), {
        duration: dur,
        delay: (kind === 'lightning' ? Math.random() * 260 : 0) + (kind === 'wave' ? i * 26 : i * 7 + Math.random() * 30),
        easing: kind === 'lightning' ? 'steps(2, end)' : 'cubic-bezier(.22,.9,.16,1)',
        fill: 'backwards',
      });
    });
    return () => { chars.forEach((el) => el.getAnimations().forEach((a) => a.cancel())); };
  }, [text, seed, kind]);

  return (
    <span ref={box} className={`blast-line blast-${kind}`} aria-label={text}>
      {Array.from(text).map((c, i) => (
        <i
          key={`${i}-${c}`}
          aria-hidden="true"
          className={sung === i ? 'lit' : sung >= 0 && i < sung ? 'done' : ''}
          style={{ '--i': i, '--h': (i * 37 + seed * 11) % 360 } as React.CSSProperties}
        >
          {c === ' ' ? '\u00a0' : c}
        </i>
      ))}
    </span>
  );
}

/** Blast: the line plus whatever the effect drapes around it (rings, beams, sparks, glass). */
export function Blast({ text, seed, kind, sung = -1 }: { text: string; seed: number; kind: BlastKind; sung?: number }) {
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The rings and sparks are made here rather than rendered, so the effects differ every time.
    const bits: HTMLElement[] = [];
    const add = (cls: string, css: Partial<CSSStyleDeclaration> = {}) => {
      const el = document.createElement('b');
      el.className = cls;
      Object.assign(el.style, css);
      root.appendChild(el);
      bits.push(el);
      return el;
    };
    const hue = Math.floor(Math.random() * 360);
    root.style.setProperty('--hue', String(hue));
    switch (kind) {
      case 'shatter':
      case 'implode':
        add('ring', { borderColor: `hsl(${hue} 100% 78% / 0.95)` });
        add('ring ring-late', { borderColor: `hsl(${(hue + 40) % 360} 100% 70% / 0.7)` });
        break;
      case 'vortex':
        add('spiral', { borderTopColor: `hsl(${hue} 100% 70% / 0.9)`, borderRightColor: `hsl(${(hue + 60) % 360} 100% 65% / 0.7)` });
        add('spiral spiral-2', { borderBottomColor: `hsl(${(hue + 120) % 360} 100% 70% / 0.6)` });
        for (let i = 0; i < 14; i++) {
          add('dust', { left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 500}ms`, background: `hsl(${(hue + i * 12) % 360} 100% 70%)` });
        }
        break;
      case 'rise':
        add('beam', { background: `linear-gradient(to top, hsl(${hue} 100% 72% / 0.75), transparent 78%)` });
        add('beam beam-2', { left: '55%', background: `linear-gradient(to top, hsl(${(hue + 50) % 360} 100% 70% / 0.55), transparent 78%)` });
        break;
      case 'lightning':
        add('flash', { background: `hsl(${hue} 100% 92%)` });
        break;
      case 'glass':
        for (let i = 0; i < 18; i++) {
          add('shard', { left: `${Math.random() * 100}%`, top: `${Math.random() * 60}%`, animationDelay: `${80 + Math.random() * 320}ms`, background: `hsl(${hue} 90% 85% / 0.9)` });
          bits[bits.length - 1].style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
        }
        break;
      case 'wave':
        add('ring', { borderColor: `hsl(${hue} 100% 80% / 0.9)` });
        add('ring ring-late', { borderColor: `hsl(${(hue + 30) % 360} 100% 75% / 0.75)` });
        break;
      case 'confetti':
        for (let i = 0; i < 26; i++) {
          add('bit', { left: `${Math.random() * 100}%`, background: `hsl(${Math.floor(Math.random() * 360)} 95% 68%)`, animationDelay: `${Math.random() * 220}ms` });
          bits[bits.length - 1].style.setProperty("--dx", `${(Math.random() - 0.5) * 160}px`);
        }
        break;
    }
    return () => { bits.forEach((b) => b.remove()); };
  }, [seed, kind]);

  return (
    <span ref={wrap} className="blast-wrap" data-kind={kind}>
      <BlastLine text={text} seed={seed} kind={kind} sung={sung} />
    </span>
  );
}
