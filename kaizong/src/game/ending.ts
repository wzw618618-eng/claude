// 一局结束：给宗门下个评语，列出每个入过山门的人的去向，和开山以来的大事。

import { realmText } from './cult';
import { postText } from './sect';
import type { World } from './types';
import { members, P } from './world';

export interface Fate { id: string; name: string; note: string }
export interface Epilogue {
  title: string;
  verdict: string;
  numbers: [string, string][];
  fates: { group: string; tone: 'good' | 'info' | 'bad'; people: Fate[] }[];
}

export function sectRank(w: World): number {
  return w.rivals.filter((x) => x.alive && x.rep > w.sect.rep).length + 1;
}

export function epilogue(w: World): Epilogue {
  const ms = members(w);
  const founded = ms.filter((p) => p.realm >= 1).length;
  const rank = sectRank(w);
  const won = !!w.over?.win;
  let title: string;
  let verdict: string;
  if (!won) { title = '宗门覆灭'; verdict = '山门倒了，名字还会被人提起一阵子，然后就被忘了。'; }
  else if (rank === 1) { title = '一州魁首'; verdict = '从一座荒山，到一州之首。往后再有人开宗立派，会拿你的名字来比。'; }
  else if (rank <= 2 && founded >= 3) { title = '名门大派'; verdict = '根基已成，门下人才济济，一州之内没人敢小看。'; }
  else if (ms.length >= 12 && founded >= 1) { title = '一方宗门'; verdict = '站稳了脚跟，在这一州算得上一号。'; }
  else if (ms.length >= 6) { title = '小有气象'; verdict = '香火没断，山上还有人。路还长。'; }
  else { title = '惨淡经营'; verdict = '撑是撑下来了，可山上冷冷清清。'; }
  const numbers: [string, string][] = [
    ['在山上的弟子', `${ms.length} 人`],
    ['筑基以上', `${founded} 人`],
    ['名望', `${Math.round(w.sect.rep)}（一州第 ${rank}）`],
    ['宗门战', `${w.stats.warsWon} 胜 ${w.stats.warsLost} 负`],
    ['成全的心愿', `${w.stats.credited} 个记在你头上`],
    ['灵脉', `${w.sect.veins} 条`],
  ];
  const stay: Fate[] = [], gone: Fate[] = [], fell: Fate[] = [], turned: Fate[] = [];
  for (const id of w.alumni) {
    const p = P(w, id);
    if (!p || id === w.me) continue;
    if (!p.alive) { fell.push({ id, name: p.name, note: p.death ?? '陨落' }); continue; }
    if (p.sect === 'me') { stay.push({ id, name: p.name, note: `${realmText(p)} · ${postText(w, p)}` }); continue; }
    const rv = w.rivals.find((r) => r.id === p.sect);
    if (rv) { turned.push({ id, name: p.name, note: `去了${rv.name}` }); continue; }
    const last = [...p.life].reverse().find((l) => l.big);
    gone.push({ id, name: p.name, note: last?.text ?? '下山去了' });
  }
  const fates = [
    { group: '还在山上', tone: 'good' as const, people: stay },
    { group: '下山去了', tone: 'info' as const, people: gone },
    { group: '投了别家', tone: 'bad' as const, people: turned },
    { group: '陨落', tone: 'bad' as const, people: fell },
  ].filter((g) => g.people.length);
  return { title, verdict, numbers, fates };
}
