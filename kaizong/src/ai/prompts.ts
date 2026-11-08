// 提示词。固定的部分（世界、规矩、人设）放在 system 里，同一个人每季一字不差，命中 DeepSeek 的缓存；
// 会变的部分（处境、关系、经历、选项）放在 prompt 里。

import type { Choice } from '../game/choices';
import { REALM_NAME, realmText, ROOT_NAME, yearsLeft } from '../game/cult';
import { TRAIT } from '../game/data/traits';
import { JOB_NAME, POLICY, SKILL_NAME, SKILLS, VALUE_NAME, VALUES } from '../game/data/world';
import type { RivalChoice } from '../game/rivals';
import { rivalStrength } from '../game/rivals';
import { postText, sectStrength, type Unconvinced } from '../game/sect';
import type { Person, Rival, World } from '../game/types';
import { WISH_NAME, type WishOption } from '../game/wishes';
import { nm, P, timeText } from '../game/world';

const WORLD = `这是一个修仙世界。一州之内有好几个宗门，互相争灵脉、抢人才。修士的境界从低到高是炼气（一到九层）、筑基、结丹、元婴、化神，隔一个大境界实力天差地别；冲击大境界有风险，失败会受伤、折寿。寿元有限：炼气约一百二十岁，筑基约两百岁，结丹约五百岁。宗门里身份从低到高是记名弟子、外门弟子、内门弟子、真传弟子、首席弟子、长老，最上面是宗主。修仙界以实力为尊：修为高的人屈居人下，心里会不服。`;

const DISCIPLE_RULES = `你在扮演宗门里的一个修士，替他决定这一季要做的一件事。
要求：
- 完全按他的性格、价值取向、处境、心愿和经历来选，像一个真实的人。不要选"最优解"，要选"他会做的事"。性格冲动的人会冲动，胆小的人会退缩，记仇的人会报复，重情的人会顾及别人。
- 只能从给出的选项里挑一个，填它的代号。
- "why"写他心里的一句话，用他自己的口吻和说话方式，第一人称，不超过 25 个字，不要复述选项。
- 只输出 JSON：{"pick":"选项代号","why":"一句话"}`;

export function personaBlock(p: Person): string {
  const traits = p.traits.map((t) => `${TRAIT[t]?.name}（${TRAIT[t]?.desc}）`).join('；');
  const vals = [...VALUES].sort((a, b) => p.values[b] - p.values[a]).slice(0, 2).map((v) => VALUE_NAME[v]).join('、');
  const lines = [
    `【你是谁】${p.name}，${p.gender === 'f' ? '女' : '男'}，${p.age}岁，${ROOT_NAME[p.root.kind]}（${p.root.els.join('')}）。`,
    `出身：${p.origin}。怪癖：${p.quirk}。说话：${p.voice}。`,
    `性格：${traits}。`,
    `最看重：${vals}。`,
  ];
  if (p.secret && !p.secret.exposed) lines.push(`你心底的秘密（别人不知道）：你${p.secret.text}。`);
  return lines.join('\n');
}

function feel(n: number, words: [number, string][]) {
  for (const [t, w] of words) if (n >= t) return w;
  return words[words.length - 1][1];
}

export function situationBlock(w: World, p: Person, unc: Unconvinced[]): string {
  const s = w.sect;
  const lines: string[] = [];
  lines.push(`【现在】${timeText(w.t)}。你在${s.name}，${postText(w, p)}，修为${realmText(p)}${yearsLeft(p) < 20 ? `，只剩约${yearsLeft(p)}年寿元` : ''}。`);
  if (s.policy) lines.push(`宗门今年的方略：${POLICY[s.policy].name}（${POLICY[s.policy].desc}）。`);
  const job = p.job;
  if (job !== 'none') lines.push(`你的差事：${JOB_NAME[job]}${p.likes.includes(job) ? '，是你喜欢的活' : p.dislikes.includes(job) ? '，是你讨厌的活' : ''}，已经干了${p.tenure}季。`);
  const best = [...SKILLS].sort((a, b) => p.skills[b] - p.skills[a]).slice(0, 2).map((k) => `${SKILL_NAME[k]}${Math.round(p.skills[k])}`).join('、');
  lines.push(`你最拿手的：${best}。你喜欢的活：${p.likes.map((j) => JOB_NAME[j]).join('、') || '无'}；讨厌的：${p.dislikes.map((j) => JOB_NAME[j]).join('、') || '无'}。`);
  lines.push(`心情${feel(p.mood, [[75, '很好'], [55, '还行'], [35, '不太好'], [0, '很差']])}，心里的怨气${feel(p.grudge, [[70, '快压不住了'], [45, '不小'], [20, '有一点'], [0, '没有']])}，对宗门${feel(p.loyalty, [[80, '死心塌地'], [55, '还算忠心'], [35, '没什么归属感'], [0, '早想走了']])}。${p.hp < 50 ? '身上有伤。' : ''}`);
  for (const u of unc.filter((x) => x.who === p.id)) lines.push(`你不服${nm(w, u.over)}：论修为、功劳你比${P(w, u.over)?.gender === 'f' ? '她' : '他'}强，却屈居其下。`);
  const ties = Object.entries(p.ops)
    .filter(([id, o]) => P(w, id)?.alive && (o.tag || Math.abs(o.aff) >= 30))
    .sort((a, b) => Math.abs(b[1].aff) - Math.abs(a[1].aff)).slice(0, 5)
    .map(([id, o]) => `${nm(w, id)}（${o.tag ? { friend: '至交', rival: '死对头', lover: '道侣', enemy: '仇人', master: '师父', pupil: '徒弟', kin: '亲人' }[o.tag] + '，' : ''}${o.aff >= 30 ? '你喜欢' : o.aff <= -30 ? '你讨厌' : '一般'}）`);
  if (ties.length) lines.push(`你在意的人：${ties.join('、')}。`);
  const meOp = p.ops[w.me];
  lines.push(`你对宗主${nm(w, w.me)}：${meOp ? feel(meOp.aff, [[50, '感激敬重'], [15, '还算认可'], [-15, '说不上好坏'], [-100, '心有怨言']]) : '说不上好坏'}。`);
  if (p.wish) lines.push(`你现在最大的心愿：${p.wish.text}（${WISH_NAME[p.wish.kind]}）。`);
  if (w.offers[p.id]) lines.push(`${w.rivals.find((r) => r.id === w.offers[p.id])?.name}私下派人找过你，许了好处，想让你过去。`);
  const recent = p.life.slice(-6).map((l) => `${timeText(l.t)}：${l.text}`);
  if (recent.length) lines.push(`你最近的经历：\n${recent.join('\n')}`);
  return lines.join('\n');
}

export function decidePrompt(w: World, p: Person, options: Choice[], unc: Unconvinced[]) {
  return {
    system: `${WORLD}\n\n${DISCIPLE_RULES}\n\n${personaBlock(p)}`,
    prompt: `${situationBlock(w, p, unc)}\n\n【这一季你能做的事】\n${options.map((c) => `- ${c.id}：${c.label}`).join('\n')}\n\n输出 JSON。`,
  };
}

export function wishPrompt(w: World, p: Person, opts: WishOption[]) {
  return {
    system: `${WORLD}\n\n你在扮演宗门里的一个修士，替他想清楚他现在最想要的是什么。按他的性格和经历挑一个方向，再用他自己的话写成一句心愿（第一人称，不超过 25 个字，要具体，像真人说的）。只输出 JSON：{"pick":序号,"text":"心愿"}\n\n${personaBlock(p)}`,
    prompt: `${situationBlock(w, p, [])}\n\n【他可能的心愿方向】\n${opts.map((o, i) => `${i}：${WISH_NAME[o.kind]}——${o.text}`).join('\n')}\n\n输出 JSON。`,
  };
}

export function reactionPrompt(w: World, p: Person, wishText: string, cause: string) {
  return {
    system: `${WORLD}\n\n你在扮演宗门里的一个修士。他多年的心愿刚刚成了，起因是宗主的一个决定——宗主做这个决定时未必知道他的心愿。写出他此刻心里的一句话（第一人称，用他的口吻，不超过 30 个字）。只输出 JSON：{"reply":"一句话"}\n\n${personaBlock(p)}`,
    prompt: `他的心愿：${wishText}\n起因：宗主${cause}\n\n输出 JSON。`,
  };
}

export function rivalPrompt(w: World, rv: Rival, options: RivalChoice[]) {
  const m = P(w, rv.master)!;
  const ratio = rivalStrength(w, rv) / Math.max(1, sectStrength(w));
  const att = rv.attitude;
  return {
    system: `${WORLD}\n\n你在扮演${rv.name}的宗主，替他决定这一季对邻近的新宗门「${w.sect.name}」怎么做。按他的性格和宗门的处境来选，不要选"最优解"。只能从选项里挑。"why"写他心里的一句话（第一人称，他的口吻，不超过 25 个字）。只输出 JSON：{"pick":"代号","why":"一句话"}\n\n${personaBlock(m)}\n身份：${rv.name}宗主，${REALM_NAME[m.realm]}修士。`,
    prompt: `【现在】${timeText(w.t)}。\n${rv.name}的实力大约是${w.sect.name}的${ratio.toFixed(1)}倍。你对${w.sect.name}的看法：${feel(att, [[40, '颇有好感'], [10, '还算客气'], [-20, '看不顺眼'], [-50, '恨不得除之而后快'], [-100, '不共戴天']])}。两家现在${{ neutral: '相安无事', ally: '是盟友', hostile: '关系紧张', war: '正在交战', truce: '刚打完仗，在休战' }[rv.status]}。${w.sect.name}名望${Math.round(w.sect.rep)}，有弟子${w.members.length - 1}人。\n\n【这一季你能做的事】\n${options.map((c) => `- ${c.id}：${c.label}`).join('\n')}\n\n输出 JSON。`,
  };
}

export function chatPrompt(w: World, p: Person) {
  return {
    system: `${WORLD}\n\n你在扮演宗门里的一个修士，宗主${nm(w, w.me)}召见了你，和你说话。用他的口吻、性格和说话方式回答，一两句话，不超过 60 个字。他对宗主的态度、心里的怨气和心愿都会影响他说话的样子；秘密不会轻易说出口。不要提"AI""游戏""数值"。另外判断宗主这句话让他心里怎么样：mood 填 -2 到 2 的整数（-2 很受伤，2 很受用）。只输出 JSON：{"reply":"他说的话","mood":0}\n\n${personaBlock(p)}`,
    prompt: (said: string, unc: Unconvinced[]) => `${situationBlock(w, p, unc)}\n\n宗主对你说：${said}\n\n输出 JSON。`,
  };
}

