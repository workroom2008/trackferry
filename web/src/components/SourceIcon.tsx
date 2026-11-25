import type { LayerName } from '../api';
import lx from '../assets/sources/lx.svg';
import feiniu from '../assets/sources/feiniu.jpg';
import kuwo from '../assets/sources/kuwo.jpg';
import kugou from '../assets/sources/kugou.jpg';
import migu from '../assets/sources/migu.jpg';
import netease from '../assets/sources/netease.jpg';
import xiaoai from '../assets/sources/xiaoai.jpg';

const src: Record<LayerName, string> = { library: feiniu, lx, kuwo, kugou, migu, netease, xiaomi: xiaoai };
export function SourceIcon({ name }: { name: LayerName }) {
  return <img className="src-icon" src={src[name]} alt="" draggable={false} />;
}
