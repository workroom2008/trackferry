import type { Candidate, Layer, LayerName, LayerState, Route, RunOutcome, TakeoverRun } from './api';

export const stops: LayerName[] = ['library', 'lx', 'kuwo', 'kugou', 'migu', 'netease', 'xiaomi'];
export const stopLabel: Record<LayerName, string> = { library: '曲库', lx: '洛雪', kuwo: '酷我', kugou: '酷狗', migu: '咪咕', netease: '网易云', xiaomi: '小爱' };

const stateLabel: Record<LayerState, string> = {
  hit: '有', miss: '没有', ambiguous: '同名', restricted: '会员', error: '出错', timeout: '超时', disabled: '已关', open: '暂停', skipped: '', asking: '在问',
};

/** How a stop looks on the line. */
export type StopLook = 'arrived' | 'passed' | 'trouble' | 'idle';

export interface Stop {
  name: LayerName;
  label: string;
  look: StopLook;
  /** The line is travelled up to and including this stop. */
  reached: boolean;
  note: string;
}

/** Turns a decision into the four stops drawn for it. Stops never asked stay idle. */
export function line(route: Route | null): Stop[] {
  const by = new Map<LayerName, Layer>(route?.layers.map((l) => [l.name, l]));
  const end: LayerName | null = !route ? null : route.decision === 'native' ? 'xiaomi' : (route.source ?? 'library');
  const endAt = end ? stops.indexOf(end) : -1;
  return stops.map((name, i) => {
    const l = by.get(name);
    let look: StopLook = 'idle';
    if (name === end) look = 'arrived';
    else if (l?.state === 'miss' || l?.state === 'hit' || l?.state === 'ambiguous' || l?.opinion) look = 'passed';
    else if (l && l.state !== 'skipped' && l.state !== 'disabled') look = 'trouble';
    let note = l ? stateLabel[l.state] : '';
    if (l?.opinion) note = '问原唱';
    else if (name === 'xiaomi') note = '';
    else if (l && (l.state === 'hit' || l.state === 'miss')) note = l.ms >= 10 ? ms(l.ms) : l.state === 'miss' ? '没有' : '';
    return { name, label: stopLabel[name], look, reached: i <= endAt, note };
  });
}

export function ms(v: number) {
  return v < 1000 ? `${Math.max(0, Math.round(v))} ms` : `${(v / 1000).toFixed(1)} s`;
}

export function layerSays(l: Layer) {
  if (l.detail) return l.detail;
  switch (l.state) {
    case 'hit': return '命中';
    case 'miss': return '没有这首歌';
    case 'ambiguous': return '有同名歌曲，分不清';
    case 'restricted': return '只有会员或试听版本';
    case 'timeout': return '超时没答上来';
    case 'error': return '出错了';
    case 'disabled': return '已关闭';
    case 'open': return '连续失败，暂停使用';
    case 'asking': return '正在问';
    default: return '没有查';
  }
}

export function song(r: { title?: string; artist?: string } | Candidate) {
  return r.artist ? `${r.title} · ${r.artist}` : (r.title ?? '');
}

const outcomes: Record<RunOutcome, { text: string; tone: 'ok' | 'warn' | 'bad' | '' }> = {
  running: { text: '正在接管', tone: '' },
  confirmed: { text: '已播放', tone: 'ok' },
  fetched: { text: '已取流，未确认', tone: 'warn' },
  dispatched: { text: '已下发，未确认', tone: 'warn' },
  failed: { text: '接管失败', tone: 'bad' },
  cancelled: { text: '被新口令取代', tone: '' },
};

export function outcome(run: TakeoverRun) {
  if (run.outcome === 'cancelled' && run.detail === '按了停止') return { text: '已停止', tone: '' as const };
  return outcomes[run.outcome] ?? { text: run.outcome, tone: '' as const };
}

const stepNames: Record<string, string> = {
  status: '读取状态', mute: '静音', stop1: '停止小爱', stop2: '再停一次', wait: '等小爱说完', play: '推送音频', fetched: '音箱取流',
  foreign: '小爱抢回，再停', replay: '重新推送', confirmed: '确认在播', restore: '恢复音量', cancelled: '被新口令取代',
  ended: '放完', paused: '停了', continued: '又响了', talked: '有人和小爱说话', resume: '接着放', stopped: '停下了', released: '让给小爱', seek: '换到另一处',
};
export const stepLabel = (s: string) => stepNames[s] ?? s;

/** When the speaker was really playing our audio, relative to the start of the run. */
export function landedAt(run: TakeoverRun) {
  const steps = run.steps ?? [];
  return steps.find((s) => s.step === 'confirmed')?.at_ms ?? steps.find((s) => s.step === 'fetched')?.at_ms;
}

/** Counts where requests ended. */
export function tally(routes: (Route | null)[]) {
  const n: Record<LayerName, number> = { library: 0, lx: 0, kuwo: 0, kugou: 0, migu: 0, netease: 0, xiaomi: 0 };
  for (const r of routes) if (r) n[r.decision === 'native' ? 'xiaomi' : (r.source ?? 'library')]++;
  return n;
}

/** A song sent from the library, as if it had been asked for. */
export function pushed(run?: TakeoverRun | null): Route | null {
  const s = run?.song;
  return s ? { preview: false, decision: 'local', source: 'library', ms: 0, layers: [], track_id: s.track_id, list: s.list, title: s.title, artist: s.artist, album: s.album, cover: s.cover, duration_ms: s.duration_ms } as unknown as Route : null;
}

/** What played, in words the page can show: 洛雪's songs name the platform they came from. */
export function playedBy(r: Route | null | undefined): string {
  if (!r) return stopLabel.library;
  const base = stopLabel[r.source ?? 'library'];
  if (r.source === 'lx' && r.platform_name) return `${base}·${r.platform_name}`;
  return base;
}
