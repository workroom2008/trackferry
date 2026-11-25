import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, type Command, type Device, type ObserverStatus, type Route, type TakeoverRun } from '../api';
import { Cover } from '../components/Cover';
import { AddTo } from '../components/AddTo';
import { SpeakerChip } from '../components/SpeakerChip';
import { Fish } from '../components/Fish';
import { Heart } from '../components/Heart';
import { LyricSheet, Progress, useSeek, useWords } from '../components/Lyrics';
import { Notice } from '../components/Notice';
import { Play } from '../components/Play';
import { SourceIcon } from '../components/SourceIcon';
import { Sheet } from '../components/Sheet';
import { connected, HERE, useEar } from '../ear';
import { here, hereName, hereSong, hereSounding, playHere, routeHere, useHere } from '../here';
import { onSpeaker, phaseText, sounding, useLive, type Flow } from '../live';
import { Buttons, HereButtons, watchText } from '../components/Speaker';
import { clock, day, deviceTitle, length, singer } from '../copy';
import type { Place } from '../nav';
import { line, ms, outcome, playedBy, pushed, stopLabel, tally } from '../route';
import { fishPicture, songPicture, useWater } from '../stage/Stage';

const PAGE = 50;
/** Rows of the log shown at once. */
const ROWS = 12;
/** Who a row belongs to, for the log's filter. */
const kindOf = (c: Scene) => c.command?.intent_kind === 'favorite' ? 'favorite' : !c.route || c.route.decision === 'native' ? 'xiaomi' : c.route.source ?? 'library';
const kinds = ['library', 'kuwo', 'kugou', 'migu', 'netease', 'xiaomi', 'favorite'] as const;
const kindLabel = (k: string) => k === 'favorite' ? '收藏' : k === 'xiaomi' ? '小爱' : stopLabel[k as keyof typeof stopLabel];
/** What is on the water: a recorded request, or one just tried. */
interface Scene { key: string; said: string; asked?: string; route: Route | null; command?: Command; run?: TakeoverRun; device?: string; deviceId?: string; at?: number }

const sceneOf = (c: Command, runs: TakeoverRun[]): Scene => ({ key: `c${c.id}`, said: c.query, route: c.route, command: c, run: runs.find((r) => r.kind === 'command' && r.command_id === c.id), device: c.device_name, deviceId: c.device_id, at: c.upstream_ms });
const sceneOfPush = (r: TakeoverRun): Scene => ({ key: `r${r.id}`, said: '', route: pushed(r), run: r, device: r.device_name, deviceId: r.device_id, at: r.started_ms });

const narrow = matchMedia('(max-width: 760px)');
/** A phone in the hand: one screen, the log in a sheet. */
const usePhone = () => useSyncExternalStore((f) => { narrow.addEventListener('change', f); return () => narrow.removeEventListener('change', f); }, () => narrow.matches);

const sentBy = (r: Route | null) => r?.list ? `连播${r.list}` : '从曲库推送';

function title(s: Scene) {
  if (s.route && s.route.decision !== 'native' && s.route.title) return s.route.title;
  return s.asked || s.command?.intent_title || s.said;
}

/** The newest request, unless it left the song on the speaker playing. */
function headline(items: Scene[], flows: Flow[]): Scene | null {
  const first = items.findIndex((x) => x.route && x.route.decision !== 'native');
  const top = items[0] ?? null;
  if (!top || first <= 0) return top;
  const song = items[first];
  if (sounding(flows, song.run?.id)) return song;
  return top.command?.intent_kind === 'favorite' && top.deviceId === song.deviceId ? song : top;
}

function HeartMark() {
  return <svg viewBox="0 0 20 18" width="20" height="18" aria-hidden="true"><path d="M10 16.6S1.4 11.6 1.4 5.9C1.4 3.3 3.4 1.4 5.8 1.4c1.8 0 3.3 1 4.2 2.6.9-1.6 2.4-2.6 4.2-2.6 2.4 0 4.4 1.9 4.4 4.5 0 5.7-8.6 10.7-8.6 10.7z" fill="currentColor" /></svg>;
}

function Crossing({ scene, trying }: { scene: Scene | null; trying: boolean }) {
  const water = useWater();
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const st = line(scene?.route ?? null);
  const key = scene?.key;
  const end = st.findIndex((s) => s.look === 'arrived');
  useEffect(() => {
    if (!water) return;
    const xs = () => refs.current.slice(0, end + 1).map((el) => { const b = el!.getBoundingClientRect(); return b.left + b.width / 2; });
    if (end < 0 || !key || !refs.current[0]?.offsetParent) { // not shown on a phone
      water.ferry([]); return; }
    water.ferry(xs());
    const again = () => water.ferry(xs(), true);
    addEventListener('resize', again);
    return () => { removeEventListener('resize', again); water.ferry([]); };
  }, [water, key, end]);
  return (
    <ol style={{ '--stops': st.length } as React.CSSProperties} className={`crossing ${st.length > 5 ? 'many ' : ''}${trying ? 'trying' : ''}`} aria-label={end >= 0 ? `由${st[end].label}播放` : undefined}>
      {st.map((s, i) => (
        <li key={s.name} ref={(el) => { refs.current[i] = el; }} className={`stop stop-${s.look}`} style={{ '--i': i } as React.CSSProperties}>
          <b><SourceIcon name={s.name} /><span>{s.label}</span></b><small className="num">{s.note}</small>
        </li>
      ))}
    </ol>
  );
}

// What was last known shows at once while it is asked for again.
let known: { obs: ObserverStatus; cmds: Command[]; runs: TakeoverRun[]; more: boolean } | null = null;

export function Home({ devices, navigate, onRelink }: { devices: Device[]; navigate: (p: Place) => void; onRelink: () => void }) {
  const water = useWater();
  const [obs, setObs] = useState<ObserverStatus | null>(known?.obs ?? null);
  const [cmds, setCmds] = useState<Command[] | null>(known?.cmds ?? null);
  const [runs, setRuns] = useState<TakeoverRun[]>(known?.runs ?? []);
  const [more, setMore] = useState(known?.more ?? false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tried, setTried] = useState<Scene | null>(null);
  const [text, setText] = useState('');
  const [trying, setTrying] = useState(false);
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState('');
  const [ear, setEar] = useEar(devices);
  const local = ear === HERE;
  const listen = local ? '' : ear; // whose requests are shown
  const h = useHere(), mineHere = hereSong(h);
  const phone = usePhone();
  const [history, setHistory] = useState(false);
  const many = connected(devices).length > 1;
  const [big, setBig] = useState(false);
  // Fireworks on the big lyrics, on unless the reader turned them off. Kept across visits.
  const [blast, setBlast] = useState(() => {
    try { return localStorage.getItem('tf.blast') !== 'off'; } catch { return true; }
  });
  const chooseBlast = (on: boolean) => {
    setBlast(on);
    try { localStorage.setItem('tf.blast', on ? 'on' : 'off'); } catch { /* this visit only */ }
  };
  const [loading, setLoading] = useState(false);
  const loadingMore = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const raft = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [o, c, r] = await Promise.all([api.observer(), api.commands(0, PAGE), api.takeoverRuns(200)]);
      setObs(o);
      setRuns(r.runs ?? []);
      setError(null);
      known = { obs: o, cmds: c.commands, runs: r.runs ?? [], more: c.commands.length === PAGE };
      setCmds((cur) => {
        if (!cur || cur.length <= PAGE) {
          setMore(c.commands.length === PAGE);
          return c.commands;
        }
        const ids = new Set(c.commands.map((x) => x.id));
        return [...c.commands, ...cur.filter((x) => !ids.has(x.id) && x.id < (c.commands.at(-1)?.id ?? 0))];
      });
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
    return () => clearInterval(t);
  }, [refresh]);
  const flows = useLive().flows;
  const beat = flows.filter((f) => f.kind !== 'try').at(-1);
  useEffect(() => { if (beat) refresh(); }, [beat?.id, !!beat?.route, beat?.run?.steps?.length, beat?.done, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Requests, and songs sent from the library, newest first.
  const items = useMemo(() => {
    const list = (cmds ?? []).map((c) => sceneOf(c, runs));
    const oldest = more ? list.at(-1)?.at ?? 0 : 0;
    return [...list, ...runs.filter((r) => r.kind === 'push' && r.song && r.started_ms >= oldest).map(sceneOfPush)].sort((x, y) => y.at! - x.at!);
  }, [cmds, runs, more]);
  const mine = useMemo(() => listen ? items.filter((x) => x.deviceId === listen) : items, [items, listen]);
  const locally = useMemo<Scene | null>(() => mineHere && { key: `h${mineHere.key}`, said: '', route: { preview: false, decision: 'local', source: mineHere.source ?? 'library', ms: 0, layers: [], track_id: mineHere.track_id, title: mineHere.title, artist: mineHere.artist, album: mineHere.album, cover: mineHere.cover, duration_ms: mineHere.duration_ms } as unknown as Route }, [mineHere]);
  // A new request takes the stage, if its speaker is the one being looked at.
  const top = local ? locally?.key : mine[0]?.key;
  const was = useRef({ ear, top });
  useEffect(() => {
    if (was.current.ear !== ear || (was.current.top && was.current.top !== top)) { setPicked(null); setTried(null); setPage(0); }
    was.current = { ear, top };
  }, [ear, top]);
  const scene: Scene | null = tried ?? items.find((x) => x.key === picked) ?? (local ? locally : headline(mine, flows));
  const isHere = local && !!scene && scene === locally;
  const kept = mine.find((x) => x.command?.intent_kind === 'favorite');

  const native = !scene?.route || scene.route.decision === 'native';
  const pic = native ? fishPicture : songPicture({ title: scene.route!.title, artist: scene.route!.artist, cover: scene.route!.cover }, 1024);
  useEffect(() => { if (cmds) water?.show(pic); }, [water, pic.src, !!cmds]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = useWords(native ? undefined : scene?.route?.track_id,
    scene?.route?.source === 'lx' ? scene.route.cover : undefined);
  const wide = big && !!words;
  useEffect(() => {
    if (!wide) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [wide]);

  const heard = isHere ? hereSounding(h) : sounding(flows, scene?.run?.id);
  const heardOn = scene?.deviceId;
  const far = useSeek(heard, scene?.run?.id ?? scene?.key, !isHere && heard && heardOn ? (ms) => api.press(heardOn, 'seek', { position: Math.round(ms) }) : null, heard && !heard.seek ? '这首歌的格式在音箱上不能拖动' : '');
  const now = isHere ? heard : far.shown, seek = isHere ? here.seek : far.seek;

  // The raft is laid out by CSS; the water draws what stands on it.
  const ready = !!obs && !!cmds;
  useLayoutEffect(() => {
    if (!water || !ready) return;
    const set = (hard: boolean) => {
      const b = raft.current?.getBoundingClientRect();
      if (!b) return;
      const r = native ? null : { x: b.left, y: b.top, w: b.width, h: b.height };
      if (hard) water.nudge(r, b.bottom - 2);
      else water.place(r, b.bottom - 2);
    };
    set(false);
    const onScroll = () => set(true);
    const onSize = () => set(true);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onSize);
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', onSize); };
  }, [water, ready, native, wide, many, !!words, scene?.key, !!now, obs?.paused, error]);

  const touch = (e: React.PointerEvent) => { if (water && e.clientY > water.waterline) water.ripple(e.clientX, e.clientY); };
  const last = useRef(0);
  const trail = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.timeStamp - last.current > 420) { last.current = e.timeStamp; touch(e); }
  };

  const tryIt = async (e: FormEvent) => {
    e.preventDefault();
    const said = text.trim();
    if (!said) return;
    setTrying(true);
    setError(null);
    try {
      const r = await api.tryRoute(said);
      setTried({ key: `t${Date.now()}`, said, asked: r.intent.title, route: r.route });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setTrying(false);
    }
  };
  const loadMore = async () => {
    if (!cmds?.length || loadingMore.current) return;
    loadingMore.current = true;
    setLoading(true);
    try {
      const r = await api.commands(cmds[cmds.length - 1].id, PAGE);
      setCmds((cur) => [...(cur ?? []), ...r.commands.filter((x) => !cur?.some((y) => y.id === x.id))]);
      setMore(r.commands.length === PAGE);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      loadingMore.current = false;
      setLoading(false);
    }
  };
  const shown = items.filter((c) => (!kind || kindOf(c) === kind) && (!listen || c.deviceId === listen));
  const lastPage = Math.max(0, Math.ceil(shown.length / ROWS) - 1);
  const at = Math.min(page, lastPage);
  // A page that needs older records fetches them, and one ahead so that 更早 is known.
  const short = (!phone || history) && more && shown.length <= (page + 1) * ROWS;
  useEffect(() => { if (short && !loading && !error) loadMore(); }, [short, loading, error, cmds?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const turn = (n: number) => {
    setPage(n);
    if (phone) { log.current?.closest('.sheet-body')?.scrollTo({ top: 0 }); return; }
    const top = log.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) scrollTo({ top: scrollY + top - 88 });
  };
  const pick = (c: Scene) => {
    setTried(null);
    setPicked(c.key);
    setHistory(false);
    scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!obs || !cmds) return error ? <Notice tone="error" title={error} /> : <div className="boot"><span className="spinner" /></div>;

  const n = tally(mine.filter((c) => day(c.at!) === '今天' && c.command?.intent_kind !== 'favorite' && c.command?.intent_kind !== 'control').map((c) => c.route));
  const days: { label: string; items: Scene[] }[] = [];
  for (const c of shown.slice(at * ROWS, (at + 1) * ROWS)) {
    const label = day(c.at!);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(c);
  }
  const t = scene ? title(scene) : local ? `在${hereName}上听` : '说一声就来';
  const r = scene?.route;
  const flowOf: Place = { page: 'flow', id: scene?.command ? String(scene.command.id) : scene?.run ? `r${scene.run.id}` : undefined };
  const speakers = connected(devices);
  const deck = local ? undefined : speakers.find((d) => d.device_id === (listen || (now && scene?.deviceId))) ?? speakers.find((d) => onSpeaker(flows, d.device_id)) ?? speakers.find((d) => d.device_id === scene?.deviceId) ?? speakers[0];
  const o = scene?.run && outcome(scene.run);
  const total = isHere ? h.total || r?.duration_ms : r?.duration_ms;
  const where = isHere ? '' : scene?.at ? `${scene.device || '音箱'} ${day(scene.at) === '今天' ? '' : `${day(scene.at)} `}${clock(scene.at).slice(0, 5)}` : '试一句';

  const alerts: { tone: 'error' | 'warn' | 'info'; text: string; act?: string; go?: () => void }[] = [
    ...(error ? [{ tone: 'error' as const, text: error }] : []),
    ...(obs.paused === 'relink_required' ? [{ tone: 'error' as const, text: '小米登录已失效，听不到点歌', act: '重新登录', go: onRelink }] : []),
    ...(obs.paused === 'unlinked' ? [{ tone: 'warn' as const, text: '还没有关联小米账号，听不到点歌', act: '关联账号', go: onRelink }] : []),
    ...(!obs.paused && obs.devices.length === 0 ? [{ tone: 'info' as const, text: '还没有音箱在听', act: '去选音箱', go: () => navigate({ page: 'speakers' }) }] : []),
  ];
  const sign = (d: string) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
  const tail = <>
    {scene && !isHere && <button type="button" className="foot-btn foot-flow" onClick={() => navigate(flowOf)} aria-label="看它怎么走" title="流转">{sign('M4 7h7c3 0 3 10 6 10h3M4 17h5M16 7h4M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5')}</button>}
    {phone && <button type="button" className="foot-btn" onClick={() => { setPage(0); setHistory(true); }} aria-haspopup="dialog" aria-label="点歌记录" title="点歌记录">{sign('M12 7.5V12l3 2M4.6 9.5A8 8 0 1 1 4 12M4 5.5v4.2h4.2')}</button>}
  </>;
  const chip = <SpeakerChip devices={devices} value={ear} onChange={setEar} all title="看哪一台" bare={deck ? deviceTitle(deck) : '全部音箱'} />;
  const record: ReactNode = <>
        <ul className="ears">
          {obs.devices.filter((w) => !many || w.state === 'error').map((w) => <li key={w.device_id} className={w.state === 'listening' ? 'on-dot' : w.state === 'error' ? 'bad-dot' : 'off-dot'}>{w.name} {watchText[w.state]}{w.error && <span className="muted">{w.error}</span>}</li>)}
        </ul>
        <div className="log-bar" ref={log}>
          <div role="group" aria-label="由谁放">
            <button type="button" aria-pressed={!kind} onClick={() => { setKind(''); setPage(0); }}>全部</button>
            {kinds.filter((k) => k === kind || items.some((c) => kindOf(c) === k)).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(kind === k ? '' : k); setPage(0); }}>{k === 'favorite' ? <HeartMark /> : <SourceIcon name={k} />}{kindLabel(k)}</button>)}
          </div>
          {many && (
            <div role="group" aria-label="哪台音箱">
              {connected(devices).map((d) => <button key={d.device_id} type="button" aria-pressed={ear === d.device_id} onClick={() => setEar(ear === d.device_id ? '' : d.device_id)}>{deviceTitle(d)}</button>)}
            </div>
          )}
        </div>
        {days.map((d) => (
          <div key={d.label} className="log-day">
            <h2>{d.label}<small className="num">{d.label === '今天' && ([['曲库', n.library], ['酷我', n.kuwo], ['酷狗', n.kugou], ['咪咕', n.migu], ['网易云', n.netease], ['小爱', n.xiaomi]] as const).filter((x) => x[1]).map(([k, v]) => `${k} ${v}`).join('　')}</small></h2>
            <ul>
              {d.items.map((c) => {
                const nat = !c.route || c.route.decision === 'native';
                const out = c.run && outcome(c.run);
                const on = scene?.key === c.key;
                const playing = sounding(flows, c.run?.id);
                return (
                  <li key={c.key} className={on ? 'on' : ''}>
                    <button type="button" onClick={() => pick(c)} aria-current={on || undefined}>
                      <span className="log-time num">{clock(c.at!).slice(0, 5)}</span>
                      {nat ? <span className="cover nat-cover">{c.command?.intent_kind === 'favorite' ? <HeartMark /> : <SourceIcon name="xiaomi" />}</span> : <Cover cover={c.route!.cover} title={c.route!.title ?? c.said} artist={c.route!.artist} />}
                      <span className="log-main">
                        <b>{nat ? c.said : c.route!.title}</b>
                        <small>{nat ? (c.route?.reason || '由小爱处理') : [singer(c.route!.artist), c.said ? `“${c.said}”` : sentBy(c.route)].filter(Boolean).join('　')}</small>
                      </span>
                      <span className="log-end"><i>{playing ? <span className="tag tag-ok">{phaseText[playing.phase]}</span> : out && out.tone !== 'ok' && out.text !== '已播放' && <span className={`tag tag-${out.tone}`}>{out.text}</span>}</i><span>{c.device}</span><b>{c.command?.intent_kind === 'favorite' ? '收藏' : <><SourceIcon name={nat ? 'xiaomi' : c.route!.source ?? 'library'} />{nat ? '小爱' : playedBy(c.route)}</>}</b></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {shown.length === 0 && <p className="log-none">{loading || more ? '正在翻更早的记录' : kind || ear ? '没有这样的记录' : '还没有记录'}</p>}
        {(lastPage > 0 || more) && (
          <nav className="pager" aria-label="翻页">
            <button type="button" disabled={at === 0} onClick={() => turn(at - 1)}>较新</button>
            <span className="num" aria-live="polite">{at + 1}{more ? '' : ` / ${lastPage + 1}`}</span>
            <button type="button" disabled={at >= lastPage} onClick={() => turn(at + 1)}>{at >= lastPage && loading ? '在翻' : '更早'}</button>
          </nav>
        )}
  </>;

  return (
    <div className="home">
      <section className={`scene ${words ? 'player' : ''} ${wide ? 'player-wide' : ''} ${many ? 'with-spks' : ''}`} onPointerDown={touch} onPointerMove={trail}>
        {phone && alerts.length > 0 && <div className="scene-alerts">{alerts.map((a) => <div key={a.text} className={`scene-alert ${a.tone}`} role={a.tone === 'error' ? 'alert' : 'status'}><span>{a.text}</span>{a.act && <button type="button" onClick={a.go}>{a.act}</button>}</div>)}</div>}
        <div className="raft" ref={raft}>{native && <Fish water mood={trying ? 'searching' : 'idle'} />}</div>
        <div className="words">
          <div className="title" key={`t${scene?.key}`}>
          <p className="said">{isHere ? <>{[`在${hereName}放`, h.list].filter(Boolean).join('　')}</> : scene ? <>{scene.said ? `“${scene.said}”` : sentBy(scene.route)}<span>{where}</span></> : local ? <>从曲库或搜索里选一首</> : <>对音箱说“小爱同学，播放晴天”</>}</p>
          <h1 style={{ '--n': Math.max(3, [...t].reduce((a, c) => a + (c.charCodeAt(0) < 256 ? 0.55 : 1), 0)) } as React.CSSProperties}>{t}</h1>
          {!scene && <button className="link say-link" onClick={() => navigate({ page: local ? 'search' : 'say' })}>{local ? '去找歌' : '看看都能怎么说'}</button>}
          {r && !native && <p className="by">{[singer(r.artist), singer(r.album)].filter(Boolean).join('　')}</p>}
          {r && native && <p className="by">{r.reason || '由小爱处理'}</p>}
          {r?.track_id && !native ? <div className="acts"><Heart key={`h${r.track_id}/${kept?.key}`} trackID={r.track_id} title={t} /><AddTo trackID={r.track_id} title={t} /></div> : null}
          </div>
          {words && <LyricSheet key={`l${scene?.key}`} words={words} now={now} big={wide} seek={now ? seek : undefined} blast={blast} />}
          {(now || words) && <div className="transport" key={`p${scene?.key}`}>
            {now ? <Progress now={now} total={total} seek={seek} /> : <span />}
            {words && <button type="button" className="expand" aria-pressed={wide} aria-label={wide ? '收起歌词' : '放大歌词'} onClick={() => setBig(!big)}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={wide ? 'M9 4v5H4M15 20v-5h5M4 4l5 5M20 20l-5-5' : 'M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
            {wide && <button type="button" className={`expand blast-key ${blast ? 'on' : ''}`} aria-pressed={blast} aria-label={blast ? '关掉歌词特效' : '打开歌词特效'} onClick={() => chooseBlast(!blast)}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.5l2 5.6 5.8-.9-3.5 4.7 3.5 4.7-5.8-.9-2 5.6-2-5.6-5.8.9 3.5-4.7-3.5-4.7 5.8.9z" fill={blast ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></button>}
          </div>}
          {/* Stays while songs change: its list may be open. */}
          {local ? <HereButtons foot={chip} tail={tail} /> : deck ? <Buttons key={deck.device_id} device={deck} foot={chip} tail={tail} /> : <div className="deck-foot"><span className="foot-who">{chip}</span><span className="foot-acts">{tail}</span></div>}
        </div>
        <Crossing scene={scene} trying={trying} />
        <div className="below">
          <div className="verdict" key={scene?.key}>
            {o ? <span className={`tag tag-${now ? (now.phase === 'playing' ? 'ok' : 'warn') : o.tone}`}>{now ? phaseText[now.phase] : o.text}</span> : scene && !isHere && !native && <span className="tag">{scene.command ? (r?.preview ? '只记录，没有出声' : '没有接管') : `${playedBy(r)}，${ms(r!.ms)} 找到`}</span>}
            {r && !native && r.duration_ms ? <span className="num">{length(r.duration_ms)}</span> : null}
            {scene && r && !isHere && <button className="link" onClick={() => navigate(flowOf)}>看它怎么走</button>}
            {kept && scene && kept.deviceId === scene.deviceId && kept.at! > scene.at! && kept.key !== scene.key && !picked && !tried ? <span className="kept-note"><HeartMark />{kept.route?.reason}</span> : null}
            {r?.basis?.some((f) => f.name === '选它') && !tried ? <span className="muted more">{r.basis.find((f) => f.name === '选它')!.text}</span> : null}
            {r?.others?.length ? <span className="muted more">也有{r.others.join('、')}的版本</span> : null}
            {r?.track_id && !native ? <Play key={r.track_id} here={() => playHere(routeHere(r))} send={(d) => api.playTrack(d, r.track_id!)} title={t} devices={devices} /> : null}
          </div>
          <div className="recent">
            {mine.slice(0, 7).map((c) => {
              const nat = !c.route || c.route.decision === 'native';
              const name = nat ? c.said : c.route!.title ?? c.said;
              return <button key={c.key} type="button" aria-label={name} aria-current={scene?.key === c.key || undefined} onClick={() => pick(c)}>{nat ? <span className="cover nat-cover"><SourceIcon name="xiaomi" /></span> : <Cover cover={c.route!.cover} title={name} artist={c.route!.artist} />}</button>;
            })}
          </div>
          <form className="ask" onSubmit={tryIt}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="试一句，比如 播放周杰伦的晴天" aria-label="试一句点歌" maxLength={100} />
            <button disabled={trying || !text.trim()} aria-label="看谁来放">{trying ? <span className="spinner spinner-tiny" /> : <svg viewBox="0 0 18 14" width="18" height="14" aria-hidden="true"><path d="M1 7h15M10 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}</button>
          </form>
        </div>
      </section>

      {!phone && <section className="log">
        {alerts.length > 0 && <div className="alerts">{alerts.map((a) => <Notice key={a.text} tone={a.tone} title={a.text}>{a.act && <div className="notice-actions"><button className="btn btn-small" onClick={a.go}>{a.act}</button></div>}</Notice>)}</div>}
        {record}
      </section>}
      {phone && history && <Sheet title="点歌记录" onClose={() => setHistory(false)}><div className="log">{record}</div></Sheet>}
      {far.toast}
    </div>
  );
}
