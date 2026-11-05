// 角色的自主行动：
// - 白天自荐：每个人从自己「能做的事」里挑一件今天想干的，并说一句理由；
// - 夜里主动找你：心里有事的人会先开口；
// - 篝火对话：两个人之间的一段对话。
// 没有 AI 时按性子和营地需要来定（规则）；接上 AI 时，由 AI 按人设来定，但只能从允许的选项里挑。

import type { CharState, GameState, Intent, TaskId, Want } from '../core/types';
import { act, addRel, addTrust, ch, clamp, def, eats, has, heatNeed, lvl, nm, rel, relWord } from '../core/world';
import { BUILDINGS, TASKS, TASK_ORDER } from '../data/rules';
import { blocked, injuryRisk, preview } from '../systems/work';
import { personaBlock, situationBlock, WORLD_BLOCK } from './dialogue';
import { memoryBlock, remember } from './memory';

// ───────────── 营地需要 ─────────────

function needs(s: GameState) {
  const A = act(s);
  const eat = Math.max(1, A.reduce((n, c) => n + eats(c), 0));
  return {
    foodDays: s.res.food / eat,
    woodDays: s.res.wood / Math.max(1, heatNeed(s)),
    patients: A.filter((c) => c.injured || c.sick || c.health < 60),
    lowMood: A.length ? A.reduce((t, c) => t + c.mood, 0) / A.length < 40 : false,
  };
}

// ───────────── 白天自荐（规则） ─────────────

const OBJECT: Record<TaskId, string> = {
  wood: '斧子', hunt: '套索', scavenge: '山下的公路', explore: '远处的山路', build: '工具箱',
  cook: '锅', care: '伤员', comfort: '大家', guard: '门口', rest: '自己的铺位',
};

function sayFor(s: GameState, c: CharState, t: TaskId): string {
  if (has(c, 'mute')) return `（他指了指${OBJECT[t]}，点了点头。）`;
  const n = needs(s);
  if (has(c, 'child')) {
    const kid: Partial<Record<TaskId, string>> = {
      cook: '我想帮胖叔做饭！', comfort: '我给大家唱歌好不好？', wood: '我去捡小树枝！',
      build: '我也想帮忙搭东西！', care: '我帮忙递东西！', rest: '我有点困……',
    };
    return kid[t] ?? '我也想帮忙！';
  }
  switch (t) {
    case 'wood': return n.woodDays < 2 ? '柴快烧完了，我去砍。' : '我去多砍几捆，省得晚上挨冻。';
    case 'hunt': return n.foodDays < 3 ? '粮不多了，我去下几个套子。' : '我去山里转转，看能不能逮点东西。';
    case 'scavenge': return '附近那几辆车还没翻完，我去看看。';
    case 'explore': return '我想走远一点，说不定能找到人，或者别的路。';
    case 'build': return s.project ? `「${BUILDINGS[s.project.id].name}」得赶紧弄好，我去搭把手。` : '我去修修补补。';
    case 'cook': return '今天我来掌勺，保证大家吃口热的。';
    case 'care': return n.patients.length ? `${n.patients.map((p) => nm(p.id)).join('、')}的情况不太好，我得守着。` : '我看着点大家的身体。';
    case 'comfort': return '大家心里都憋着，我陪他们说说话。';
    case 'guard': return '晚上我来守门。';
    case 'rest': return c.stamina < 30 || c.injured || c.sick ? '我得歇一天，实在撑不住了。' : '今天想歇歇。';
  }
}

function score(s: GameState, c: CharState, t: TaskId, taken: Record<string, number>): number {
  const n = needs(s);
  const sk = TASKS[t].skill;
  let v = sk ? lvl(c, sk) : 1;
  if (t === 'hunt' && n.foodDays < 4) v += 3;
  if (t === 'wood' && n.woodDays < 3) v += 3;
  if (t === 'care') v += n.patients.length ? (c.skills.med >= 3 ? 4 : 1) : -5;
  if (t === 'build') v += s.project ? 1.5 : -9;
  if (t === 'comfort' && n.lowMood) v += 2;
  if (t === 'guard') v += s.day >= 4 ? 0.5 : -3;
  if (t === 'explore') v += s.day <= 12 ? 2.5 : 0;
  if (t === 'rest') v = c.stamina < 30 || c.mood < 20 ? 6 : 0;
  if (TASKS[t].danger) v -= injuryRisk(s, c, t) * 10;
  if (has(c, 'timid') && TASKS[t].danger) v -= 4;
  if (has(c, 'reckless') && (t === 'explore' || t === 'scavenge')) v += 2;
  if (has(c, 'lazy') && t === 'rest') v += 2;
  if (has(c, 'diligent') && t === 'rest') v -= 3;
  if (has(c, 'gourmet') && t === 'cook') v += 2;
  if (has(c, 'kind') && (t === 'care' || t === 'comfort')) v += 1.5;
  if (has(c, 'leader') && t === 'comfort') v += 1.5;
  if (has(c, 'loner') && (t === 'comfort' || t === 'cook')) v -= 1.5;
  // 别人已经认领的活，吸引力下降；掌勺和照料一个人就够了
  const k = taken[t] ?? 0;
  v -= (t === 'cook' || t === 'care' || t === 'comfort' ? 5 : 1.2) * k;
  return v;
}

export function ruleIntent(s: GameState, c: CharState, taken: Record<string, number> = {}): Intent {
  const allowed = TASK_ORDER.filter((t) => !blocked(s, c, t));
  let best: TaskId = 'rest';
  let bv = -Infinity;
  for (const t of allowed) {
    const v = score(s, c, t, taken);
    if (v > bv) { bv = v; best = t; }
  }
  return { task: best, say: sayFor(s, c, best), by: 'rule' };
}

/** 新的一天：每个人按自己的性子挑一件想干的活 */
export function planDay(s: GameState) {
  s.intents = {};
  const taken: Record<string, number> = {};
  for (const c of act(s)) {
    const it = ruleIntent(s, c, taken);
    s.intents[c.id] = it;
    taken[it.task] = (taken[it.task] ?? 0) + 1;
  }
}

export function allowedTasks(s: GameState, id: string): TaskId[] {
  const c = ch(s, id);
  return c ? TASK_ORDER.filter((t) => !blocked(s, c, t)) : [];
}

/** 照他说的办：每人每天第一次被采纳时，信任 +1 */
export function adoptIntent(s: GameState, id: string): boolean {
  const c = ch(s, id);
  const it = s.intents?.[id];
  if (!c || c.status !== 'active' || !it || it.asking || s.phase !== 'day' || blocked(s, c, it.task)) return false;
  c.task = it.task;
  const k = `adopt_${id}`;
  if (s.flags[k] !== s.day) {
    s.flags[k] = s.day;
    addTrust(c, 1);
  }
  return true;
}

export function adoptAll(s: GameState) {
  let n = 0;
  for (const c of act(s)) if (adoptIntent(s, c.id)) n++;
  return n;
}

// ───────────── 夜里主动找你（规则） ─────────────

export function ruleWants(s: GameState) {
  const cands: { id: string; p: number; w: Want }[] = [];
  const A = act(s);
  const lost = s.chars.filter((c) => c.status === 'dead' && (c.endDay ?? 0) >= s.day - 1);
  for (const c of A) {
    const d = def(c.id);
    const L = d.lines;
    const mute = has(c, 'mute');
    const kid = has(c, 'child');
    const friend = lost.find((x) => rel(s, c.id, x.id) >= 20);
    const heard = !!s.flags[`heard_${c.id}`];
    if (friend) {
      const dn = nm(friend.id);
      cands.push({ id: c.id, p: 5, w: { reason: `${dn}走了`, by: 'rule', done: false, opener: mute ? '（他在你旁边坐下，很久都没有动。）' : kid ? `${dn}是不是睡着了？` : `……我还是不敢信，${dn}就这么走了。` } });
    } else if (!heard && c.trust >= d.secretTrust) {
      cands.push({ id: c.id, p: 4, w: { reason: '心里有事，想跟你说', by: 'rule', done: false, opener: L.past[2], reveals: true } });
    } else if (c.mood < 25) {
      cands.push({ id: c.id, p: 3, w: { reason: '心情很糟', by: 'rule', done: false, opener: L.greet.low[0] } });
    } else if (!heard && c.trust >= d.secretTrust - 8) {
      cands.push({ id: c.id, p: 2, w: { reason: '有话憋在心里', by: 'rule', done: false, opener: L.past[1] } });
    } else if (c.injured || c.sick || c.hungerDays) {
      cands.push({ id: c.id, p: 1.5, w: { reason: c.hungerDays ? '饿' : '身上不舒服', by: 'rule', done: false, opener: c.hungerDays ? L.hungry : L.hurt } });
    } else if (c.trust >= 70) {
      cands.push({ id: c.id, p: 1, w: { reason: '想谢谢你', by: 'rule', done: false, opener: L.greet.high[0] } });
    }
  }
  cands.sort((a, b) => b.p - a.p);
  s.wants = {};
  for (const x of cands.slice(0, 2)) s.wants[x.id] = x.w;
}

/** 打开和某人的对话：如果他正想找你，他先开口 */
export function openChat(s: GameState, id: string): boolean {
  const w = s.wants?.[id];
  const c = ch(s, id);
  if (!w || w.done || !c || c.status !== 'active' || s.phase !== 'night') return false;
  w.done = true;
  (s.chat[id] ??= []).push({ from: 'them', text: w.opener });
  addTrust(c, 1);
  if (w.reveals && c.trust >= def(id).secretTrust - 5 && !s.flags[`heard_${id}`]) {
    s.flags[`heard_${id}`] = true;
    remember(s, id, { kind: 'secret', text: `你听我说了${def(id).secretShort}` });
  }
  return true;
}

// ───────────── AI 提示词与校验 ─────────────

const asJson = (raw: string): any => {
  try { return JSON.parse(raw); } catch { /* 往下找 */ }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
};

export function buildIntentPrompt(s: GameState, id: string) {
  const c = ch(s, id)!;
  const n = needs(s);
  const options = allowedTasks(s, id).map((t) => `- ${t}：${TASKS[t].name}（${preview(s, c, t)}${injuryRisk(s, c, t) ? `，受伤风险${Math.round(injuryRisk(s, c, t) * 100)}%` : ''}）`).join('\n');
  return `你在为一款叫《寒驿》的中文生存经营游戏扮演一个角色。现在是早上，大家在商量今天各自干什么。

${WORLD_BLOCK}

${personaBlock(s, id)}

${situationBlock(s, id)}

【营地的难处】食物还够吃约${n.foodDays.toFixed(1)}天，柴火还够烧约${n.woodDays.toFixed(1)}天${n.patients.length ? `，${n.patients.map((p) => nm(p.id)).join('、')}需要照料` : ''}${s.project ? `，正在修「${BUILDINGS[s.project.id].name}」` : ''}。

【你今天能做的事】（只能从这里选）
${options}

【要求】
- 按你的性格、身体和心情，以及你对营地处境的判断，选一件你自己想干的事。你不一定选最优的，要像这个人会做的选择。
- 用你的口吻说一句理由，不超过30个字。不要提到AI、游戏、数值。
- 只回复一个JSON对象：{"task":"上面的英文代号","say":"你说的话"}`;
}

export function acceptIntent(s: GameState, id: string, raw: string): Intent | null {
  const o = asJson(raw);
  if (!o || typeof o.task !== 'string' || typeof o.say !== 'string') return null;
  if (!allowedTasks(s, id).includes(o.task as TaskId)) return null;
  const say = o.say.trim().slice(0, 60);
  return say ? { task: o.task as TaskId, say, by: 'ai' } : null;
}

export function buildOpenerPrompt(s: GameState, id: string, w: Want) {
  const d = def(id);
  return `你在为一款叫《寒驿》的中文生存经营游戏扮演一个角色。现在是夜里，大家围着火。

${WORLD_BLOCK}

${personaBlock(s, id)}

${situationBlock(s, id)}

${memoryBlock(s, id)}

【这一刻】你主动走到主事人身边，想说点什么，因为：${w.reason}。

【要求】
- 用${d.short}的口吻先开口，中文口语，1到2句，不超过60个字。可以带一个括号里的简短动作。
- 要符合你的性格和此刻的心情；不要跳出角色，不要提到AI、游戏、数值。
- 只回复一个JSON对象：{"reply":"你说的话","revealed":true或false}
revealed表示你这句话有没有说出心底的秘密。`;
}

export function acceptOpener(raw: string): { reply: string; revealed: boolean } | null {
  const o = asJson(raw);
  const reply = typeof o?.reply === 'string' ? o.reply.trim().slice(0, 120) : '';
  return reply ? { reply, revealed: o.revealed === true } : null;
}

/** 篝火边挑两个人：关系最有张力的一对，或者随机一对 */
export function banterPair(s: GameState, pick: number): [string, string] | null {
  const A = act(s).filter((c) => !has(c, 'mute'));
  if (A.length < 2) return null;
  const pairs: [string, string, number][] = [];
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) pairs.push([A[i].id, A[j].id, Math.abs(rel(s, A[i].id, A[j].id))]);
  pairs.sort((a, b) => b[2] - a[2]);
  const p = pairs[Math.floor(pick * Math.min(3, pairs.length))];
  return [p[0], p[1]];
}

export function buildBanterPrompt(s: GameState, a: string, b: string) {
  const who = (id: string) => {
    const d = def(id);
    const c = ch(s, id)!;
    return `- ${id}：${d.name}（${d.short}），${d.age}岁，${d.job}。性格：${d.personality} 说话方式：${d.voice} 此刻心情：${c.mood}/100。`;
  };
  const recent = s.log.filter((l) => l.day >= s.day - 1).slice(-6).map((l) => `第${l.day}天：${l.text}`).join('\n');
  return `你在为一款叫《寒驿》的中文生存经营游戏写一小段篝火边的对话。

${WORLD_BLOCK}

【两个人】
${who(a)}
${who(b)}
他们的关系：${relWord(rel(s, a, b))}（${rel(s, a, b)}，范围-100到100）。

【最近发生的事】
${recent || '（没什么特别的）'}

【要求】
- 写2到4句他们之间的对话，每句不超过30个字，口吻要像各自的人。对话要和他们的关系、心情、最近的事有关。
- 不要提到AI、游戏、数值，不要出现主事人。
- warmth表示这段对话让两人关系变好(正)还是变差(负)，整数-2到2。
- 只回复一个JSON对象：{"lines":[{"who":"${a}","text":"……"},{"who":"${b}","text":"……"}],"warmth":0}`;
}

export function acceptBanter(raw: string, a: string, b: string): { lines: { who: string; text: string }[]; warmth: number } | null {
  const o = asJson(raw);
  if (!o || !Array.isArray(o.lines)) return null;
  const lines = o.lines
    .filter((l: any) => l && (l.who === a || l.who === b) && typeof l.text === 'string' && l.text.trim())
    .slice(0, 4)
    .map((l: any) => ({ who: l.who as string, text: String(l.text).trim().slice(0, 60) }));
  if (lines.length < 2) return null;
  return { lines, warmth: clamp(Math.round(Number(o.warmth) || 0), -2, 2) };
}

export function applyBanter(s: GameState, a: string, b: string, r: { lines: { who: string; text: string }[]; warmth: number }) {
  s.ambient.push(r.lines.map((l) => `${nm(l.who)}：${l.text}`).join('\n'));
  addRel(s, a, b, r.warmth * 2);
}
