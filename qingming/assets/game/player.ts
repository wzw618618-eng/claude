// 主角能做的事：去哪、做什么主事、和在场的人打交道、处理找上门的事。
// 每个函数都直接改世界，并返回一句结果给界面看。

import { makeRng, type Rng } from './core/rng';
import type { Encounter, Npc, PlaceId, World } from './core/types';
import {
  adjust, aff, being, has, ME, news, nm, npc, op, placeName, power, realmText, takeItem, ta,
} from './core/world';
import { ITEMS, REALMS, SECT_NAME } from './data/world-data';
import { PERSON } from './data/people';
import { delve, finish, GOALS, goalText, killed, moveTreasure, setGoal, targetName, useLife } from './mind/goals';
import { describe, remember, witness } from './mind/memory';
import { beast, checkEnd, endYear } from './systems/year';
import { canBreak, fight, gainExp, tryBreak, yearExp } from './systems/body';

/** 用世界里的随机数做一件事，做完把随机数状态存回去 */
function withRng<T>(w: World, f: (rng: Rng) => T): T {
  const rng = makeRng(w.rng);
  const r = f(rng);
  w.rng = rng.state();
  checkEnd(w);
  return r;
}

// ───────────── 去哪 ─────────────

/** 今年去哪。到了之后，冲着你来的人会找上门 */
export function moveTo(w: World, place: PlaceId) {
  if (w.phase !== 'year' || w.turn.moved) return false;
  w.me.place = place;
  w.turn.moved = true;
  withRng(w, (rng) => { w.pending = encounters(w, rng); });
  return true;
}

// ───────────── 主事 ─────────────

export type MainAct = 'cultivate' | 'seclude' | 'adventure' | 'work';
export function mainActs(w: World): { id: MainAct; label: string; hint: string; ok: boolean }[] {
  const at = w.me.place;
  const work = at === 'market' ? '在坊市跑腿，挣些灵石' : w.me.sect === at ? '替宗门办事，攒功劳和灵石' : at === 'village' ? '帮村民做事，攒下名声' : '打些零工';
  return [
    { id: 'cultivate', label: '修炼', hint: `修为约 +${Math.round(yearExp(w, w.me, at))}`, ok: w.me.realm < 4 },
    { id: 'seclude', label: '闭关冲关', hint: canBreak(w.me) ? `冲击${REALMS[w.me.realm + 1]}` : '修为圆满才能冲关', ok: canBreak(w.me) },
    { id: 'adventure', label: '历练', hint: at === 'cave' ? '机缘多，危险也多' : at === 'forest' ? '和妖兽打一场' : '四处走走，碰碰运气', ok: true },
    { id: 'work', label: '做事', hint: work, ok: true },
  ];
}

export function doMain(w: World, act: MainAct): string {
  if (w.phase !== 'year' || !w.turn.moved || w.turn.main) return '';
  w.turn.main = true;
  const me = w.me;
  return withRng(w, (rng) => {
    if (act === 'cultivate') {
      const before = realmText(me);
      gainExp(me, yearExp(w, me, me.place));
      return before === realmText(me) ? '闭门修炼了一年，修为又进了一步。' : `修炼一年，境界到了${realmText(me)}。`;
    }
    if (act === 'seclude') {
      const r = tryBreak(w, me, rng);
      if (!r) return '修为还不够圆满。';
      if (r.ok) {
        news(w, `${me.name}闭关出关，突破到了${REALMS[me.realm]}。`, 'good', [ME], me.realm >= 2);
        for (const x of Object.values(w.people)) if (x.alive && x.place === me.place) remember(w, x, { k: 'talk_good', a: ME, b: x.id, tone: 0 });
        return `${r.pill ? '服下破境丹，' : ''}闭关一年，破境成功：${REALMS[me.realm]}！寿元涨了。`;
      }
      return `${r.pill ? '服下破境丹，' : ''}冲关失败，受了内伤，修为跌了一截。`;
    }
    if (act === 'adventure') {
      if (me.place === 'cave') {
        for (const item of ['letter', 'sword']) {
          if (w.treasure[item] === 'cave' && rng.chance(item === 'letter' ? 0.35 : 0.5)) {
            const r = delve(w, me, rng, item);
            if (r === 'found') {
              if (item === 'letter') { w.knows.push('secret:wen'); news(w, `${me.name}在玄冥洞府深处找到一具白骨，压着一封遗书。`, 'story', [ME], true); return '洞府深处有一具白骨，手里压着一封信：署名「云鹤」。信里写着，三十年前是师弟温玄把他丢在这里的。'; }
              news(w, `${me.name}从玄冥洞府深处带出了玄冥剑。`, 'story', [ME], true);
              witness(w, 'cave', { k: 'rob', a: ME, b: 'cave', tone: 0 });
              return '洞府最深处，一柄黑剑插在石台上。你拔出了玄冥剑。';
            }
            if (r === 'died') return '';
            return `你摸到了洞府深处，被守在那里的东西打伤，只能退了出来。`;
          }
        }
      }
      const [lo, hi] = me.place === 'cave' ? [2, 12] : me.place === 'forest' ? [0.5, 5] : [0.3, 2];
      const r = beast(w, me, rng, lo, hi);
      if (!me.alive) return '';
      if (r.win) return `打退了一头妖兽，得了 ${r.loot} 灵石${r.item ? `和一颗${ITEMS[r.item].name}` : ''}。`;
      return '遇上一头凶兽，没打过，带伤逃了回来。';
    }
    // 做事
    if (me.place === 'market') { const g = rng.int(25, 45); me.stones += g; return `在坊市跑了一年腿，挣了 ${g} 灵石。`; }
    if (me.sect && me.sect === me.place) { me.merit += 10; me.stones += 20; gainExp(me, yearExp(w, me, me.place, 0.3)); return '替宗门办了一年差事，功劳 +10，领了 20 灵石。'; }
    if (me.place === 'village') {
      me.stones += 5;
      witness(w, 'village', { k: 'help', a: ME, b: 'village', tone: 2 });
      news(w, `${me.name}在柳溪村帮村民修渠、驱兽，村里人都念着好。`, 'good', [ME]);
      return '帮村里修渠、赶走了偷鸡的狐妖。村民塞给你 5 块灵石，在场的人都看在眼里。';
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
  if (item === 'life' && w.me.items.includes('life')) { useLife(w, w.me); return '服下延寿丹，寿元多了三十年。'; }
  return '';
}

// ───────────── 打交道 ─────────────

export type SocialKind = 'chat' | 'news' | 'goal' | 'teach' | 'gift' | 'spar' | 'provoke' | 'master' | 'partner' | 'join' | 'ally' | 'tell';

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
      gainExp(w.me, yearExp(w, w.me, w.me.place, 0.35));
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
      const ok = o.aff >= 30 || rng.chance(0.25 + w.me.talent * 0.15);
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
  }
  return { ok: false, text: '' };
}

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
    // 冲着你来的：报仇、抢东西——在哪都找得到你
    if (n.plan.target === ME && (n.plan.scheme === 'ambush' || n.plan.scheme === 'rob')) { n.place = me.place; out.push({ id: `attack:${n.id}`, kind: 'attack', who: n.id, vars: {} }); continue; }
    if (g?.ally === ME && ((g.kind === 'revenge' && g.step === 3) || (g.kind === 'treasure' && g.step === 2))) { out.push({ id: `call:${n.id}`, kind: 'call', who: n.id, vars: {} }); continue; }
    if (g?.ally === ME && g.kind === 'treasure' && g.step === 3) { out.push({ id: `${n.plan.scheme === 'betray' ? 'betray' : 'share'}:${n.id}`, kind: n.plan.scheme === 'betray' ? 'betray' : 'share', who: n.id, vars: {} }); continue; }
    if (n.place !== me.place || !o) continue;
    if (g?.kind === 'love' && g.target === ME && g.step === 2) { out.push({ id: `confess:${n.id}`, kind: 'confess', who: n.id, vars: {} }); continue; }
    if (g && !g.ally && ((g.kind === 'revenge' && g.step === 2) || (g.kind === 'treasure' && g.step === 1 && n.plan.scheme === 'ally')) && o.aff >= 15 && o.trust >= 30 && g.target !== ME) { out.push({ id: `ask:${n.id}`, kind: 'ask', who: n.id, vars: {} }); continue; }
    if (n.realm >= me.realm + 1 && o.aff >= 45 && !me.master && !has(n, 'lonely') && rng.chance(0.5)) { out.push({ id: `teach:${n.id}`, kind: 'teach', who: n.id, vars: {} }); continue; }
    const secret = n.mind.knows.find((k) => k.startsWith('secret:') && !w.knows.includes(k) && k !== `secret:${n.id}`);
    if (secret && o.aff >= 30 && o.trust >= 45 && rng.chance(0.4)) { out.push({ id: `tip:${n.id}`, kind: 'tip', who: n.id, vars: { key: secret } }); continue; }
    const ratio = power(n) / power(me);
    if ((has(n, 'proud') || has(n, 'rash')) && ratio > 0.6 && ratio < 1.6 && o.aff <= 10 && rng.chance(0.3)) out.push({ id: `duel:${n.id}`, kind: 'duel', who: n.id, vars: {} });
  }
  const rank = ['attack', 'betray', 'call', 'confess', 'ask', 'share', 'teach', 'tip', 'duel'];
  out.sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind));
  return out.slice(0, 2);
}

/** 找上门的事怎么显示：AI 替来人说了话（vars.say），就用 AI 的话，选项照旧 */
export function viewEncounter(w: World, e: Encounter): EncounterView {
  const v = ruleEncounter(w, e);
  const say = typeof e.vars.say === 'string' ? e.vars.say : '';
  return say ? { ...v, text: `${w.people[e.who].name}：「${say}」`, rule: v.text } : v;
}

/** 规则写的那一版：AI 配台词时，按这个意思说 */
export function ruleEncounter(w: World, e: Encounter): EncounterView {
  const n = w.people[e.who];
  const g = n.mind.goal;
  const N = n.name;
  const known = w.knows.includes(`goal:${n.id}`) || !g?.secret;
  switch (e.kind) {
    case 'attack': {
      const rob = n.plan.scheme === 'rob';
      return { who: n.id, title: rob ? `${N}拦住了你` : `${N}来寻仇`, text: rob ? `${N}挡在路上：「把你身上的延寿丹交出来。」` : `${N}${g?.secret && !known ? '突然出手' : '找到了你'}：「${g?.secret && !known ? '……' : '今天就是你的死期。'}」`, choices: [
        { label: '迎战', hint: `胜算约 ${odds(w, n)}` }, { label: '逃', hint: '跑得掉就躲过今年' }, { label: rob ? '交出延寿丹' : '求和', disabled: rob ? !w.me.items.includes('life') : has(n, 'grudge') || aff(n, ME) < -70 },
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
  const view = viewEncounter(w, e);
  if (view.choices[idx]?.disabled) return '';
  w.pending.shift();
  const n = w.people[e.who];
  const g = n.mind.goal;
  return withRng(w, (rng) => {
    const done = () => { w.flags[`done:${n.id}`] = w.year; };
    switch (e.kind) {
      case 'attack': {
        done();
        const rob = n.plan.scheme === 'rob';
        if (idx === 1) {
          if (rng.chance(power(w.me) >= power(n) ? 0.8 : 0.5)) return '你借着地形甩开了对方。今年躲过去了。';
        }
        if (idx === 2) {
          if (rob) { moveTreasureLife(w, n); if (g) finish(w, n, 'ok'); return `你交出了延寿丹。${n.name}拿了就走。`; }
          adjust(n, ME, { aff: 25 });
          if (rng.chance(0.4 + aff(n, ME) / 200)) { if (g) finish(w, n, 'fail'); remember(w, n, { k: 'talk_good', a: ME, b: n.id, tone: 1 }); return `你低头认了错。${n.name}盯着你看了半天，收起了兵器。`; }
          return `${n.name}冷笑一声：「晚了。」`;
        }
        const r = fight(w, w.me, n, rng, { lethal: true });
        if (r.win === w.me) {
          if (r.killed) { killed(w, ME, n.id, rng); news(w, `${n.name}向${w.me.name}寻仇，反被${w.me.name}所杀。`, 'bad', [ME, n.id], true); return `一番死斗，${n.name}倒在了你的剑下。`; }
          remember(w, n, { k: 'hurt', a: ME, b: n.id, tone: -2 });
          if (g?.kind === 'revenge') { g.step = 1; g.stuck = 0; }
          return `你打退了${n.name}，${ta(w, n.id)}带着伤逃走了。`;
        }
        if (r.killed) { news(w, `${w.me.name}死在${n.name}手里。`, 'bad', [ME, n.id], true); if (g) finish(w, n, 'ok'); return ''; }
        if (rob && takeItem(w.me, 'life')) { n.items.push('life'); useLife(w, n); if (g) finish(w, n, 'ok'); }
        return `你输了，伤得不轻，${rob ? '延寿丹被抢走了' : `${n.name}以为你活不成了，扬长而去`}。`;
      }
      case 'call': {
        if (idx !== 1) done();
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
          const r = delve(w, n, rng, g.target!, undefined);
          const r2 = r === 'found' ? r : delve(w, w.me, rng, g.target!);
          if (r2 === 'found') {
            if (w.treasure[g.target!] === ME) moveTreasure(w, g.target!, ME, n.id);
            g.step = 3; g.stuck = 0;
            remember(w, n, { k: 'help', a: ME, b: n.id, tone: 2 });
            news(w, `${n.name}和${w.me.name}从玄冥洞府带出了${targetName(w, g)}。`, 'story', [ME, n.id], true);
            return `你们在洞府深处拿到了${targetName(w, g)}。${n.name}收了起来：「回头分你的那份。」`;
          }
          return '洞府深处守着的东西太凶，你们只能退了出来。';
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

function moveTreasureLife(w: World, n: Npc) {
  if (takeItem(w.me, 'life')) { n.items.push('life'); useLife(w, n); }
}

/**
 * 闭关几年：每年都在这里修炼（修为圆满就冲关），世界照常转。
 * 有人找上门就停下来，让你自己处理。返回实际闭关了几年。
 */
export function retreat(w: World, years: number) {
  let n = 0;
  for (let i = 0; i < years && w.phase === 'year'; i++) {
    if (!w.turn.moved) moveTo(w, w.me.place);
    if (w.pending.length) break;
    if (!w.turn.main) doMain(w, canBreak(w.me) ? 'seclude' : 'cultivate');
    if (w.phase !== 'year') break;
    endYear(w);
    n++;
  }
  return n;
}

/** 结束这一年：没选地方就留在原地 */
export function endTurn(w: World) {
  if (w.phase !== 'year' || w.pending.length) return false;
  if (!w.turn.moved) moveTo(w, w.me.place);
  if (w.pending.length) return false;
  endYear(w);
  return true;
}

export { being, goalText, nm };
