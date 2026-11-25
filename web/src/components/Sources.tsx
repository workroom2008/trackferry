import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type CacheStatus, type SourceHealth } from '../api';
import { clock } from '../copy';
import { Pick } from './Pick';
import { Setting, WavesIcon, type Light } from './Setting';
import { Netease } from './Netease';
import { Lx } from './Lx';
import { SourceIcon } from './SourceIcon';
import { ms, stopLabel } from '../route';

function size(bytes: number) {
  const mb = bytes / 2 ** 20;
  return mb < 1024 ? `${Math.round(mb)} MB` : `${+(mb / 1024).toFixed(1)} GB`;
}

/** The cache's limit that is none. */
const NO_LIMIT = -1;

export function Sources({ onLight }: { onLight: (l: Light) => void }) {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.library().then((r) => setSources(r.sources ?? [])).catch((e) => setError((e as ApiError).message)), []);
  useEffect(() => { load(); }, [load]);
  const set = async (s: SourceHealth, on: boolean) => {
    try {
      setSources((await api.setSource(s.source, on)).sources);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  // The platforms are asked in the order they are listed here; a move is saved at once.
  const move = async (from: number, to: number) => {
    if (to < 0 || to >= sources.length || from === to) return;
    const next = [...sources];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSources(next); // answer at once; the server does not reorder on failure
    try {
      setSources((await api.setSourceOrder(next.map((s) => s.source))).sources);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
      load();
    }
  };
  const [cache, setCache] = useState<CacheStatus | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => { api.cache().then(setCache).catch(() => {}); }, []); // not there: nothing to show
  const change = async (by: Promise<CacheStatus>) => {
    try {
      setCache(await by);
      setClearing(false);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  const limit = (mb: number) => change(api.setCache(mb));
  const on = sources.filter((s) => s.enabled).length;
  const down = (s: SourceHealth) => s.enabled && (s.open_until_ms ?? 0) > Date.now();
  const light: Light | null = !sources.length ? null : sources.some(down) ? 'warn' : on ? 'ok' : 'off';
  useEffect(() => { if (light) onLight(light); }, [light, onLight]);
  return (
    <Setting id="sources" icon={<WavesIcon />} title="线上音源" says="曲库没有时一起问，只放能完整听的；点 ↑ 调整先后" light={light ?? 'off'} state={sources.length ? on ? `启用 ${on} 个` : '都关着' : undefined}>
      <ul className="sources">
        {sources.map((s, i) => {
          const all = s.ok + s.failed;
          return (
            <li key={s.source} className={s.enabled ? '' : 'off'}>
              <span className="source-no num" title={i > 0 ? '和上一个换位置' : undefined}>
                {i > 0
                  ? <button type="button" className="source-up" onClick={() => move(i, i - 1)} aria-label={`${stopLabel[s.source]}提前一位`}>↑</button>
                  : <span className="source-first" aria-hidden="true">{i + 1}</span>}
              </span>
              <SourceIcon name={s.source} />
              <span className="source-state"><b>{stopLabel[s.source]}</b>{s.source === 'netease' && s.enabled && !down(s) && !s.last_error ? <Netease /> : <small>{!s.enabled ? '已关闭' : down(s) ? <span className="bad">连续失败，{clock(s.open_until_ms!).slice(0, 5)} 后再试</span> : s.last_at_ms ? `上次 ${clock(s.last_at_ms).slice(0, 5)}` : '启动后还没用过'}{s.last_error && s.enabled ? `，${s.last_error}` : ''}</small>}</span>
              <span className="source-time num">{s.enabled && s.last_at_ms ? ms(s.last_ms) : ''}</span>
              <span className="source-rate">{all > 0 && <><i><i style={{ width: `${s.ok / all * 100}%` }} /></i><small className="num">{s.ok} / {all}</small></>}</span>
              <label className="switch"><input type="checkbox" role="switch" checked={s.enabled} onChange={(e) => set(s, e.target.checked)} aria-label={`使用${stopLabel[s.source]}`} /><span /></label>
            </li>
          );
        })}
      </ul>
      <Lx onSources={setSources} />

      {cache && (
        <div className="kept">
          <div><b>听过的歌留一份</b><small>{cache.limit_mb ? <>已存 <span className="num">{cache.songs}</span> 首，{size(cache.bytes)}。{cache.limit_mb === NO_LIMIT ? '不会删，磁盘只剩 1 GB 时不再存新的。' : '没存满不会删，满了先删最久没听的。'}{cache.mounted ? '放在挂载的缓存盘' : '放在 data/cache'}</> : '已关闭，每次都从线上取'}</small></div>
          <Pick label="缓存上限" value={cache.limit_mb} onPick={limit}
            choices={[...[...new Set([0, 1024, 2048, 5120, 10240, 20480, 51200, Math.max(0, cache.limit_mb)])].sort((a, b) => a - b), NO_LIMIT].map((m) => ({ value: m, label: m === NO_LIMIT ? '不限' : m ? `最多 ${size(m * 2 ** 20)}` : '关闭' }))} />
          {cache.songs > 0 && (clearing
            ? <span className="kept-sure"><button className="btn btn-small btn-danger" onClick={() => change(api.clearCache())}>清空</button><button className="btn btn-small btn-quiet" onClick={() => setClearing(false)}>取消</button></span>
            : <button className="btn btn-small btn-quiet" onClick={() => setClearing(true)}>清空</button>)}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </Setting>
  );
}
