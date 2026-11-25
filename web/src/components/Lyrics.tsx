import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { length } from '../copy';
import { position, type Sounding } from '../live';
import { lineAt, parseLRC, plainLyrics, type Line } from '../lyrics';
import { Fish } from './Fish';
import { useToast } from './Toast';
import { Blast, nextKind, type BlastKind } from './BlastLine';

export interface Words { lines: Line[]; timed: boolean; /** How much sooner the lines come, in ms. */ offset: number; setOffset: (ms: number) => void }

/** The words of a song: a library song by its id, an online one by the source's id ("kw_12").
 *  A library song has its own time nudge; an online one only has the words. */
export function useWords(trackID?: number, onlineID?: string): Words | null {
  const key = onlineID ? `o:${onlineID}` : trackID ? `l:${trackID}` : '';
  const [got, setGot] = useState<{ id: string; lines: Line[]; timed: boolean; offset: number } | null>(null);
  const later = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!key) return;
    let on = true;
    const p = onlineID ? api.lxLyrics(onlineID) : api.lyrics(trackID!);
    p.then((r: { lyrics: string; offset_ms?: number }) => {
      if (!on) return;
      const lines = parseLRC(r.lyrics ?? '');
      setGot({ id: key, lines: lines.length ? lines : plainLyrics(r.lyrics ?? ''), timed: lines.length > 0, offset: r.offset_ms ?? 0 });
    }).catch(() => {});
    return () => { on = false; };
  }, [key, trackID, onlineID]);
  const setOffset = useCallback((ms: number) => {
    if (!trackID) return;
    const to = Math.max(-60000, Math.min(60000, ms));
    setGot((g) => g && { ...g, offset: to });
    clearTimeout(later.current);
    later.current = setTimeout(() => { api.setLyricsOffset(trackID, to).catch(() => {}); }, 500); // several taps are one change
  }, [trackID]);
  return key && got?.id === key && got.lines.length ? { lines: got.lines, timed: got.timed, offset: got.offset, setOffset } : null;
}

const SIZE = 'trackferry.lyrics.size';
const sizes = [{ v: 'small', label: '小' }, { v: '', label: '中' }, { v: 'large', label: '大' }];

/** All of the words. The line being sung stays in view unless the reader has scrolled away; a tap on a line goes there. */
export function LyricSheet({ words, now, big, seek, blast }: { words: Words; now: Sounding | null; big: boolean; seek?: (ms: number) => void; blast?: boolean }) {
  const box = useRef<HTMLOListElement>(null);
  const hands = useRef(0);
  const [i, setI] = useState(-1);
  const [free, setFree] = useState(false);
  const [tools, setTools] = useState(false);
  const [size, setSize] = useState(() => { try { return localStorage.getItem(SIZE) ?? ''; } catch { return ''; } });
  const { lines, timed, offset } = words;
  const follow = !!now && timed;
  // The effect changes every line: the next kind is drawn once per new line, never the same twice.
  const [kind, setKind] = useState<BlastKind>('shatter');
  const lastKind = useRef<BlastKind | null>(null);
  const live = !!blast && big && i >= 0 && !!lines[i];
  useEffect(() => {
    if (i < 0) return;
    const k = nextKind(lastKind.current);
    lastKind.current = k;
    setKind(k);
  }, [i]);
  useEffect(() => {
    if (!follow) { setI(-1); return; }
    const f = () => {
      setI(lineAt(lines, position(now!) + offset));
      setFree(Date.now() - hands.current < 4000);
    };
    f();
    const t = setInterval(f, 150);
    return () => clearInterval(t);
  }, [lines, offset, follow, now?.phase, now?.at, now?.since]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const b = box.current, el = b?.children[Math.max(i, 0)] as HTMLElement | undefined;
    if (!b || !el || !follow || free) return;
    b.scrollTo({ top: i < 0 ? 0 : el.offsetTop + el.offsetHeight / 2 - b.clientHeight * .42, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [i, big, size, follow, free]);
  useEffect(() => { hands.current = 0; setFree(false); }, [lines]);
  // Which character of the line is being sung: the line's own span, walked by the clock.
  const [sung, setSung] = useState(-1);
  const sungNow = () => {
    if (!live || !follow) return -1;
    const cur = lines[i];
    const next = lines[i + 1];
    const from = cur.at - offset;
    const to = next ? next.at - offset : from + Math.max(2400, Array.from(cur.text).length * 260);
    if (to <= from) return -1;
    const f = (position(now!) - from) / (to - from);
    if (f < 0) return -1;
    const n = Array.from(cur.text).length;
    return Math.min(n - 1, Math.floor(f * n));
  };
  useEffect(() => {
    if (!live) { setSung(-1); return; }
    const t = setInterval(() => setSung(sungNow()), 90);
    setSung(sungNow());
    return () => clearInterval(t);
  }, [live, i, now?.phase, now?.at, now?.since]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = () => { hands.current = Date.now(); if (follow) setFree(true); };
  const go = (l: Line) => { hands.current = 0; setFree(false); seek!(Math.max(0, l.at - offset)); };
  const jump = timed && seek;
  const sized = (v: string) => { setSize(v); try { localStorage.setItem(SIZE, v); } catch { /* for this visit only */ } };
  return (
    <div className={`lyric ${size ? `lyric-${size}` : ''}`}>
      <ol ref={box} className={`sheet-words ${follow ? 'follow' : ''} ${free ? 'free' : ''} ${jump ? 'jump' : ''} ${live ? 'blasting' : ''}`} aria-label="歌词" tabIndex={0} onWheel={mine} onTouchMove={mine} onKeyDown={mine}>
        {lines.map((l, k) => <li key={k} className={k === i ? 'now' : ''} aria-current={k === i || undefined} onClick={jump ? () => go(l) : undefined} style={{ '--d': follow ? Math.min(5, Math.abs(k - Math.max(i, 0))) : 0 } as React.CSSProperties}>
          {live && k === i ? <Blast text={l.text} seed={k} kind={kind} sung={sung} /> : l.text}
        </li>)}
      </ol>
      {tools ? (
        <div className="lyric-tools" role="group" aria-label="调整歌词">
          {timed && <div><button type="button" onClick={() => words.setOffset(offset - 500)} aria-label="歌词慢半秒">慢 0.5</button><button type="button" className="num" onClick={() => words.setOffset(0)} disabled={!offset} aria-label="歌词时间还原">{offset ? `${offset > 0 ? '快' : '慢'} ${Math.abs(offset / 1000).toFixed(1)} 秒` : '同步'}</button><button type="button" onClick={() => words.setOffset(offset + 500)} aria-label="歌词快半秒">快 0.5</button></div>}
          <div>{sizes.map((x) => <button key={x.v} type="button" aria-pressed={size === x.v} onClick={() => sized(x.v)} aria-label={`${x.label}号字`}>{x.label}</button>)}</div>
          <button type="button" className="lyric-x" onClick={() => setTools(false)} aria-label="收起"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        </div>
      ) : <button type="button" className="lyric-open" onClick={() => setTools(true)} aria-label="调整歌词" title="调整歌词"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.4" /><circle cx="8" cy="17" r="2.4" /></svg></button>}
    </div>
  );
}

/** Where the listener has put a song, shown until it is there. One request at a time, the newest place wins. */
export function useSeek(now: Sounding | null, key: string | number | undefined, to: ((ms: number) => Promise<void> | void) | null, cannot = '') {
  const [aim, setAim] = useState<{ ms: number; at: number } | null>(null);
  const [done, setDone] = useState(0);
  const [toast, say] = useToast();
  const busy = useRef(false), next = useRef<number | null>(null);
  const fn = useRef(to);
  fn.current = to;
  const no = useRef(cannot);
  no.current = cannot;
  const song = useRef(key);
  useEffect(() => { song.current = key; next.current = null; setAim(null); }, [key]);
  // It is there once the song is heard close to it.
  useEffect(() => {
    if (!aim || busy.current || !now || now.phase === 'resuming') return;
    const p = position(now);
    if (p > aim.ms - 2500 && p < aim.ms + Date.now() - aim.at + 3000) setAim(null);
  }, [aim, done, now?.at, now?.since, now?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!aim) return;
    const t = setTimeout(() => setAim(null), 9000);
    return () => clearTimeout(t);
  }, [aim]);
  const seek = useCallback(async (ms: number) => {
    if (no.current) { say({ tone: 'bad', text: no.current }); return; }
    setAim({ ms, at: Date.now() });
    next.current = ms;
    if (busy.current) return;
    busy.current = true;
    const mine = song.current;
    try {
      while (next.current !== null && song.current === mine) {
        const want: number = next.current;
        next.current = null;
        await fn.current?.(want);
      }
    } catch (e) {
      next.current = null;
      setAim(null);
      say({ tone: 'bad', text: (e as ApiError).message });
    } finally {
      busy.current = false;
      setDone((n) => n + 1);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown: Sounding | null = now && aim ? { ...now, at: aim.ms, since: now.since, phase: 'resuming' } : now;
  return { seek: to ? seek : undefined, shown, toast };
}

/** How far the song is; it can be dragged. The fish swims at its head. */
export function Progress({ now, total, seek }: { now: Sounding; total?: number; seek?: (ms: number) => void }) {
  const [at, setAt] = useState(() => position(now));
  const [drag, setDrag] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const grip = useRef<number | null>(null);
  useEffect(() => {
    const f = () => setAt(position(now));
    f();
    const t = setInterval(f, 250);
    return () => clearInterval(t);
  }, [now.phase, now.at, now.since]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = drag ?? (total ? Math.min(at, total) : at);
  const can = !!seek && !!total;
  const under = (x: number) => { const r = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * total!; };
  const down = (e: React.PointerEvent) => {
    if (!can || e.button) return;
    e.stopPropagation();
    grip.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(under(e.clientX));
  };
  const move = (e: React.PointerEvent) => { if (grip.current === e.pointerId) setDrag(under(e.clientX)); };
  const up = (e: React.PointerEvent) => {
    if (grip.current !== e.pointerId) return;
    grip.current = null;
    setDrag(null);
    if (e.type === 'pointerup') { const to = under(e.clientX); setAt(to); seek!(to); }
  };
  const key = (e: React.KeyboardEvent) => {
    if (!can) return;
    const to = { ArrowLeft: here - 5000, ArrowRight: here + 5000, ArrowDown: here - 5000, ArrowUp: here + 5000, PageDown: here - 30000, PageUp: here + 30000, Home: 0, End: total! - 3000 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const ms = Math.max(0, Math.min(total!, to));
    setAt(ms);
    seek!(ms);
  };
  return (
    <div className={`swim ${now.phase} ${can ? 'can' : ''} ${drag !== null ? 'held' : ''}`}>
      <span className="num">{length(here) || '0:00'}</span>
      <div ref={bar} style={{ '--f': total ? here / total : 0 } as React.CSSProperties} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        {...(can ? { role: 'slider', tabIndex: 0, 'aria-label': '播放进度', 'aria-valuemin': 0, 'aria-valuemax': Math.round(total! / 1000), 'aria-valuenow': Math.round(here / 1000), 'aria-valuetext': `${length(here) || '0:00'}，共 ${length(total)}` } : {})}>
        {total ? <><i /><b>{drag !== null && <em className="num">{length(drag) || '0:00'}</em>}<Fish mood={now.phase === 'playing' ? 'idle' : 'waiting'} /></b></> : null}
      </div>
      <span className="num">{total ? length(total) : ''}</span>
    </div>
  );
}
