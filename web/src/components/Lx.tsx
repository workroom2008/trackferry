import { useEffect, useState } from 'react';
import { api, ApiError, type LxSetting, type SourceHealth } from '../api';

/**
 * Where the 洛雪 server is. The page saves it and tries it once, so a wrong address or a wrong
 * password is told apart right here instead of showing up later as a song that will not play.
 */
export function Lx({ onSources }: { onSources: (s: SourceHealth[]) => void }) {
  const [saved, setSaved] = useState<LxSetting | null>(null);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    api.lx().then((r) => {
      setSaved(r.lx);
      setUrl(r.lx.url);
      setUser(r.lx.user);
    }).catch((e) => setError((e as ApiError).message));
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const r = await api.saveLx(url.trim(), user.trim(), pw);
      setSaved(r.lx);
      setPw('');
      setDone(true);
      onSources(r.sources);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveLx('', '', '');
      setSaved(r.lx);
      setUrl('');
      setUser('');
      setPw('');
      onSources(r.sources);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kept lx-box">
      <div>
        <b>洛雪</b>
        <small>{saved?.ready ? `已接上 ${saved.url}（${saved.user}）` : '填上自己部署的洛雪音乐，酷我、酷狗、QQ、网易云、咪咕都收在它一个接口后面'}</small>
      </div>
      <form className="lx-form" onSubmit={save}>
        <label className="field"><span>地址</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:9527" autoCapitalize="off" spellCheck={false} /></label>
        <label className="field"><span>用户名</span><input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
        <label className="field"><span>密码</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" placeholder={saved?.has_password ? '不改就留空' : ''} /></label>
        <span className="kept-sure">
          <button type="submit" className="btn btn-small" disabled={busy || !url.trim() || !user.trim()}>{busy ? '测试中…' : '保存并测试'}</button>
          {saved?.ready && <button type="button" className="btn btn-small btn-quiet" onClick={clear} disabled={busy}>断开</button>}
        </span>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {done && !error && <p className="field-note">已接上洛雪，曲库没有的歌会交给它。</p>}
    </div>
  );
}
