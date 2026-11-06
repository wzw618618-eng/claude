// 主角能做的事：去哪、做什么主事、和在场的人打交道、处理找上门的事。
// 每个函数都直接改世界，并返回一句结果给界面看。

import { makeRng, type Rng } from './core/rng';
import type { Encounter, Npc, PlaceId, SectId, World } from './core/types';
import {
  adjust, aff, being, has, itemName, lifeGain, ME, news, nm, npc, op, placeName, power, realmText, sweepDead, takeItem, ta,
} from './core/world';
import { BID, ITEMS, REALMS, SECT_NAME } from './data/world-data';
import { PERSON } from './data/people';
import { delve, finish, GOALS, goalText, killed, moveTreasure, setGoal, strikeReady, targetName, useLife, wantFrom } from './mind/goals';
import { addFame, canTakeDisciple, disciples, doLate, doLocal, eventView, fame, lateActs, localAct, resolveEvent, rollEvent, takeDisciple } from './systems/places';
import { describe, remember, witness } from './mind/memory';
import { touch, TOUCH } from './mind/bond';
import { checkEnd, endYear } from './systems/year';
import { beast, beastRange, breakChance, canBreak, fight, gainExp, tryBreak, yearExp } from './systems/body';

/** 用世界里的随机数做一件事，做完把随机数状态存回去 */
function withRng<T>(w: World, f: (rng: Rng) => T): T {
  const rng = makeRng(w.rng);
  const r = f(rng);
  w.rng = rng.state();
  sweepDead(w);
  checkEnd(w);
  return r;
}

// ───────────── 去哪 ─────────────

/** 今年去哪。到了之后，冲着你来的人会找上门，路上也可能碰上些事（quiet：闭关时只有凶险的地方才会出事） */
export function moveTo(w: World, place: PlaceId, opts: { quiet?: boolean } = {}) {
  if (w.phase !== 'year' || w.turn.moved) return false;
  w.me.place = place;
  w.turn.moved = true;
  withRng(w, (rng) => {
    w.pending = encounters(w, rng);
    if (w.pending.length < 2) {
      const ev = rollEvent(w, rng, opts.quiet);
      if (ev) w.pending.push(ev);
    }
  });
  return true;
}

// ───────────── 主事 ─────────────

export type MainAct = 'cultivate' | 'seclude' | 'pill' | 'array' | 'adventure' | 'work' | 'local' | 'expose' | 'govern' | 'abode' | 'pass' | 'lecture' | 'ward';
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** 布阵修炼要花的灵石（按境界） */
export const ARRAY_COST = [15, 40, 100, 240];
const ARRAY_MULT = 1.25;

/** 今年在这里能做的主事：修炼、冲关、布阵、这个地方专属的事、历练、做事，还有境界和名分解锁的事 */
export function mainActs(w: World): { id: MainAct; label: string; hint: string; ok: boolean }[] {
  const me = w.me, at = me.place;
  const work = at === 'market' ? '在坊市跑腿，挣些灵石' : me.sect === at ? '替宗门办事，攒功劳和灵石' : at === 'village' ? '帮村民做事，攒名声' : '打些零工';
  const ready = canBreak(me);
  const out: { id: MainAct; label: string; hint: string; ok: boolean }[] = [
    { id: 'cultivate', label: '修炼', hint: `修为约 +${Math.round(yearExp(w, me, at))}`, ok: me.realm < 4 },
    { id: 'seclude', label: '闭关冲关', hint: ready ? `冲击${REALMS[me.realm + 1]}，把握约 ${pct(breakChance(me, false, w))}` : '修为圆满才能冲关', ok: ready },
  ];
  if (me.items.includes('pill')) out.push({ id: 'pill', label: '服丹冲关', hint: ready ? `服下破境丹，把握约 ${pct(breakChance(me, true, w))}` : '修为圆满才能冲关', ok: ready });
  if (me.realm < 4) out.push({ id: 'array', label: '布阵修炼', hint: `花 ${ARRAY_COST[me.realm]} 灵石，修为约 +${Math.round(yearExp(w, me, at, ARRAY_MULT))}`, ok: me.stones >= ARRAY_COST[me.realm] });
  const local = localAct(w);
  if (local) out.push(local as { id: MainAct; label: string; hint: string; ok: boolean });
  out.push(
    { id: 'adventure', label: '历练', hint: at === 'cave' ? '洞府里的妖物凶，机缘也多' : at === 'forest' ? '和妖兽打一场' : '四处走走，碰碰运气', ok: true },
    { id: 'work', label: '做事', hint: work, ok: true },
  );
  out.push(...(lateActs(w) as { id: MainAct; label: string; hint: string; ok: boolean }[]));
  return out;
}

export function doMain(w: World, act: MainAct): string {
  if (w.phase !== 'year' || !w.turn.moved || w.turn.main) return '';
  if (!mainActs(w).find((x) => x.id === act)?.ok) return '';
  w.turn.main = true;
  const me = w.me;
  return withRng(w, (rng) => {
    if (act === 'cultivate' || act === 'array') {
      const before = realmText(me);
      if (act === 'array') me.stones -= ARRAY_COST[me.realm];
      gainExp(me, yearExp(w, me, me.place, act === 'array' ? ARRAY_MULT : 1));
      const how = act === 'array' ? '布下聚灵阵修炼了一年' : '闭门修炼了一年';
      return before === realmText(me) ? `${how}，修为又进了一步。` : `${how}，境界到了${realmText(me)}。`;
    }
    if (act === 'seclude' || act === 'pill') {
      const r = tryBreak(w, me, rng, { pill: act === 'pill' });
      if (!r) return '修为还不够圆满。';
      if (r.ok) {
        news(w, `${me.name}闭关出关，突破到了${REALMS[me.realm]}。`, 'good', [ME], me.realm >= 2);
        for (const x of Object.values(w.people)) if (x.alive && x.place === me.place) remember(w, x, { k: 'talk_good', a: ME, b: x.id, tone: 0 });
        return `${r.pill ? '服下破境丹，' : ''}闭关一年，破境成功：${REALMS[me.realm]}！寿元涨了。`;
      }
      return `${r.pill ? '服下破境丹，' : ''}冲关失败，受了内伤，修为跌了一截${w.root === 'mixed' ? '（好在根基稳，跌得不多）' : ''}。下次把握大些。`;
    }
    if (act === 'local') return doLocal(w, rng);
    if (act !== 'adventure' && act !== 'work') return doLate(w, act, rng);
    if (act === 'adventure') {
      const [lo, hi] = beastRange(me.place);
      const r = beast(w, me, rng, lo, hi);
      if (!me.alive) return '';
      if (r.win && w.root === 'dual') me.stones += Math.round(r.loot * 0.3);
      if (r.win) return `打退了一头妖兽，得了 ${r.loot} 灵石${r.item ? `和一颗${ITEMS[r.item].name}` : ''}。`;
      return '遇上一头凶兽，没打过，带伤逃了回来。';
    }
    // 做事
    if (me.place === 'market') { const g = rng.int(25, 45); me.stones += g; return `在坊市跑了一年腿，挣了 ${g} 灵石。`; }
    if (me.sect && me.sect === me.place) { me.merit += 10; me.stones += 20; gainExp(me, yearExp(w, me, me.place, 0.3)); return '替宗门办了一年差事，功劳 +10，领了 20 灵石。'; }
    if (me.place === 'village') {
      me.stones += 8;
      addFame(w, 2);
      witness(w, 'village', { k: 'help', a: ME, b: 'village', tone: 2 });
      news(w, `${me.name}在柳溪村帮村民修渠、驱兽，村里人都念着好。`, 'good', [ME]);
      return '帮村里修渠、赶走了偷鸡的狐妖。村民塞给你 8 块灵石，名声传开了些。';
    }
    const g = rng.int(10, 20); me.stones += g; return `打了一年零工，挣了 ${g} 灵石。`;
  });
}

// ───────────── 坊市和丹药 ─────────────

export const SHOP: Record<string, number> = { pill: 60, heal: 25, life: 200 };
export function buy(w: World, item: string) {
  const price = SHOP[item];
  if (w.me.place !== 'market' || !price || w.me.stones < price) return '买不起。';
  if (item === 'life' && Number(w.flags.lifeStock ?? 0) <= 0) return '延寿丹卖完了。';
  if (item === 'life') w.flags.lifeStock = Number(w.flags.lifeStock) - 1;
  w.me.stones -= price;
  w.me.items.push(item);
  return `买下了${ITEMS[item].name}。`;
}
export function useItem(w: World, item: string) {
  if (item === 'heal' && takeItem(w.me, 'heal')) { w.me.hp = Math.min(100, w.me.hp + 50); return '服下回春丹，伤好了一大半。'; }
  if (item === 'life' && w.me.items.includes('life')) {
    if (!lifeGain(w.me)) return '延寿丹吃得太多，药力已经不起作用了。';
    return `服下延寿丹，寿元多了${useLife(w, w.me)}年。`;
  }
  return '';
}

/** 在坊市卖东西能卖多少、卖给谁；遗书不卖 */
export function sellOffer(w: World, item: string): { price: number; to: string } | null {
  if (!w.me.items.includes(item) || item === 'letter') return null;
  if (item === 'sword') {
    const liu = w.people.liu;
    if (liu?.alive && liu.stones >= 250) return { price: Math.min(400, liu.stones), to: 'liu' };
    return { price: 350, to: 'gone' };
  }
  const base = ITEMS[item]?.price ?? 0;
  return base ? { price: Math.round(base * 0.5 * (w.origin === 'ledger' ? 1.2 : 1)), to: 'shop' } : null;
}

export function sell(w: World, item: string): string {
  if (w.phase !== 'year' || w.me.place !== 'market') return '';
  const o = sellOffer(w, item);
  if (!o) return '这东西不能卖。';
  w.me.stones += o.price;
  if (item !== 'sword') {
    takeItem(w.me, item);
    if (item === 'life') w.flags.lifeStock = Math.min(3, Number(w.flags.lifeStock ?? 0) + 1);
    return `卖掉了${itemName(item)}，得了 ${o.price} 灵石。`;
  }
  moveTreasure(w, 'sword', ME, o.to);
  const li = w.people.li;
  const liWants = li?.alive && li.mind.goal?.kind === 'treasure' && li.mind.goal.target === 'sword';
  if (o.to === 'liu') {
    const liu = w.people.liu;
    liu.stones -= o.price;
    news(w, `${w.me.name}在云渡坊把玄冥剑卖给了柳如烟，得了${o.price}灵石。`, 'story', [ME, 'liu'], true);
  } else news(w, `${w.me.name}在云渡坊把玄冥剑卖给了一位过路的高人，那人当天就离开了青冥州。`, 'story', [ME], true);
  if (liWants) { adjust(li, ME, { aff: o.to === 'liu' ? -15 : -25 }); news(w, '厉擎听说后，把茶碗摔了。', 'info', ['li', ME]); }
  return o.to === 'liu' ? `柳如烟笑盈盈地数出 ${o.price} 灵石：「这买卖，值。」` : `一位过路的高人出了 ${o.price} 灵石，带着玄冥剑走了，再没回来。`;
}

// ───────────── 打交道 ─────────────

export type SocialKind = 'chat' | 'news' | 'goal' | 'teach' | 'gift' | 'spar' | 'provoke' | 'master' | 'partner' | 'join' | 'ally' | 'tell' | 'disciple' | 'admit' | 'expel';

/** 打交道的结果：一句话，外加这次让对方怎么看你 */
export interface SocialResult { text: string; ok: boolean }

const reply = (w: World, n: Npc, line: string) => `${n.name}：「${line}」`;

export function canSocial(w: World, id: string) {
  const n = npc(w, id);
  return !!n && n.alive && w.phase === 'year' && w.turn.moved && w.turn.social > 0 && n.place === w.me.place && !w.pending.length;
}

/** 对一个人说出某个秘密会怎样：要紧的是这个秘密和他有没有关系 */
export function tellables(w: World, id: string) {
  const n = npc(w, id);
  if (!n) return [];
  return w.knows.filter((k) => k.startsWith('secret:') && !n.mind.knows.includes(k));
}

export function social(w: World, id: string, kind: SocialKind, arg = ''): SocialResult {
  if (!canSocial(w, id)) return { text: '', ok: false };
  w.turn.social--;
  touch(w, id, TOUCH.social);
  return withRng(w, (rng) => socialEffect(w, w.people[id], kind, arg, rng));
}

/** 打交道的效果本身，不花次数：谈话里对方提出、你答应下来的事也走这里 */
export function socialEffect(w: World, n: Npc, kind: SocialKind, arg: string, rng: Rng): SocialResult {
  const o = op(n, ME);
  switch (kind) {
    case 'chat': {
      const good = o.aff >= 0 || has(n, 'bold') || has(n, 'kind');
      remember(w, n, { k: good ? 'talk_good' : 'talk_bad', a: ME, b: n.id, tone: good ? 1 : -1, at: n.place });
      return { ok: good, text: reply(w, n, chatLine(w, n)) };
    }
    case 'news': {
      if (o.trust < 15 && !has(n, 'bold')) return { ok: false, text: reply(w, n, '我跟你不熟。') };
      // 交情深的人，可能把知道的秘密告诉你
      const secret = n.mind.knows.find((k) => k.startsWith('secret:') && !w.knows.includes(k) && k !== `secret:${n.id}`);
      if (secret && o.aff >= 45 && o.trust >= 50) {
        w.knows.push(secret);
        const who = secret.slice(7);
        return { ok: true, text: reply(w, n, `这话我只跟你说……${secretLine(w, who)}`) };
      }
      const m = n.mind.mem.filter((x) => x.a !== ME && x.b !== ME && Math.abs(x.tone) >= 1 && !(x.a === n.id && x.tone < 0)).sort((a, b) => b.y - a.y)[0];
      if (!m) return { ok: true, text: reply(w, n, '最近没听说什么。') };
      return { ok: true, text: reply(w, n, `${describe(w, m, n.id).replace(/^我/, '我')}。`) };
    }
    case 'goal': {
      const g = n.mind.goal;
      if (!g) return { ok: true, text: reply(w, n, '没什么打算，好好修炼罢了。') };
      const honest = !g.secret || w.knows.includes(`goal:${n.id}`) || (o.trust >= 70 && o.aff >= 50);
      if (honest) {
        if (!w.knows.includes(`goal:${n.id}`)) w.knows.push(`goal:${n.id}`);
        return { ok: true, text: reply(w, n, honestGoal(w, n)) };
      }
      return { ok: true, text: reply(w, n, g.cover ?? '没什么打算。') };
    }
    case 'teach': {
      const higher = n.realm > w.me.realm || (n.realm === w.me.realm && n.stage > w.me.stage);
      if (!higher) return { ok: false, text: reply(w, n, '我的修为还不如你，哪敢指点。') };
      if (o.aff < 10 && n.master !== ME && w.me.master !== n.id) return { ok: false, text: reply(w, n, '凭什么指点你？') };
      gainExp(w.me, yearExp(w, w.me, w.me.place, w.root === 'heaven' ? 0.52 : 0.35));
      remember(w, n, { k: 'teach', a: n.id, b: ME, tone: 1 });
      adjust(n, ME, { aff: 3 });
      return { ok: true, text: `${n.name}指点了你几句，你受益匪浅。` };
    }
    case 'gift': {
      const item = arg && w.me.items.includes(arg) ? arg : '';
      if (!item && w.me.stones < 20) return { ok: false, text: '你身上没什么拿得出手的东西。' };
      if (item) { takeItem(w.me, item); n.items.push(item); if (item === 'letter') { w.treasure.letter = n.id; if (!n.mind.knows.includes('secret:wen')) n.mind.knows.push('secret:wen'); } }
      else { w.me.stones -= 20; n.stones += 20; }
      const tone = has(n, 'greedy') ? 2 : 1;
      remember(w, n, { k: 'gift', a: ME, b: n.id, tone: item === 'life' || item === 'sword' ? 3 : tone });
      return { ok: true, text: `你把${item ? ITEMS[item].name : '二十块灵石'}送给了${n.name}。${has(n, 'greedy') ? `${ta(w, n.id)}眼睛一亮。` : ''}` };
    }
    case 'spar':
    case 'provoke': {
      if (kind === 'provoke') remember(w, n, { k: 'insult', a: ME, b: n.id, tone: -2, at: n.place });
      const r = fight(w, w.me, n, rng, { lethal: false });
      const won = r.win === w.me;
      gainExp(w.me, 10);
      gainExp(n, 10);
      if (won) {
        adjust(n, ME, { fear: 10, aff: has(n, 'proud') ? -8 : 2 });
        witness(w, n.place, { k: 'spar', a: ME, b: n.id, tone: 0 });
      } else adjust(n, ME, { aff: has(n, 'proud') ? 3 : 0 });
      if (kind === 'provoke' && !won) remember(w, n, { k: 'hurt', a: n.id, b: ME, tone: 0 });
      return { ok: won, text: `${kind === 'provoke' ? '你当众挑衅，' : ''}和${n.name}过了几招，${won ? '你赢了' : '你输了'}。${won && has(n, 'proud') ? `${ta(w, n.id)}脸色很难看。` : ''}` };
    }
    case 'master': {
      const ok = n.realm > w.me.realm && o.aff >= 40 && o.trust >= 40 && !has(n, 'lonely') && !w.me.master;
      if (!ok) return { ok: false, text: reply(w, n, o.aff >= 40 ? '你我缘分还不到这一步。' : '我不收徒。') };
      w.me.master = n.id;
      remember(w, n, { k: 'master', a: n.id, b: ME, tone: 2 });
      adjust(n, ME, { aff: 10, trust: 10 });
      news(w, `${n.name}收${w.me.name}为徒。`, 'good', [ME, n.id], true);
      return { ok: true, text: `${n.name}收你为徒。和师父在一处修炼，会快不少。` };
    }
    case 'partner': {
      const ok = o.aff >= 70 && o.trust >= 50 && !n.partner && !w.me.partner && !(n.mind.goal?.kind === 'love' && n.mind.goal.target !== ME);
      if (!ok) {
        remember(w, n, { k: 'talk_bad', a: ME, b: n.id, tone: o.aff >= 40 ? 0 : -1 });
        return { ok: false, text: reply(w, n, o.aff >= 40 ? '……你让我想想。' : '你在说什么胡话。') };
      }
      n.partner = ME; w.me.partner = n.id;
      remember(w, n, { k: 'partner', a: ME, b: n.id, tone: 3 });
      if (n.mind.goal?.kind === 'love') finish(w, n, 'ok');
      news(w, `${w.me.name}与${n.name}结为道侣。`, 'good', [ME, n.id], true);
      return { ok: true, text: `${n.name}点了头。你们结为道侣。` };
    }
    case 'join': {
      const sect = n.sect;
      if (!sect || w.me.sect) return { ok: false, text: reply(w, n, '这事我做不了主。') };
      if (w.origin === 'outcast' && sect === 'chixiao') return { ok: false, text: reply(w, n, '赤霄门不收被赶下山的人。') };
      const ok = o.aff >= 30 || rng.chance(0.25 + w.me.talent * 0.15 + fame(w) / 100 + (w.origin === 'servant' && sect === 'qinglan' ? 0.3 : 0));
      if (!ok) return { ok: false, text: reply(w, n, `想入${SECT_NAME[sect]}？先让人看看你的本事。`) };
      w.me.sect = sect;
      news(w, `${w.me.name}拜入了${SECT_NAME[sect]}。`, 'good', [ME]);
      return { ok: true, text: `${n.name}替你引荐，你拜入了${SECT_NAME[sect]}。在宗门修炼更快，也能替宗门办事。` };
    }
    case 'ally': {
      const g = n.mind.goal;
      if (!g || g.ally || !((g.kind === 'revenge' && g.step === 2) || (g.kind === 'treasure' && g.step === 1))) return { ok: false, text: reply(w, n, '我眼下用不着帮手。') };
      g.ally = ME; g.step++; g.stuck = 0;
      remember(w, n, { k: 'ally', a: ME, b: n.id, tone: 1 });
      return { ok: true, text: `${n.name}答应和你一起${GOALS[g.kind].name}。到了动手那年，${ta(w, n.id)}会来找你。` };
    }
    case 'tell':
      return { ok: true, text: tell(w, n, arg, rng) };
    case 'disciple': {
      if (!canTakeDisciple(w, n)) return { ok: false, text: reply(w, n, n.master ? '我已经有师父了。' : '……我还没想好。') };
      takeDisciple(w, n);
      return { ok: true, text: `${n.name}跪下磕了三个头。从今往后，${ta(w, n.id)}是你的徒弟了。` };
    }
    case 'admit': {
      const sect = mastered(w);
      if (!sect || n.sect || !(o.aff >= 20 || n.mind.goal?.kind === 'join')) return { ok: false, text: reply(w, n, '多谢美意，我还是自在些好。') };
      n.sect = sect;
      if (n.mind.goal?.kind === 'join') finish(w, n, 'ok');
      remember(w, n, { k: 'help', a: ME, b: n.id, tone: 2 });
      news(w, `${n.name}拜入了${SECT_NAME[sect]}。`, 'good', [n.id, ME]);
      return { ok: true, text: `你把${n.name}收入了${SECT_NAME[sect]}门下。` };
    }
    case 'expel': {
      const sect = mastered(w);
      if (!sect || n.sect !== sect) return { ok: false, text: '' };
      n.sect = '';
      remember(w, n, { k: 'insult', a: ME, b: n.id, tone: -3 });
      if (n.mind.goal?.kind === 'throne') finish(w, n, 'fail');
      news(w, `${w.me.name}把${n.name}逐出了${SECT_NAME[sect]}。`, 'bad', [ME, n.id], true);
      return { ok: true, text: `你当众把${n.name}逐出了${SECT_NAME[sect]}。${ta(w, n.id)}走的时候没回头。` };
    }
  }
  return { ok: false, text: '' };
}

/** 你当宗主（门主）的宗门 */
export const mastered = (w: World): SectId | null => (['qinglan', 'chixiao'] as SectId[]).find((s) => w.sects[s].master === ME) ?? null;

export function chatLine(w: World, n: Npc) {
  const o = op(n, ME);
  const back = n.mind.mem.filter((m) => m.a === ME && Math.abs(m.tone) >= 2).sort((a, b) => b.y - a.y)[0];
  if (back && w.year - back.y <= 5) return back.tone > 0 ? `${describe(w, back, n.id).replace(/^你/, '你')}，这份情我记着。` : `${describe(w, back, n.id)}，这笔账我还没忘。`;
  if (o.aff >= 50) return '是你啊，坐。';
  if (o.aff <= -30) return '有话快说。';
  return n.mind.goal && !n.mind.goal.secret ? `最近在忙${GOALS[n.mind.goal.kind].name}的事。` : PERSON[n.id]?.voice ? '嗯。' : '幸会。';
}

export function honestGoal(w: World, n: Npc) {
  const g = n.mind.goal!;
  const t = targetName(w, g);
  switch (g.kind) {
    case 'revenge': return g.target === ME ? '我要你的命。' : `我要找${t}报仇。`;
    case 'throne': return `${t}的位子，迟早是我的。`;
    case 'seekmaster': return '我在找我师父，活要见人，死要见尸。';
    case 'love': return g.target === ME ? '……我想多见见你。' : `我心里有${t}。`;
    case 'treasure': return `我想要${t}。`;
    case 'longevity': return '我的寿元不多了，得想办法续命。';
    case 'join': return '我想拜入宗门。';
  }
}

export function secretLine(w: World, who: string) {
  const s = PERSON[who]?.secret;
  if (who === 'lu') return '十年前杀秦烈的，是陆沉舟。';
  if (who === 'wen') return '三十年前云鹤真人失踪，是温玄害的。';
  if (who === 'mojiu') return '墨九是墨家活下来的人，他要找温玄报仇。';
  return s ?? `${nm(w, who)}手上沾过血。`;
}

/** 把一个秘密告诉某人：和他相关的秘密会改变他的打算，被说的那个人迟早会知道是你说的 */
function tell(w: World, n: Npc, key: string, rng: Rng) {
  if (!key || !w.knows.includes(key)) return '';
  const who = key.slice(7);
  if (who === n.id) {
    adjust(n, ME, { aff: -30, fear: 25 });
    if (has(n, 'cruel') && !n.mind.goal?.target) setGoal(w, n, { kind: 'revenge', target: ME, secret: true, cover: '没什么', step: 1 });
    return `你当面说出了${n.name}的秘密。${ta(w, n.id)}的笑容僵在脸上：「这话，你最好烂在肚子里。」`;
  }
  if (!n.mind.knows.includes(key)) n.mind.knows.push(key);
  const subject = w.people[who];
  if (subject?.alive) remember(w, subject, { k: 'expose', a: ME, b: who, tone: -2, from: n.id });
  const g = n.mind.goal;
  let effect = `${n.name}听完沉默了很久。`;
  if (g?.kind === 'revenge' && g.target === who && g.step === 0) {
    g.step = 1; g.stuck = 0;
    remember(w, n, { k: 'help', a: ME, b: n.id, tone: 3 });
    effect = `${n.name}攥紧了拳头：「多谢。这个仇，我记下了。」`;
  } else if (who === 'wen' && n.id === 'shen') {
    if (g?.kind === 'seekmaster') { g.step = 2; g.stuck = 0; }
    else if (!g && w.people.wen?.alive) setGoal(w, n, { kind: 'seekmaster', secret: false, step: 2 });
    remember(w, n, { k: 'help', a: ME, b: n.id, tone: 3 });
    effect = '沈清禾的脸一下子白了。';
  } else if (who === 'lu' && n.id === 'tang') {
    adjust(n, 'lu', { aff: -40 });
    effect = '苏小棠愣在那里，眼圈红了：「你骗人……」';
  } else if (aff(n, who) >= 40) {
    adjust(n, ME, { aff: -10 });
    effect = `${n.name}不太高兴：「我不信。」`;
  } else {
    adjust(n, who, { aff: -20, trust: -15 });
    remember(w, n, { k: 'help', a: ME, b: n.id, tone: 1 });
  }
  if (rng.chance(0.3)) witness(w, n.place, { k: 'expose', a: ME, b: who, tone: -1 }, [n.id]);
  return effect;
}

// ───────────── 找上门的事 ─────────────

export interface Choice { label: string; hint?: string; disabled?: boolean }
export interface EncounterView { title: string; text: string; who: string; choices: Choice[]; /** AI 配了台词时，规则原本的那句 */ rule?: string }

/** 到了一个地方：谁会来找你（最多两件，要命的事排前面） */
export function encounters(w: World, rng: Rng): Encounter[] {
  const out: Encounter[] = [];
  const me = w.me;
  for (const n of Object.values(w.people)) {
    if (!n.alive) continue;
    const g = n.mind.goal;
    const o = n.mind.op[ME];
    // 冲着你来的：报仇、夺位、抢东西、上门求购——在哪都找得到你；想偷的人悄悄跟着你
    if (n.plan.target === ME) {
      const sch = n.plan.scheme, want = wantFrom(n);
      const robbing = sch === 'rob' && !!want && me.items.includes(want);
      if (sch === 'ambush' || robbing) { n.place = me.place; out.push({ id: `attack:${n.id}`, kind: 'attack', who: n.id, vars: robbing ? { item: want } : {} }); continue; }
      if (sch === 'buy' && want && me.items.includes(want)) { n.place = me.place; out.push({ id: `bid:${n.id}`, kind: 'bid', who: n.id, vars: { item: want } }); continue; }
      if (sch === 'steal') n.place = me.place;
    }
    if (g?.ally === ME && strikeReady(w, n)) { out.push({ id: `call:${n.id}`, kind: 'call', who: n.id, vars: {} }); continue; }
    if (g?.ally === ME && g.kind === 'treasure' && g.step === 3) { out.push({ id: `${n.plan.scheme === 'betray' ? 'betray' : 'share'}:${n.id}`, kind: n.plan.scheme === 'betray' ? 'betray' : 'share', who: n.id, vars: {} }); continue; }
    // 心里有你的人，常「碰巧」出现在你去的地方
    if (g?.kind === 'love' && g.target === ME && n.place !== me.place && rng.chance(0.5)) n.place = me.place;
    // 想趁宗主不在夺位的人，来探你的口风
    if (n.plan.scheme === 'seize' && n.sect && me.place === n.sect && w.flags[`plot:${n.id}`] === undefined && w.sects[n.sect].master !== ME && (me.sect === n.sect || (o?.aff ?? 0) >= 30)) {
      n.place = me.place;
      out.push({ id: `plot:${n.id}`, kind: 'plot', who: n.id, vars: {} });
      continue;
    }
    if (n.place !== me.place || !o) continue;
    if (g?.kind === 'love' && g.target === ME && g.step === 2) { out.push({ id: `confess:${n.id}`, kind: 'confess', who: n.id, vars: {} }); continue; }
    if (g && !g.ally && ((g.kind === 'revenge' && g.step === 2) || (g.kind === 'treasure' && g.step === 1 && n.plan.scheme === 'ally')) && o.aff >= 15 && o.trust >= 30 && g.target !== ME) { out.push({ id: `ask:${n.id}`, kind: 'ask', who: n.id, vars: {} }); continue; }
    if (n.realm >= me.realm + 1 && o.aff >= 45 && !me.master && !has(n, 'lonely') && rng.chance(0.5)) { out.push({ id: `teach:${n.id}`, kind: 'teach', who: n.id, vars: {} }); continue; }
    if (fame(w) >= 15 && me.realm >= 2 && n.realm < me.realm && !n.master && o.aff >= 20 && disciples(w).length < Math.max(0, me.realm - 1) + 2 && rng.chance(0.25)) { out.push({ id: `apprentice:${n.id}`, kind: 'apprentice', who: n.id, vars: {} }); continue; }
    const secret = n.mind.knows.find((k) => k.startsWith('secret:') && !w.knows.includes(k) && k !== `secret:${n.id}`);
    if (secret && o.aff >= 30 && o.trust >= 45 && rng.chance(0.4)) { out.push({ id: `tip:${n.id}`, kind: 'tip', who: n.id, vars: { key: secret } }); continue; }
    const ratio = power(n) / power(me);
    if ((has(n, 'proud') || has(n, 'rash')) && ratio > 0.6 && ratio < 1.6 && o.aff <= 10 && rng.chance(0.3)) out.push({ id: `duel:${n.id}`, kind: 'duel', who: n.id, vars: {} });
  }
  const rank = ['attack', 'betray', 'call', 'plot', 'bid', 'confess', 'ask', 'share', 'teach', 'apprentice', 'tip', 'duel'];
  out.sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind));
  return out.slice(0, 2);
}

/** 找上门的事怎么显示：AI 替来人说了话（vars.say），就用 AI 的话，选项照旧 */
export function viewEncounter(w: World, e: Encounter): EncounterView {
  if (e.kind === 'event') return eventView(w, e);
  const v = ruleEncounter(w, e);
  const say = typeof e.vars.say === 'string' ? e.vars.say : '';
  return say ? { ...v, text: `${w.people[e.who].name}：「${say}」`, rule: v.text } : v;
}

/** 规则写的那一版：AI 配台词时，按这个意思说 */
export function ruleEncounter(w: World, e: Encounter): EncounterView {
  if (e.kind === 'event') return eventView(w, e);
  const n = w.people[e.who];
  const g = n.mind.goal;
  const N = n.name;
  const known = w.knows.includes(`goal:${n.id}`) || !g?.secret;
  switch (e.kind) {
    case 'attack': {
      const item = String(e.vars.item ?? '');
      const IN = itemName(item);
      const throne = g?.kind === 'throne';
      const title = item ? `${N}拦住了你` : throne ? `${N}来夺位` : `${N}来寻仇`;
      const text = item ? `${N}挡在路上：「把你身上的${IN}交出来。」`
        : throne ? `${N}拔出了兵器：「${SECT_NAME[g!.target as SectId]}的位子，该换人坐了。」`
        : `${N}${g?.secret && !known ? '突然出手' : '找到了你'}：「${g?.secret && !known ? '……' : '今天就是你的死期。'}」`;
      return { who: n.id, title, text, choices: [
        { label: '迎战', hint: `胜算约 ${odds(w, n)}` }, { label: '逃', hint: '跑得掉就躲过今年' },
        item ? { label: `交出${IN}`, disabled: !w.me.items.includes(item) } : throne ? { label: '让位', hint: '保住性命，宗门交给他' } : { label: '求和', disabled: has(n, 'grudge') || aff(n, ME) < -70 },
      ] };
    }
    case 'bid': {
      const item = String(e.vars.item ?? '');
      const price = bidPrice(w, n, item);
      return { who: n.id, title: `${N}想买你的${itemName(item)}`, text: `${N}：「${itemName(item)}在你手上吧？${price}灵石，卖给我如何？」`, choices: [
        { label: '卖', hint: `得 ${price} 灵石`, disabled: !w.me.items.includes(item) }, { label: '不卖' },
      ] };
    }
    case 'plot': {
      const sect = n.sect as SectId;
      const M = nm(w, w.sects[sect]?.master ?? '');
      return { who: n.id, title: `${N}找你说句话`, text: `${N}压低了声音：「${M}不在山上。${SECT_NAME[sect]}也该换个主人了——你站哪边？」`, choices: [
        { label: '站你这边', hint: '他夺位时算你一份' }, { label: `去告诉${M}` }, { label: '装没听见' },
      ] };
    }
    case 'call':
      return { who: n.id, title: `${N}来约你`, text: `${N}：「时候到了。今年跟我去${placeName(n.plan.place)}，${g?.kind === 'revenge' ? `找${targetName(w, g)}算账` : `取${targetName(w, g!)}`}。」`, choices: [
        { label: '同去', hint: `去${placeName(n.plan.place)}` }, { label: '推脱' }, { label: '把这事告诉对方', disabled: g?.kind !== 'revenge' },
      ] };
    case 'betray':
      return { who: n.id, title: `${N}翻脸了`, text: `东西到手，${N}看你的眼神变了：「这东西，只能有一个主人。」`, choices: [{ label: '迎战', hint: `胜算约 ${odds(w, n)}` }, { label: '认了' }] };
    case 'share':
      return { who: n.id, title: `${N}来分东西`, text: `${N}没有食言，带着说好的那一份来找你。`, choices: [{ label: '收下' }] };
    case 'confess':
      return { who: n.id, title: `${N}有话想说`, text: `${N}犹豫了很久：「我……想和你结为道侣。」`, choices: [{ label: '答应', disabled: !!w.me.partner }, { label: '婉拒' }] };
    case 'ask': {
      const cover = g?.kind === 'treasure' ? '陪我下一趟玄冥洞府，采一味药' : '帮我教训一个人';
      const real = g?.kind === 'treasure' ? `陪我去玄冥洞府取${targetName(w, g)}` : `帮我找${targetName(w, g!)}报仇`;
      return { who: n.id, title: `${N}想请你帮忙`, text: `${N}：「${known ? real : cover}，好处少不了你的。」`, choices: [{ label: '答应' }, { label: '拒绝' }, { label: '追问到底', disabled: known }] };
    }
    case 'apprentice':
      return { who: n.id, title: `${N}想拜你为师`, text: `${N}跪在你面前：「久仰前辈大名，求前辈收我为徒！」`, choices: [{ label: '收下' }, { label: '婉拒' }] };
    case 'teach':
      return { who: n.id, title: `${N}看中了你`, text: `${N}打量了你很久：「你的根骨不错。愿不愿意跟我修行？」`, choices: [{ label: '拜师' }, { label: '婉拒' }] };
    case 'tip': {
      const who = String(e.vars.key).slice(7);
      return { who: n.id, title: `${N}有话告诉你`, text: `${N}压低了声音：「${secretLine(w, who)}」`, choices: [{ label: '记下了' }] };
    }
    case 'duel':
      return { who: n.id, title: `${N}找你比斗`, text: `${N}：「听说你有点本事？跟我过两招。」`, choices: [{ label: '应战', hint: `胜算约 ${odds(w, n)}` }, { label: '认输' }] };
  }
  return { who: n.id, title: N, text: '', choices: [{ label: '……' }] };
}

const odds = (w: World, n: Npc) => { const a = power(w.me), b = power(n); return `${Math.round(a * a / (a * a + b * b) * 100)}%`; };

/** 处理眼前这件找上门的事 */
export function choose(w: World, idx: number): string {
  const e = w.pending[0];
  if (!e) return '';
  // 冲着你身上东西来的人，发现东西已经不在你身上了
  const wanted = String(e.vars.item ?? '');
  if (wanted && (e.kind === 'bid' || e.kind === 'attack') && !w.me.items.includes(wanted)) {
    w.pending.shift();
    return `${nm(w, e.who)}发现你身上已经没有${itemName(wanted)}了，悻悻地走了。`;
  }
  const view = viewEncounter(w, e);
  if (view.choices[idx]?.disabled) return '';
  w.pending.shift();
  if (e.kind === 'event') return withRng(w, (rng) => resolveEvent(w, e, idx, rng));
  touch(w, e.who, TOUCH.encounter);
  const n = w.people[e.who];
  const g = n.mind.goal;
  return withRng(w, (rng) => {
    const done = () => { w.flags[`done:${n.id}`] = w.year; };
    switch (e.kind) {
      case 'attack': {
        done();
        const item = String(e.vars.item ?? '');
        const rob = !!item;
        const throne = g?.kind === 'throne' ? (g.target as SectId) : null;
        if (idx === 1) {
          if (rng.chance(power(w.me) >= power(n) ? 0.8 : 0.5)) return '你借着地形甩开了对方。今年躲过去了。';
        }
        if (idx === 2) {
          if (rob) { handOver(w, n, item); return `你交出了${itemName(item)}。${n.name}拿了就走。`; }
          if (throne) { yieldSeat(w, n, throne); return `你让出了${SECT_NAME[throne]}的位子。${n.name}收起了兵器。`; }
          adjust(n, ME, { aff: 25 });
          if (rng.chance(0.4 + aff(n, ME) / 200)) { if (g) finish(w, n, 'fail'); remember(w, n, { k: 'talk_good', a: ME, b: n.id, tone: 1 }); return `你低头认了错。${n.name}盯着你看了半天，收起了兵器。`; }
          return `${n.name}冷笑一声：「晚了。」`;
        }
        // 抢东西的人只有阴狠的才下死手；寻仇、夺位是拼命
        const r = fight(w, w.me, n, rng, { lethal: !rob || has(n, 'cruel') });
        if (r.win === w.me) {
          if (r.killed) { killed(w, ME, n.id, rng); news(w, `${n.name}${rob ? '拦路抢夺' : '向' + w.me.name + '寻仇'}，反被${w.me.name}所杀。`, 'bad', [ME, n.id], true); return `一番死斗，${n.name}倒在了你的剑下。`; }
          remember(w, n, { k: 'hurt', a: ME, b: n.id, tone: -2 });
          if (g?.kind === 'revenge') { g.step = 1; g.stuck = 0; }
          if (throne) {
            n.sect = '';
            finish(w, n, 'fail');
            news(w, `${n.name}行刺${w.me.name}失手，叛出了${SECT_NAME[throne]}。`, 'bad', [n.id, ME], true);
            return `你打退了${n.name}。${ta(w, n.id)}再也回不了${SECT_NAME[throne]}了。`;
          }
          return `你打退了${n.name}，${ta(w, n.id)}带着伤逃走了。`;
        }
        if (r.killed) { news(w, `${w.me.name}死在${n.name}手里。`, 'bad', [ME, n.id], true); if (g) finish(w, n, 'ok'); return ''; }
        if (rob && w.me.items.includes(item)) { handOver(w, n, item); return `你输了，伤得不轻，${itemName(item)}被抢走了。`; }
        if (throne) { yieldSeat(w, n, throne); return `你输了，伤得不轻。${n.name}坐上了${SECT_NAME[throne]}的位子。`; }
        return `你输了，伤得不轻，${n.name}以为你活不成了，扬长而去。`;
      }
      case 'bid': {
        done();
        const item = String(e.vars.item ?? '');
        if (idx === 0 && w.me.items.includes(item)) {
          const price = bidPrice(w, n, item);
          n.stones -= price; w.me.stones += price;
          handOver(w, n, item);
          remember(w, n, { k: 'help', a: ME, b: n.id, tone: 1 });
          news(w, `${w.me.name}把${itemName(item)}卖给了${n.name}。`, item === 'sword' ? 'story' : 'info', [ME, n.id], item === 'sword');
          return `${n.name}数出 ${price} 灵石，收下了${itemName(item)}。`;
        }
        w.flags[`bidno:${n.id}`] = Number(w.flags[`bidno:${n.id}`] ?? 0) + 1;
        remember(w, n, { k: 'refuse', a: ME, b: n.id, tone: -1 });
        return has(n, 'cruel') || has(n, 'cunning') ? `${n.name}笑了笑：「那就算了。」笑意没到眼睛里。` : `${n.name}叹了口气，走了。`;
      }
      case 'plot': {
        done();
        const sect = n.sect as SectId;
        const mid = w.sects[sect]?.master ?? '';
        if (!w.knows.includes(`goal:${n.id}`)) w.knows.push(`goal:${n.id}`);
        if (idx === 0) {
          w.flags[`plot:${n.id}`] = 'me';
          remember(w, n, { k: 'ally', a: ME, b: n.id, tone: 2 });
          return `你点了点头。${n.name}眯起眼：「好。等着看吧。」`;
        }
        if (idx === 1) {
          w.flags[`plot:${n.id}`] = 'no';
          const m = w.people[mid];
          if (m?.alive) remember(w, m, { k: 'save', a: ME, b: m.id, tone: 3 });
          remember(w, n, { k: 'betray', a: ME, b: n.id, tone: -3 });
          n.sect = '';
          if (g) finish(w, n, 'fail');
          news(w, `${n.name}夺位的图谋败露，叛出了${SECT_NAME[sect]}。`, 'bad', [n.id, mid, ME], true);
          if (has(n, 'grudge')) setGoal(w, n, { kind: 'revenge', target: ME, secret: true, cover: '闭门苦修', step: 1 });
          return `你把这事告诉了${nm(w, mid)}。${n.name}连夜下了山，临走前看了你一眼。`;
        }
        w.flags[`plot:${n.id}`] = 'quiet';
        return '你装作没听懂。这事和你无关——至少眼下是。';
      }
      case 'call': {
        if (idx !== 1) done();
        // 等你到了，事情已经变了：仇人死了，或者东西早被人取走了
        if (g?.kind === 'revenge' && !being(w, g.target!)?.alive) { finish(w, n, 'fail'); return '那人已经不在了。这件事，就这么了了。'; }
        if (g?.kind === 'treasure' && w.treasure[g.target!] !== 'cave') { g.ally = undefined; return `${n.name}叹了口气：「${targetName(w, g)}早被人取走了，不用去了。」`; }
        if (idx === 0 && g) {
          w.me.place = n.plan.place;
          if (g.kind === 'revenge') {
            const t = w.people[g.target!];
            if (!t?.alive) return '到了地方，那人已经不在了。';
            const r = fight(w, n, t, rng, { lethal: true, ambush: 1.25, helpA: [w.me] });
            remember(w, n, { k: 'help', a: ME, b: n.id, tone: 3 });
            if (r.win === n) {
              if (r.killed) { killed(w, n.id, t.id, rng); remember(w, t, { k: 'hurt', a: ME, b: t.id, tone: -3 }); news(w, `${n.name}和${w.me.name}联手，杀了${t.name}。`, 'bad', [ME, n.id, t.id], true); finish(w, n, 'ok'); return `你和${n.name}联手截住了${t.name}。大仇得报。`; }
              remember(w, t, { k: 'hurt', a: ME, b: t.id, tone: -3 });
              return `${t.name}被你们打成重伤，逃了。`;
            }
            w.me.hp = Math.max(5, w.me.hp - 25);
            if (r.killed) { killed(w, t.id, n.id, rng); return `${n.name}死在了${t.name}手里，你拼死才逃出来。`; }
            g.step = 1;
            return `你们没打过${t.name}，各自带伤逃走。`;
          }
          const r = delve(w, n, rng, g.target!, w.me);
          w.me.hp = Math.max(5, w.me.hp - 20);
          if (r === 'found') {
            g.step = 3; g.stuck = 0;
            remember(w, n, { k: 'help', a: ME, b: n.id, tone: 2 });
            news(w, `${n.name}和${w.me.name}从玄冥洞府带出了${targetName(w, g)}。`, 'story', [ME, n.id], true);
            return `你们在洞府深处拿到了${targetName(w, g)}。${n.name}收了起来：「回头分你的那份。」`;
          }
          if (r === 'died') return `${n.name}没能从洞府深处出来。你拖着伤逃了回来。`;
          // 退回去重新准备；要再请你帮忙，得等下回当面开口
          g.ally = undefined; g.step = 1; g.stuck = 0;
          remember(w, n, { k: 'help', a: ME, b: n.id, tone: 1 });
          return '洞府深处守着的东西太凶，你们都带了伤，只能退了出来。';
        }
        if (idx === 2 && g?.target) {
          const t = w.people[g.target];
          remember(w, t, { k: 'save', a: ME, b: t.id, tone: 3 });
          remember(w, n, { k: 'betray', a: ME, b: n.id, tone: -3, from: t.id });
          g.ally = undefined; g.step = 2;
          return `你把${n.name}的打算告诉了${t?.name}。${t?.name}欠你一个人情，${n.name}迟早会知道。`;
        }
        remember(w, n, { k: 'refuse', a: ME, b: n.id, tone: -2 });
        if (g) { g.ally = undefined; }
        return `你推脱了。${n.name}一个人去了。`;
      }
      case 'betray': {
        done();
        if (g) finish(w, n, 'ok');
        if (idx === 0) {
          const r = fight(w, w.me, n, rng, { lethal: false });
          if (r.win === w.me && g?.target && w.treasure[g.target] === n.id) { moveTreasure(w, g.target, n.id, ME); return `你打赢了，把${ITEMS[g.target].name}夺了回来。`; }
          return '你没打过，眼睁睁看着对方走了。';
        }
        return '你认了。这笔账先记着。';
      }
      case 'share': {
        done();
        const s = Math.min(n.stones, 60);
        n.stones -= s; w.me.stones += s;
        if (g) finish(w, n, 'ok');
        return `${n.name}分给你 ${s} 灵石。`;
      }
      case 'confess': {
        if (idx === 0 && !w.me.partner) {
          n.partner = ME; w.me.partner = n.id;
          remember(w, n, { k: 'partner', a: ME, b: n.id, tone: 3 });
          if (g) finish(w, n, 'ok');
          news(w, `${w.me.name}与${n.name}结为道侣。`, 'good', [ME, n.id], true);
          return `你们结为道侣。`;
        }
        remember(w, n, { k: 'reject', a: ME, b: n.id, tone: -2 });
        if (g) finish(w, n, 'fail');
        if (has(n, 'grudge')) adjust(n, ME, { aff: -40 });
        return `${n.name}低下头，转身走了。`;
      }
      case 'ask': {
        if (idx === 2) {
          if (op(n, ME).trust >= 55 || rng.chance(0.4)) { w.knows.push(`goal:${n.id}`); w.pending.unshift(e); return `${n.name}叹了口气，说了实话。`; }
          remember(w, n, { k: 'talk_bad', a: ME, b: n.id, tone: -1 });
          w.pending.unshift(e);
          return `${n.name}不肯多说。`;
        }
        if (idx === 0 && g) {
          g.ally = ME; g.step++; g.stuck = 0;
          remember(w, n, { k: 'ally', a: ME, b: n.id, tone: 1 });
          return `你答应了。到了动手那年，${n.name}会来找你。`;
        }
        remember(w, n, { k: 'refuse', a: ME, b: n.id, tone: -1 });
        return '你拒绝了。';
      }
      case 'teach':
        if (idx === 0) {
          w.me.master = n.id;
          remember(w, n, { k: 'master', a: n.id, b: ME, tone: 2 });
          news(w, `${n.name}收${w.me.name}为徒。`, 'good', [ME, n.id], true);
          return `你拜${n.name}为师。和师父在一处修炼，会快不少。`;
        }
        return '你婉拒了。';
      case 'apprentice':
        if (idx === 0) {
          n.mind.op[ME] ??= { aff: 35, trust: 35, fear: 0 };
          op(n, ME).aff = Math.max(op(n, ME).aff, 35); op(n, ME).trust = Math.max(op(n, ME).trust, 35);
          takeDisciple(w, n);
          return `你收下了${n.name}。和徒弟在一处时，可以给${ta(w, n.id)}传功。`;
        }
        adjust(n, ME, { aff: -5 });
        return `${n.name}失望地走了。`;
      case 'tip':
        if (!w.knows.includes(String(e.vars.key))) w.knows.push(String(e.vars.key));
        return '你把这件事记在了心里。';
      case 'duel': {
        if (idx === 1) { adjust(n, ME, { aff: 5 }); remember(w, n, { k: 'talk_good', a: ME, b: n.id, tone: 0 }); return `你认了输。${n.name}哈哈一笑，走了。`; }
        const r = fight(w, w.me, n, rng, { lethal: false });
        gainExp(w.me, 15);
        if (r.win === w.me) { adjust(n, ME, { aff: has(n, 'bold') ? 15 : -5, fear: 10 }); witness(w, n.place, { k: 'spar', a: ME, b: n.id, tone: 0 }); return `你赢了。${has(n, 'bold') ? `${n.name}反倒对你另眼相看。` : `${n.name}黑着脸走了。`}`; }
        adjust(n, ME, { aff: 5 });
        return `你输了，受了点伤。${n.name}：「还得练。」`;
      }
    }
    return '';
  });
}

/** 上门求购时出的价：出不起全价就出身上有的 */
function bidPrice(w: World, n: Npc, item: string) {
  return Math.max(50, Math.min(n.stones, BID[item] ?? 200));
}

/** 把身上的东西交给对方：宝物换手；延寿丹当场服下；对方的目标跟着往前走 */
function handOver(w: World, n: Npc, item: string) {
  if (item === 'sword' || item === 'letter') moveTreasure(w, item, ME, n.id);
  else if (takeItem(w.me, item)) n.items.push(item);
  else return;
  const g = n.mind.goal;
  if (item === 'letter' && n.id === 'wen') {
    moveTreasure(w, 'letter', 'wen', 'gone');
    news(w, '云鹤遗书落到温玄手里，当夜就烧成了灰。', 'story', ['wen'], true);
  }
  if (item === 'life' && g?.kind === 'longevity') { useLife(w, n); finish(w, n, 'ok'); }
  else if (g?.kind === 'treasure' && g.target === item) finish(w, n, 'ok');
}

/** 夺位的人赢了：你让出宗主之位，人还留在宗门里 */
function yieldSeat(w: World, n: Npc, sect: SectId) {
  if (w.sects[sect].master !== ME) return;
  w.sects[sect].master = n.id;
  if (n.mind.goal?.kind === 'throne') finish(w, n, 'ok');
  news(w, `${n.name}逼${w.me.name}让出了${SECT_NAME[sect]}${sect === 'qinglan' ? '宗主' : '门主'}之位。`, 'bad', [n.id, ME], true);
}

/**
 * 闭关几年：每年都在这里修炼（修为圆满就冲关），世界照常转。
 * 有人找上门就停下来，让你自己处理。返回实际闭关了几年。
 */
export function retreat(w: World, years: number) {
  let n = 0;
  for (let i = 0; i < years && w.phase === 'year'; i++) {
    if (!w.turn.moved) moveTo(w, w.me.place, { quiet: true });
    if (w.pending.length) break;
    if (!w.turn.main) doMain(w, canBreak(w.me) ? (w.me.items.includes('pill') ? 'pill' : 'seclude') : 'cultivate');
    if (w.phase !== 'year') break;
    endYear(w);
    n++;
  }
  return n;
}

/** 结束这一年：没选地方就留在原地 */
export function endTurn(w: World) {
  if (w.phase !== 'year' || w.pending.length) return false;
  if (!w.turn.moved) moveTo(w, w.me.place, { quiet: true });
  if (w.pending.length) return false;
  endYear(w);
  return true;
}

export { being, goalText, nm };
