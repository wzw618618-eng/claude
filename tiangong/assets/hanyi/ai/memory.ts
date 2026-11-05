// 记忆：每个人记得和主事人之间发生过的事——夜里聊过什么、说出口的心事、事件里你替谁做了主。
// - 有 AI 时，这些记忆写进提示词，AI 还可以在回复里补一条「这次会记住的事」；
// - 离线时，聊天偶尔会提起前几天的事（「「争吵」那天的事，我还没想通。」）；
// - 人物页上能看到「他记得的事」。

import { Rng } from '../core/rng';
import { CharState, GameState, Memory } from '../core/types';
import { def, has } from '../core/world';

export const MEMORY_CAP = 12;

export const memoriesOf = (s: GameState, id: string): Memory[] => s.memory?.[id] ?? [];

/** 记下一件事；同样的话不记两遍，记多了先忘掉最早的（说出口的心事不忘） */
export function remember(s: GameState, id: string, m: Omit<Memory, 'day'> & { day?: number }) {
  const all = (s.memory ??= {});
  const list = (all[id] ??= []);
  const text = m.text.trim().slice(0, 60);
  if (!text || list.some((x) => x.text === text)) return;
  list.push({ ...m, day: m.day ?? s.day, text });
  while (list.length > MEMORY_CAP) {
    const i = list.findIndex((x) => x.kind !== 'secret');
    list.splice(i >= 0 ? i : 0, 1);
  }
}

/** 今晚是不是已经记过一条聊天了（每人每晚最多记一条，免得流水账） */
export const talkedTonight = (s: GameState, id: string) => memoriesOf(s, id).some((m) => m.kind === 'talk' && m.day === s.day);

/** 事件里的选项 → 一句记忆：「争吵」：你选择了「站在胖叔这边」 */
export function eventMemory(title: string, label: string) {
  const clean = label.replace(/（[^）]*）/g, '').trim();
  if (/^["“「]/.test(clean)) return `「${title}」：你说「${clean.replace(/^["“「]+|["”」]+$/g, '')}」`;
  return `「${title}」：你选择了「${clean}」`;
}

/** 写进 AI 提示词的记忆 */
export function memoryBlock(s: GameState, id: string) {
  const list = memoriesOf(s, id).slice(-8);
  if (!list.length) return '【你记得的事】你和主事人之间还没有什么共同的回忆。';
  return `【你记得的事】下面是你和主事人之间发生过的事（「你」指主事人）。说话时可以自然地提起，别生硬地复述：\n${list.map((m) => `- 第${m.day}天：${m.text}`).join('\n')}`;
}

/** 离线聊天时提起前几天的一件事；没有可提的就返回 null */
export function recall(s: GameState, c: CharState, rng: Rng): string | null {
  const list = memoriesOf(s, c.id).filter((m) => m.kind === 'event' && m.title && !m.recalled && m.day < s.day && m.day >= s.day - 5);
  if (!list.length || !rng.chance(0.45)) return null;
  const m = list[list.length - 1];
  m.recalled = true;
  const t = `「${m.title}」`;
  const short = def(c.id).short;
  if (has(c, 'mute')) {
    return m.tone === 'bad' ? `（${short}别过脸去。${t}那天的事，他好像还记着。）` : `（${short}看着你，像是想起了${t}那天的事，轻轻点了点头。）`;
  }
  if (has(c, 'child')) return m.tone === 'bad' ? `${t}那天……你是不是不喜欢我？` : `${t}那天，你真好。我都记着呢！`;
  if (m.tone === 'good') return rng.pick([`${t}那天的事，我一直记着。……谢了。`, `说起来，${t}那回，你做得对。`, `${t}那天你替我说话，我心里有数。`]);
  if (m.tone === 'bad') return rng.pick([`${t}那天的事，我还没想通。`, `你还记得${t}吗？我可记得。`, `${t}那回……算了，不提了。`]);
  return rng.pick([`我还在想${t}那天的事。`, `${t}那天之后，我想了很多。`]);
}
