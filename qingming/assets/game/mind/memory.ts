// 记忆和传闻：谁对谁做了什么，亲历、目睹、听说，分量不一样；见面时会把印象深的事讲给别人听。

import type { Rng } from '../core/rng';
import type { MemKind, Memory, Npc, PlaceId, World } from '../core/types';
import { adjust, has, ME, nm, npcs, op, placeName } from '../core/world';

export const MEM_CAP = 30;

/** 每种事在当事人眼里的分量（对做事的人的看法怎么变） */
const KIND: Record<MemKind, { tone: number; trust?: number; fear?: number }> = {
  save: { tone: 3, trust: 2 }, gift: { tone: 1 }, help: { tone: 2, trust: 1 }, teach: { tone: 2 },
  talk_good: { tone: 1 }, talk_bad: { tone: -1 }, spar: { tone: 0 }, hurt: { tone: -2, fear: 1 },
  kill: { tone: -3, fear: 2 }, rob: { tone: -3, trust: -2 }, betray: { tone: -3, trust: -3 }, refuse: { tone: -1 },
  lie: { tone: -2, trust: -3 }, expose: { tone: -2 }, partner: { tone: 3, trust: 2 }, reject: { tone: -2 },
  master: { tone: 3, trust: 2 }, insult: { tone: -2 }, ally: { tone: 1, trust: 1 }, avenge: { tone: 3, trust: 2 },
};
export const baseTone = (k: MemKind) => KIND[k].tone;

/**
 * 记下一件事，并按分量改变对做事人的看法：
 * 冲着自己来的算满分，目睹别人的事算一半，听说的再减半；记仇的人坏事记得更深。
 */
export function remember(w: World, n: Npc, m: Omit<Memory, 'y'> & { y?: number }) {
  if (!n.alive) return;
  const mem: Memory = { y: m.y ?? w.year, ...m };
  if (n.mind.mem.some((x) => x.k === mem.k && x.a === mem.a && x.b === mem.b && x.y === mem.y)) return;
  n.mind.mem.push(mem);
  if (n.mind.mem.length > MEM_CAP) {
    // 忘掉最淡、最旧的一件
    let k = 0;
    n.mind.mem.forEach((x, i) => { if (Math.abs(x.tone) * 10 + x.y < Math.abs(n.mind.mem[k].tone) * 10 + n.mind.mem[k].y) k = i; });
    n.mind.mem.splice(k, 1);
  }
  // 自己做的事只记着，不改看法
  if (mem.a === n.id) return;
  let wgt = mem.b === n.id ? 1 : 0.5;
  if (mem.from) wgt *= 0.5;
  let tone = mem.tone;
  // 害的是自己在乎的人，也算到自己头上
  if (mem.b && mem.b !== n.id && mem.b !== mem.a) {
    const care = n.mind.op[mem.b]?.aff ?? 0;
    if (Math.abs(care) >= 40) tone = tone * Math.sign(care) * 1.5;
  }
  if (tone < 0 && has(n, 'grudge')) tone *= 1.5;
  if (tone > 0 && has(n, 'grudge')) tone *= 0.7;
  const k = KIND[mem.k];
  adjust(n, mem.a, { aff: tone * 8 * wgt, trust: (k.trust ?? 0) * 6 * wgt * Math.sign(tone || 1), fear: (k.fear ?? 0) * 10 * wgt });
}

/** 某件事发生时，在场的其他人都看在眼里 */
export function witness(w: World, at: PlaceId, m: Omit<Memory, 'y' | 'at'>, except: string[] = []) {
  for (const n of npcs(w)) {
    if (n.place !== at || n.id === m.a || n.id === m.b || except.includes(n.id)) continue;
    remember(w, n, { ...m, at });
  }
}

/** 甲把一件印象深的事讲给乙听（讲别人的事，不讲乙自己的） */
export function gossip(w: World, a: Npc, b: Npc, rng: Rng) {
  const cands = a.mind.mem.filter((m) => !m.from && m.a !== b.id && m.b !== b.id && Math.abs(m.tone) >= 1 && (m.told ?? 0) < 3 && !(m.a === a.id && m.tone < 0));
  if (!cands.length) return null;
  cands.sort((x, y) => Math.abs(y.tone) - Math.abs(x.tone) || y.y - x.y);
  const m = rng.chance(0.7) ? cands[0] : rng.pick(cands);
  m.told = (m.told ?? 0) + 1;
  // 不信任的人讲的话，听的人打个折
  if (op(b, a.id).trust < 20 && rng.chance(0.5)) return null;
  remember(w, b, { ...m, from: a.id, told: 0, tone: Math.trunc(m.tone / 2) || Math.sign(m.tone) });
  // 知道的秘密，交情够深才说
  for (const key of a.mind.knows) {
    if (!b.mind.knows.includes(key) && op(a, b.id).aff >= 55 && op(a, b.id).trust >= 55 && rng.chance(0.2)) {
      b.mind.knows.push(key);
      break;
    }
  }
  return m;
}

// ───────────── 写成一句话 ─────────────

const SAY: Record<MemKind, string> = {
  save: '{a}{at}救了{b}', gift: '{a}{at}送了{b}东西', help: '{a}{at}帮了{b}一把', teach: '{a}{at}指点{b}修行',
  talk_good: '{a}{at}和{b}聊得投机', talk_bad: '{a}{at}和{b}话不投机', spar: '{a}{at}和{b}切磋了一场', hurt: '{a}{at}打伤了{b}',
  kill: '{a}{at}杀了{b}', rob: '{a}{at}抢了{b}的东西', betray: '{a}{at}出卖了{b}', refuse: '{a}拒绝帮{b}', lie: '{a}骗了{b}',
  expose: '{a}揭穿了{b}', partner: '{a}和{b}结为道侣', reject: '{a}拒绝了{b}的心意', master: '{a}收{b}为徒',
  insult: '{a}{at}当众羞辱了{b}', ally: '{a}和{b}结了盟', avenge: '{a}替{b}报了仇',
};

/** 站在 viewer 的角度把记忆写出来：viewer 自己是「我」，主角是「你」（给 NPC 看）或名字 */
export function describe(w: World, m: Memory, viewer: string, youAre = ME) {
  const who = (id?: string) => (!id ? '人' : id === viewer ? '我' : id === youAre ? '你' : nm(w, id));
  if (m.from === 'rumor') return `听说${SAY[m.k].replace('{a}', who(m.a)).replace('{b}', who(m.b)).replace('{at}', '')}`;
  const s = SAY[m.k].replace('{a}', who(m.a)).replace('{b}', who(m.b)).replace('{at}', m.at ? `在${placeName(m.at)}` : '');
  return `${m.from ? `听${who(m.from)}说，` : ''}${s}`;
}

/** 这个人记得的和主角有关的事（新的在前） */
export const aboutMe = (n: Npc) => n.mind.mem.filter((m) => m.a === ME || m.b === ME).sort((a, b) => b.y - a.y);

/** 这个人怎么看主角：一句话 */
export function feel(n: Npc, id = ME) {
  const o = n.mind.op[id];
  if (!o) return '素不相识';
  if (o.aff >= 70) return '视为至交';
  if (o.aff >= 40) return '颇有好感';
  if (o.aff >= 15) return '还算客气';
  if (o.aff > -15) return o.fear >= 40 ? '有些忌惮' : '不冷不热';
  if (o.aff > -50) return '心存芥蒂';
  return o.fear >= 50 ? '又恨又怕' : '恨之入骨';
}
