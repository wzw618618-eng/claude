// 出身里认得你的人：第一次碰上时有一场戏，兑现开局时说的话（墨九会来认你、花婆婆送你出村……）。
// 每个人只演一次（flags 里记 met:<人>），要真的碰上了才算。

import type { Rng } from '../core/rng';
import type { Encounter, Npc, World } from '../core/types';
import { adjust, giveItem, ME, op, placeName, power } from '../core/world';
import { remember } from '../mind/memory';

interface Scene {
  title: string;
  text: (w: World, n: Npc) => string;
  choices: (w: World, n: Npc) => { label: string; hint?: string }[];
  run: (w: World, n: Npc, idx: number, rng: Rng) => string;
}

const kid = (w: World) => (w.me.gender === 'f' ? '丫头' : '小子');
const sib = (w: World) => (w.me.gender === 'f' ? '姐' : '哥');

const SCENES: Record<string, Scene> = {
  hua: {
    title: '花婆婆',
    text: (w) => {
      const aman = w.people.aman;
      const kidLine = aman?.alive && aman.place === w.me.place ? `阿蛮在一旁扯着嗓子喊：「${w.me.name}${sib(w)}，等我也拜进宗门，就去找你！」` : '';
      return w.me.place === 'village'
        ? `花婆婆把你拉进屋，从柜子底下摸出个布包塞进你怀里：「娃儿，往后是要出远门的人了。在外头别逞强，伤了就回来。」${kidLine}`
        : `在${placeName(w.me.place)}碰见了花婆婆。她一把拉住你，从药篓里摸出个布包：「娃儿，婆婆正想着给你送去。在外头别逞强，伤了就回柳溪村。」${kidLine}`;
    },
    choices: () => [{ label: '「婆婆保重。」' }],
    run: (w, n) => {
      giveItem(w.me, 'pill');
      remember(w, n, { k: 'talk_good', a: ME, b: n.id, tone: 1 });
      return '布包里是一颗破境丹——她攒了好些年的。';
    },
  },
  mojiu: {
    title: '少了两根手指的人',
    text: () => '一个左手少了两根手指的人拦住了你，盯着你的脸看了很久，声音发哑：「……你长得像你娘。」他是墨九，墨家另一个活下来的人。「当年灭墨家的，是青岚宗的温玄。我等了二十年。」',
    choices: () => [{ label: '「这个仇，算我一份。」', hint: '墨九把你当自己人' }, { label: '「上一辈的仇，我不想背。」' }],
    run: (w, n, idx) => {
      if (idx === 0) {
        adjust(n, ME, { aff: 15, trust: 15 });
        remember(w, n, { k: 'ally', a: ME, b: n.id, tone: 2 });
        return '墨九看了你很久，点了点头：「好。时候到了，我来找你。在那之前——别让温玄知道你姓墨。」';
      }
      adjust(n, ME, { aff: -5 });
      return '墨九的眼神暗了下去：「……随你。」他转身走了，没再回头。';
    },
  },
  liu: {
    title: '柳老板',
    text: () => '柳如烟笑盈盈地迎上来：「哟，这不是咱们的小账房吗？听说你测出了灵根，出息了。」',
    choices: () => [{ label: '「托您的福。」' }],
    run: (w, n) => {
      giveItem(w.me, 'heal');
      adjust(n, ME, { aff: 5 });
      return '她往你手里塞了一颗回春丹：「拿着，算我押在你身上的。往后发达了，可别忘了照顾我生意。」';
    },
  },
  han: {
    title: '韩长老的旧账',
    text: (w) => `韩烈眯着眼打量你：「哟，云渡坊那个打算盘的${kid(w)}？……你东家那笔账，你不会还惦记着吧？」`,
    choices: () => [{ label: '「那笔账，该还了。」', hint: '他未必肯' }, { label: '「早忘了。」' }],
    run: (w, n, idx) => {
      if (idx === 1) { adjust(n, ME, { aff: 10 }); return '韩烈哈哈一笑，拍了拍你的肩：「识时务。」'; }
      if (power(w.me) >= power(n) * 0.8) {
        w.me.stones += 50;
        adjust(n, ME, { aff: -10 });
        remember(w, n, { k: 'insult', a: ME, b: n.id, tone: -1 });
        return '韩烈脸上的笑僵了一下，扔过来一袋灵石：「五十块，两清。」走的时候，他看了你一眼。';
      }
      adjust(n, ME, { aff: -10 });
      remember(w, n, { k: 'insult', a: ME, b: n.id, tone: -1 });
      return '韩烈笑出了声：「就凭你？」他转身走了。这笔账，又多了一笔。';
    },
  },
  qinyan: {
    title: '秦焰',
    text: (w) => `秦焰远远看见你，一把搂住你的肩：「${w.me.gender === 'f' ? '你' : '好兄弟'}，可算又见着你了！那天你替我顶撞韩烈，被赶下山……这个人情，我一直记着。」`,
    choices: () => [{ label: '「都过去了。」' }],
    run: (w, n) => {
      adjust(n, ME, { aff: 10, trust: 10 });
      remember(w, n, { k: 'save', a: ME, b: n.id, tone: 2 });
      return '秦焰压低了声音：「门主那边我替你说过话，没用。不过往后你有事，喊一声。」';
    },
  },
  shen: {
    title: '大师姐',
    text: () => '沈清禾认出了你，脚步顿了一下：「是你。听说那天你也去测了灵根。」',
    choices: () => [{ label: '「想入青岚宗。」' }, { label: '「只是路过。」' }],
    run: (w, n, idx) => {
      adjust(n, ME, { aff: 5, trust: 5 });
      if (idx === 0 && !w.me.sect) {
        w.flags.vouch = 'qinglan';
        return '沈清禾想了想：「拜山那天，我替你说句话。成不成，看你自己。」';
      }
      return '沈清禾点了点头：「山门的路你认得。有事来找我。」';
    },
  },
};

/** 每种出身认得你的人（按先后） */
const KNOWN_BY: Record<string, string[]> = { hua: ['hua'], mo: ['mojiu'], ledger: ['liu', 'han'], outcast: ['qinyan'], servant: ['shen'] };

/** 到了一处：出身里认得你、还没见过面的人，有一场戏 */
export function originMeet(w: World): Encounter | null {
  for (const id of KNOWN_BY[w.origin ?? 'wild'] ?? []) {
    if (w.flags[`met:${id}`] !== undefined) continue;
    const n = w.people[id];
    if (!n?.alive) continue;
    if (n.place === w.me.place) return { id: `meet:${id}`, kind: 'meet', who: id, vars: {} };
  }
  return null;
}

export function meetView(w: World, e: Encounter) {
  const n = w.people[e.who];
  const s = SCENES[e.who];
  return { who: n.id, title: s.title, text: s.text(w, n), choices: s.choices(w, n) };
}

export function resolveMeet(w: World, e: Encounter, idx: number, rng: Rng) {
  const n = w.people[e.who];
  w.flags[`met:${n.id}`] = w.year;
  const out = SCENES[e.who].run(w, n, idx, rng);
  // 见过面就算认得：起码有个看法
  op(n, ME);
  return out;
}
