// Thin client for the TrackFerry management API. Every mutating request carries the
// CSRF header the server requires for cookie sessions.

export interface UpdateStatus { enabled: boolean; current: string; latest?: string; newer: boolean; url?: string; notes?: string; published?: string; checked_ms?: number; error?: string;
  proxy?: string; installable?: boolean; failed?: string; install?: { phase: 'download' | 'check' | 'restart'; done?: number; total?: number; error?: string } }

export interface HomeStatus { enabled: boolean; has_token: boolean; connected: number }
export interface Playing { artist: boolean; after: boolean; hours: number }
export type Hush = 'normal' | 'strong' | 'wait';
export interface OnlineSong { key: string; source: 'kuwo' | 'kugou' | 'migu' | 'netease'; title: string; artist: string; duration_ms: number; restricted: boolean; note?: string }
export interface OnlineOutcome { source: string; state: string; detail?: string }
export interface Playlist { guid: string; name: string }
/** What can be sent to a speaker to play. */
export type Sendable = { source: 'favorites' } | { source: 'playlist' | 'album' | 'online'; id: string; title?: string } | { source: 'track'; track_id: number; title?: string } | { source: 'artist'; name: string };
export type Press = 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'mode' | 'volume' | 'wake' | 'seek';
export type PlayMode = 'loop' | 'shuffle' | 'one';
export interface Controls { state: 'playing' | 'paused' | 'idle'; volume: number | null; mode: PlayMode | ''; queue: { list: string; at: number; total: number; next: string[] } | null }

/** A song that comes: where it stands on the list, or which wish it is. */
export interface Coming { wish?: number; at: number; id: number; title: string; artist: string; cover?: string; duration_ms?: number }
export interface Queue { on: boolean; list: string; total: number; aside: boolean; mode: PlayMode | ''; wishes: Coming[]; songs: Coming[]; left: number }
export interface HereListed { id: number; title: string; artist: string; album?: string; cover?: string; duration_ms: number }

export type Mode = 'off' | 'observe' | 'takeover';

export interface Device {
  device_id: string;
  name: string;
  alias: string;
  model: string;
  hardware: string;
  miot_did: string;
  presence: string;
  mode: Mode;
  first_seen_at: string;
  last_seen_at: string;
  in_account: boolean;
  /** config.yaml permits choosing takeover for this speaker. */
  takeover_allowed: boolean;
  /** Wake can be pressed from here. */
  can_wake: boolean;
  /** Xiao AI can be silenced through Mi Home. */
  can_hush: boolean;
  hush: Hush;
}

export type SyncOutcome = 'ok' | 'empty' | 'relink_required' | 'error';

export interface SyncInfo {
  at: string;
  outcome: SyncOutcome;
  count: number;
  variant?: string;
  error?: string;
  error_kind?: string;
}

export type QRState = 'pending' | 'confirming' | 'linked' | 'expired' | 'failed';

export interface QRStatus {
  id: string;
  state: QRState;
  expires_at: string;
  error?: string;
  error_kind?: string;
  sync?: SyncInfo;
}

export type PasswordState = 'need_captcha' | 'need_verify' | 'linked';

export interface PasswordStatus {
  id: string;
  state: PasswordState;
  account: string;
  message?: string;
  captcha_rev?: number;
  verify_url?: string;
  verify_type?: 'phone' | 'email';
  expires_at: string;
  sync?: SyncInfo;
}

/** What a finished login (QR or password) reports. */
export interface LinkResult {
  sync?: SyncInfo;
}

export interface Account {
  linked: boolean;
  user_id?: string;
  linked_at?: string;
  token_obtained_at?: string;
  relink_required: boolean;
  last_sync?: SyncInfo;
}

export type NativeNote = '' | 'silent' | 'spoke' | 'playing';

export interface Command {
  id: number;
  device_id: string;
  device_name: string;
  query: string;
  answer: string;
  answer_types: string[];
  upstream_ms: number;
  prev_poll_ms: number;
  seen_ms: number;
  stale: boolean;
  intent_kind: 'song' | 'version' | 'favorite' | 'list' | 'artist' | 'random' | 'control';
  intent_title?: string;
  intent_artist?: string;
  intent_control?: string;
  stage: string;
  native_note: NativeNote;
  /** null until routed (or recorded before routing existed). */
  route: Route | null;
}

export type LayerName = 'library' | 'lx' | 'kuwo' | 'kugou' | 'migu' | 'netease' | 'xiaomi';
export type LayerState = 'hit' | 'miss' | 'ambiguous' | 'restricted' | 'error' | 'timeout' | 'disabled' | 'open' | 'skipped' | 'asking';

export interface Candidate {
  title: string;
  artist: string;
  detail?: string;
  duration_ms?: number;
  cover?: string;
}

export interface Layer {
  name: LayerName;
  state: LayerState;
  ms: number;
  opinion?: boolean;
  detail?: string;
  candidates: Candidate[];
}

export interface Route {
  /** Watch-only: nothing was played. */
  preview: boolean;
  decision: 'local' | 'online' | 'native';
  reason?: string;
  source?: 'library' | 'lx' | 'kuwo' | 'kugou' | 'migu' | 'netease';
  /** For 洛雪: the platform whose song this is, and its name. */
  platform?: string;
  platform_name?: string;
  title?: string;
  artist?: string;
  path?: string;
  track_id?: number;
  cover?: string;
  album?: string;
  duration_ms?: number;
  /** Other singers of the same title in the library. */
  others?: string[];
  list?: string;
  /** What the decision rests on. */
  basis?: { name: string; text: string }[];
  layers: Layer[];
  ms: number;
}

export interface Track {
  id: number;
  path: string;
  root: string;
  size: number;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  format: string;
  sample_rate: number;
  bits: number;
  tagged: boolean;
  cover?: string;
  album_id?: string;
  favorite?: boolean;
  added_ms?: number;
}

export interface Album { id: string; name: string; artist: string; cover: string; tracks: number; added_ms: number }
export interface Artist { name: string; cover: string; tracks: number }
export interface Shelf { newest: Album[] | null; wall: Album[] | null; artists: Artist[] | null; favorites: Track[] | null; picks: Track[] | null; albums: number }

export interface FeiniuServer { base: string; name: string; version: string; gate: boolean }

export interface Feiniu {
  code: boolean;
  linked: boolean;
  base?: string;
  user?: string;
  server?: string;
  version?: string;
  linked_at?: string;
  expired?: boolean;
  error?: string;
}
export interface FeiniuInfo { feiniu: Feiniu; suggested: string }

export interface RootReport {
  name: string;
  tracks: number;
  by_name: number;
  unreadable: number;
  damaged: number;
  error?: string;
  samples: string[];
}

export interface ScanReport {
  started_ms: number;
  finished_ms?: number;
  error?: string;
  added: number;
  removed: number;
  source?: 'feiniu' | 'files';
  total?: number;
  skipped?: number;
  roots: RootReport[];
}

export interface LibraryStatus {
  running: boolean;
  seen: number;
  tracks: number;
  artists: number;
  last: ScanReport | null;
  /** Minutes between two syncs; 0 is never. */
  every_minutes?: number;
  progress?: ScanReport;
}

/** A song played from a platform. */
export interface Missing { title: string; artist: string; plays: number; last_ms: number; owned: boolean }
export interface CacheStatus { mounted: boolean; limit_mb: number; bytes: number; songs: number }

export interface NeteaseAccount { linked: boolean; name?: string; vip: boolean; linked_ms?: number; expired: boolean }
export interface NeteaseQR { state: 'waiting' | 'scanned' | 'expired' | 'done'; account: NeteaseAccount }

export interface SourceHealth {
  source: 'kuwo' | 'kugou' | 'migu' | 'netease';
  enabled: boolean;
  ok: number;
  failed: number;
  last_ms: number;
  last_at_ms: number;
  last_error?: string;
  open_until_ms?: number;
}

export interface Intent {
  kind: string;
  title?: string;
  artist?: string;
  control?: string;
}

export type WatchState = 'starting' | 'listening' | 'error' | 'paused' | 'unsupported';

export interface WatchStatus {
  device_id: string;
  name: string;
  state: WatchState;
  last_poll_at?: string;
  last_ok_at?: string;
  error?: string;
  recorded: number;
  ignored: number;
  since: string;
}

export interface ObserverStatus {
  paused?: string;
  interval_ms: number;
  devices: WatchStatus[];
}

export type RunOutcome = 'running' | 'confirmed' | 'fetched' | 'dispatched' | 'failed' | 'cancelled';

export interface RunStep {
  step: string;
  at_ms: number;
  ok: boolean;
  detail?: string;
}

export interface Guide { verbs: string[]; polite: string[]; tails: string[]; not_music: string[]; controls: Record<string, string[]>; yes: Example[]; no: Example[] }
export interface Example { say: string; then: string; kind: string }
export type Reading = Intent & { verb?: string; word?: string; why: 'song' | 'artist' | 'random' | 'control' | 'version' | 'favorite' | 'list' | 'no_verb' | 'not_music' | 'empty' };

export interface TakeoverRun {
  id: number;
  device_id: string;
  device_name: string;
  command_id?: number;
  kind: 'test' | 'command' | 'push';
  song?: { track_id: number; title: string; artist: string; album?: string; cover?: string; duration_ms?: number; list?: string };
  source: string;
  started_ms: number;
  upstream_ms?: number;
  finished_ms?: number;
  outcome: RunOutcome;
  detail?: string;
  steps: RunStep[];
}

export interface Session {
  setup_required: boolean;
  authenticated: boolean;
  build: { version: string; commit: string };
}

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  constructor(status: number, code: string, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Called when any request finds the session gone, so the app can show the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(f: () => void) {
  onUnauthorized = f;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'trackferry' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', '连不上 TrackFerry，请确认 NAS 上的服务在运行');
  }
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/password') && !path.startsWith('/api/xiaomi/password') && !(path === '/api/feiniu' && method === 'POST')) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? 'http_' + res.status, data?.message ?? `请求失败（HTTP ${res.status}）`, data?.detail);
  }
  return data as T;
}

export const api = {
  update: () => request<UpdateStatus>('GET', '/api/update'),
  checkUpdate: () => request<UpdateStatus>('POST', '/api/update'),
  updateProxy: (proxy: string) => request<UpdateStatus>('PUT', '/api/update/proxy', { proxy }),
  installUpdate: () => request<UpdateStatus>('POST', '/api/update/install'),
  session: () => request<Session>('GET', '/api/session'),
  setup: (setup_code: string, password: string) => request('POST', '/api/setup', { setup_code, password }),
  login: (password: string, remember: boolean) => request('POST', '/api/login', { password, remember }),
  logout: () => request('POST', '/api/logout'),
  changePassword: (current: string, next: string) => request('POST', '/api/password', { current, new: next }),

  xiaomi: () => request<{ account: Account; qr?: QRStatus }>('GET', '/api/xiaomi'),
  unlink: () => request<{ account: Account }>('DELETE', '/api/xiaomi'),
  startQR: () => request<QRStatus>('POST', '/api/xiaomi/qr'),
  qr: () => request<QRStatus>('GET', '/api/xiaomi/qr'),
  cancelQR: () => request<void>('DELETE', '/api/xiaomi/qr'),
  startPassword: (account: string, password: string) => request<PasswordStatus>('POST', '/api/xiaomi/password', { account, password }),
  passwordStatus: () => request<PasswordStatus>('GET', '/api/xiaomi/password'),
  cancelPassword: () => request<void>('DELETE', '/api/xiaomi/password'),
  submitCaptcha: (code: string) => request<PasswordStatus>('POST', '/api/xiaomi/password/captcha', { code }),
  refreshCaptcha: () => request<PasswordStatus>('POST', '/api/xiaomi/password/captcha/refresh'),
  submitVerify: (code: string) => request<PasswordStatus>('POST', '/api/xiaomi/password/verify', { code }),

  devices: () => request<{ devices: Device[]; takeover_supported: boolean }>('GET', '/api/devices'),
  sync: () => request<{ sync: SyncInfo; devices: Device[]; takeover_supported: boolean }>('POST', '/api/devices/sync'),
  observer: () => request<ObserverStatus>('GET', '/api/observer'),
  commands: (before = 0, limit = 50) => request<{ commands: Command[] }>('GET', `/api/commands?limit=${limit}${before ? `&before=${before}` : ''}`),
  setNativeNote: (id: number, native_note: NativeNote) => request<Command>('PATCH', `/api/commands/${id}`, { native_note }),
  takeoverRuns: (limit = 10) => request<{ runs: TakeoverRun[]; stream_ready: boolean }>('GET', `/api/takeover/runs?limit=${limit}`),
  takeoverTest: (id: string, source: 'tone' | 'library') => request<TakeoverRun>('POST', `/api/devices/${encodeURIComponent(id)}/takeover-test`, { source }),
  library: () => request<{ library: LibraryStatus; every_minutes: number; sources: SourceHealth[] }>('GET', '/api/library'),
  shelf: () => request<Shelf>('GET', '/api/library/shelf'),
  album: (id: string) => request<{ album: Album; tracks: Track[] }>('GET', `/api/library/albums/${encodeURIComponent(id)}`),
  artist: (name: string) => request<{ artist?: Artist; tracks: Track[] | null }>('GET', `/api/library/artist?name=${encodeURIComponent(name)}`),
  lyrics: (id: number) => request<{ track: Track; lyrics: string; offset_ms?: number }>('GET', `/api/library/tracks/${id}/lyrics`),
  setLyricsOffset: (id: number, offset_ms: number) => request<unknown>('PUT', `/api/library/tracks/${id}/lyrics`, { offset_ms }),
  lxLyrics: (id: string) => request<{ lyrics: string }>('GET', `/api/lx/lyrics/${encodeURIComponent(id)}`),
  isFavorite: (id: number) => request<{ favorite: boolean }>('GET', `/api/library/tracks/${id}/favorite`),
  favorite: (id: number, on: boolean) => request<{ favorite: boolean }>('PUT', `/api/library/tracks/${id}/favorite`, { on }),
  playTrack: (id: string, track_id: number) => request<TakeoverRun>('POST', `/api/devices/${encodeURIComponent(id)}/takeover-test`, { source: 'track', track_id }),
  feiniu: () => request<FeiniuInfo>('GET', '/api/feiniu'),
  linkFeiniu: (base: string, user: string, password: string, code: string) => request<FeiniuInfo>('POST', '/api/feiniu', { base, user, password, code }),
  discoverFeiniu: () => request<{ servers: FeiniuServer[]; blocked: string[]; relay: boolean }>('GET', '/api/feiniu/discover'),
  unlinkFeiniu: () => request<FeiniuInfo>('DELETE', '/api/feiniu'),
  searchLibrary: (q: string) => request<{ tracks: Track[] | null }>('GET', `/api/library/search?q=${encodeURIComponent(q)}`),
  missing: () => request<{ songs: Missing[] }>('GET', '/api/library/missing'),
  dismissMissing: (title: string, artist: string, back = false) => request<{ songs: Missing[] }>('POST', '/api/library/missing/dismiss', { title, artist, back }),
  addToPlaylist: (guid: string, track_id: number) => request<{ changed: boolean }>('POST', `/api/library/playlists/${encodeURIComponent(guid)}/tracks`, { track_id }),
  cache: () => request<CacheStatus>('GET', '/api/cache'),
  setCache: (limit_mb: number) => request<CacheStatus>('PUT', '/api/cache', { limit_mb }),
  clearCache: () => request<CacheStatus>('DELETE', '/api/cache'),
  setEvery: (minutes: number) => request<unknown>('PUT', '/api/library/every', { minutes }),
  scanLibrary: () => request<{ started: boolean }>('POST', '/api/library/scan'),
  guide: () => request<Guide>('GET', '/api/intent'),
  explain: (text: string) => request<Reading>('POST', '/api/intent', { text }),
  tryRoute: (text: string) => request<{ intent: Intent; route: Route }>('POST', '/api/route/try', { text }),
  netease: () => request<NeteaseAccount>('GET', '/api/sources/netease/account'),
  neteaseLogout: () => request<NeteaseAccount>('DELETE', '/api/sources/netease/account'),
  neteaseSignIn: (cookie: string) => request<NeteaseAccount>('POST', '/api/sources/netease/account', { cookie }),
  neteaseStart: () => request<{ url: string }>('POST', '/api/sources/netease/qr'),
  neteaseQR: () => request<NeteaseQR>('GET', '/api/sources/netease/qr'),
  neteaseCancel: () => request<void>('DELETE', '/api/sources/netease/qr'),
  setSource: (name: string, enabled: boolean) => request<{ sources: SourceHealth[] }>('PATCH', `/api/sources/${name}`, { enabled }),
  setSourceOrder: (order: string[]) => request<{ sources: SourceHealth[] }>('PUT', '/api/sources/order', { order }),
  lx: () => request<{ lx: LxSetting }>('GET', '/api/lx'),
  saveLx: (url: string, user: string, password: string) => request<{ lx: LxSetting; sources: SourceHealth[] }>('PUT', '/api/lx', { url, user, password }),
  press: (id: string, action: Press, with_: { volume?: number; mode?: PlayMode; position?: number } = {}) => request<void>('POST', `/api/devices/${encodeURIComponent(id)}/control`, { action, ...with_ }),
  controls: (id: string) => request<Controls>('GET', `/api/devices/${encodeURIComponent(id)}/control`),
  queue: (id: string, from = 0) => request<Queue>('GET', `/api/devices/${encodeURIComponent(id)}/queue?from=${from}`).then((q) => {
    if (!Array.isArray(q?.songs) || !Array.isArray(q.wishes)) throw new ApiError(502, 'bad_answer', '读不到播放列表，TrackFerry 可能要更新');
    return q;
  }),
  queuePlay: (id: string, s: Coming) => request<void>('POST', `/api/devices/${encodeURIComponent(id)}/queue`, { action: 'play', wish: s.wish, at: s.at, id: s.id }),
  queueRemove: (id: string, s: Coming | null) => request<void>('POST', `/api/devices/${encodeURIComponent(id)}/queue`, s ? { action: 'remove', wish: s.wish, at: s.at, id: s.id } : { action: 'remove', now: true }),
  hereList: (what: { source: string; id?: string; name?: string }) => request<{ list: string; songs: HereListed[] }>('GET', `/api/here?${new URLSearchParams(Object.entries(what).filter(([, v]) => v) as [string, string][])}`),
  home: () => request<HomeStatus>('GET', '/api/home'),
  setHome: (enabled: boolean) => request<HomeStatus>('PUT', '/api/home', { enabled }),
  homeToken: () => request<{ token: string }>('POST', '/api/home/token'),
  setHush: (id: string, hush: Hush) => request<Device>('PATCH', `/api/devices/${encodeURIComponent(id)}`, { hush }),
  play: (id: string, what: Sendable) => request<TakeoverRun>('POST', `/api/devices/${encodeURIComponent(id)}/play`, what),
  playNext: (id: string, what: Sendable) => request<{ queued?: boolean }>('POST', `/api/devices/${encodeURIComponent(id)}/play`, { ...what, next: true }),
  playing: () => request<Playing>('GET', '/api/playing'),
  setPlaying: (p: Partial<Playing>) => request<Playing>('PUT', '/api/playing', p),
  favorites: (from = 0) => request<{ tracks: Track[] | null; total: number }>('GET', `/api/library/favorites?from=${from}`),
  playlists: () => request<{ playlists: Playlist[] }>('GET', '/api/library/playlists'),
  playlist: (guid: string) => request<{ name: string; tracks: Track[]; total: number }>('GET', `/api/library/playlists/${encodeURIComponent(guid)}`),
  searchOnline: (q: string) => request<{ songs: OnlineSong[]; sources: OnlineOutcome[] }>('GET', `/api/library/online?q=${encodeURIComponent(q)}`),
  setMode: (id: string, mode: Mode) => request<Device>('PATCH', `/api/devices/${encodeURIComponent(id)}`, { mode }),
};

export function captchaURL(rev: number) {
  return `/api/xiaomi/password/captcha.png?rev=${rev}`;
}

export function qrImageURL(id: string) {
  return `/api/xiaomi/qr.png?id=${encodeURIComponent(id)}`;
}

export interface LxSetting { url: string; user: string; has_password: boolean; ready: boolean }
