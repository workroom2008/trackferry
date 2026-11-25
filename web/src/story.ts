import type { Command, Layer, LayerName, Route, TakeoverRun } from './api';
import { phaseText, type Flow } from './live';
import { pushed } from './route';

export type SourceName = LayerName;
export interface Visit { name: SourceName; from: number; to: number | null; layer: Layer | null }
export interface Story {
  key: string; kind: 'command' | 'test' | 'try' | 'push'; said: string; device: string; deviceId?: string; commandId?: number;
  /** Times are epoch ms on the server's clock. */
  start: number; seen: number; visits: Visit[]; decided: number | null; route: Route | null;
  run: TakeoverRun | null; landed: number | null; failed: boolean; end: number; open: boolean;
  audio?: Flow['audio']; player?: Flow['player']; note?: string;
}

const asked = (l?: Layer | null) => !!l && l.state !== 'skipped' && l.state !== 'disabled' && l.state !== 'open';

/** Steps of the song itself, after it was put on. */
export const after = new Set(['ended', 'paused', 'continued', 'talked', 'resume', 'stopped']);

function make(s: Omit<Story, 'landed' | 'failed' | 'end' | 'visits' | 'decided'> & { layers: Partial<Record<SourceName, Layer>>; decidedAt?: number }): Story {
  const { layers, decidedAt, ...rest } = s;
  const visits: Visit[] = [];
  const lib = layers.library;
  const busy = (l: Layer) => (l.state as string) === 'asking';
  let at = s.seen;
  if (lib) {
    visits.push({ name: 'library', from: at, to: busy(lib) ? null : at + Math.max(lib.ms, 1), layer: lib });
    at += lib.ms;
  }
  for (const n of ['lx', 'kuwo', 'kugou', 'migu', 'netease'] as const) {
    const l = layers[n];
    if (asked(l) || (l?.state === 'skipped' && l.ms > 0)) visits.push({ name: n, from: at, to: busy(l!) ? null : at + Math.max(l!.ms, 1), layer: l! });
  }
  const steps = s.run?.steps ?? [];
  const runAt = s.run?.started_ms ?? 0;
  const hit = steps.find((x) => x.step === 'confirmed') ?? steps.find((x) => x.step === 'fetched');
  const landed = hit ? runAt + hit.at_ms : null;
  const decided = s.route ? (decidedAt ?? s.seen + s.route.ms) : null;
  const marks = [s.seen, decided ?? 0, ...visits.map((v) => v.to ?? 0), ...steps.filter((x) => !after.has(x.step) && (landed === null || runAt + x.at_ms <= landed + 1500)).map((x) => runAt + x.at_ms)];
  return { ...rest, visits, decided, landed, failed: s.run?.outcome === 'failed', end: Math.max(...marks) + 900 };
}

export function fromFlow(f: Flow): Story {
  return make({
    key: f.command_id ? `c${f.command_id}` : f.kind === 'push' && f.run ? `r${f.run.id}` : `f${f.id}`, kind: f.kind, said: f.said, device: f.device ?? '', deviceId: f.device_id, commandId: f.command_id,
    start: f.upstream_ms && f.upstream_ms < f.seen_ms ? f.upstream_ms : f.seen_ms, seen: f.seen_ms, layers: f.layers,
    route: f.route ?? pushed(f.run), decidedAt: f.route ? f.seen_ms + f.route.ms : f.seen_ms, run: f.run ?? null, open: !f.done, audio: f.audio, player: f.player, note: f.note,
  });
}

export function fromCommand(c: Command, run?: TakeoverRun): Story {
  const layers: Partial<Record<SourceName, Layer>> = {};
  for (const l of c.route?.layers ?? []) layers[l.name] = l;
  return make({
    key: `c${c.id}`, kind: 'command', said: c.query, device: c.device_name, deviceId: c.device_id, commandId: c.id, start: Math.min(c.upstream_ms, c.seen_ms), seen: c.seen_ms,
    layers, route: c.route, run: run ?? null, open: run?.outcome === 'running',
  });
}

export function fromPush(r: TakeoverRun): Story {
  return make({ key: `r${r.id}`, kind: 'push', said: r.song?.title ?? r.source, device: r.device_name, deviceId: r.device_id, start: r.started_ms, seen: r.started_ms, layers: {}, route: pushed(r), decidedAt: r.started_ms, run: r, open: false });
}

/** In one phrase, what is going on at t. */
export function phase(s: Story, t: number): string {
  if (t < s.seen) return '等小爱的对话记录';
  if (s.kind !== 'test' && s.kind !== 'push' && (s.decided === null || t < s.decided)) {
    const v = s.visits.filter((x) => t >= x.from && (x.to === null || t < x.to));
    if (v.some((x) => x.layer?.opinion)) return '曲库里有同名歌，正在问原唱是谁';
    return v.length && s.visits.length ? `正在问${v.map((x) => ({ library: '曲库', lx: '洛雪', kuwo: '酷我', kugou: '酷狗', migu: '咪咕', netease: '网易云', xiaomi: '小爱' })[x.name]).join('和')}` : '正在想';
  }
  if (s.route?.decision === 'native') return s.route.reason || '交给小爱';
  if (!s.run) return s.note || (s.route?.preview ? '只观察，没有出声' : s.open ? '准备音频' : '没有接管');
  const done = (s.run.steps ?? []).filter((x) => s.run!.started_ms + x.at_ms <= t).map((x) => x.step);
  const last = s.open ? s.player?.phase : undefined;
  if (last && s.landed && t >= s.landed) return phaseText[last];
  if (done.includes('ended')) return '放完了';
  if (done.includes('stopped')) return '停下了';
  if (done.includes('cancelled')) return '被新口令取代';
  if (done.includes('released')) return '让给小爱';
  if (done.includes('confirmed')) return s.open ? '已经放上' : '放过了';
  if (s.failed && t >= s.end - 900) return '没有接管成功';
  if (done.includes('fetched')) return '音箱在取歌';
  if (done.includes('play')) return '已推给音箱，等它来取';
  if (done.includes('mute')) return '小爱已静音，正在停下';
  return '正在接管';
}
