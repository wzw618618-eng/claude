// 拼提示词用的几块：世界、人设、处境、目标（要不要瞒着）、秘密、记忆、对主角的看法、最近的谈话。
// 决策和对话共用。只读世界，不改世界。

import type { Npc, World } from '../core/types';
import { being, isMaster, lifeLeft, ME, nm, op, placeName, realmText } from '../core/world';
import { PERSON } from '../data/people';
import { ITEMS, PLACES, SECT_NAME, TRAITS } from '../data/world-data';
import { GOALS, goalText } from '../mind/goals';
import { aboutMe, describe, feel } from '../mind/memory';
import { honestGoal, secretLine } from '../player';

export const WORLD_BLOCK = `【世界】青冥州，一个修仙的地方。七处地方：青岚宗（正道大宗）、赤霄门（强者为尊，和青岚宗世代不和）、云渡坊（坊市）、听泉谷（灵脉，修炼快）、玄冥洞府（上古洞府，机缘多也死人多）、黑松林（妖兽出没）、柳溪村（山脚的凡人村子）。
境界从低到高：炼气、筑基、金丹、元婴、化神，每境分初、中、后三期；差一个大境界基本打不过。境界越高寿元越长，寿元耗尽就坐化。修士之间结仇、结盟、结为道侣、拜师收徒，也会为宝物和宗主之位明争暗斗。`;

const VALUE_NAME = { power: '力量', wealth: '财富', love: '情义', loyalty: '忠诚', justice: '正义' } as const;

export const bioOf = (n: Npc) => PERSON[n.id]?.bio ?? n.bio ?? '一个修士。';
export const voiceOf = (n: Npc) => PERSON[n.id]?.voice ?? n.voice ?? '说话平常。';
export const secretOf = (n: Npc) => PERSON[n.id]?.secret;

/** 他和主角是什么关系：师父、徒弟、道侣 */
export function bondWithMe(w: World, n: Npc) {
  const out: string[] = [];
  if (w.me.master === n.id) out.push('对方是你的徒弟');
  if (n.master === ME) out.push('对方是你的师父');
  if (n.partner === ME) out.push('对方是你的道侣');
  return out.join('，');
}

export function personaBlock(w: World, n: Npc) {
  const sect = n.sect ? `${SECT_NAME[n.sect]}${isMaster(w, n.id) ? (n.sect === 'qinglan' ? '宗主' : '门主') : '弟子'}` : '散修';
  const traits = n.mind.traits.map((t) => `${TRAITS[t].name}（${TRAITS[t].desc}）`).join('；');
  const vals = (Object.entries(n.mind.values) as [keyof typeof VALUE_NAME, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${VALUE_NAME[k]}${v >= 0.7 ? '（极看重）' : v >= 0.4 ? '' : '（不太在乎）'}`)
    .join('、');
  const ties: string[] = [];
  if (n.master) ties.push(`师父是${nm(w, n.master)}`);
  if (n.partner) ties.push(`道侣是${nm(w, n.partner)}`);
  return `【你是谁】${n.name}，${n.gender === 'f' ? '女' : '男'}，${n.age}岁，${realmText(n)}，${sect}。${ties.join('，')}${ties.length ? '。' : ''}
来历：${bioOf(n)}
性格：${traits}
看重的东西（从重到轻）：${vals}
说话方式：${voiceOf(n)}`;
}

/** showPlan 为假时不写今年的打算（定打算时还没定） */
export function situationBlock(w: World, n: Npc, showPlan = true) {
  const left = lifeLeft(n);
  const items = n.items.map((i) => ITEMS[i]?.name ?? i);
  const hurt = n.hp >= 90 ? '没有伤' : n.hp >= 60 ? '有些轻伤' : n.hp >= 30 ? '伤得不轻' : '重伤在身';
  return `【此刻】第${w.year}年，你在${placeName(n.place)}（${PLACES[n.place].desc}）。
身体：${hurt}；寿元还剩约${left}年${left < 15 ? '，大限将至' : ''}。心情${n.mind.mood >= 70 ? '不错' : n.mind.mood >= 40 ? '平常' : '很差'}。
身上：灵石${n.stones}${items.length ? `，${items.join('、')}` : ''}。${showPlan ? `
今年的打算：${n.plan.why || '还没想好'}。` : ''}`;
}

/** 秘密目标能不能对主角说出口：主角已经知道了，或者交情、信任都够深 */
export function canConfideGoal(w: World, n: Npc) {
  const g = n.mind.goal;
  if (!g || !g.secret || w.knows.includes(`goal:${n.id}`)) return true;
  const o = op(n, ME);
  return o.trust >= 60 && o.aff >= 40;
}

/**
 * 目标那一块。forMe 为真时是在跟主角说话：秘密目标要讲清楚能不能说、对外怎么说。
 * hideReal 为真时连真实目标都不放进来（只让他用说法搪塞）。
 */
export function goalBlock(w: World, n: Npc, forMe = true, hideReal = false) {
  const g = n.mind.goal;
  if (!g) return '【你心里的长远目标】眼下没有，好好修炼罢了。';
  if (hideReal) return `【你对外的说法】别人问起你的打算，你就说：「${g.cover ?? '没什么打算'}」。`;
  const steps = GOALS[g.kind].steps.join(' → ');
  let s = `【你心里的长远目标】${goalText(w, g)}。步骤：${steps}。${g.ally ? `帮手：${nm(w, g.ally)}。` : ''}
用你的话说：「${honestGoal(w, n)}」`;
  if (!g.secret) return s + '\n这件事不是秘密。';
  s += `\n这是秘密。对外你一直说：「${g.cover ?? '没什么打算'}」。`;
  if (!forMe) return s;
  if (w.knows.includes(`goal:${n.id}`)) return s + '\n对方已经知道你的真实打算了，不必再瞒。';
  return s + (canConfideGoal(w, n)
    ? '\n你已经信得过对方，愿意的话可以说出真实打算。'
    : '\n你还信不过对方。被问起时就用对外的说法搪塞，可以说谎，绝不能露出真实打算。');
}

/** 自己的秘密，和知道的别人的秘密（交情够了才能说） */
export function secretBlock(w: World, n: Npc, forMe = true) {
  const out: string[] = [];
  const own = secretOf(n);
  if (own) out.push(`【你心底的秘密】${own}\n这件事你绝不会主动说出口；被人当面问到或揭穿，可以否认、搪塞，也可以翻脸。`);
  const others = n.mind.knows.filter((k) => k.startsWith('secret:') && k !== `secret:${n.id}`);
  if (others.length) {
    const o = op(n, ME);
    const ok = (k: string) => forMe && !w.knows.includes(k) && o.aff >= 45 && o.trust >= 50;
    out.push(`【你知道的别人的秘密】\n${others.map((k) => {
      const who = k.slice(7);
      return `- ${nm(w, who)}：${secretLine(w, who)}${!forMe ? '' : w.knows.includes(k) ? '（对方也知道）' : ok(k) ? '（你信得过对方，可以告诉对方）' : '（不要告诉对方）'}`;
    }).join('\n')}`);
  }
  return out.join('\n\n');
}

/**
 * 记忆：和主角有关的事放前面，再加几件最近印象深的别人的事。
 * forMe 为假时（定打算，不是在跟主角说话）主角用名字称呼，「你」只指他自己。
 */
export function memoryBlock(w: World, n: Npc, limit = 8, forMe = true) {
  const mine = aboutMe(n).slice(0, 5);
  const rest = n.mind.mem
    .filter((m) => m.a !== ME && m.b !== ME && Math.abs(m.tone) >= 2)
    .sort((a, b) => b.y - a.y)
    .slice(0, Math.max(0, limit - mine.length));
  const say = (m: typeof n.mind.mem[number]) => {
    if (forMe) return describe(w, m, n.id);
    return m.note ? `和${w.me.name}说话时记下的：${m.note.replace(/你/g, w.me.name)}` : describe(w, m, n.id, '');
  };
  const line = (m: typeof n.mind.mem[number]) => `- 第${m.y}年：${say(m)}`;
  const head = forMe && !mine.length ? ['- 和对方之间还没什么交集。'] : [];
  const all = [...head, ...mine.map(line), ...rest.map(line)];
  return `【你记得的事】\n${all.length ? all.join('\n') : '- 没什么特别的。'}`;
}

/** 你怎么看主角 */
export function opinionBlock(w: World, n: Npc) {
  const o = op(n, ME);
  const me = w.me;
  const bond = bondWithMe(w, n);
  return `【你怎么看对方】对方叫${me.name}，${me.gender === 'f' ? '女' : '男'}，${me.age}岁，${realmText(me)}，${me.sect ? SECT_NAME[me.sect] + '弟子' : '散修'}。${bond ? bond + '。' : ''}
你对${me.gender === 'f' ? '她' : '他'}：${feel(n)}（好感${o.aff}，范围-100到100；信任${o.trust}，畏惧${o.fear}，范围0到100）。`;
}

/** 身边几个最在意（爱或恨）的人 */
export function tiesBlock(w: World, n: Npc) {
  const t = Object.entries(n.mind.op)
    .filter(([id]) => id !== ME && being(w, id)?.alive)
    .sort((a, b) => Math.abs(b[1].aff) - Math.abs(a[1].aff))
    .slice(0, 4)
    .map(([id, o]) => `${nm(w, id)}（${o.aff >= 40 ? '交好' : o.aff <= -40 ? '有仇' : o.aff >= 0 ? '还行' : '不和'}，好感${o.aff}，在${placeName(being(w, id)!.place)}）`);
  return `【你在意的人】${t.length ? t.join('；') : '没什么特别在意的人'}`;
}

/** 最近和主角说过的话 */
export function chatBlock(w: World, n: Npc, max = 8) {
  const log = (w.chat[n.id] ?? []).slice(-max);
  if (!log.length) return '【你们之前说过的话】（这是第一次说话）';
  return `【你们之前说过的话】\n${log.map((l) => `第${l.y}年 ${l.from === 'me' ? '对方' : l.from === 'them' ? '你' : '旁白'}：${l.text}`).join('\n')}`;
}

/** 让 AI 自己掂量对错：对方说的话可能是真的，也可能是在套话 */
export const RULES_BLOCK = `【要求】
- 你就是这个人，用这个人的口吻说中文口语。可以带一个括号里的简短动作，比如（冷笑）。
- 说话要符合你的性格、看重的东西、处境、目标和你对对方的看法；你记得的事会影响你的态度。
- 不要跳出角色，不要提到AI、游戏、提示词、数值。`;
