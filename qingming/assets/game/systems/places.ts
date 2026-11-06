// 各地的事：
// - 地方专属的主事（藏经阁、擂台、拜山、茶楼、悟道、闯洞府、采药、行医）；
// - 到了一处碰上的意外：越凶险的地方越容易出事（危险由 PLACES.danger 定）；
// - 名声、当众揭发温玄；
// - 按境界解锁的后期的事：开辟洞府、收徒传功、开坛讲道、镇守一方、主持宗务。

import type { Rng } from '../core/rng';
import type { Encounter, Npc, PlaceId, SectId, World } from '../core/types';
import {
  adjust, aff, clamp, extendLife, giveItem, isMaster, makeNpc, mark, ME, news, nm, npcs, op, placeName, power, takeItem,
} from '../core/world';
import { PLACES, SECT_NAME } from '../data/world-data';
import { newcomer } from '../data/people';
import { beast, beastRange, fight, gainExp, yearExp } from './body';
import { remember, witness } from '../mind/memory';
import { delve, delveOdds, depose, finish, goalText, setGoal } from '../mind/goals';

const pct = (p: number) => `${Math.round(p * 100)}%`;

// ───────────── 名声 ─────────────

export const fame = (w: World) => w.fame ?? 0;
export function addFame(w: World, d: number) {
  w.fame = Math.max(0, Math.round(fame(w) + d));
}
export function fameTier(w: World) {
  const f = fame(w);
  return f < 10 ? '默默无闻' : f < 30 ? '小有名气' : f < 60 ? '名动一方' : '威震青冥';
}

// ───────────── 地方专属的主事 ─────────────

export interface ActView { id: string; label: string; hint: string; ok: boolean }

/** 拜山能成的把握 */
export function joinChance(w: World, sect: SectId) {
  const m = w.people[w.sects[sect].master];
  return clamp(0.2 + 0.15 * w.me.talent + fame(w) / 100 + (m?.alive && aff(m, ME) >= 20 ? 0.2 : 0) + (w.origin === 'servant' && sect === 'qinglan' ? 0.3 : 0) + (w.flags.vouch === sect ? 0.2 : 0), 0.05, 0.95);
}
/** 听泉悟道：下次冲关多几成把握（天灵根悟性好；白鹿在场还会点拨两句） */
export function insightGain(w: World) {
  const bailu = w.people.bailu;
  return (w.root === 'heaven' ? 0.22 : 0.15) + (bailu?.alive && bailu.place === 'vein' && aff(bailu, ME) >= 30 ? 0.05 : 0);
}

/** 这个地方能做的那件事；没有就是 null */
export function localAct(w: World): ActView | null {
  const me = w.me, at = me.place;
  switch (at) {
    case 'qinglan':
    case 'chixiao': {
      if (w.sects[at].master === ME) return null;
      if (me.sect === at) {
        return at === 'qinglan'
          ? { id: 'local', label: '藏经阁参悟', hint: me.merit >= 20 ? `花 20 功劳，修为约 +${Math.round(yearExp(w, me, at, 1.3))}` : '要 20 功劳（替宗门办事攒）', ok: me.merit >= 20 && me.realm < 4 }
          : { id: 'local', label: '上擂台', hint: '和同门过招，赢了有功劳和灵石', ok: true };
      }
      if (me.sect) return null;
      const barred = at === 'chixiao' && w.origin === 'outcast';
      return { id: 'local', label: '拜山', hint: barred ? '赤霄门不收被赶下山的人' : `求入${SECT_NAME[at]}，把握约 ${pct(joinChance(w, at))}`, ok: !barred };
    }
    case 'market': return { id: 'local', label: '茶楼打听', hint: '花 10 灵石，听些消息', ok: me.stones >= 10 };
    case 'vein': return { id: 'local', label: '听泉悟道', hint: w.flags.insight ? '已有所悟，下次冲关用得上' : `下次冲关把握 +${Math.round(insightGain(w) * 100)}%`, ok: !w.flags.insight && me.realm < 4 };
    case 'cave': {
      if (['letter', 'sword'].some((i) => w.treasure[i] === 'cave')) return { id: 'local', label: '闯洞府深处', hint: `胜算约 ${pct(delveOdds(me))}，输了会受重伤`, ok: true };
      return { id: 'local', label: '寻灵药', hint: '深处还有些灵药，也有危险', ok: true };
    }
    case 'forest': return { id: 'local', label: '采药', hint: w.origin === 'hua' ? '你认得草药，采得多' : '多半能采到回春的草药', ok: true };
    case 'village': return { id: 'local', label: '行医施药', hint: me.items.includes('heal') ? '用一颗回春丹，名声 +5' : '花 10 灵石买药，名声 +5', ok: me.items.includes('heal') || me.stones >= 10 };
  }
  return null;
}

export function doLocal(w: World, rng: Rng): string {
  const me = w.me, at = me.place;
  switch (at) {
    case 'qinglan':
    case 'chixiao': {
      if (me.sect === at && at === 'qinglan') {
        me.merit -= 20;
        gainExp(me, yearExp(w, me, at, 1.3));
        return '在藏经阁里翻了一年古籍，修为大进。';
      }
      if (me.sect === at) {
        const rival = npcs(w).filter((x) => x.place === at && x.sect === at).sort((a, b) => Math.abs(power(a) - power(me)) - Math.abs(power(b) - power(me)))[0];
        let won: boolean;
        if (rival) {
          won = fight(w, me, rival, rng, { lethal: false }).win === me;
          if (won) witness(w, at, { k: 'spar', a: ME, b: rival.id, tone: 0 });
        } else {
          const foe = power(me) * rng.range(0.7, 1.3), p = power(me);
          won = rng.chance(p * p / (p * p + foe * foe));
          me.hp = Math.max(5, me.hp - (won ? 5 : 20));
        }
        if (!won) return `在擂台上输给了${rival ? rival.name : '一位师兄'}，养了好些日子的伤。`;
        me.merit += 10; me.stones += 25;
        gainExp(me, yearExp(w, me, at, 0.5));
        addFame(w, 1);
        return `在擂台上连赢几场${rival ? `，最后一场赢了${rival.name}` : ''}。功劳 +10，得了 25 灵石。`;
      }
      if (rng.chance(joinChance(w, at))) {
        me.sect = at;
        news(w, `${me.name}拜入了${SECT_NAME[at]}。`, 'good', [ME]);
        return `你在山门外跪了三天。${SECT_NAME[at]}收下了你。`;
      }
      return '守山弟子把你拦在了山门外：「回去再练几年。」';
    }
    case 'market': {
      me.stones -= 10;
      // 先打听冲着你来的人，再打听别人的打算，最后是玄冥剑的下落
      const hunter = npcs(w).find((x) => x.mind.goal?.target === ME && !w.knows.includes(`goal:${x.id}`));
      if (hunter) { w.knows.push(`goal:${hunter.id}`); return `茶博士压低了声音：「有人在打听你的下落——${hunter.name}。」`; }
      const secret = rng.shuffle(npcs(w).filter((x) => x.mind.goal?.secret && !w.knows.includes(`goal:${x.id}`)))[0];
      if (secret) { w.knows.push(`goal:${secret.id}`); return `邻桌的人喝多了，说漏了嘴：${secret.name}在${goalText(w, secret.mind.goal!)}。`; }
      const h = w.treasure.sword;
      return h === 'cave' ? '茶楼里都说，玄冥剑还插在洞府深处的石台上。' : h === 'gone' ? '茶楼里都说，玄冥剑早已离开了青冥州。' : `茶楼里都说，玄冥剑如今在${nm(w, h)}手里。`;
    }
    case 'vein': {
      w.flags.insight = insightGain(w);
      gainExp(me, yearExp(w, me, at, 0.3));
      const bailu = w.people.bailu;
      return bailu?.alive && bailu.place === 'vein' && aff(bailu, ME) >= 30 ? '白鹿陪你在泉边坐了几夜，说了几句闲话，你心里一动。下次冲关，把握大些。' : '听了一年泉声，心里像被洗过一遍。下次冲关，把握大些。';
    }
    case 'cave': {
      const item = ['letter', 'sword'].find((i) => w.treasure[i] === 'cave');
      if (item) {
        const r = delve(w, me, rng, item);
        if (r === 'found' && item === 'letter') {
          if (!w.knows.includes('secret:wen')) w.knows.push('secret:wen');
          news(w, `${me.name}在玄冥洞府深处找到一具白骨，压着一封遗书。`, 'story', [ME], true);
          return '洞府深处有一具白骨，手里压着一封信：署名「云鹤」。信里写着，三十年前是师弟温玄把他丢在这里的。拿着它去青岚宗，可以当众揭发。';
        }
        if (r === 'found') {
          news(w, `${me.name}从玄冥洞府深处带出了玄冥剑。`, 'story', [ME], true);
          witness(w, 'cave', { k: 'rob', a: ME, b: 'cave', tone: 0 });
          return '洞府最深处，一柄黑剑插在石台上。你拔出了玄冥剑。';
        }
        if (r === 'died') return '';
        return '你摸到了洞府深处，被守在那里的东西打伤，只能退了出来。';
      }
      const x = rng.next();
      if (x < 0.05) return `在石缝里找到一株延寿灵草，寿元多了${extendLife(me, w)}年。`;
      if (x < 0.35) { giveItem(me, 'heal'); return '采到几株回春的灵草，炼成了一颗回春丹。'; }
      if (x < 0.5) { giveItem(me, 'pill'); return '在一具枯骨的储物袋里，找到一颗破境丹。'; }
      if (x < 0.75) { me.hp = Math.max(5, me.hp - 20); return '被洞府里的阴风扫中，受了些伤，空手而回。'; }
      return '转了一年，什么也没找到。';
    }
    case 'forest': {
      const x = rng.next();
      if (x < 0.7) { giveItem(me, 'heal'); if (w.origin === 'hua') giveItem(me, 'heal'); return w.origin === 'hua' ? '照花婆婆教的认草药，采了一背篓，炼成两颗回春丹。' : '采了一背篓草药，炼成一颗回春丹。'; }
      if (x < 0.85) { giveItem(me, 'pill'); return '在悬崖上采到一株灵芝，炼成了一颗破境丹。'; }
      me.hp = Math.max(5, me.hp - 15);
      return '采药时撞上狼群，带着伤逃了回来。';
    }
    case 'village': {
      if (!takeItem(me, 'heal')) me.stones -= 10;
      addFame(w, 5);
      witness(w, 'village', { k: 'help', a: ME, b: 'village', tone: 2 });
      const hua = w.people.hua;
      if (hua?.alive && hua.place === 'village') adjust(hua, ME, { aff: 5 });
      news(w, `${me.name}在柳溪村行医施药，分文不取。`, 'good', [ME]);
      return '给村里的老人孩子看了一年病。走在村里，有人往你手里塞鸡蛋。';
    }
  }
  return '';
}

// ───────────── 揭发温玄 ─────────────

export function canExpose(w: World) {
  const tried = typeof w.flags.exposeTry === 'number' && w.year - (w.flags.exposeTry as number) < 2;
  return w.me.place === 'qinglan' && w.me.items.includes('letter') && !w.flags.exposed && !tried;
}

/** 在青岚宗当众拿出云鹤遗书。有沈清禾或花婆婆在场，没人不信 */
export function exposeWen(w: World, rng: Rng): string {
  const wen = w.people.wen;
  const members = npcs(w).filter((x) => x.sect === 'qinglan' && x.id !== 'wen');
  const learn = (x: Npc) => { if (!x.mind.knows.includes('secret:wen')) x.mind.knows.push('secret:wen'); };
  const shen = w.people.shen, hua = w.people.hua;
  const finishShen = () => {
    if (!shen?.alive) return;
    remember(w, shen, { k: 'help', a: ME, b: shen.id, tone: 3 });
    learn(shen);
    if (shen.mind.goal?.kind === 'seekmaster') finish(w, shen, 'ok');
    if (wen?.alive && shen.mind.goal?.kind !== 'revenge') setGoal(w, shen, { kind: 'revenge', target: 'wen', secret: false, step: 1 });
  };
  if (!wen?.alive) {
    w.flags.exposed = w.year;
    members.forEach(learn);
    finishShen();
    addFame(w, 10);
    news(w, `${w.me.name}在青岚宗拿出云鹤遗书，替三十年前的云鹤真人洗清了「失踪」的名声。`, 'story', [ME], true);
    return '温玄已经不在了。你把遗书供在云鹤真人的牌位前，青岚宗上下默然良久。';
  }
  const present = npcs(w).filter((x) => x.place === 'qinglan');
  const witnessOk = present.some((x) => x.id === 'shen' || x.id === 'hua');
  const friends = present.filter((x) => x.id !== 'wen' && aff(x, ME) >= 20).length;
  const p = witnessOk ? 1 : clamp(0.35 + 0.1 * friends + fame(w) / 100 - (w.me.sect === 'chixiao' ? 0.2 : 0), 0.1, 0.9);
  if (rng.chance(p)) {
    w.flags.exposed = w.year;
    for (const x of members) { learn(x); adjust(x, 'wen', { aff: -40, trust: -30 }); adjust(x, ME, { aff: 10 }); }
    if (w.sects.qinglan.master === 'wen') depose(w, 'qinglan');
    else wen.sect = '';
    adjust(wen, ME, { aff: -100, trust: -80 });
    learn(wen);
    if (wen.mind.goal?.kind !== 'longevity') setGoal(w, wen, { kind: 'revenge', target: ME, secret: true, cover: '闭关养伤', step: 1 });
    finishShen();
    if (hua?.alive) { adjust(hua, ME, { aff: 30 }); if (!w.knows.includes('secret:hua')) w.knows.push('secret:hua'); }
    const mojiu = w.people.mojiu;
    if (mojiu?.alive && mojiu.mind.goal?.kind === 'revenge' && mojiu.mind.goal.target === 'wen') { mojiu.mind.goal.step = Math.max(mojiu.mind.goal.step, 2); adjust(mojiu, ME, { aff: 20 }); }
    addFame(w, 15);
    mark(w, 'wen_down');
    news(w, `${w.me.name}在青岚宗当众拿出云鹤遗书。三十年前的旧事大白于天下，温玄被逐出山门。`, 'bad', [ME, 'wen'], true);
    return shen?.alive && shen.place === 'qinglan' ? '沈清禾认出了师父的笔迹，跪了下去。温玄的脸一点点灰下去，拂袖而去，再没回过山门。'
      : hua?.alive && hua.place === 'qinglan' ? '花婆婆抹了把眼泪：「他等这一天，等了三十年。」温玄拂袖而去，再没回过山门。'
      : '满堂寂静。温玄看了你很久，什么也没说，拂袖下了山。';
  }
  w.flags.exposeTry = w.year;
  adjust(wen, ME, { aff: -60, fear: 10 });
  for (const x of present) if (x.id !== 'wen' && rng.chance(0.5)) adjust(x, 'wen', { aff: -8 });
  addFame(w, -3);
  news(w, `${w.me.name}在青岚宗指控宗主温玄，众人将信将疑。`, 'story', [ME, 'wen']);
  return '你拿出遗书，众人传看了一圈，将信将疑。温玄淡淡一笑：「笔迹是可以仿的。」——要是有认得云鹤笔迹的人在场就好了。';
}

// ───────────── 后期的事 ─────────────

export const disciples = (w: World) => npcs(w).filter((x) => x.master === ME);
export const discipleCap = (w: World) => Math.max(0, w.me.realm - 1) + (isMaster(w, ME) ? 2 : 0);
/** 能不能收这个人为徒 */
export function canTakeDisciple(w: World, n: Npc) {
  const o = n.mind.op[ME];
  return w.me.realm >= 2 && n.realm < w.me.realm && !n.master && w.me.master !== n.id && (o?.aff ?? 0) >= 35 && (o?.trust ?? 0) >= 35 && disciples(w).length < discipleCap(w);
}
export function takeDisciple(w: World, n: Npc) {
  n.master = ME;
  remember(w, n, { k: 'master', a: ME, b: n.id, tone: 2 });
  adjust(n, ME, { aff: 10, trust: 10 });
  if (n.mind.goal?.kind === 'join' && !n.sect && w.me.sect) { n.sect = w.me.sect; finish(w, n, 'ok'); }
  news(w, `${w.me.name}收${n.name}为徒。`, 'good', [ME, n.id], true);
}

const ABODE_AT: PlaceId[] = ['vein', 'forest', 'village', 'cave'];
const WARD_AT: PlaceId[] = ['village', 'market', 'forest', 'vein'];
const TRIBUTE: Partial<Record<PlaceId, number>> = { village: 15, market: 40, forest: 20, vein: 10 };
const mySect = (w: World): SectId | null => (['qinglan', 'chixiao'] as SectId[]).find((s) => w.sects[s].master === ME && w.me.place === s) ?? null;

/** 按境界、名分解锁的主事 */
export function lateActs(w: World): ActView[] {
  const me = w.me, at = me.place, out: ActView[] = [];
  const here = npcs(w).filter((x) => x.place === at);
  if (canExpose(w)) out.push({ id: 'expose', label: '当众揭发温玄', hint: here.some((x) => x.id === 'shen' || x.id === 'hua') ? '有认得云鹤笔迹的人在场' : '没人作证，未必有人信', ok: true });
  const sect = mySect(w);
  if (sect) out.push({ id: 'govern', label: '主持宗务', hint: '收些供奉，门人更服你', ok: true });
  if (me.realm >= 2 && ABODE_AT.includes(at) && !w.flags.abode) out.push({ id: 'abode', label: '开辟洞府', hint: `花 200 灵石，以后在${placeName(at)}修炼更快、清静`, ok: me.stones >= 200 });
  if (me.realm >= 2 && disciples(w).some((x) => x.place === at)) out.push({ id: 'pass', label: '传功', hint: '给在场的徒弟传一年功', ok: true });
  if (me.realm >= 3 && here.length >= 2 && at !== 'cave' && at !== 'forest') out.push({ id: 'lecture', label: '开坛讲道', hint: `在场 ${here.length} 人都有所得，名声 +6`, ok: true });
  if (me.realm >= 3 && WARD_AT.includes(at) && w.flags.ward !== at) out.push({ id: 'ward', label: '镇守此地', hint: `每年有供奉、名声；${w.flags.ward ? `不再镇守${placeName(w.flags.ward as PlaceId)}` : '有魔修来犯得赶回来'}`, ok: true });
  return out;
}

export function doLate(w: World, act: string, rng: Rng): string {
  const me = w.me, at = me.place;
  const here = npcs(w).filter((x) => x.place === at);
  switch (act) {
    case 'expose': return exposeWen(w, rng);
    case 'govern': {
      const sect = mySect(w)!;
      me.stones += 60; me.merit += 10;
      addFame(w, 3);
      for (const x of here.filter((x) => x.sect === sect)) { adjust(x, ME, { aff: 4 }); gainExp(x, yearExp(w, x, at, 0.2)); }
      return `主持了一年${SECT_NAME[sect]}的大小事务。门人更服你了，供奉 60 灵石。`;
    }
    case 'abode': {
      me.stones -= 200;
      w.flags.abode = at;
      news(w, `${me.name}在${placeName(at)}开辟了洞府。`, 'good', [ME]);
      return `在${placeName(at)}开辟了一处洞府。以后在这里修炼更快，也清静些。`;
    }
    case 'pass': {
      const ds = disciples(w).filter((x) => x.place === at);
      for (const d of ds) { gainExp(d, yearExp(w, d, at, 0.8)); adjust(d, ME, { aff: 5 }); remember(w, d, { k: 'teach', a: ME, b: d.id, tone: 1 }); }
      gainExp(me, yearExp(w, me, at, 0.5));
      addFame(w, 1);
      return `给${ds.map((d) => d.name).join('、')}传了一年功，自己也温故知新。`;
    }
    case 'lecture': {
      for (const x of here) { gainExp(x, yearExp(w, x, at, 0.5)); remember(w, x, { k: 'teach', a: ME, b: x.id, tone: 1 }); }
      gainExp(me, yearExp(w, me, at, 0.4));
      addFame(w, 6);
      news(w, `${me.name}在${placeName(at)}开坛讲道，来听的人坐满了。`, 'good', [ME], true);
      const fan = here.find((x) => canTakeDisciple(w, x) && (x.mind.op[ME]?.aff ?? 0) >= 45);
      if (fan) { takeDisciple(w, fan); return `讲了一年道。散场时，${fan.name}跪下来，当场拜你为师。`; }
      return '讲了一年道，在场的人都有所得。';
    }
    case 'ward': {
      const from = w.flags.ward as PlaceId | undefined;
      w.flags.ward = at;
      addFame(w, 3);
      news(w, `${me.name}坐镇${placeName(at)}，此地太平了许多。`, 'good', [ME]);
      return `${from ? `你离开了${placeName(from)}，` : ''}在${placeName(at)}坐镇下来。以后这里每年有供奉；有魔修来犯，会有人来报信。`;
    }
  }
  return '';
}

/** 年末：镇守的地方送供奉、攒名声 */
export function playerYear(w: World) {
  const me = w.me;
  if (!me.alive) return;
  const ward = w.flags.ward as PlaceId | undefined;
  if (ward) { me.stones += TRIBUTE[ward] ?? 10; addFame(w, 2); }
}

// ───────────── 途中碰上的事 ─────────────

interface Ev {
  at: PlaceId[];
  good: boolean;
  title: string;
  text: string;
  choices: (w: World) => { label: string; hint?: string; disabled?: boolean }[];
  run: (w: World, idx: number, rng: Rng) => string;
  /** 什么情况下才会碰上 */
  when?: (w: World) => boolean;
}

/** 和一个凭空的对手过招（擂台、魔修）：返回赢没赢 */
function standIn(w: World, rng: Rng, lo: number, hi: number) {
  const foe = power(w.me) * rng.range(lo, hi), p = power(w.me);
  return rng.chance(p * p / (p * p + foe * foe));
}
/** 一场妖兽：按这个地方的凶险程度 */
function wild(w: World, rng: Rng, at: PlaceId, k = 1) {
  const [lo, hi] = beastRange(at);
  const r = beast(w, w.me, rng, lo * k, hi * k);
  if (!w.me.alive) return '';
  if (r.win) { if (w.root === 'dual') w.me.stones += Math.round(r.loot * 0.3); return `打退了它，得了 ${r.loot} 灵石${r.item ? `和一颗${r.item === 'heal' ? '回春丹' : r.item === 'pill' ? '破境丹' : '延寿丹'}` : ''}。`; }
  return '没打过，带着伤逃了。';
}
const odds = (w: World, at: PlaceId) => {
  const [lo, hi] = beastRange(at), p = power(w.me), f = (lo + hi) / 2;
  return `胜算约 ${pct(p * p / (p * p + f * f))}`;
};

export const EVENTS: Record<string, Ev> = {
  f_herb: { at: ['forest'], good: true, title: '老松下的灵芝', text: '一棵老松的根底下，长着一朵紫莹莹的灵芝。', choices: () => [{ label: '采下' }],
    run: (w) => { giveItem(w.me, 'heal'); return '采下灵芝，炼成了一颗回春丹。'; } },
  f_wolves: { at: ['forest'], good: false, title: '狼群', text: '林子里亮起一圈绿莹莹的眼睛。', choices: (w) => [{ label: '迎战', hint: odds(w, 'forest') }, { label: '突围', hint: '受点伤' }],
    run: (w, i, rng) => { if (i === 1) { w.me.hp = Math.max(5, w.me.hp - 15); return '你背靠着树杀出一条路，身上多了几道口子。'; } return `和狼群缠斗了半夜。${wild(w, rng, 'forest')}`; } },
  f_hurt: { at: ['forest'], good: true, title: '受伤的散修', text: '路边躺着一个年轻散修，腿上的伤口发了黑，看样子是被妖兽咬的。',
    choices: (w) => [{ label: '救他', hint: w.me.items.includes('heal') ? '用一颗回春丹' : '花 20 灵石', disabled: !w.me.items.includes('heal') && w.me.stones < 20 }, { label: '走开' }],
    run: (w, i, rng) => {
      if (i === 1) return '你绕开了。';
      if (!takeItem(w.me, 'heal')) w.me.stones -= 20;
      addFame(w, 4);
      if (rng.chance(0.5) && npcs(w).length < 14) {
        const id = `n${w.nextId++}`;
        const d = newcomer(id, rng.pick, rng.next);
        const n = makeNpc({ ...d, home: 'forest' }, w.year);
        n.bio = `${d.bio}在黑松林里被你救过一命。`;
        n.voice = d.voice;
        op(n, ME).aff = 55; op(n, ME).trust = 60;
        w.people[id] = n;
        news(w, `${n.name}在黑松林里被${w.me.name}救下。`, 'good', [ME, id]);
        return `你给他敷了药。他叫${n.name}，非要记下你的名字：「这条命是你给的。」`;
      }
      return '你给他敷了药。他千恩万谢地走了，逢人就说你的好。';
    } },
  c_bag: { at: ['cave'], good: true, title: '白骨堆里的储物袋', text: '一堆白骨里压着一只储物袋，还没烂透。', choices: () => [{ label: '打开' }],
    run: (w, _i, rng) => { const s = rng.int(30, 90); w.me.stones += s; return `袋子里有 ${s} 块灵石。不知道它的主人是谁。`; } },
  c_wind: { at: ['cave'], good: false, title: '阴风', text: '洞里忽然卷起一阵阴风，寒气直往骨头缝里钻。', choices: () => [{ label: '运功硬抗' }],
    run: (w) => { const d = Math.max(5, 25 - 5 * w.me.realm); w.me.hp = Math.max(5, w.me.hp - d); return d > 10 ? '你咬牙扛了过去，经脉里像结了冰。' : '阴风扑在你身上，散了。'; } },
  c_array: { at: ['cave'], good: true, title: '残阵', text: '石壁上刻着一座残缺的古阵，阵纹还在微微发亮。', choices: () => [{ label: '参悟', hint: '有所得，也可能受伤' }, { label: '不碰' }],
    run: (w, i, rng) => { if (i === 1) return '你没敢碰。'; gainExp(w.me, yearExp(w, w.me, 'cave', 0.5)); if (rng.chance(0.3)) { w.me.hp = Math.max(5, w.me.hp - 20); return '你看出了些门道，也被阵力反噬，吐了口血。'; } return '你在阵前坐了七天，看出了些门道。'; } },
  c_rock: { at: ['cave'], good: false, title: '塌方', text: '头顶的岩层裂开了。', choices: () => [{ label: '躲' }],
    run: (w) => { if (w.me.realm >= 2) return '你一掌拍开落石，衣角都没沾灰。'; w.me.hp = Math.max(5, w.me.hp - 20); return '你被埋了半截，爬出来时浑身是血。'; } },
  x_bully: { at: ['chixiao'], good: false, title: '门人刁难', text: '几个赤霄门弟子拦住你：「外人来赤霄门，得先过我们这关。」', when: (w) => w.me.sect !== 'chixiao',
    choices: () => [{ label: '亮本事' }, { label: '赔笑', hint: '花 10 灵石' }],
    run: (w, i, rng) => { if (i === 1) { w.me.stones = Math.max(0, w.me.stones - 10); return '你塞了几块灵石，他们笑着让开了。'; } if (standIn(w, rng, 0.6, 1.3)) { addFame(w, 2); return '你三招打翻了领头的。周围的人看你的眼神变了。'; } w.me.hp = Math.max(5, w.me.hp - 15); return '你被打得鼻青脸肿，丢了不小的脸。'; } },
  x_drill: { at: ['chixiao'], good: true, title: '师兄喂招', text: '一位师兄看你顺眼，拉着你喂了一下午的招。', when: (w) => w.me.sect === 'chixiao', choices: () => [{ label: '多谢' }],
    run: (w) => { gainExp(w.me, yearExp(w, w.me, 'chixiao', 0.3)); return '一下午下来，你的拳脚扎实了不少。'; } },
  q_books: { at: ['qinglan'], good: true, title: '藏经阁晒书', text: '藏经阁晒书，你帮着搬了一天，顺手翻了几本。', when: (w) => w.me.sect === 'qinglan', choices: () => [{ label: '好' }],
    run: (w) => { gainExp(w.me, yearExp(w, w.me, 'qinglan', 0.3)); return '有一本讲吐纳的，正合你用。'; } },
  m_peddler: { at: ['market'], good: true, title: '游方货郎', text: '一个货郎拉住你：「上好的破境丹，四十灵石，坊市里可买不着这个价。」',
    choices: (w) => [{ label: '买', hint: '40 灵石', disabled: w.me.stones < 40 }, { label: '不买' }],
    run: (w, i, rng) => { if (i === 1) return '你摆摆手走了。'; w.me.stones -= 40; if (rng.chance(0.2)) return '回去一看，是一颗搓圆了的泥丸。'; giveItem(w.me, 'pill'); return '真是一颗破境丹。'; } },
  m_thief: { at: ['market'], good: false, title: '扒手', text: '人挤人的时候，你觉得腰间一轻。', choices: () => [{ label: '追' }, { label: '算了' }],
    run: (w, i) => { const loss = Math.floor(w.me.stones * 0.1); if (i === 0 && w.me.realm >= 1) { addFame(w, 1); return '你两步就追上了，扒手跪在地上直磕头。'; } w.me.stones -= loss; return loss ? `丢了 ${loss} 灵石。` : '好在钱袋里本来也没几个钱。'; } },
  v_deer: { at: ['vein'], good: true, title: '白鹿饮泉', text: '清晨，一头白鹿在泉边低头饮水，看见你也不躲。', choices: () => [{ label: '静静看着' }],
    run: (w) => { gainExp(w.me, yearExp(w, w.me, 'vein', 0.3)); const b = w.people.bailu; if (b?.alive) adjust(b, ME, { aff: 5 }); return '白鹿喝完水，慢悠悠地走了。你心里静了许多。'; } },
  v_surge: { at: ['vein'], good: true, title: '灵泉涨潮', text: '谷底的灵脉忽然涌动，泉水都泛起了一层白雾。', choices: () => [{ label: '趁机吐纳' }],
    run: (w) => { gainExp(w.me, yearExp(w, w.me, 'vein', 0.5)); return '你在泉边坐了三天三夜，修为涨了一截。'; } },
  l_fox: { at: ['village'], good: false, title: '狐妖进村', text: '村民跑来找你：「后山的狐妖又来偷鸡了，还咬伤了人！」', choices: () => [{ label: '帮忙' }, { label: '推辞' }],
    run: (w, i, rng) => { if (i === 1) { addFame(w, -1); return '你推说有事。村民失望地走了。'; } const r = beast(w, w.me, rng, 0.3, 2); if (!w.me.alive) return ''; if (r.win) { addFame(w, 3); return '你在后山守了两夜，赶跑了狐妖。'; } return '狐妖比想的凶，你带着伤回来了。'; } },
  l_kid: { at: ['village'], good: true, title: '村童求艺', text: '几个村童跟在你后面，非要你教他们两招。', choices: () => [{ label: '教他们几招' }],
    run: (w) => { addFame(w, 2); return '孩子们学得有模有样，回家都说是仙人教的。'; } },
};

/** 镇守的地方有魔修来犯（在哪都会有人来报信） */
const RAID: Ev = {
  at: [], good: false, title: '魔修来犯', text: '', choices: () => [{ label: '赶回去迎敌' }, { label: '不管' }],
  run: (w, i, rng) => {
    const ward = w.flags.ward as PlaceId;
    if (i === 1) { delete w.flags.ward; addFame(w, -10); news(w, `魔修洗劫了${placeName(ward)}，${w.me.name}没有回来。`, 'bad', [ME], true); return `你没有回去。${placeName(ward)}遭了殃，那里的人不再指望你了。`; }
    w.me.place = ward;
    if (standIn(w, rng, 0.6, 1.2)) { const s = rng.int(50, 150); w.me.stones += s; w.me.hp = Math.max(5, w.me.hp - 15); addFame(w, 8); news(w, `${w.me.name}赶回${placeName(ward)}，击退了来犯的魔修。`, 'good', [ME], true); return `你赶回${placeName(ward)}，把魔修打跑了，缴了 ${s} 灵石。`; }
    w.me.hp = Math.max(5, w.me.hp - 40);
    return '魔修比想的难缠，你拼着重伤才把他们逼退。';
  },
};

/** 到了一处，碰上什么事（有洞府、镇守的地方清静，不出事） */
export function rollEvent(w: World, rng: Rng, quiet = false): Encounter | null {
  const at = w.me.place;
  if (w.flags.ward && rng.chance(0.12)) return { id: 'event:raid', kind: 'event', who: '', vars: { ev: 'raid' } };
  if (w.flags.abode === at || w.flags.ward === at) return null;
  const d = PLACES[at].danger;
  if (quiet && d < 0.1) return null;
  if (!rng.chance((quiet ? 0 : 0.12) + d)) return null;
  const pool = Object.entries(EVENTS).filter(([, e]) => e.at.includes(at) && (!e.when || e.when(w)));
  if (!pool.length) return null;
  const weight = (e: Ev) => (e.good ? (1 - d) * (w.root === 'dual' ? 1.5 : 1) : d * 4);
  const total = pool.reduce((t, [, e]) => t + weight(e), 0);
  let x = rng.next() * total;
  for (const [id, e] of pool) { x -= weight(e); if (x <= 0) return { id: `event:${id}`, kind: 'event', who: '', vars: { ev: id } }; }
  return { id: `event:${pool[0][0]}`, kind: 'event', who: '', vars: { ev: pool[0][0] } };
}

const evOf = (id: string) => (id === 'raid' ? RAID : EVENTS[id]);

export function eventView(w: World, e: Encounter) {
  const id = String(e.vars.ev);
  const ev = evOf(id);
  const text = id === 'raid' ? `有人连夜赶来报信：${placeName(w.flags.ward as PlaceId)}来了一伙魔修。` : ev.text;
  return { who: '', title: ev.title, text, choices: ev.choices(w) };
}

export function resolveEvent(w: World, e: Encounter, idx: number, rng: Rng) {
  return evOf(String(e.vars.ev)).run(w, idx, rng);
}

export { SECT_NAME };
