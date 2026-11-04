// 围炉夜话：夜里和角色说话。
// 有 AI 时，由 Claude 根据角色设定和当前处境即兴回答；没有 AI 时，用手写台词。
// 两种模式走同一套规则：每晚聊天带来的信任/心情有上限，说出秘密会解锁对应的故事线。

import { Rng } from '../core/rng';
import { GameState } from '../core/types';
import {
  act, addMood, addTrust, ch, clamp, def, has, insulation, moodWord, nm, rel, relWord, trustWord,
} from '../core/world';
import { SKILLS, TRAITS } from '../data/rules';

export type Topic = 'chat' | 'past' | 'cheer' | 'others';
export const TOPICS: { id: Topic; label: string; ask: string }[] = [
  { id: 'chat', label: '闲聊几句', ask: '最近怎么样？' },
  { id: 'past', label: '问起过去', ask: '能说说你以前的事吗？' },
  { id: 'cheer', label: '给TA打气', ask: '撑住，我们一定能出去的。' },
  { id: 'others', label: '聊聊别人', ask: '你觉得营地里的其他人怎么样？' },
];

export const MAX_TALKS = 4;

export interface TalkResult { reply: string; trust: number; mood: number; revealed: boolean }

export function canTalk(s: GameState, id: string) {
  const c = ch(s, id);
  return !!c && c.status === 'active' && s.phase === 'night' && c.talks < MAX_TALKS;
}

/** 把一次谈话的结果记到角色身上（每晚有上限） */
export function applyTalk(s: GameState, id: string, r: TalkResult) {
  const c = ch(s, id)!;
  const first = c.talks === 0;
  c.talks++;
  const dt = clamp(r.trust + (first ? 1 : 0), -3, 4);
  const nt = clamp(c.trustTonight + dt, -5, 5);
  addTrust(c, nt - c.trustTonight);
  c.trustTonight = nt;
  const nmood = clamp(c.moodTonight + r.mood, -6, 8);
  addMood(c, nmood - c.moodTonight);
  c.moodTonight = nmood;
  if (r.revealed && c.trust >= def(id).secretTrust - 5) s.flags[`heard_${id}`] = true;
}

// ───────────── 手写台词 ─────────────

export function scriptedReply(s: GameState, id: string, topic: Topic, rng: Rng): TalkResult {
  const c = ch(s, id)!;
  const d = def(id);
  const L = d.lines;
  switch (topic) {
    case 'chat': {
      let reply: string;
      if (c.injured || c.sick) reply = L.hurt;
      else if (c.hungerDays > 0) reply = L.hungry;
      else if (s.res.wood < 2 || s.temp <= -24) reply = L.cold;
      else if (c.mood < 30) reply = rng.pick(L.greet.low);
      else if (c.trust >= 60 && c.mood >= 45) reply = rng.pick(L.greet.high);
      else reply = rng.pick(L.greet.mid);
      return { reply, trust: 1, mood: 2, revealed: false };
    }
    case 'past': {
      const tier = c.trust < 30 ? 0 : c.trust < d.secretTrust ? 1 : 2;
      return { reply: L.past[tier], trust: tier === 0 ? 0 : 1, mood: tier === 2 ? 4 : 0, revealed: tier === 2 };
    }
    case 'cheer': {
      const low = c.mood < 40;
      return { reply: rng.pick(L.cheer), trust: low ? 2 : 1, mood: low ? 8 : 3, revealed: false };
    }
    case 'others': {
      const os = act(s).filter((o) => o.id !== id);
      if (!os.length) return { reply: has(c, 'mute') ? '（他看着空荡荡的屋子，摇了摇头。）' : '……就剩我们了。', trust: 1, mood: 0, revealed: false };
      const o = os.sort((a, b) => Math.abs(rel(s, id, b.id)) - Math.abs(rel(s, id, a.id)))[0];
      const r = rel(s, id, o.id);
      const B = nm(o.id);
      let reply: string;
      if (has(c, 'mute')) reply = r >= 15 ? `（提到${B}，他点了点头，嘴角动了一下。）` : r <= -15 ? `（提到${B}，他皱了皱眉。）` : `（提到${B}，他没什么表情。）`;
      else if (has(c, 'child')) reply = r >= 15 ? `${B}对我可好了！` : r <= -15 ? `${B}有点凶……` : `${B}？我还不太认识。`;
      else if (r >= 40) reply = `${B}啊……这种时候能碰上${B}，算是运气。`;
      else if (r >= 15) reply = `${B}人不错。`;
      else if (r > -15) reply = `${B}？不太熟。`;
      else reply = `别跟我提${B}。`;
      return { reply, trust: 1, mood: 0, revealed: false };
    }
  }
}

// ───────────── AI 对话 ─────────────

const WEATHER = { clear: '晴', snow: '下雪', blizzard: '暴风雪' };

export function buildPrompt(s: GameState, id: string, history: { from: 'me' | 'them'; text: string }[], said: string) {
  const c = ch(s, id)!;
  const d = def(id);
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
  const canReveal = c.trust >= d.secretTrust;
  const convo = history.slice(-8).map((h) => (h.from === 'me' ? `主事人：${h.text}` : `${d.short}：${h.text}`)).join('\n');

  return `你在为一款叫《寒驿》的中文生存经营游戏扮演一个角色，和玩家对话。

【世界】寒潮突至，大雪封山。一群陌生人被困在半山腰一座废弃的驿站（以前是护林站），断电断路，要靠砍柴、打猎、搜寻物资撑到救援。玩家是这群人里拿主意的"主事人"。

【你扮演】${d.name}（大家叫${ta(d)}"${d.short}"），${d.age}岁，${d.job}。
性格：${d.personality}
说话方式：${d.voice}
背景：${d.background}
特质：${d.traits.map((t) => `${TRAITS[t].name}（${TRAITS[t].desc}）`).join('；')}
擅长：${(Object.keys(c.skills) as (keyof typeof c.skills)[]).filter((k) => c.skills[k] >= 3).map((k) => SKILLS[k]).join('、') || '没什么特别擅长的'}
心底的秘密：${d.secret}
${canReveal ? '你现在足够信任主事人：如果对方真诚地问起你的过去或心事，你可以说出这个秘密（要用你自己的方式，别一口气全倒出来）。' : '你还不够信任主事人：绝对不要说出这个秘密，被问到时要回避、岔开或者含糊带过，但可以流露一点情绪。'}

【此刻】第${s.day}天夜里，${WEATHER[s.weather.kind]}，气温${s.temp}℃，屋里保暖程度${insulation(s)}级。营地还剩食物${s.res.food}份、柴火${s.res.wood}捆、药品${s.res.med}盒。
你的状态：健康${c.health}/100，体力${c.stamina}/100，心情${moodWord(c.mood)}（${c.mood}/100）${status.length ? '，' + status.join('，') : ''}。
你对主事人的信任：${trustWord(c.trust)}（${c.trust}/100）。
你对其他人的看法：${relLines || '营地里只剩你了'}。${gone.length ? '\n' + gone.join('；') + '。' : ''}
最近发生的事：
${recent || '（没什么特别的）'}

【刚才的对话】
${convo || '（今晚第一次说话）'}
主事人：${said}

【要求】
- 用${d.short}的口吻回一句话，中文口语，1到3句，不超过80个字。可以带一个括号里的简短动作。
- 要符合你的性格、处境和你对主事人的信任程度，不要总是很配合；冷淡、回避、发牢骚都可以。
- 不要跳出角色，不要提到AI、游戏、玩家、数值。
- 只回复一个JSON对象，不要别的文字：
{"reply":"你说的话","trust":整数-3到3,"mood":整数-5到5,"revealed":true或false}
trust是这次对话让你对主事人的信任变化，mood是你心情的变化，revealed表示你这句话有没有说出心底的秘密。`;
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
  return { reply, trust: num(o.trust, -3, 3), mood: num(o.mood, -5, 5), revealed: o.revealed === true };
}
