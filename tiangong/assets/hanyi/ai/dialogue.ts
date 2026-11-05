// 围炉夜话：夜里和角色说话。
// 有 AI 时，由 Claude 根据角色设定和当前处境即兴回答；没有 AI 时，用手写台词。
// 两种模式走同一套规则：每晚只顾得上一两个人；用对了路子才聊得进去；说出秘密会解锁对应的故事线。

import { Rng } from '../core/rng';
import { GameState } from '../core/types';
import {
  act, addMood, addTrust, ch, clamp, def, eats, has, heatNeed, insulation, moodWord, nm, rel, relWord, trustWord,
} from '../core/world';
import { LAST_DAY, SKILLS, TRAITS } from '../data/rules';
import { memoryBlock, recall, remember, talkedTonight } from './memory';

// 每个人吃哪一套：陪着坐、安慰、逗乐、说实话、问起过去。摸清了才聊得进去，聊错了反而寒心。
export type Topic = 'sit' | 'comfort' | 'joke' | 'straight' | 'past';
export const TOPICS: { id: Topic; label: string; ask: string }[] = [
  { id: 'sit', label: '陪着坐', ask: '（你在旁边坐下，陪着烤火。）' },
  { id: 'comfort', label: '安慰几句', ask: '别太往心里去，有我们在呢。' },
  { id: 'joke', label: '逗TA笑', ask: '给你讲个笑话——' },
  { id: 'straight', label: '说实在的', ask: '跟你说句实话。' },
  { id: 'past', label: '问起过去', ask: '能说说你以前的事吗？' },
];

/** 每人每晚最多说两句；每晚只顾得上一个人（砌了火塘能多顾一个） */
export const MAX_TALKS = 2;
export const seats = (s: GameState) => 1 + (s.built.includes('hearth') ? 1 : 0);
export const satWith = (s: GameState) => s.sat ?? [];

const TASTE: Record<string, { like: Topic[]; dislike: Topic[] }> = {
  qin: { like: ['sit', 'straight'], dislike: ['joke', 'comfort'] },
  lin: { like: ['comfort', 'past'], dislike: ['joke'] },
  jie: { like: ['joke', 'sit'], dislike: ['straight'] },
  ma: { like: ['joke', 'comfort'], dislike: ['straight'] },
  su: { like: ['straight'], dislike: ['comfort', 'joke'] },
  man: { like: ['joke', 'comfort'], dislike: ['straight'] },
  gesang: { like: ['sit', 'straight'], dislike: ['comfort'] },
  wu: { like: ['sit'], dislike: ['joke', 'past'] },
};

export type Reaction = 'like' | 'meh' | 'dislike';

/** 他此刻吃不吃这一套：底子是性子，心情会改：心情很糟时谁都不想听笑话，只想有人陪 */
export function reaction(s: GameState, id: string, t: Topic): Reaction {
  const c = ch(s, id)!;
  const tt = TASTE[id] ?? { like: [], dislike: [] };
  if (t === 'past' && c.trust < 30) return tt.dislike.includes('past') ? 'dislike' : 'meh';
  if (c.mood < 30) {
    if (t === 'joke' && !has(c, 'child')) return 'dislike';
    if (t === 'sit' && !tt.dislike.includes('sit')) return 'like';
  }
  if (tt.like.includes(t)) return 'like';
  if (tt.dislike.includes(t)) return 'dislike';
  if (c.mood >= 65 && t === 'joke') return 'like';
  return 'meh';
}

/** 你摸清的他的脾气（上一次这样聊时他的反应） */
export const knownTaste = (s: GameState, id: string, t: Topic) => s.flags[`taste_${id}_${t}`] as Reaction | undefined;

export function canSit(s: GameState, id: string) {
  const c = ch(s, id);
  if (!c || c.status !== 'active' || s.phase !== 'night') return false;
  return satWith(s).includes(id) || satWith(s).length < seats(s);
}
export function sitWith(s: GameState, id: string) {
  if (!canSit(s, id)) return false;
  if (!satWith(s).includes(id)) (s.sat ??= []).push(id);
  return true;
}
export function canTalk(s: GameState, id: string) {
  return canSit(s, id) && ch(s, id)!.talks < MAX_TALKS;
}

/** 说出口的那句话：「说实在的」会把营地的实底说出来 */
export function askText(s: GameState, t: Topic) {
  if (t !== 'straight') return TOPICS.find((x) => x.id === t)!.ask;
  const eat = act(s).reduce((n, c) => n + eats(c), 0) || 1;
  const food = Math.floor(s.res.food / eat), wood = Math.floor(s.res.wood / heatNeed(s));
  return `跟你说实话：粮食还够${food}天，柴火够${wood}天。${s.rescueBy === 'road' ? `路要到第${LAST_DAY}天才通` : `救援大概${Math.max(0, s.rescueDay - s.day)}天后到`}。`;
}

export interface TalkResult {
  reply: string;
  trust: number;
  mood: number;
  revealed: boolean;
  /** AI 写下的「这次会记住的事」 */
  remember?: string;
  react?: Reaction;
}

/** 把一次谈话的结果记到角色身上（每晚有上限），并记下这次聊了什么 */
export function applyTalk(s: GameState, id: string, r: TalkResult, about: { topic?: Topic | null; said?: string } = {}) {
  const c = ch(s, id)!;
  sitWith(s, id);
  const knew = !!s.flags[`heard_${id}`];
  const first = c.talks === 0;
  c.talks++;
  if (about.topic && r.react) s.flags[`taste_${id}_${about.topic}`] = r.react;
  const dt = clamp(r.trust + (first ? 1 : 0), -3, 4);
  const nt = clamp(c.trustTonight + dt, -5, 7);
  addTrust(c, nt - c.trustTonight);
  c.trustTonight = nt;
  const nmood = clamp(c.moodTonight + r.mood, -6, 10);
  addMood(c, nmood - c.moodTonight);
  c.moodTonight = nmood;
  if (r.revealed && c.trust >= def(id).secretTrust - 5) s.flags[`heard_${id}`] = true;
  if (!knew && s.flags[`heard_${id}`]) remember(s, id, { kind: 'secret', text: `你听我说了${def(id).secretShort}` });
  else if (!talkedTonight(s, id)) {
    const text = r.remember?.trim() || talkMemory(about.topic ?? null, about.said ?? '', r.react);
    if (text) remember(s, id, { kind: 'talk', text, tone: dt > 0 ? 'good' : dt < 0 ? 'bad' : '' });
  }
}

function talkMemory(topic: Topic | null, said: string, react?: Reaction) {
  if (topic === 'past') return '你问起我的过去';
  if (topic === 'sit' && react === 'like') return '那晚你什么也没说，就陪我烤火';
  if (topic === 'straight' && react === 'like') return '你跟我说了实话';
  if (topic === 'comfort' && react === 'like') return '你安慰我，说有你们在';
  if (topic === 'joke' && react === 'like') return '你讲笑话把我逗乐了';
  if (react === 'dislike') return topic === 'joke' ? '那种时候你还跟我说笑' : topic === 'comfort' ? '你拿哄小孩的话哄我' : topic === 'straight' ? '你非要跟我说那些丧气的数' : '';
  if (!topic && said) return `你对我说：「${said.length > 18 ? said.slice(0, 18) + '…' : said}」`;
  return '';
}

/** AI 写台词，数值照规则：聊对了路子才涨，免得变成刷好感 */
export function withRule(ai: TalkResult, rule: TalkResult): TalkResult {
  return { ...ai, trust: rule.trust, mood: rule.mood, react: rule.react, revealed: ai.revealed || rule.revealed };
}

// ───────────── 手写台词 ─────────────

const DELTA: Record<Reaction, { trust: number; mood: number }> = {
  like: { trust: 3, mood: 6 },
  meh: { trust: 1, mood: 1 },
  dislike: { trust: -2, mood: -4 },
};

const LIKE: Record<Exclude<Topic, 'past' | 'comfort'>, string[]> = {
  sit: ['（{n}往你这边挪了挪。两个人就这么烤着火，谁也没说话，{n}的肩膀慢慢松了下来。）', '（{n}没说话，把手里的热水递给你一半。）'],
  joke: ['（{n}噗嗤一声笑出来。）……你这人，真是。', '（{n}笑得直咳嗽。）好久没这么笑过了。'],
  straight: ['……嗯。你肯跟我说实话，我心里反倒踏实了。', '好。知道了底，就知道该怎么熬。'],
};
const DISLIKE: Record<Exclude<Topic, 'past'>, string[]> = {
  sit: ['（{n}坐立不安，过了一会儿起身去添柴，走开了。）'],
  comfort: ['……别安慰我了。说这些有什么用。', '你不用哄我。'],
  joke: ['……现在不是说笑的时候。', '（{n}看了你一眼，没笑。）'],
  straight: ['……你非得现在跟我说这些吗？', '（{n}的脸一下子白了，半天没吭声。）'],
};
const KID = { like: '（{n}咯咯地笑起来。）再讲一个嘛！', dislike: '（{n}的眼圈一下子红了。）……我们是不是出不去了？' };
const MUTE = { like: '（{n}看了你一眼，嘴角动了动。）', dislike: '（{n}别过头去。）' };

export function scriptedReply(s: GameState, id: string, topic: Topic, rng: Rng): TalkResult {
  const c = ch(s, id)!;
  const d = def(id);
  const L = d.lines;
  const react = reaction(s, id, topic);
  const fill = (t: string) => t.replace(/\{n\}/g, d.short);
  const out = (reply: string, extra: Partial<TalkResult> = {}): TalkResult => ({ reply: fill(reply), ...DELTA[react], revealed: false, react, ...extra });

  if (topic === 'past') {
    const tier = c.trust < 30 ? 0 : c.trust < d.secretTrust ? 1 : 2;
    return out(L.past[tier], tier === 2 ? { revealed: true, mood: DELTA[react].mood + 4 } : {});
  }
  // 陪着坐的时候，他偶尔会提起前几天的事
  if (topic === 'sit' && react !== 'dislike') {
    const back = recall(s, c, rng);
    if (back) return out(back);
  }
  if (react !== 'meh') {
    if (has(c, 'mute')) return out(MUTE[react]);
    if (has(c, 'child') && (topic === 'joke' || topic === 'straight')) return out(KID[react]);
    if (react === 'like') return out(topic === 'comfort' ? rng.pick(L.cheer) : rng.pick(LIKE[topic]));
    return out(rng.pick(DISLIKE[topic]));
  }
  // 不咸不淡：说些家常，偶尔提起前几天的事
  const back = recall(s, c, rng);
  if (back) return out(back);
  if (c.injured || c.sick) return out(L.hurt);
  if (c.hungerDays > 0) return out(L.hungry);
  if (s.res.wood < 2 || s.temp <= -24) return out(L.cold);
  return out(rng.pick(c.mood < 30 ? L.greet.low : c.trust >= 60 && c.mood >= 45 ? L.greet.high : L.greet.mid));
}

// ───────────── AI 对话 ─────────────

const WEATHER = { clear: '晴', snow: '下雪', blizzard: '暴风雪' };

/** 角色设定：谁、什么性子、怎么说话、心底的秘密（以及此刻能不能说出口） */
export function personaBlock(s: GameState, id: string) {
  const c = ch(s, id)!;
  const d = def(id);
  const canReveal = c.trust >= d.secretTrust;
  return `【你扮演】${d.name}（大家叫${ta(d)}"${d.short}"），${d.age}岁，${d.job}。
性格：${d.personality}
说话方式：${d.voice}
背景：${d.background}
特质：${d.traits.map((t) => `${TRAITS[t].name}（${TRAITS[t].desc}）`).join('；')}
擅长：${(Object.keys(c.skills) as (keyof typeof c.skills)[]).filter((k) => c.skills[k] >= 3).map((k) => SKILLS[k]).join('、') || '没什么特别擅长的'}
心底的秘密：${d.secret}
${canReveal ? '你现在足够信任主事人：如果对方真诚地问起你的过去或心事，你可以说出这个秘密（要用你自己的方式，别一口气全倒出来）。' : '你还不够信任主事人：绝对不要说出这个秘密，被问到时要回避、岔开或者含糊带过，但可以流露一点情绪。'}`;
}

/** 此刻的处境：天气、营地存粮、自己的身心、对别人的看法、最近发生的事 */
export function situationBlock(s: GameState, id: string) {
  const c = ch(s, id)!;
  const status: string[] = [];
  if (c.injured) status.push('身上有伤');
  if (c.sick) status.push('在发烧');
  if (c.hungerDays) status.push(`已经饿了${c.hungerDays}天`);
  if (s.res.wood < 2) status.push('柴火快烧完了，很冷');
  const relLines = act(s)
    .filter((o) => o.id !== id)
    .map((o) => `${nm(o.id)}（${def(o.id).job}）：${relWord(rel(s, id, o.id))}`)
    .join('；');
  const gone = s.chars.filter((o) => o.status !== 'active' && o.id !== id).map((o) => `${nm(o.id)}${o.status === 'dead' ? '已经死了' : '离开了营地'}`);
  const recent = s.log.filter((l) => l.day >= s.day - 2).slice(-8).map((l) => `第${l.day}天：${l.text}`).join('\n');
  const when = s.phase === 'night' ? '夜里' : s.phase === 'evening' ? '傍晚' : '早上';
  return `【此刻】第${s.day}天${when}，${WEATHER[s.weather.kind]}，气温${s.temp}℃，屋里保暖程度${insulation(s)}级。营地还剩食物${s.res.food}份、柴火${s.res.wood}捆、药品${s.res.med}盒。
你的状态：健康${c.health}/100，体力${c.stamina}/100，心情${moodWord(c.mood)}（${c.mood}/100）${status.length ? '，' + status.join('，') : ''}。
你对主事人的信任：${trustWord(c.trust)}（${c.trust}/100）。
你对其他人的看法：${relLines || '营地里只剩你了'}。${gone.length ? '\n' + gone.join('；') + '。' : ''}
最近发生的事：
${recent || '（没什么特别的）'}`;
}

export const WORLD_BLOCK = `【世界】寒潮突至，大雪封山。一群陌生人被困在半山腰一座废弃的驿站（以前是护林站），断电断路，要靠砍柴、打猎、搜寻物资撑到救援。玩家是这群人里拿主意的"主事人"。`;

const FEEL: Record<Reaction, string> = {
  like: '你吃这一套，心里会松动一些，语气可以软下来',
  meh: '你没什么特别的感觉，照常回应',
  dislike: '你不吃这一套，会有点抵触或者不耐烦',
};

export function buildPrompt(s: GameState, id: string, history: { from: 'me' | 'them'; text: string }[], said: string, topic?: Topic | null) {
  const d = def(id);
  const how = topic ? `\n【这一句】主事人的方式是「${TOPICS.find((x) => x.id === topic)!.label.replace('TA', ta(d))}」。${FEEL[reaction(s, id, topic)]}。` : '';
  const convo = history.slice(-8).map((h) => (h.from === 'me' ? `主事人：${h.text}` : `${d.short}：${h.text}`)).join('\n');

  return `你在为一款叫《寒驿》的中文生存经营游戏扮演一个角色，和玩家对话。

${WORLD_BLOCK}

${personaBlock(s, id)}

${situationBlock(s, id)}

${memoryBlock(s, id)}

【刚才的对话】
${convo || '（今晚第一次说话）'}
主事人：${said}${how}

【要求】
- 用${d.short}的口吻回一句话，中文口语，1到3句，不超过80个字。可以带一个括号里的简短动作。
- 要符合你的性格、处境和你对主事人的信任程度，不要总是很配合；冷淡、回避、发牢骚都可以。
- 不要跳出角色，不要提到AI、游戏、玩家、数值。
- 只回复一个JSON对象，不要别的文字：
{"reply":"你说的话","trust":整数-3到3,"mood":整数-5到5,"revealed":true或false,"remember":"这次你会记住的一件事"}
trust是这次对话让你对主事人的信任变化，mood是你心情的变化，revealed表示你这句话有没有说出心底的秘密。
remember用一句话写下这次对话里你会记住的事，用「你」指主事人，不超过24个字（比如"你说开春后要陪我去看秦川走过的路"）；没什么值得记的就写空字符串。`;
}

function ta(d: { gender: 'm' | 'f' }) {
  return d.gender === 'f' ? '她' : '他';
}

export function parseAI(raw: unknown): TalkResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const reply = typeof o.reply === 'string' ? o.reply.trim().slice(0, 200) : '';
  if (!reply) return null;
  const num = (v: unknown, lo: number, hi: number) => clamp(Math.round(Number(v) || 0), lo, hi);
  const mem = typeof o.remember === 'string' ? o.remember.trim().slice(0, 40) : '';
  return { reply, trust: num(o.trust, -3, 3), mood: num(o.mood, -5, 5), revealed: o.revealed === true, ...(mem ? { remember: mem } : {}) };
}
