import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line, tally } from '../src/route.ts';
import { day } from '../src/copy.ts';

const layer = (name: any, state: any, ms = 1) => ({ name, state, ms, candidates: [] });
const looks = (r: any) => line(r).map((s) => s.look);

test('曲库命中后不再经过线上，线停在曲库', () => {
  const r: any = { decision: 'local', source: 'library', layers: [layer('library', 'hit'), layer('xiaomi', 'skipped')] };
  assert.deepEqual(looks(r), ['arrived', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle']);
  assert.deepEqual(line(r).map((s) => s.reached), [true, false, false, false, false, false, false]);
});
test('咪咕命中时酷我没有只算经过', () => {
  const r: any = { decision: 'online', source: 'migu', layers: [layer('library', 'miss'), layer('kuwo', 'miss'), layer('kugou', 'miss'), layer('migu', 'hit'), layer('xiaomi', 'skipped')] };
  assert.deepEqual(looks(r), ['passed', 'idle', 'passed', 'passed', 'arrived', 'idle', 'idle']);
});
test('会员、超时标成有问题，关闭的音源保持未到', () => {
  const r: any = { decision: 'native', layers: [layer('library', 'miss'), layer('kuwo', 'restricted'), layer('migu', 'disabled'), layer('xiaomi', 'hit')] };
  assert.deepEqual(looks(r), ['passed', 'idle', 'trouble', 'idle', 'idle', 'idle', 'arrived']);
  assert.equal(line(r)[2].note, '会员');
});
test('没有路由记录时各站都未到', () => {
  assert.deepEqual(looks(null), ['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle']);
});
test('统计只算有路由的口令', () => {
  assert.deepEqual(tally([null, { decision: 'native' } as any, { decision: 'online', source: 'kuwo' } as any]), { library: 0, lx: 0, kuwo: 1, kugou: 0, migu: 0, netease: 0, xiaomi: 1 });
});
test('日期按自然日分组', () => {
  const now = new Date(2026, 10, 23, 0, 5).getTime();
  assert.equal(day(now, now), '今天');
  assert.equal(day(now - 10 * 60_000, now), '昨天');
});
