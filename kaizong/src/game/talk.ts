// 召见：宗主每季只顾得上当面见三个人。
// 话题的后果都由规则算；离线时用规则写好的话回答，接了 AI 时 AI 照着这个意思用他的口吻说。

import { atBottleneck, REALM_NAME } from './cult';
import { HALL, JOB_NAME, RANK_NAME, SKILL_NAME } from './data/world';
import type { Rng } from './rng';
import { unconvinced } from './sect';
import type { HallId, Person, Rank, Skill, World } from './types';
import { visibleWish } from './wishes';
import { adjust, clamp, disp, hasTrait, members, nm, op, P, pronoun } from './world';

export const TALK_LIMIT = 3;

export type Topic = 'status' | 'wish' | 'cheer' | 'soothe' | 'warn' | 'wound';

export const TOPIC: Record<Topic, { name: string; line: string; hint: string }> = {
  status: { name: '问近况', line: '最近怎么样？山上过得惯吗？', hint: '听听他心里的事' },
  wish: { name: '问心愿', line: '你心里最想要的是什么？说来听听。', hint: '听他亲口说' },
  cheer: { name: '勉励', line: '这阵子辛苦了。好好干，我都看在眼里。', hint: '心情好一些' },
  soothe: { name: '安抚', line: '我知道你心里有委屈。说出来，我替你做主。', hint: '怨气消一些' },
  warn: { name: '敲打', line: '最近山上风气不太好，你心里要有数。', hint: '这一季不敢偷懒使坏；心气高的会记恨' },
  wound: { name: '问伤势', line: '伤好些了没有？', hint: '心里暖一些' },
};

/** 这一季已经召见过的人 */
export function audience(w: World): Person[] {
  return members(w).filter((p) => p.talked?.t === w.t);
}

/** 现在能不能召见他；不能就说为什么 */
export function talkBlock(w: World, p: Person): string | null {
  if (!p.alive || p.sect !== 'me' || p.id === w.me) return '不是本门弟子';
  if (p.job === 'travel') return `${pronoun(p)}在外历练，不在山上`;
  if (p.talked?.t === w.t) return null;
  if (audience(w).length >= TALK_LIMIT) return `这一季已经召见了 ${TALK_LIMIT} 个人，下一季再说`;
  return null;
}

export function topicsFor(p: Person): Topic[] {
  const t: Topic[] = ['status', 'wish', 'cheer'];
  if (p.grudge >= 25) t.push('soothe');
  t.push('warn');
  if (p.hp < 60) t.push('wound');
  return t;
}

export const topicUsed = (w: World, p: Person, t: string) => p.talked?.t === w.t && p.talked.topics.includes(t);

function enter(w: World, p: Person, topic: string) {
  if (p.talked?.t !== w.t) p.talked = { t: w.t, topics: [] };
  p.talked.topics.push(topic);
}

export interface TalkResult { said: string; reply: string; effect: string }

const meAff = (w: World, p: Person) => op(p, w.me).aff;

export function talk(w: World, _r: Rng, p: Person, topic: Topic): TalkResult | string {
  const block = talkBlock(w, p);
  if (block) return block;
  if (topicUsed(w, p, topic)) return '这件事这一季已经说过了';
  if (!topicsFor(p).includes(topic)) return '现在不是说这个的时候';
  enter(w, p, topic);
  const mood = (d: number) => { p.mood = clamp(p.mood + d, 0, 100); };
  const grudge = (d: number) => { p.grudge = clamp(p.grudge + d, 0, 100); };
  let reply = '';
  let effect = '';
  switch (topic) {
    case 'status': {
      reply = statusLine(w, p);
      mood(2); adjust(p, w.me, 1);
      effect = '心情好了一点';
      break;
    }
    case 'wish': {
      reply = wishLine(w, p);
      adjust(p, w.me, 2);
      effect = '觉得宗主把自己放在心上';
      break;
    }
    case 'cheer': {
      if (p.grudge >= 50) { reply = '……宗主说得是。'; mood(2); effect = '嘴上应着，心里的结没解开'; }
      else if (disp(p, 'pride') > 1 || hasTrait(p, 'vain')) { reply = '那是自然，弟子岂会让宗主失望。'; mood(6); effect = '心情好了不少'; }
      else if (meAff(w, p) >= 40) { reply = '有宗主这句话，弟子再苦也值了。'; mood(8); adjust(p, w.me, 3); effect = '心情大好，更认你这个宗主了'; }
      else { reply = '弟子记下了，定不负宗主所望。'; mood(6); adjust(p, w.me, 2); effect = '心情好了不少'; }
      break;
    }
    case 'soothe': {
      const unc = unconvinced(w).find((u) => u.who === p.id);
      if (meAff(w, p) < -20) { reply = '不劳宗主费心。'; grudge(-2); effect = '他对你有成见，话听不进去'; }
      else if (unc) {
        reply = `……论修为、论功劳，我哪点不如${nm(w, unc.over)}？宗主心里有数就好。`;
        grudge(-4); mood(2); effect = `怨气稍减，可根子还在：${pronoun(p)}不服${nm(w, unc.over)}`;
      } else if (p.dislikes.includes(p.job) && p.job in HALL) {
        reply = `${JOB_NAME[p.job]}的活，弟子实在干不来。`;
        grudge(-5); mood(2); effect = `怨气稍减，根子在差事上：${pronoun(p)}讨厌${JOB_NAME[p.job]}`;
      } else {
        const g = clamp(6 + Math.max(0, meAff(w, p)) / 10 + (hasTrait(p, 'forgiving') ? 4 : 0) - (hasTrait(p, 'grudging') ? 3 : 0), 3, 14);
        grudge(-g); mood(3);
        reply = p.grudge <= 15 ? '有宗主这句话，弟子心里好受多了。' : '……谢宗主。';
        effect = `怨气消了 ${Math.round(g)}`;
      }
      break;
    }
    case 'warn': {
      p.warned = w.t;
      adjust(p, w.me, 0, 4);
      const guilty = w.misdeeds.some((m) => m.who === p.id);
      if (guilty) { reply = '弟子……知错了，再不敢了。'; mood(-4); grudge(2); }
      else if (p.secret?.kind === 'spy' && !p.secret.exposed) { reply = '弟子一向本分，宗主何出此言？'; mood(-2); }
      else if (disp(p, 'pride') > 0 || p.grudge >= 40) { reply = '弟子行得正坐得端，宗主这话是说给谁听的？'; grudge(6); mood(-6); adjust(p, w.me, -3); }
      else { reply = '弟子明白。'; mood(-3); }
      effect = guilty ? '心虚了，这一季不敢再犯' : disp(p, 'pride') > 0 || p.grudge >= 40 ? '这一季不敢乱来，可心里不服气' : '这一季不敢偷懒使坏';
      break;
    }
    case 'wound': {
      p.hp = clamp(p.hp + 5, 0, 100); mood(4); adjust(p, w.me, 4);
      reply = p.hp < 35 ? '伤得不轻……多谢宗主还记着我。' : '皮肉伤，不碍事。多谢宗主挂念。';
      effect = '心里暖了一些';
      break;
    }
  }
  return { said: TOPIC[topic].line, reply: voiced(w, p, reply), effect };
}

/** 接了 AI 时随口说的话：也算召见；每季前三句的心情变化作数 */
export function noteFreeTalk(w: World, p: Person): { ok: false; why: string } | { ok: true; counts: boolean } {
  const block = talkBlock(w, p);
  if (block) return { ok: false, why: block };
  enter(w, p, 'ai');
  return { ok: true, counts: p.talked!.topics.filter((t) => t === 'ai').length <= 3 };
}

function statusLine(w: World, p: Person): string {
  if (meAff(w, p) < 0 && p.grudge >= 40) return '没什么，宗主不必挂心。';
  const facts: string[] = [];
  const unc = unconvinced(w).find((u) => u.who === p.id);
  if (unc) facts.push(`论修为、论功劳，我哪点不如${nm(w, unc.over)}？凭什么${pronoun(P(w, unc.over)!)}压我一头。`);
  if (p.job === 'none') facts.push('整天闲着，心里发慌，宗主给我派个差事吧。');
  else if (p.dislikes.includes(p.job)) {
    const like = p.likes.find((j) => j in HALL) as HallId | undefined;
    facts.push(`${JOB_NAME[p.job]}的活，说实话我干着不舒心${like && like !== p.job ? `，要是能去${HALL[like].name}就好了` : ''}。`);
  }
  if (atBottleneck(p)) facts.push('修为已经圆满了，就等宗主点头让我闭关。');
  if (p.hp < 50) facts.push('身上的伤还没好利索。');
  const rival = w.rivals.find((r) => r.id === w.offers[p.id]);
  if (rival && meAff(w, p) >= 30) facts.push(`前些天${rival.name}的人私下来找过我，许了好处……我没答应。`);
  const foe = Object.entries(p.ops).filter(([id, o]) => o.aff <= -40 && P(w, id)?.alive && P(w, id)?.sect === 'me').sort((a, b) => a[1].aff - b[1].aff)[0];
  if (foe) facts.push(`就是${nm(w, foe[0])}那人，我实在处不来。`);
  const lover = Object.entries(p.ops).find(([id, o]) => o.tag === 'lover' && P(w, id)?.alive);
  if (lover && facts.length < 2) facts.push(`和${nm(w, lover[0])}都好，宗主放心。`);
  if (!facts.length) return p.mood >= 70 ? '山上的日子挺好，多谢宗主。' : p.mood >= 45 ? '还行，就是修为长得慢了些。' : '最近心里闷得慌，也说不上为什么。';
  return facts.slice(0, 2).join('');
}

function wishLine(w: World, p: Person): string {
  const x = visibleWish(p);
  if (!x) return '眼下没什么特别想要的，跟着宗主好好修炼就是。';
  if (x.by === 'ai') return /[。！？]$/.test(x.text) ? x.text : `${x.text}。`;
  switch (x.kind) {
    case 'realm': return `此生只想踏入${REALM_NAME[Number(x.param)] ?? '更高的境界'}。${atBottleneck(p) ? '修为已经圆满，就等宗主点头。' : ''}`;
    case 'post': return `要是能主事${HALL[x.param as HallId]?.name ?? '一处殿堂'}，弟子定把它打理得井井有条。`;
    case 'rank': return `弟子想当${RANK_NAME[x.param as Rank] ?? '更高的位置'}，不知道还差在哪里。`;
    case 'love': return disp(p, 'courage') < 0 ? `……宗主别笑话，弟子心里有个人，是${nm(w, x.target)}。` : `不瞒宗主，我想和${nm(w, x.target)}结为道侣。`;
    case 'revenge': return `${nm(w, x.target)}的仇，我迟早要报。`;
    case 'best': return `${SKILL_NAME[x.param as Skill] ?? '这一门'}一道，我要做到宗门第一。`;
    case 'recognition': return '弟子只盼宗主能多看我一眼。';
    case 'glory': return '想看着咱们宗门名震一州。';
    case 'mentor': return '想收个能传衣钵的好徒弟。';
    case 'treasure': return '要是有件趁手的法宝就好了。';
    case 'leave': return '弟子……想家了，想回去看看。';
    case 'found': return meAff(w, p) >= 50 ? '不瞒宗主，弟子总想有朝一日，自己也开宗立派。' : '弟子没什么大志向，好好修炼罢了。';
    default: return x.text;
  }
}

/** 按他说话的样子改一改 */
function voiced(w: World, p: Person, text: string): string {
  const v = p.voice;
  let t = text;
  if (v.includes('乡音')) t = t.replace(/我(?!们)/g, '俺');
  if (v.includes('惜字如金') || v.includes('简短')) t = (t.match(/^[^。！？]*[。！？]/) ?? [t])[0];
  if (v.includes('急吼吼')) t = t.replace(/。/g, '！');
  if (v.includes('油嘴滑舌')) t = `嘿嘿，${t}`;
  if (v.includes('老学究')) t = `嗯……${t}`;
  if (v.includes('礼数周全')) t = `回宗主的话，${t}`;
  if (v.includes('文绉绉')) t = `禀宗主，${t}`;
  if (v.includes('嗓门大') && p.mood >= 50) t = `${t}哈哈！`;
  void w;
  return t;
}
