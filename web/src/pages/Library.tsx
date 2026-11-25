import { lookFor } from './Search';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, type Album, type Artist, type Device, type FeiniuInfo, type LibraryStatus, type Missing, type Playlist, type Shelf, type Track } from '../api';
import { Cover } from '../components/Cover';
import { Heart } from '../components/Heart';
import { More, useGrow } from '../components/More';
import { Notice } from '../components/Notice';
import { listHere, playHere, trackHere } from '../here';
import { Play } from '../components/Play';
import { TrackMenu } from '../components/TrackMenu';
import { day, length, singer } from '../copy';
import { href, type Place } from '../nav';
import { songPicture, useBackdrop } from '../stage/Stage';

type Nav = (p: Place, from?: Element | null) => void;

/** Whether the library's search box looks online too; kept across visits. */
const ONLINE = 'trackferry.search.online';

export function Library({ place, devices, navigate }: { place: Place; devices: Device[]; navigate: Nav }) {
  if (place.kind === 'album') return <AlbumPage key={place.id} id={place.id!} devices={devices} navigate={navigate} />;
  if (place.kind === 'artist') return <ArtistPage key={place.id} name={place.id!} devices={devices} navigate={navigate} />;
  if (place.kind === 'favorites') return <FavoritesPage devices={devices} navigate={navigate} />;
  if (place.kind === 'playlist') return <PlaylistPage key={place.id} guid={place.id!} devices={devices} navigate={navigate} />;
  if (place.kind === 'playlists') return <PlaylistsPage devices={devices} navigate={navigate} />;
  if (place.kind === 'missing') return <MissingPage navigate={navigate} />;
  return <Front devices={devices} navigate={navigate} />;
}

// Coming back from an album or a singer should find the same page; a new visit gets a new draw, if the last is some minutes old.
let keptShelf: Shelf | null = null;
let keepNext = false;
// What was last known shows at once while it is asked for again.
let keptLib: LibraryStatus | null = null, keptFn: FeiniuInfo | null = null, keptAt = 0;
const DRAW = 10 * 60_000;
const keptAlbums = new Map<string, Album>();
const keep = (as: Album[] | null | undefined) => as?.forEach((a) => keptAlbums.set(a.id, a));

function open(a: Album, e: React.MouseEvent, navigate: Nav) {
  keptAlbums.set(a.id, a);
  e.preventDefault();
  navigate({ page: 'library', kind: 'album', id: a.id }, e.currentTarget.querySelector('img'));
}

function Tile({ a, navigate, big = false }: { a: Album; navigate: Nav; big?: boolean }) {
  return (
    <a className="tile" href={`#/library/album/${a.id}`} onClick={(e) => open(a, e, navigate)}>
      <Cover cover={a.cover} title={a.name} artist={a.artist} size={big ? 1024 : 600} />
      <b>{a.name}</b><small>{a.artist}</small>
    </a>
  );
}

function Wall({ albums, navigate }: { albums: Album[]; navigate: Nav }) {
  const rows = [0, 1, 2].map((r) => albums.filter((_, i) => i % 3 === r));
  return (
    <div className="wall">
      {rows.map((row, r) => (
        <div key={r} className="wall-row" style={{ '--len': row.length, '--dir': r % 2 ? 'reverse' : 'normal' } as CSSProperties}>
          {[...row, ...row].map((a, i) => (
            <a key={i} href={`#/library/album/${a.id}`} tabIndex={i < row.length ? 0 : -1} aria-hidden={i >= row.length || undefined} aria-label={`${a.name}，${a.artist}`} onClick={(e) => open(a, e, navigate)}>
              <Cover cover={a.cover} title={a.name} artist={a.artist} size={600} />
              <span><b>{a.name}</b><small>{a.artist}</small></span>
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}

function Tracks({ tracks, all = tracks, list = '', devices, numbered = false, showAlbum = false, paged = false, navigate }: { tracks: Track[]; /** The whole list these are of, and its name: it is played on. */ all?: Track[]; list?: string; devices: Device[]; numbered?: boolean; paged?: boolean; showAlbum?: boolean; navigate: Nav }) {
  const from = () => ({ list, songs: all.map(trackHere) });
  return (
    <ol className={`tracks ${paged ? 'paged' : ''}`}>
      {tracks.map((t, i) => (
        <li key={t.id}>
          <span className="track-lead">
            {numbered ? <span className="num track-no">{i + 1}</span> : <Cover cover={t.cover} title={t.title} artist={t.artist} />}
            <Play send={(d) => api.playTrack(d, t.id)} here={() => playHere(trackHere(t), 'now', from())} title={t.title} devices={devices} />
          </span>
          <span className="track-name">
            <b>{t.title}</b>
            <small>
              {singer(t.artist) ? <a href={`#/library/artist/${encodeURIComponent(t.artist)}`} onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'artist', id: t.artist }); }}>{t.artist}</a> : '没有歌手信息'}
              {showAlbum && t.album && (t.album_id ? <a href={`#/library/album/${t.album_id}`} onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'album', id: t.album_id }); }}>{t.album}</a> : <span>{t.album}</span>)}
            </small>
          </span>
          <span className="track-tech num">{t.format.toUpperCase()}{t.bits > 16 && t.format !== 'mp3' ? ` ${t.bits}bit` : ''}{t.sample_rate > 48000 ? ` ${t.sample_rate / 1000}k` : ''}</span>
          <Heart trackID={t.id} title={t.title} on={!!t.favorite} />
          <span className="num track-len">{length(t.duration_ms)}</span>
          <TrackMenu track={t} from={from} devices={devices} navigate={navigate} />
        </li>
      ))}
    </ol>
  );
}

const more = (p: Place, text: string, navigate: Nav) => <a className="shelf-more" href={href(p)} onClick={(e) => { e.preventDefault(); navigate(p); }}>{text}</a>;

/** Songs of one shelf on the front: pages of four on a phone, to be swiped; six rows on a desktop. */
const FEW = 12;

function Favorites({ devices, navigate }: { devices: Device[]; navigate: Nav }) {
  const [fav, setFav] = useState<{ tracks: Track[] | null; total: number } | null>(null);
  useEffect(() => { api.favorites().then(setFav).catch(() => {}); }, []);
  if (!fav?.total) return null;
  return (
    <section className="shelf">
      <header className="shelf-head"><h2>收藏的<small className="num">{fav.total}</small></h2><Play send={(d) => api.play(d, { source: 'favorites' })} here={() => listHere({ source: 'favorites' })} title="收藏" devices={devices} label="播放收藏" />{fav.total > 4 && more({ page: 'library', kind: 'favorites' }, '看全部', navigate)}</header>
      <Tracks tracks={(fav.tracks ?? []).slice(0, FEW)} all={fav.tracks ?? []} list="我的收藏" devices={devices} showAlbum paged navigate={navigate} />
    </section>
  );
}

const listHref = (l: Playlist): Place => ({ page: 'library', kind: 'playlist', id: l.guid });

function ListTile({ l, devices, navigate }: { l: Playlist; devices: Device[]; navigate: Nav }) {
  return (
    <li className="list-tile">
      <a className="tile" href={href(listHref(l))} onClick={(e) => { e.preventDefault(); navigate(listHref(l)); }}><Cover title={l.name} /><b>{l.name}</b></a>
      <Play send={(d) => api.play(d, { source: 'playlist', id: l.guid })} here={() => listHere({ source: 'playlist', id: l.guid })} title={`歌单${l.name}`} devices={devices} />
    </li>
  );
}

function Playlists({ devices, navigate }: { devices: Device[]; navigate: Nav }) {
  const [lists, setLists] = useState<Playlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.playlists().then((r) => setLists(r.playlists)).catch((e) => setError((e as ApiError).message)); }, []);
  if (!lists.length) return error ? <p className="muted">{error}</p> : null;
  return (
    <section className="shelf">
      <header className="shelf-head"><h2>歌单<small className="num">{lists.length}</small></h2>{lists.length > 2 && more({ page: 'library', kind: 'playlists' }, '看全部', navigate)}</header>
      <ul className="rail list-rail">{lists.slice(0, 12).map((l) => <ListTile key={l.guid} l={l} devices={devices} navigate={navigate} />)}</ul>
    </section>
  );
}

function PlaylistsPage({ devices, navigate }: { devices: Device[]; navigate: Nav }) {
  useEffect(() => { keepNext = true; }, []);
  useBackdrop();
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { shown, grow } = useGrow();
  useEffect(() => { api.playlists().then((r) => setLists(r.playlists)).catch((e) => setError((e as ApiError).message)); }, []);
  const hit = lists?.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase())) ?? [];
  return (
    <article className="artist">
      <Back navigate={navigate} />
      <header className="list-head"><h1>歌单</h1>{lists && <span className="num">{lists.length} 个</span>}</header>
      {error && <Notice tone="error" title={error} />}
      {!lists && !error && <div className="boot"><span className="spinner" /></div>}
      {lists && lists.length > 12 && <Filter q={q} setQ={setQ} label="找歌单" />}
      {lists?.length === 0 && <p className="muted">飞牛音乐里还没有歌单。</p>}
      {lists && lists.length > 0 && !hit.length && <p className="muted">没有叫这个名字的歌单。</p>}
      <ul className="list-grid">{hit.slice(0, shown).map((l) => <ListTile key={l.guid} l={l} devices={devices} navigate={navigate} />)}</ul>
      {hit.length > shown && <More onMore={grow} />}
    </article>
  );
}

function Filter({ q, setQ, label }: { q: string; setQ: (q: string) => void; label: string }) {
  return <label className="filter"><svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label} autoComplete="off" /></label>;
}

const within = (ts: Track[], q: string) => { const k = q.trim().toLowerCase(); return k ? ts.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(k)) : ts; };

function FavoritesPage({ devices, navigate }: { devices: Device[]; navigate: Nav }) {
  useEffect(() => { keepNext = true; }, []);
  useBackdrop();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (from: number) => {
    setBusy(true);
    try {
      const r = await api.favorites(from);
      setTracks((cur) => { const had = from ? cur ?? [] : []; const ids = new Set(had.map((t) => t.id)); return [...had, ...(r.tracks ?? []).filter((t) => !ids.has(t.id))]; });
      setTotal(r.tracks?.length ? r.total : Math.min(r.total, from));
      setError(null);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  useEffect(() => { load(0); }, []);
  return (
    <article className="artist">
      <Back navigate={navigate} />
      <header className="list-head"><h1>收藏的</h1>{tracks && <span className="num">{total.toLocaleString('zh-CN')} 首</span>}{total > 0 && <Play send={(d) => api.play(d, { source: 'favorites' })} here={() => listHere({ source: 'favorites' })} title="收藏" devices={devices} label="播放收藏" />}</header>
      {error && <Notice tone="error" title={error} />}
      {tracks ? <Tracks tracks={tracks} list="我的收藏" devices={devices} showAlbum navigate={navigate} /> : !error && <div className="boot"><span className="spinner" /></div>}
      {tracks && tracks.length < total && (error ? <p className="center"><button className="btn btn-quiet" disabled={busy} onClick={() => load(tracks.length)}>重试</button></p> : <More busy={busy} onMore={() => load(tracks.length)} />)}
      {tracks && total === 0 && <p className="muted">还没有收藏。</p>}
    </article>
  );
}

function PlaylistPage({ guid, devices, navigate }: { guid: string; devices: Device[]; navigate: Nav }) {
  useEffect(() => { keepNext = true; }, []);
  useBackdrop();
  const [list, setList] = useState<{ name: string; tracks: Track[]; total: number } | null>(null);
  const { shown, grow } = useGrow();
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hit = within(list?.tracks ?? [], q);
  useEffect(() => { api.playlist(guid).then(setList).catch((e) => setError((e as ApiError).message)); }, [guid]);
  return (
    <article className="artist">
      <Back navigate={navigate} />
      {error && <Notice tone="error" title={error} />}
      {!list && !error && <div className="boot"><span className="spinner" /></div>}
      {list && <>
        <header className="list-head"><h1>{list.name}</h1><span className="num">{list.total.toLocaleString('zh-CN')} 首</span>{list.total > 0 && <Play send={(d) => api.play(d, { source: 'playlist', id: guid })} here={() => listHere({ source: 'playlist', id: guid })} title={`歌单${list.name}`} devices={devices} label="播放歌单" />}</header>
        {list.tracks.length > 30 && <Filter q={q} setQ={setQ} label="在这个歌单里找" />}
        <Tracks tracks={hit.slice(0, shown)} all={hit} list={`歌单“${list.name}”`} devices={devices} showAlbum navigate={navigate} />
        {q.trim() && !hit.length && <p className="muted">这个歌单里没有找到。</p>}
        {shown < hit.length && <More onMore={grow} />}
        {!q && shown >= list.tracks.length && list.total > list.tracks.length && <p className="muted center">只列前 {list.tracks.length} 首，播放时全都会放。</p>}
        {list.total === 0 && <p className="muted">这个歌单里没有曲库能放的歌。</p>}
      </>}
    </article>
  );
}

function Front({ devices, navigate }: { devices: Device[]; navigate: Nav }) {
  const [shelf, setShelf] = useState<Shelf | null>(() => (keepNext || Date.now() - keptAt < DRAW ? keptShelf : null));
  const fresh = useRef(!shelf);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => { keepNext = false; }, []);
  const [lib, setLib] = useState<LibraryStatus | null>(keptLib);
  const [fn, setFn] = useState<FeiniuInfo | null>(keptFn);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [online, setOnline] = useState(() => { try { return localStorage.getItem(ONLINE) === '1'; } catch { return false; } });
  const lead = shelf?.newest?.find((a) => a.cover) ?? shelf?.wall?.[0];
  useBackdrop(lead ? songPicture({ title: lead.name, artist: lead.artist, cover: lead.cover }) : undefined);

  const [lack, setLack] = useState(0);
  useEffect(() => { api.missing().then((r) => setLack(r.songs.length)).catch(() => {}); }, []);

  const running = lib?.running ?? false;
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const [l, f] = await Promise.all([api.library(), api.feiniu()]);
        if (!on) return;
        setLib(keptLib = l.library);
        setFn(keptFn = f);
        if (!l.library.running) {
          const s = await api.shelf();
          if (!on) return;
          // Every draw differs; keep the one already on screen.
          if (fresh.current || !keptShelf || keptShelf.albums !== s.albums) {
            fresh.current = false; keptShelf = s; keptAt = Date.now(); setShelf(s); }
          keep(s.newest); keep(s.wall);
        }
        setError(null);
      } catch (e) {
        if (on) setError((e as ApiError).message);
      }
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, running ? 1500 : 30000);
    return () => { on = false; clearInterval(t); };
  }, [running]);

  const redraw = async () => {
    setDrawing(true);
    try {
      const s = await api.shelf();
      keptShelf = s;
      keptAt = Date.now();
      setShelf(s);
      keep(s.newest); keep(s.wall);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setDrawing(false);
    }
  };

  if (!lib || !fn) return error ? <Notice tone="error" title={error} /> : <div className="boot"><span className="spinner" /></div>;
  const n = (v: number) => v.toLocaleString('zh-CN');
  const artists = shelf?.artists ?? [];
  const newest = shelf?.newest ?? [];

  return (
    <div className="library">
      <header className="lib-head">
        <h1><span className="num">{n(running ? Math.max(lib.seen, lib.tracks) : lib.tracks)}</span> 首歌</h1>
        <p className="lib-sub">{running ? '正在从飞牛音乐同步' : <>{shelf && shelf.albums > 0 && <>{n(shelf.albums)} 张专辑，</>}{n(lib.artists)} 位歌手{fn.feiniu.linked && <>，来自飞牛音乐</>}</>}</p>
        <form className="lib-search glass" role="search" onSubmit={(e) => {
          e.preventDefault();
          const w = q.trim();
          if (!w) { navigate({ page: 'search' }); return; }
          lookFor(w, online);
          navigate({ page: 'search' });
        }}>
          <label>
            <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={online ? '回车搜在线源' : '歌名、歌手、专辑'} enterKeyHint="search" aria-label="搜索曲库和在线源" maxLength={100} autoComplete="off" />
          </label>
          <label className="lib-online" title="勾上后回车，直接搜在线源">
            <input type="checkbox" checked={online} onChange={(e) => { setOnline(e.target.checked); try { localStorage.setItem(ONLINE, e.target.checked ? '1' : ''); } catch { /* for this visit only */ } }} />
            在线源
          </label>
        </form>
      </header>
      {error && <Notice tone="error" title={error} />}
      {(!fn.feiniu.linked || fn.feiniu.expired) && (
        <Notice tone={fn.feiniu.expired ? 'error' : 'warn'} title={fn.feiniu.expired ? '飞牛音乐的登录已失效' : '还没有连接飞牛音乐'}>
          <div className="notice-actions"><button className="btn btn-small" onClick={() => navigate({ page: 'account' })}>{fn.feiniu.expired ? '重新登录' : '去连接'}</button></div>
        </Notice>
      )}

        <>
          {shelf?.wall && shelf.wall.length > 11 && <Wall albums={shelf.wall} navigate={navigate} />}
          {(shelf || lack > 0) && <div className="redraw">
            {lack > 0 && <a className="pill" href="#/library/missing" onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'missing' }); }}><svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.4 2.25" /><circle cx="9" cy="9" r="1.8" fill="currentColor" /></svg>缺歌<span className="num">{lack}</span></a>}
            {shelf && <button className="pill" disabled={drawing} onClick={redraw}>{drawing ? <span className="spinner spinner-tiny" /> : <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path d="M15.5 9a6.5 6.5 0 1 1-2-4.7M15.5 1.5v4h-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>}换一批</button>}
          </div>}
          <Favorites devices={devices} navigate={navigate} />
          <Playlists devices={devices} navigate={navigate} />
          {shelf?.picks && shelf.picks.length > 0 && (
            <section className="shelf"><h2>随手翻到的</h2><Tracks key={shelf.picks[0].id} tracks={shelf.picks} list="随手翻到的" devices={devices} showAlbum paged navigate={navigate} /></section>
          )}
          {newest.length > 0 && (
            <section className="shelf">
              <h2>新到的专辑</h2>
              <div className="newest">{newest.slice(0, 15).map((a, i) => <Tile key={a.id} a={a} navigate={navigate} big={i === 0} />)}</div>
            </section>
          )}
          {artists.length > 0 && (
            <section className="shelf">
              <h2>歌手</h2>
              <ul className="artists">
                {artists.map((a: Artist) => (
                  <li key={a.name}><a href={`#/library/artist/${encodeURIComponent(a.name)}`} onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'artist', id: a.name }, e.currentTarget.querySelector('img')); }}>
                    <Cover cover={a.cover} title={a.name} /><b>{a.name}</b><small className="num">{n(a.tracks)} 首</small>
                  </a></li>
                ))}
              </ul>
            </section>
          )}
        </>

    </div>
  );
}

function Back({ navigate }: { navigate: Nav }) {
  return <button className="back" onClick={() => (history.length > 1 ? history.back() : navigate({ page: 'library' }))}><svg viewBox="0 0 18 14" width="18" height="14" aria-hidden="true"><path d="M17 7H2M8 1L2 7l6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>曲库</button>;
}

function AlbumPage({ id, devices, navigate }: { id: string; devices: Device[]; navigate: Nav }) {
  useEffect(() => { keepNext = true; }, []);
  const { shown, grow } = useGrow();
  const [album, setAlbum] = useState<Album | null>(keptAlbums.get(id) ?? null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBackdrop(album ? songPicture({ title: album.name, artist: album.artist, cover: album.cover }) : undefined);
  useEffect(() => {
    api.album(id).then((r) => { setAlbum(r.album); setTracks(r.tracks); }).catch((e) => setError((e as ApiError).message));
  }, [id]);
  if (!album) return <>{error ? <><Back navigate={navigate} /><Notice tone="error" title={error} /></> : <div className="boot"><span className="spinner" /></div>}</>;
  const total = tracks?.reduce((a, t) => a + t.duration_ms, 0) ?? 0;
  return (
    <article className="album">
      <div className="album-side">
        <Back navigate={navigate} />
        <Cover className="hero" cover={album.cover} title={album.name} artist={album.artist} size={1024} eager />
      </div>
      <div className="album-main">
        <h1>{album.name}</h1>
        <p className="album-by"><a href={`#/library/artist/${encodeURIComponent(album.artist)}`} onClick={(e) => { e.preventDefault(); navigate({ page: 'library', kind: 'artist', id: album.artist }); }}>{album.artist}</a><span className="num">{album.tracks} 首{total > 0 && `，${Math.round(total / 60000)} 分钟`}</span><Play send={(d) => api.play(d, { source: 'album', id })} here={() => listHere({ source: 'album', id })} title={album.name} devices={devices} label="播放专辑" /></p>
        {error && <Notice tone="error" title={error} />}
        {tracks && <Tracks tracks={tracks.slice(0, shown)} all={tracks} list={`专辑“${album.name}”`} devices={devices} numbered navigate={navigate} />}
        {tracks && shown < tracks.length && <More onMore={grow} />}
      </div>
    </article>
  );
}

function ArtistPage({ name, devices, navigate }: { name: string; devices: Device[]; navigate: Nav }) {
  useEffect(() => { keepNext = true; }, []);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { shown, grow } = useGrow();
  const [q, setQ] = useState('');
  const hit = within(tracks ?? [], q);
  useEffect(() => {
    api.artist(name).then((r) => setTracks(r.tracks ?? [])).catch((e) => setError((e as ApiError).message));
  }, [name]);
  const albums = new Map<string, Album>();
  for (const t of tracks ?? []) {
    if (!t.album_id || !t.album) continue;
    const a = albums.get(t.album_id) ?? { id: t.album_id, name: t.album, artist: t.artist, cover: '', tracks: 0, added_ms: 0 };
    a.tracks++;
    a.cover ||= t.cover ?? '';
    albums.set(t.album_id, a);
  }
  const list = [...albums.values()].sort((a, b) => b.tracks - a.tracks);
  const lead = list.find((a) => a.cover);
  useBackdrop(tracks ? songPicture({ title: name, cover: lead?.cover }) : undefined);
  return (
    <article className="artist">
      <Back navigate={navigate} />
      <header className="artist-head">
        <Cover key={lead?.cover} className="hero" cover={lead?.cover} title={name} size={600} eager />
        <div><h1>{name}</h1>{tracks && <p className="album-by"><span className="num">{tracks.length.toLocaleString('zh-CN')} 首，{list.length} 张专辑</span>{tracks.length > 0 && <Play send={(d) => api.play(d, { source: 'artist', name })} here={() => listHere({ source: 'artist', name })} title={`${name}的歌`} devices={devices} label="播放这位歌手" />}</p>}</div>
      </header>
      {error && <Notice tone="error" title={error} />}
      {list.length > 0 && <section className="shelf"><h2>专辑</h2><div className="rail">{list.map((a) => <Tile key={a.id} a={a} navigate={navigate} />)}</div></section>}
      {tracks && tracks.length > 0 && (
        <section className="shelf"><h2>歌曲</h2>{tracks.length > 30 && <Filter q={q} setQ={setQ} label={`在${name}的歌里找`} />}
          <Tracks tracks={hit.slice(0, shown)} all={hit} list={`${name}的歌`} devices={devices} showAlbum navigate={navigate} />
          {q.trim() && !hit.length && <p className="muted">没有找到。</p>}
          {shown < hit.length && <More onMore={grow} />}
        </section>
      )}
      {tracks && tracks.length === 0 && <p className="muted">曲库里没有这位歌手的歌。</p>}
    </article>
  );
}

function MissingPage({ navigate }: { navigate: Nav }) {
  useEffect(() => { keepNext = true; }, []);
  const { shown, grow } = useGrow();
  const [songs, setSongs] = useState<Missing[] | null>(null);
  const [gone, setGone] = useState<Missing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.missing().then((r) => setSongs(r.songs)).catch((e) => setError((e as ApiError).message)); }, []);
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(() => setGone(null), 8000);
    return () => clearTimeout(t);
  }, [gone]);
  const take = async (s: Missing, back = false) => {
    setError(null);
    if (!back) setSongs((l) => l?.filter((x) => x !== s) ?? null);
    try {
      setSongs((await api.dismissMissing(s.title, s.artist, back)).songs);
      setGone(back ? null : s);
    } catch (e) {
      setError((e as ApiError).message);
      api.missing().then((r) => setSongs(r.songs), () => {});
    }
  };
  return (
    <article className="artist">
      <Back navigate={navigate} />
      <header className="lack-head">
        <div><h1>缺歌清单</h1><p>近 180 天从线上放过、曲库里还没有的歌。补进飞牛音乐并同步后自动消失；识别错的、不想要的，移除就好。</p></div>
        {!!songs?.length && <a className="btn" href="/api/library/missing.csv" download>导出表格</a>}
      </header>
      {error && <Notice tone="error" title={error} />}
      {!songs && !error && <div className="boot"><span className="spinner" /></div>}
      {songs?.length === 0 && <p className="muted">点过的歌，曲库里都有。</p>}
      {!!songs?.length && (
        <ol className="hits lacks">
          {[...songs].sort((a, b) => b.plays - a.plays || b.last_ms - a.last_ms).slice(0, shown).map((s) => (
            <li key={`${s.title} ${s.artist} ${s.last_ms}`}>
              <button type="button" className="hit" onClick={() => { lookFor(`${s.title} ${s.artist}`.trim()); navigate({ page: 'search' }); }} aria-label={`在线找${s.title}`}>
                <i><Cover title={s.title} artist={s.artist} /></i>
                <span><b>{s.title}</b><small>{[s.artist || '没有歌手信息', `放过 ${s.plays} 次`, day(s.last_ms)].join('　')}</small></span>
              </button>
              <button type="button" className="lack-x" onClick={() => take(s)} aria-label={`移除${s.title}`} title="移除"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
            </li>
          ))}
        </ol>
      )}
      {!!songs && shown < songs.length && <More onMore={grow} />}
      {gone && createPortal(<button type="button" className="play-state ok" onClick={() => take(gone, true)}><span role="status">已移除《{gone.title}》，点这里撤销</span></button>, document.body)}
    </article>
  );
}
