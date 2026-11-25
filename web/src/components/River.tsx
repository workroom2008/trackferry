import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { after, type SourceName, type Story } from '../story';
import { layerSays, ms, stepLabel, stopLabel } from '../route';
import { length, secs } from '../copy';
import { songPicture } from '../stage/Stage';
import { Cover } from './Cover';
import { SourceIcon } from './SourceIcon';
import { phaseText } from '../live';
import { fishAtlas, Swimmer, type FishFrame } from './Fish';

type P = [number, number];
type Node = 'ear' | 'mind' | SourceName | 'gate' | 'spk';
const wide: Record<Node, P> = { ear: [.065, .5], mind: [.22, .5], library: [.42, .05], lx: [.42, .2], kuwo: [.42, .35], kugou: [.42, .5], migu: [.42, .65], netease: [.42, .8], xiaomi: [.42, .95], gate: [.74, .4], spk: [.92, .5] };
const tall: Record<Node, P> = { ear: [.5, .045], mind: [.5, .235], library: [.07, .46], lx: [.2, .46], kuwo: [.33, .46], kugou: [.46, .46], migu: [.59, .46], netease: [.72, .46], xiaomi: [.86, .46], gate: [.46, .675], spk: [.5, .9] };
const sources: SourceName[] = ['library', 'lx', 'kuwo', 'kugou', 'migu', 'netease', 'xiaomi'];
const GOLD = '244,201,93', PALE = '190,220,228', CORAL = '240,132,112', PEACH = '255,190,158';

/** A line, sampled once: x, y and the sideways step there. Dust: where, which lane, how fast. */
interface Edge { pts: P[]; geo: Float32Array; dust: Float32Array; width: number }
interface Lit { f: number; rgb: string; power: number; flow: number }

function bezier(a: P, b: P, upright: boolean, sag = 0): P[] {
  const c1: P = upright ? [a[0], a[1] + (b[1] - a[1]) * .5] : [a[0] + (b[0] - a[0]) * .5, a[1] + sag];
  const c2: P = upright ? [b[0], b[1] - (b[1] - a[1]) * .5] : [b[0] - (b[0] - a[0]) * .5, b[1] + sag];
  return Array.from({ length: 61 }, (_, i) => {
    const t = i / 60, u = 1 - t;
    return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k]) as P;
  });
}
const along = (p: P[], f: number): P => {
  const x = Math.max(0, Math.min(1, f)) * (p.length - 1), i = Math.min(p.length - 2, Math.floor(x)), k = x - i;
  return [p[i][0] + (p[i + 1][0] - p[i][0]) * k, p[i][1] + (p[i + 1][1] - p[i][1]) * k];
};
const N = 96;
const part = (t: number, from: number, to: number) => Math.max(0, Math.min(1, (t - from) / Math.max(1, to - from)));
const smooth = (x: number) => x * x * (3 - 2 * x);

/** The way a request takes, at time `now()`. Everything that happens on it follows recorded times. */
export function River({ story, now, listening }: { story: Story | null; now: () => number; listening: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<P>([0, 0]);
  const upright = size[0] < 720;
  const at = upright ? tall : wide;
  const ref = useRef({ story, now, ears: listening.length });
  ref.current = { story, now, ears: listening.length };

  useLayoutEffect(() => {
    const o = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]));
    o.observe(box.current!);
    return () => o.disconnect();
  }, []);

  useEffect(() => {
    const [w, h] = size;
    const c = cv.current, o = top.current;
    const g = c?.getContext('2d'), k = o?.getContext('2d');
    if (!c || !o || !g || !k || !w) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const low = Math.min(dpr, 1.5); // the water below needs fewer pixels than the fish
    c.width = w * low; c.height = h * low; o.width = w * dpr; o.height = h * dpr;
    g.scale(low, low); k.scale(dpr, dpr);
    const xy = (n: Node): P => [at[n][0] * w, at[n][1] * h];
    // A line leaves a source after its name, not through it, and the ear after its wave.
    const from = (n: Node, b: Node): P => {
      const p = xy(n);
      if (n === 'ear') return upright ? [p[0], p[1] + 16] : [p[0] + 58, p[1]];
      if (upright) return sources.includes(n as SourceName) ? [p[0], p[1] + 78] : p;
      return sources.includes(n as SourceName) ? [p[0] + Math.min(190, (xy(b)[0] - p[0]) * .5), p[1]] : p;
    };
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const edge = (a: Node, b: Node, width: number, sag = 0): Edge => {
      const pts = bezier(from(a, b), xy(b), upright, sag);
      const geo = new Float32Array((N + 1) * 4);
      for (let i = 0; i <= N; i++) {
        const f = i / N, q = along(pts, f), y = along(pts, f - .012), z = along(pts, f + .012);
        const dx = z[0] - y[0], dy = z[1] - y[1], d = Math.hypot(dx, dy) || 1;
        // The current narrows where it begins and ends.
        const off = width * Math.sin(f * Math.PI) ** .6 / d;
        geo.set([q[0], q[1], -dy * off, dx * off], i * 4);
      }
      const dust = new Float32Array((upright ? 26 : 40) * 3);
      for (let i = 0; i < dust.length; i += 3) dust.set([rnd(), (rnd() + rnd() - 1) * 1.1, .6 + rnd() * .8], i);
      return { pts, geo, dust, width };
    };
    const es = { hear: edge('ear', 'mind', 5), library: edge('mind', 'library', 7), lx: edge('mind', 'lx', 7), kuwo: edge('mind', 'kuwo', 7), kugou: edge('mind', 'kugou', 7), migu: edge('mind', 'migu', 7), netease: edge('mind', 'netease', 7), xiaomi: edge('mind', 'xiaomi', 7),
      gl: edge('library', 'gate', 7), gw: edge('lx', 'gate', 7), gk: edge('kuwo', 'gate', 7), gg: edge('kugou', 'gate', 7), gm: edge('migu', 'gate', 7), gn: edge('netease', 'gate', 7), gx: edge('xiaomi', 'spk', 7, upright ? 0 : 26), out: edge('gate', 'spk', 10) };
    type Name = keyof typeof es;
    const names = Object.keys(es) as Name[];
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, last = 0, seen = true;

    const trace = (p: P[], f0: number, f1: number) => {
      g.beginPath();
      const n = Math.max(2, Math.ceil((f1 - f0) * 48));
      for (let i = 0; i <= n; i++) { const q = along(p, f0 + (f1 - f0) * i / n); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }
    };
    // The beds never change: painted once.
    const beds = document.createElement('canvas');
    beds.width = c.width; beds.height = c.height;
    const bg = beds.getContext('2d')!;
    bg.scale(low, low); bg.lineCap = 'round'; bg.lineWidth = 1; bg.strokeStyle = 'rgba(190,220,228,.13)';
    for (const n of names) {
      const q = es[n].geo;
      bg.beginPath(); bg.moveTo(q[0], q[1]);
      for (let i = 4; i < q.length; i += 4) bg.lineTo(q[i], q[i + 1]);
      bg.stroke();
    }
    const dot = (e: Edge, f: number, lane: number, sec: number, start: boolean) => {
      const x = Math.max(0, Math.min(1, f)) * N, i = Math.min(N - 1, x | 0), u = x - i, p = i * 4, q = e.geo;
      const s = lane + .3 * Math.sin(f * 9 + sec * .9 + lane * 4);
      const px = q[p] + (q[p + 4] - q[p]) * u + (q[p + 2] + (q[p + 6] - q[p + 2]) * u) * s;
      const py = q[p + 1] + (q[p + 5] - q[p + 1]) * u + (q[p + 3] + (q[p + 7] - q[p + 3]) * u) * s;
      if (start) g.moveTo(px, py); else g.lineTo(px, py);
    };
    // How far the dust has come, carried on so that a change of pace never makes it jump.
    const ran = Object.fromEntries(names.map((n) => [n, 0])) as Record<Name, number>;
    const pace = Object.fromEntries(names.map((n) => [n, .03])) as Record<Name, number>;
    const glow = Object.fromEntries(names.map((n) => [n, 0])) as Record<Name, number>;
    let thin = 1, heavy = 0;
    // Dust over still water is one path for all lines; only coloured water is drawn line by line.
    const quiet = (sec: number, lit: Partial<Record<Name, Lit>>) => {
      g.beginPath();
      for (const n of names) {
        const e = es[n], f = lit[n]?.f ?? 0;
        for (let i = 0; i < 12 * 3 * thin; i += 3) {
          const x = (e.dust[i] + ran[n] * e.dust[i + 2]) % 1;
          if (x < f) continue;
          dot(e, x, e.dust[i + 1], sec, true); dot(e, Math.min(1, x + .014), e.dust[i + 1], sec, false);
        }
      }
      g.lineWidth = 1; g.strokeStyle = 'rgba(190,220,228,.3)'; g.stroke();
    };
    const current = (e: Edge, n: Name, l: Lit, sec: number) => {
      const power = glow[n];
      trace(e.pts, 0, l.f);
      g.lineWidth = e.width * 2.1; g.strokeStyle = `rgba(${l.rgb},${.09 * power})`; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = `rgba(${l.rgb},${.75 * power})`; g.stroke();
      const len = .014 + .022 * l.flow;
      g.beginPath();
      for (let i = 0; i < e.dust.length * thin; i += 3) {
        const x = (e.dust[i] + ran[n] * e.dust[i + 2]) % 1;
        if (x > l.f) continue;
        dot(e, x, e.dust[i + 1], sec, true); dot(e, Math.min(l.f, x + len), e.dust[i + 1], sec, false);
      }
      g.lineWidth = 1.6; g.strokeStyle = `rgba(${l.rgb},${.25 + .65 * power})`; g.stroke();
    };

    // Rings on the water, where something was recorded.
    let rings: { p: P; at: number; rgb: string; r: number }[] = [];
    let fired = new Set<string>(), of = '', before = 0;
    const ring = (id: string, when: number | null, t: number, p: P, rgb: string, r: number) => {
      if (when === null || t < when || fired.has(id)) return;
      fired.add(id);
      if (t - when < 600) rings.push({ p, at: performance.now(), rgb, r });
    };
    const oval = (p: P, r: number, rgb: string, a: number, width = 1.2) => {
      g.beginPath(); g.ellipse(p[0], p[1], r, r * .4, 0, 0, 7); g.lineWidth = width; g.strokeStyle = `rgba(${rgb},${a})`; g.stroke();
    };

    // The fish, and what it carries.
    const fishSize = upright ? 86 : 118;
    const swim = new Swimmer();
    const fish = { p: [xy('mind')[0] - 60, xy('mind')[1]] as P, v: [0, 0] as P, face: 1, to: 1, tilt: 0, fast: false };
    let wake: { p: P; at: number; r: number }[] = [];
    let cover: HTMLImageElement | null = null, coverOf = '';

    const draw = (wall: number) => {
      raf = still || !seen ? 0 : requestAnimationFrame(draw);
      if (!still && wall - last < 13) return;
      const gap = wall - last, dt = Math.min(.05, gap / 1000);
      last = wall;
      // A machine that cannot keep up gets less dust, not fewer frames.
      if (gap < 200) heavy += gap > 24 ? 1 : heavy > 0 ? -.25 : 0;
      if (heavy > 40 && thin > .3) { thin *= .6; heavy = 0; }
      const { story: s, now: clock, ears } = ref.current;
      const sec = wall / 1000;
      const t = clock();
      g.clearRect(0, 0, w, h); k.clearRect(0, 0, w, h);
      g.lineCap = 'round';
      if (s?.key !== of || t < before - 60) { of = s?.key ?? ''; fired = new Set(); rings = []; }
      before = t;

      const lit: Partial<Record<Name, Lit>> = {};
      const put = (n: Name, f: number, rgb: string, power: number, flow: number) => { if (f > 0) lit[n] = { f, rgb, power, flow }; };
      const mind = xy('mind'), spk = xy('spk');
      let want: P = [mind[0] + Math.sin(sec * .45) * 6, mind[1] - 4 + Math.cos(sec * .62) * 5];
      let carry = false, resting: FishFrame = 'idle', hearing = false, sounding = false;
      if (s) {
        const made = s.kind === 'test' || s.kind === 'push';
        const heard = made ? 0 : part(t, s.start, s.seen);
        hearing = heard > 0 && heard < 1;
        if (!made) { put('hear', smooth(heard), GOLD, .8, hearing ? 1 : .15); ring('heard', s.seen, t, mind, GOLD, 70); }
        const end = s.route && s.decided !== null && t >= s.decided ? (s.route.decision === 'native' ? 'xiaomi' : s.route.source ?? 'library') : null;
        if (s.kind === 'push') { put('library', smooth(part(t, s.start, s.start + 300)), GOLD, 1, .3); }
        for (const v of s.visits) {
          if (t < v.from) continue;
          const asking = v.to === null || t < v.to;
          const grow = smooth(part(t, v.from, v.from + Math.min(260, (v.to ?? t + 260) - v.from + 60)));
          const state = v.layer?.state;
          const fine = state === 'hit' || state === 'miss' || state === 'skipped' || state === 'ambiguous' || !!v.layer?.opinion;
          const rgb = asking || end === v.name ? GOLD : fine ? PALE : CORAL;
          put(v.name, grow, rgb, end === v.name ? 1 : asking ? .6 : .24, asking ? 1 : end === v.name ? .25 : 0);
          ring(`asked ${v.name}`, v.to, t, xy(v.name), state === 'hit' ? GOLD : rgb, 46);
        }
        if (heard === 1 && !end) want = [mind[0] + Math.sin(sec * 1.1) * 26, mind[1] - 4 + Math.sin(sec * 2.2) * 5];
        if (end === 'xiaomi') {
          const f = part(t, s.decided!, s.decided! + 420), f2 = part(t, s.decided! + 320, s.decided! + 1000);
          put('xiaomi', smooth(f), PALE, .8, .3); put('gx', smooth(f2), PALE, .8, .3);
          want = along(es.xiaomi.pts, smooth(f) * (upright ? .6 : .72));
          ring('native', s.decided! + 900, t, spk, PALE, 80);
        } else if (end) {
          const e: Name = end === 'library' ? 'gl' : end === 'lx' ? 'gw' : end === 'kuwo' ? 'gk' : end === 'kugou' ? 'gg' : end === 'migu' ? 'gm' : 'gn';
          const f = part(t, s.decided!, s.decided! + 420);
          const goes = !s.route!.preview || !!s.run;
          put(e, smooth(f) * (goes ? 1 : .5), GOLD, goes ? 1 : .3, goes ? .4 : 0);
          ring('decided', s.decided, t, xy(end), GOLD, 90);
          const there = smooth(part(t, s.decided!, s.decided! + 380)), on = smooth(part(t, s.decided! + 420, s.decided! + 900));
          want = on > 0 && goes ? along(es[e].pts, on * .8) : along(es[end].pts, there * .86);
          carry = on > 0 && goes;
        }
        if (s.run) {
          const steps = s.run.steps ?? [];
          const when = (n: string) => { const x = steps.find((y) => y.step === n); return x ? s.run!.started_ms + x.at_ms : null; };
          const play = when('play'), got = when('fetched') ?? when('confirmed'), over = when('ended') ?? when('stopped') ?? when('cancelled') ?? when('released');
          if (play !== null && t >= play) {
            const f = got !== null ? part(t, play, got) : Math.min(.86, 1 - Math.exp(-(t - play) / 1500));
            const bad = s.failed && t > s.end - 900;
            const on = f === 1 && (over === null || t < over);
            sounding = on && (s.open ? s.player?.phase === 'playing' : t < s.end);
            put('out', smooth(f), bad ? CORAL : GOLD, over !== null && t > over ? .3 : 1, sounding ? .55 : f < 1 ? 1 : .1);
            ring('landed', got, t, spk, GOLD, 130);
            ring('sure', when('confirmed'), t, spk, PEACH, 100);
            carry = f < 1 && !bad;
            want = along(es.out.pts, smooth(f) * .92);
            if (f === 1) {
              const a = -2 + .85 * Math.sin(sec * (sounding ? .3 : .14));
              const r = upright ? 74 : 98;
              want = [spk[0] + Math.cos(a) * r, spk[1] + Math.sin(a) * r * .92];
              if (got !== null && t - got < 1600) resting = 'wink';
            }
          }
        }
      }

      for (const n of names) {
        const l = lit[n];
        pace[n] += ((l ? .06 + .2 * l.flow : .028) - pace[n]) * (1 - Math.exp(-dt * 2.4));
        ran[n] += dt * pace[n];
        glow[n] += ((l?.power ?? 0) - glow[n]) * (still ? 1 : 1 - Math.exp(-dt * 5));
      }
      g.drawImage(beds, 0, 0, w, h);
      quiet(sec, lit);
      for (const n of names) if (lit[n]) current(es[n], n, lit[n]!, sec);

      // A pool under the fish's place.
      for (let i = 0; i < 2; i++) { const f = ((sec * .2 + i / 2) % 1); oval([mind[0], mind[1] + 22], 16 + f * 52, PALE, .3 * (1 - f)); }
      rings = rings.filter((x) => wall - x.at < 2600);
      for (const x of rings) for (const d of [0, .16, .32]) {
        const f = (wall - x.at) / 2600 - d;
        if (f > 0) oval(x.p, x.r * (1 - (1 - f) ** 2), x.rgb, .7 * (1 - f) ** 1.5, 1.8);
      }

      // What the speakers hear.
      const ear = xy('ear');
      g.beginPath();
      for (let i = 0; i < 25; i++) {
        const z = (i - 12) / 12, round = Math.exp(-z * z * 2.2);
        const v = .5 + .5 * Math.sin(sec * (hearing ? 6.4 : 1.4) + i * 1.7) * Math.sin(sec * (hearing ? 4.3 : .9) + i * .83);
        const tallness = still ? 8 * round : (hearing ? 6 + 46 * v : ears ? 3 + 13 * v : 3) * round + 1;
        const x = ear[0] + (i - 12) * 3.9;
        g.moveTo(x, ear[1] - tallness / 2); g.lineTo(x, ear[1] + tallness / 2);
      }
      g.lineWidth = 1.8; g.strokeStyle = hearing ? `rgba(${GOLD},1)` : ears ? 'rgba(226,240,240,.82)' : 'rgba(226,240,240,.3)'; g.stroke();

      // Sound leaving the speaker. It stands still when nothing is heard.
      if (sounding) {
        g.beginPath();
        const r0 = upright ? 58 : 78;
        for (let i = 0; i <= 72; i++) {
          const a = Math.PI * (.82 + 1.36 * i / 72);
          const v = Math.abs(Math.sin(sec * 1.8 + i * .61) * Math.sin(sec * 1.1 + i * .27) + .35 * Math.sin(sec * 3.1 + i * 1.3));
          const r1 = r0 + 3 + v * (upright ? 12 : 20);
          g.moveTo(spk[0] + Math.cos(a) * r0, spk[1] + Math.sin(a) * r0); g.lineTo(spk[0] + Math.cos(a) * r1, spk[1] + Math.sin(a) * r1);
        }
        g.lineWidth = 2; g.strokeStyle = `rgba(${GOLD},.85)`; g.stroke();
      }

      // The fish follows, as a fish does.
      // A damped spring: it gathers way and glides in, without overshooting.
      const room = fishSize * .55;
      want = [Math.max(room, Math.min(w - room, want[0])), Math.max(room, Math.min(h - room, want[1]))];
      if (still) { fish.p = [...want]; fish.v = [0, 0]; } else for (const a of [0, 1] as const) {
        const om = 4.6, x = fish.p[a] - want[a], tmp = (fish.v[a] + om * x) * dt, ex = Math.exp(-om * dt);
        fish.v[a] = (fish.v[a] - om * tmp) * ex;
        fish.p[a] = want[a] + (x + tmp) * ex;
      }
      const speed = Math.hypot(...fish.v);
      if (Math.abs(fish.v[0]) > 26) fish.to = Math.sign(fish.v[0]);
      fish.face += (fish.to - fish.face) * (1 - Math.exp(-dt * 5));
      fish.fast = fish.fast ? speed > 110 : speed > 240;
      const fast = fish.fast;
      const tilt = Math.max(-.45, Math.min(.45, Math.atan2(fish.v[1], Math.abs(fish.v[0]) + 60))) + (fast ? .16 : 0);
      fish.tilt += (tilt - fish.tilt) * (1 - Math.exp(-dt * 5));
      if (fast && Math.random() < dt * 14) wake.push({ p: [fish.p[0] - fish.to * 26, fish.p[1] + (Math.random() - .5) * 16], at: wall, r: 1.5 + Math.random() * 3 });
      wake = wake.filter((x) => wall - x.at < 1600);
      for (const x of wake) {
        const f = (wall - x.at) / 1600;
        k.beginPath(); k.arc(x.p[0], x.p[1] - f * 16, x.r * (1 + f), 0, 7); k.lineWidth = 1; k.strokeStyle = `rgba(226,244,246,${.7 * (1 - f)})`; k.stroke();
      }
      if (carry && s?.route) {
        const pic = songPicture(s.route, 600);
        if (coverOf !== pic.src) {
          coverOf = pic.src;
          const img = new Image();
          img.onerror = () => { img.onerror = null; img.src = pic.fallback; };
          img.src = pic.src;
          cover = img;
        }
        if (cover?.complete && cover.naturalWidth) {
          const q = upright ? 30 : 40, m = Math.min(cover.naturalWidth, cover.naturalHeight);
          const x = fish.p[0] - fish.face * fishSize * .5 - q / 2, y = fish.p[1] - q / 2 + Math.sin(sec * 1.6) * 3;
          k.save(); k.beginPath(); k.roundRect(x, y, q, q, 4); k.clip();
          k.drawImage(cover, (cover.naturalWidth - m) / 2, (cover.naturalHeight - m) / 2, m, m, x, y, q, q);
          k.restore();
        }
      }
      const frame: FishFrame = fast ? 'dart' : resting !== 'idle' ? resting : sec % 11 > 10.3 ? 'wink' : 'idle';
      const body = swim.paint(Math.round(fishSize * dpr), still ? 0 : dt, frame, fast ? .036 : .026, fast ? 4.2 : 1.5 + Math.min(1.4, speed / 120));
      k.save();
      k.translate(fish.p[0], fish.p[1]);
      k.scale(fish.face, 1);
      k.rotate(fish.tilt);
      k.drawImage(body, -fishSize / 2, -fishSize / 2, fishSize, fishSize);
      k.restore();
      if (still && !fishAtlas()) raf = requestAnimationFrame(draw);
    };
    const see = new IntersectionObserver(([e]) => { seen = e.isIntersecting; if (seen && !raf) raf = requestAnimationFrame(draw); });
    see.observe(box.current!);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); see.disconnect(); };
  }, [size, upright]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = now();
  const s = story;
  const style = (n: Node) => ({ left: `${at[n][0] * 100}%`, top: `${at[n][1] * 100}%` });
  const heard = !!s && s.kind !== 'test' && s.kind !== 'push' && t >= s.seen;
  const decided = !!s?.route && s.decided !== null && t >= s.decided;
  const end = decided ? (s!.route!.decision === 'native' ? 'xiaomi' : s!.route!.source ?? 'library') : null;
  const steps = (s?.run?.steps ?? []).filter((x) => s!.run!.started_ms + x.at_ms <= t && (s!.open || !after.has(x.step)));
  const landed = !!s?.landed && t >= s.landed;
  const song = end && end !== 'xiaomi' ? s!.route! : null;
  const ph = s?.open ? s.player?.phase : undefined;
  const pos = ph ? s!.player!.elapsed + (ph === 'playing' ? Math.max(0, t - s!.player!.at_ms) : 0) : null;
  const total = song?.duration_ms || s?.run?.song?.duration_ms || 0;
  const here = pos !== null && total ? Math.min(pos, total) : pos;
  const closed = ((['ended', 'stopped', 'cancelled', 'released'] as const).find((x) => s?.run?.steps?.some((y) => y.step === x && s.run!.started_ms + y.at_ms <= t)));
  const fetching = !!landed && !!s?.open && !!s.audio?.open && ph === undefined;

  return (
    <div className={`river ${upright ? 'river-tall' : ''}`} ref={box}>
      <canvas ref={cv} aria-hidden="true" />
      <canvas ref={top} className="river-top" aria-hidden="true" />
      <div className={`rn rn-ear ${listening.length ? 'on' : ''}`} style={style('ear')}>
        {s && s.kind === 'command'
          ? <span><b>{s.device}</b><small className="num">{t < s.seen ? `${secs(Math.max(0, t - s.start))} 秒` : `${secs(s.seen - s.start)} 秒听到`}</small></span>
          : <span><b>{listening.length ? '在听' : '没有在听'}</b>{listening.length > 0 && <small>{listening.length > 2 ? `${listening.length} 台音箱` : listening.join('、')}</small>}</span>}
      </div>
      <div className={`rn rn-mind ${heard && !decided ? 'busy' : ''}`} style={style('mind')}>
        <span><b>{s?.kind === 'push' ? 'TrackFerry' : decided ? `${ms(s!.route!.ms)} 想好` : heard ? '在想' : 'TrackFerry'}</b></span>
      </div>
      {sources.map((n) => {
        const v = s?.visits.find((x) => x.name === n);
        const began = !!v && t >= v.from;
        const over = began && v!.to !== null && t >= v!.to;
        const l = v?.layer;
        const skip = s?.route?.layers.find((x) => x.name === n);
        const note = n === 'xiaomi' ? (end === 'xiaomi' ? s!.route!.reason || '由小爱处理' : '') : over ? layerSays(l!) : began ? (l && (l.state as string) === 'asking' && l.detail) || '正在问' : decided && skip && (skip.state === 'disabled' || skip.state === 'open') ? layerSays(skip) : '';
        const bad = over && l && !l.opinion && !['hit', 'miss', 'skipped', 'ambiguous'].includes(l.state);
        const cover = end === n && song ? song : null;
        return (
          <div key={n} className={`rn rn-src ${end === n ? 'hit' : ''} ${began && !over ? 'busy' : ''} ${bad ? 'bad' : ''} ${over || end === n ? 'done' : ''} ${decided && end !== n ? 'away' : ''}`} style={style(n)}>
            <i>{cover ? <Cover cover={cover.cover} title={cover.title ?? ''} artist={cover.artist} size={600} /> : <SourceIcon name={n} />}</i>
            <span><b>{stopLabel[n]}{over && n !== 'xiaomi' && <small className="num">{ms(l!.ms)}</small>}</b>{note && <small>{note}</small>}</span>
          </div>
        );
      })}
      <div className={`rn rn-gate ${steps.length ? 'on' : ''}`} style={style('gate')}>
        {steps.length ? <ol>{steps.slice(upright ? -4 : -8).map((x, i) => <li key={`${x.step}${x.at_ms}${i}`} className={x.ok ? x.step === 'confirmed' ? 'good' : '' : 'bad'}><span className="num">{secs(x.at_ms)}</span>{stepLabel(x.step)}</li>)}</ol> : <span><b>接管</b></span>}
      </div>
      <div className={`rn rn-spk ${landed && (ph === 'playing' || !s!.open) ? 'on' : ''} ${ph === 'playing' ? 'turning' : ''}`} style={style('spk')}>
        <i>
          {landed && song ? <img src={songPicture(song, 600).src} alt="" onError={(e) => { e.currentTarget.src = songPicture(song, 600).fallback; }} /> : <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="5" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="14.5" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M9.4 6.5h5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
        </i>
        <span><b>{s?.device || '音箱'}</b>
          {landed && here !== null && total > 0 && <em className="rn-bar"><em style={{ transform: `scaleX(${here / total})` }} /></em>}
          {landed && here !== null && <small className="num">{ph !== 'playing' && `${phaseText[ph!]} `}{length(here) || '0:00'}{total > 0 && ` / ${length(total)}`}</small>}
          {landed && here === null && <small className="num">{fetching ? '音箱在取歌' : closed === 'ended' ? '放完了' : closed === 'stopped' ? '停下了' : closed ? '让出来了' : `${secs(s!.landed! - s!.start)} 秒出声`}</small>}
        </span>
      </div>
    </div>
  );
}
