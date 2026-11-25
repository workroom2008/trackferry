import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Album, type Artist, type Device, type OnlineSong, type Sendable, type Track } from '../api';
import { AddToSheet } from '../components/AddTo';
import { Cover } from '../components/Cover';
import { Heart } from '../components/Heart';
import { useOnline } from '../components/Online';
import { Segments } from '../components/Segments';
import { Sheet } from '../components/Sheet';
import { SourceIcon } from '../components/SourceIcon';
import { SpeakerChip } from '../components/SpeakerChip';
import { useToast } from '../components/Toast';
import { deviceTitle, length, singer } from '../copy';
import { connected, HERE, lookAt, useTarget } from '../ear';
import { hereName, hereSong, listHere, onlineHere, playHere, trackHere, useHere } from '../here';
import { onDeck, songOf, useLive } from '../live';
import type { Place } from '../nav';
import { stopLabel } from '../route';
import { useBackdrop } from '../stage/Stage';

type Nav = (p: Place, from?: Element | null) => void;
/** A song that can be sent, wherever it is from. */
type Song = { key: string; title: string; artist: string; track?: Track; online?: OnlineSong };
const ofTrack = (t: Track): Song => ({ key: `t${t.id}`, title: t.title, artist: singer(t.artist), track: t });
const ofOnline = (s: OnlineSong): Song => ({ key: s.key, title: s.title, artist: s.artist, online: s });

const WORDS = 'trackferry.search.words', SENT = 'trackferry.search.sent';
const read = <T,>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* for this visit only */ } };
/** Rows of the library shown before the rest is asked for. */
const FEW = 8;
let keptQ = '', keptAsked = '', keptSide: 'here' | 'online' = 'here';

/** What the search page opens with: the given side looked up already, online unless it says otherwise. */
export function lookFor(w: string, online = true) { keptQ = w; keptAsked = online ? w : ''; keptSide = online ? 'online' : 'here'; }

const low = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function dots() { return <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.7" /><circle cx="10" cy="10" r="1.7" /><circle cx="16" cy="10" r="1.7" /></svg>; }

/** Find a song, and a tap has it on the speaker. */
export function Search({ devices, navigate }: { devices: Device[]; navigate: Nav }) {
  useBackdrop();
  const [target, setTarget] = useTarget(devices);
  const speaker = connected(devices).find((d) => d.device_id === target);
  const { flows } = useLive();
  const mine = hereSong(useHere());
  const [q, setQ] = useState(keptQ);
  const key = q.trim();
  const [found, setFound] = useState<{ q: string; tracks: Track[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState({ q: keptAsked, turn: 0 });
  const [side, setSide_] = useState(keptSide);
  const setSide = (v: 'here' | 'online') => { keptSide = v; setSide_(v); };
  const [all, setAll] = useState(false);
  const [words, setWords] = useState(() => read<string>(WORDS));
  const [sent, setSent] = useState(() => read<Song>(SENT));
  const [artists, setArtists] = useState<Artist[]>([]);
  const [busy, setBusy] = useState('');
  const [more, setMore] = useState<Song | null>(null);
  const [adding, setAdding] = useState<Track | null>(null);
  const [toast, say] = useToast();
  const input = useRef<HTMLInputElement>(null);
  const online = useOnline(key, asked.q, asked.turn);

  useEffect(() => { api.shelf().then((s) => setArtists(s.artists ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (!keptQ && matchMedia('(hover: hover)').matches) input.current?.focus(); }, []);
  useEffect(() => {
    keptQ = q;
    setAll(false);
    setError(null);
    if (!key) { setFound(null); return; }
    let on = true;
    const t = setTimeout(() => api.searchLibrary(key).then((r) => on && setFound({ q: key, tracks: r.tracks ?? [] }), (e) => on && setError((e as ApiError).message)), 160);
    return () => { on = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = (w = key) => {
    if (!w) return;
    keptAsked = w;
    setAsked((a) => ({ q: w, turn: a.turn + 1 }));
    const next = [w, ...words.filter((x) => x !== w)].slice(0, 12);
    setWords(next);
    write(WORDS, next);
  };
  const look = (w: string) => { setQ(w); ask(w); scrollTo(0, 0); };

  const remember = (s: Song) => {
    const next = [s, ...sent.filter((x) => x.key !== s.key)].slice(0, 12);
    setSent(next);
    write(SENT, next);
    if (key) { const w = [key, ...words.filter((x) => x !== key)].slice(0, 12); setWords(w); write(WORDS, w); }
  };
  const play = async (s: Song, how: 'now' | 'next' = 'now', dev = target) => {
    if (dev === HERE) {
      playHere(s.track ? trackHere(s.track) : onlineHere(s.online!), how);
      if (how === 'next') say({ tone: 'ok', text: `《${s.title}》排在下一首` });
      remember(s);
      return;
    }
    const d = connected(devices).find((x) => x.device_id === dev);
    if (!d) { say({ tone: 'bad', text: '没有接入的音箱，先到音箱页接入一台' }); return; }
    if (busy) return;
    setBusy(s.key);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      const what: Sendable = s.track ? { source: 'track', track_id: s.track.id, title: s.title } : { source: 'online', id: s.key, title: s.title };
      if (how === 'next') {
        const r = await api.playNext(dev, what);
        say({ tone: 'ok', text: r.queued ? `《${s.title}》排在下一首` : `已送往${deviceTitle(d)}` });
      } else {
        await (s.track ? api.playTrack(dev, s.track.id) : api.play(dev, what));
        say({ tone: 'ok', text: `已送往${deviceTitle(d)}` });
      }
      lookAt(dev);
      remember(s);
    } catch (e) {
      const x = e as ApiError;
      if (x.code === 'gone' || x.code === 'no_track') look(`${s.title} ${s.artist}`.trim());
      else say({ tone: 'bad', text: x.message });
    } finally {
      setBusy('');
    }
  };
  const send = async (what: Sendable, name: string) => {
    if (target === HERE) {
      setBusy(name);
      try { await listHere(what); } catch (e) { say({ tone: 'bad', text: (e as Error).message }); } finally { setBusy(''); }
      return;
    }
    if (!speaker) { say({ tone: 'bad', text: '没有接入的音箱，先到音箱页接入一台' }); return; }
    setBusy(name);
    try { await api.play(target, what); lookAt(target); say({ tone: 'ok', text: `${name}已送往${deviceTitle(speaker)}` }); } catch (e) { say({ tone: 'bad', text: (e as ApiError).message }); } finally { setBusy(''); }
  };

  const on = target && target !== HERE ? onDeck(flows, target) : null;
  const song = target === HERE ? mine : on && songOf(on);
  const sounds = (s: Song) => !!song && (s.track ? song.track_id === s.track.id : !song.track_id && low(song.title ?? '') === low(s.title) && low(song.artist ?? '') === low(s.artist));

  const tracks = found?.tracks ?? [];
  const albums: Album[] = [], singers: { name: string; cover?: string }[] = [];
  for (const t of tracks) {
    if (t.album_id && t.album && low(t.album).includes(low(key)) && albums.length < 4 && !albums.some((a) => a.id === t.album_id)) albums.push({ id: t.album_id, name: t.album, artist: t.artist, cover: t.cover ?? '', tracks: 0, added_ms: 0 });
    for (const a of singer(t.artist).split(/[、/;,&]/).map((x) => x.trim())) if (a && low(a).includes(low(key)) && singers.length < 3 && !singers.some((x) => low(x.name) === low(a))) singers.push({ name: a, cover: t.cover });
  }

  const row = (s: Song) => {
    const locked = s.online?.restricted;
    const here = sounds(s);
    return (
      <li key={s.key} className={`${locked ? 'locked' : ''} ${here ? 'here' : ''}`}>
        <button type="button" className="hit" disabled={locked || !!busy} onClick={() => play(s)} aria-label={`播放${s.title}${s.artist ? `，${s.artist}` : ''}`}>
          <i>{s.track ? <Cover cover={s.track.cover} title={s.title} artist={s.artist} /> : <SourceIcon name={s.online!.source} />}{busy === s.key ? <span className="spinner" /> : here ? <em className="eq" aria-hidden="true"><u /><u /><u /></em> : null}</i>
          <span><b>{s.title}</b><small>{[s.artist || '没有歌手信息', s.track ? singer(s.track.album) : stopLabel[s.online!.source], locked ? '要会员' : s.online?.note].filter(Boolean).join('　')}</small></span>
        </button>
        {!locked && <button type="button" className="hit-more" onClick={() => setMore(s)} aria-haspopup="dialog" aria-label={`${s.title}，更多操作`}>{dots()}</button>}
      </li>
    );
  };

  const rows = all ? tracks : tracks.slice(0, FEW);
  const songsOnline = online.res?.songs ?? [];
  const fresh = found?.q === key;
  return (
    <div className="search">
      <div className="search-top">
        <header><h1>搜索</h1><SpeakerChip devices={devices} value={target} onChange={setTarget} title="送到哪里" /></header>
        <form role="search" className="search-box glass" onSubmit={(e) => { e.preventDefault(); ask(); if (fresh && !tracks.length) setSide('online'); input.current?.blur(); }}>
          <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="歌名、歌手、专辑" enterKeyHint="search" autoComplete="off" autoCorrect="off" aria-label="搜索曲库和在线源" maxLength={100} />
          {q && <button type="button" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="清空"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>}
        </form>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}

      {!key && (
        <>
          {words.length > 0 && <section><header className="search-head"><h2>最近搜过</h2><button type="button" className="shelf-more" onClick={() => { setWords([]); write(WORDS, []); }}>清空</button></header><div className="word-chips">{words.map((w) => <button key={w} type="button" onClick={() => look(w)}>{w}</button>)}</div></section>}
          {sent.length > 0 && <section><header className="search-head"><h2>最近送过</h2><button type="button" className="shelf-more" onClick={() => { setSent([]); write(SENT, []); }}>清空</button></header><ol className="hits">{sent.map(row)}</ol></section>}
          {artists.length > 0 && <section><header className="search-head"><h2>歌手</h2></header><div className="singers">{artists.slice(0, 12).map((a) => <button key={a.name} type="button" onClick={() => look(a.name)}><Cover cover={a.cover} title={a.name} /><b>{a.name}</b></button>)}</div></section>}
          {!words.length && !sent.length && <p className="muted search-tip">搜到后点一下就放。</p>}
        </>
      )}

      {key && (
        <>
          <Segments label="搜哪里" value={side} onChange={(v) => { setSide(v); if (v === 'online' && !online.res && !online.busy) ask(); }} items={[
            { value: 'here', label: <>曲库{fresh && <small className="num">{tracks.length === 50 ? '50+' : tracks.length}</small>}</> },
            { value: 'online', label: <>在线源{online.busy ? <span className="spinner spinner-tiny" /> : online.res && <small className="num">{songsOnline.length}</small>}</> },
          ]} />
          {side === 'here' && fresh && (singers.length > 0 || albums.length > 0) && (
            <ul className="groups">
              {singers.map((a) => <li key={`a${a.name}`}><a href={`#/library/artist/${encodeURIComponent(a.name)}`} onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'artist', id: a.name }); }}><Cover className="round" cover={a.cover} title={a.name} /><span><b>{a.name}</b><small>歌手</small></span></a><button type="button" disabled={!!busy} onClick={() => send({ source: 'artist', name: a.name }, `${a.name}的歌`)} aria-label={`播放${a.name}的歌`}><svg viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"><path d="M1 1l10 6-10 6z" fill="currentColor" /></svg></button></li>)}
              {albums.map((a) => <li key={a.id}><a href={`#/library/album/${a.id}`} onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'album', id: a.id }); }}><Cover cover={a.cover} title={a.name} artist={a.artist} /><span><b>{a.name}</b><small>专辑　{a.artist}</small></span></a><button type="button" disabled={!!busy} onClick={() => send({ source: 'album', id: a.id }, `专辑“${a.name}”`)} aria-label={`播放专辑${a.name}`}><svg viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"><path d="M1 1l10 6-10 6z" fill="currentColor" /></svg></button></li>)}
            </ul>
          )}
          {side === 'here' ? <section>
            <header className="search-head">{tracks.length > FEW && <button type="button" className="shelf-more" onClick={() => setAll(!all)}>{all ? '收起' : `看全部 ${tracks.length}${tracks.length === 50 ? '+' : ''}`}</button>}</header>
            {!found && !error ? <span className="spinner" /> : rows.length ? <ol className={`hits ${fresh ? '' : 'stale'}`}>{rows.map((t) => row(ofTrack(t)))}</ol> : fresh && <div className="search-none"><p className="muted">曲库里没有“{key}”</p><button type="button" className="btn ask-online" onClick={() => { setSide('online'); if (!online.res && !online.busy) ask(); }}>在线找</button></div>}
          </section> : <section>
            {online.busy && <p className="center"><span className="spinner" /></p>}
            {!online.res && !online.busy && <button type="button" className="btn ask-online" onClick={() => { ask(); input.current?.blur(); }}>{online.error ? '再搜一次' : `在线搜“${key}”`}</button>}
            {online.error && <p className="field-error" role="alert">{online.error}</p>}
            {songsOnline.length > 0 && <ol className="hits">{songsOnline.map((s) => row(ofOnline(s)))}</ol>}
            {online.res && !online.busy && songsOnline.length === 0 && <p className="muted">在线源也没有找到。</p>}
            {!online.busy && online.down.length > 0 && <p className="muted">{online.down.map((s) => stopLabel[s.source as OnlineSong['source']]).join('、')}这次没有回应。<button type="button" className="btn btn-quiet btn-small" onClick={() => ask()}>再搜一次</button></p>}
          </section>}
        </>
      )}

      {more && (
        <Sheet title={more.title} onClose={() => setMore(null)}>
          <p className="sheet-by">{[more.artist, more.track ? length(more.track.duration_ms) : more.online && `${stopLabel[more.online.source]}　${length(more.online.duration_ms)}`].filter(Boolean).join('　')}{more.track && <Heart trackID={more.track.id} title={more.title} />}</p>
          {connected(devices).length > 0 && <div className="send-to" role="radiogroup" aria-label="放在哪里"><button type="button" role="radio" aria-checked={target === HERE} onClick={() => setTarget(HERE)}>{hereName}</button>{connected(devices).map((d) => <button key={d.device_id} type="button" role="radio" aria-checked={d.device_id === target} onClick={() => setTarget(d.device_id)}>{deviceTitle(d)}</button>)}</div>}
          <div className="send">
            <button type="button" onClick={() => { play(more); setMore(null); }}><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" /></svg>现在放</button>
            <button type="button" onClick={() => { play(more, 'next'); setMore(null); }}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M4 12h7M4 17h7M15 11.5v7l5.5-3.5z" /></svg>下一首放</button>
          </div>
          <div className="picks plain">
            {more.track && <button type="button" onClick={() => { setAdding(more.track!); setMore(null); }}><i><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M2 4.5h13M2 10h9M2 15.5h7M15.5 10.5v8M11.5 14.5h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></i><span><b>加入歌单</b></span></button>}
            {more.track?.album_id && <button type="button" onClick={() => { setMore(null); navigate({ page: 'library', kind: 'album', id: more.track!.album_id! }); }}><i><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.4" /></svg></i><span><b>看专辑</b><small>{more.track.album}</small></span></button>}
            {more.artist && <button type="button" onClick={() => { const s = more; setMore(null); if (s.track) navigate({ page: 'library', kind: 'artist', id: s.track.artist }); else look(s.artist); }}><i><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4.5 20c1-4.4 4-6 7.5-6s6.5 1.6 7.5 6" /></svg></i><span><b>{more.track ? '看歌手' : '搜这位歌手'}</b><small>{more.artist}</small></span></button>}
          </div>
        </Sheet>
      )}
      {adding && <AddToSheet trackID={adding.id} title={adding.title} onClose={() => setAdding(null)} say={say} />}
      {toast}
    </div>
  );
}
