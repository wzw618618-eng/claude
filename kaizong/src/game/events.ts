// 突发事件和奇遇。宗门层面的事要宗主拍板；个人的奇遇直接发生，写进经历。
// 每季：宗门大事最多一件，个人奇遇两三件；外出历练的人奇遇多。

import { atBottleneck, power, REALM_NAME, stepUp, yearsLeft } from './cult';
import { addDecision, drift, setEventResolver } from './decisions';
import { SKILL_NAME, SKILLS } from './data/world';
import { makeCandidate, insight } from './recruit';
import { resolveRivalEvent } from './rivals';
import type { Rng } from './rng';
import type { Decision, Person, World } from './types';
import { addLife, adjust, clamp, disp, everyone, hasTrait, members, P, pronoun, report } from './world';

type Opt = { id: string; label: string; hint?: string };
interface SectEvent {
  id: string;
  weight(w: World): number;
  /** 发生时：返回给宗主的选择；或者直接结算（返回 null） */
  start(w: World, r: Rng): { title: string; text: string; options: Opt[]; params?: Record<string, string | number>; fallback: string; about?: string[] } | null;
  resolve?(w: World, r: Rng, x: Record<string, string | number>, o: string): void;
}

const strongest = (w: World, n = 3) => [...members(w)].sort((a, b) => power(b) - power(a)).slice(0, n);
const weakest = (w: World, n = 3) => [...members(w)].filter((p) => p.rank !== 'probation').sort((a, b) => power(a) - power(b)).slice(0, n);
const names = (ps: Person[]) => ps.map((p) => p.name).join('、');
const rivalAlive = (w: World) => w.rivals.filter((x) => x.alive && !x.passive);

/** 派一队人出去冒险：每人可能得宝、受伤、送命 */
function expedition(w: World, r: Rng, team: Person[], danger: number, prize: string) {
  const lines: string[] = [];
  for (const p of team) {
    const roll = r.next() + power(p) / 400 + disp(p, 'courage') * 0.03;
    if (roll < danger * 0.25) {
      p.alive = false; p.death = `死在${prize}里`;
      addLife(w, p, `死在${prize}里`, 'bad', true);
      lines.push(`${p.name}没能回来`);
    } else if (roll < danger) {
      p.hp = clamp(p.hp - 35, 5, 100);
      addLife(w, p, `闯${prize}受了重伤`, 'bad');
      lines.push(`${p.name}受了伤`);
    } else {
      const gain = r.weighted<'gear' | 'exp' | 'skill' | 'stones'>([['gear', 3], ['exp', 3], ['skill', 2], ['stones', 2]])!;
      if (gain === 'gear') { p.gear += 1; addLife(w, p, `在${prize}里得了一件法宝`, 'good', true); lines.push(`${p.name}得了法宝`); }
      if (gain === 'exp') { p.exp += 40; stepUp(p); addLife(w, p, `在${prize}里得了机缘，修为大进`, 'good', true); lines.push(`${p.name}修为大进`); }
      if (gain === 'skill') { const sk = r.pick(SKILLS); p.caps[sk] = Math.min(100, p.caps[sk] + 10); p.skills[sk] = Math.min(p.caps[sk], p.skills[sk] + 10); addLife(w, p, `在${prize}里悟到了${SKILL_NAME[sk]}的门道`, 'good'); lines.push(`${p.name}${SKILL_NAME[sk]}长进`); }
      if (gain === 'stones') { const n = r.int(40, 120); w.sect.stones += n; lines.push(`${p.name}带回${n}灵石`); }
      p.fame += 3;
    }
  }
  w.members = w.members.filter((id) => P(w, id)?.alive);
  return lines.join('，');
}

const SECT_EVENTS: SectEvent[] = [
  {
    id: 'secret_realm', weight: () => 1,
    start: () => ({ title: '秘境开启', text: '百里外一处上古秘境开启了，各宗都在派人。里面有机缘，也有凶险。', options: [{ id: 'elite', label: '派最强的三人去', hint: '收获大，折损也心疼' }, { id: 'young', label: '派三个新人去历练' }, { id: 'no', label: '不去' }], fallback: 'no' }),
    resolve(w, r, _x, o) {
      if (o === 'no') return;
      const team = o === 'elite' ? strongest(w) : weakest(w);
      const res = expedition(w, r, team, o === 'elite' ? 0.3 : 0.45, '秘境');
      report(w, { text: `派${names(team)}闯秘境：${res}。`, tone: 'story', about: team.map((p) => p.id), big: true });
    },
  },
  {
    id: 'treasure', weight: (w) => rivalAlive(w).length ? 0.8 : 0,
    start: (w, r) => { const rv = r.pick(rivalAlive(w)); return { title: '异宝出世', text: `后山深处夜有宝光，${rv.name}也派人来了。`, options: [{ id: 'fight', label: '争', hint: `可能和${rv.name}结怨` }, { id: 'share', label: '约对方平分' }, { id: 'yield', label: '让给他们' }], params: { rival: rv.id }, fallback: 'yield' }; },
    resolve(w, r, x, o) {
      const rv = w.rivals.find((v) => v.id === x.rival)!;
      if (o === 'fight') {
        const win = r.chance(0.5 + (power(strongest(w, 1)[0]) - 60) / 400);
        rv.attitude -= 12;
        if (win) { const p = strongest(w, 1)[0]; p.gear += 2; w.sect.rep += 5; report(w, { text: `和${rv.name}争宝，赢了。${p.name}得了异宝。`, tone: 'good', about: [p.id], big: true }); w.acts.push({ kind: 'gift', who: p.id, text: `把争来的异宝给了${p.name}` }); }
        else { for (const p of strongest(w, 2)) p.hp = clamp(p.hp - 25, 5, 100); report(w, { text: `和${rv.name}争宝，输了，还伤了人。`, tone: 'bad', about: [] }); }
      } else if (o === 'share') { rv.attitude += 6; w.sect.stones += 80; report(w, { text: `和${rv.name}平分了宝物，换成 80 灵石。`, tone: 'info', about: [] }); }
      else { rv.attitude += 4; w.sect.rep -= 2; }
    },
  },
  {
    id: 'demon_pass', weight: () => 0.8,
    start: () => ({ title: '魔修过境', text: '一伙魔修路过山下，抢了几个村子。', options: [{ id: 'slay', label: '出手除魔', hint: '名望大涨，可能有人受伤' }, { id: 'close', label: '闭山不出' }, { id: 'deal', label: '和他们做笔买卖', hint: '灵石多，但正道会看不起' }], fallback: 'close' }),
    resolve(w, r, _x, o) {
      if (o === 'slay') {
        const team = strongest(w);
        const ok = r.chance(0.65);
        for (const p of team) { if (!ok || r.chance(0.3)) p.hp = clamp(p.hp - 30, 5, 100); p.fame += ok ? 5 : 1; addLife(w, p, ok ? '随队下山除魔' : '下山除魔，铩羽而归', ok ? 'good' : 'bad'); }
        w.sect.rep += ok ? 15 : 3; w.sect.align = clamp(w.sect.align + 8, -100, 100);
        if (ok) w.acts.push({ kind: 'war_win', text: '带人下山除魔' });
        report(w, { text: ok ? `${names(team)}下山除魔，大获全胜，四方传颂。` : `下山除魔，没占到便宜，还伤了人。`, tone: ok ? 'good' : 'bad', about: team.map((p) => p.id), big: ok });
      } else if (o === 'deal') { w.sect.stones += 150; w.sect.align = clamp(w.sect.align - 15, -100, 100); for (const p of members(w)) if (p.values.justice > 0.6) { adjust(p, w.me, -10, -10); p.grudge = clamp(p.grudge + 8, 0, 100); } report(w, { text: '和魔修做了笔买卖，进账 150 灵石。几个正直的弟子很不痛快。', tone: 'bad', about: [] }); }
      else { w.sect.rep -= 3; }
    },
  },
  {
    id: 'kingdom', weight: () => 0.7,
    start: () => ({ title: '凡人王朝求援', text: '山下的凡人王朝闹妖兽，派使者送来厚礼，求宗门出手。', options: [{ id: 'help', label: '派人去', hint: '得灵石和名望' }, { id: 'free', label: '不收钱，白帮', hint: '名望更高' }, { id: 'no', label: '凡人的事不管' }], fallback: 'no' }),
    resolve(w, r, _x, o) {
      if (o === 'no') { w.sect.rep -= 1; return; }
      const team = strongest(w, 2).concat(weakest(w, 1));
      for (const p of team) { p.merit += 10; p.fame += 2; if (r.chance(0.2)) p.hp = clamp(p.hp - 20, 5, 100); addLife(w, p, '下山替凡人王朝除妖兽', 'good'); }
      if (o === 'help') { w.sect.stones += 120; w.sect.rep += 6; } else { w.sect.rep += 12; w.sect.align = clamp(w.sect.align + 5, -100, 100); for (const p of members(w)) if (disp(p, 'kindness') > 0.5) adjust(p, w.me, 5, 5); }
      report(w, { text: `${names(team)}下山除妖兽，凡人感恩戴德。`, tone: 'good', about: team.map((p) => p.id) });
    },
  },
  {
    id: 'vein_decay', weight: (w) => w.sect.site === 'vein' ? 0.6 : 0.3,
    start: () => ({ title: '灵脉衰减', text: '山中灵脉近来灵气变弱，阵法师说要花一笔灵石加固。', options: [{ id: 'fix', label: '花 150 灵石加固' }, { id: 'no', label: '先不管', hint: '收入会降一阵' }], fallback: 'no' }),
    resolve(w, _r, _x, o) {
      if (o === 'fix' && w.sect.stones >= 150) { w.sect.stones -= 150; return; }
      w.sect.veinDebuff = w.t + 8;
      report(w, { text: '灵脉衰减，之后两年收入少两成。', tone: 'bad', about: [] });
    },
  },
  {
    id: 'refugees', weight: () => 0.7,
    start: () => ({ title: '散修求庇护', text: '一群走投无路的散修来到山门，求宗门收留。里面也许有能人，也许有麻烦。', options: [{ id: 'all', label: '都让他们进来，挑一挑' }, { id: 'no', label: '婉拒' }], fallback: 'no' }),
    resolve(w, r, _x, o) {
      if (o !== 'all') return;
      const n = r.int(2, 4);
      for (let i = 0; i < n; i++) w.candidates.push(makeCandidate(w, r, 'walkin', insight(w, 0)));
      w.sect.rep += 3;
      report(w, { text: `收留了${n}个散修，他们在迎客堂等着你挑。`, tone: 'info', about: [] });
    },
  },
  {
    id: 'fair', weight: () => 0.8,
    start: (w) => ({ title: '坊市大会', text: '山下坊市三年一次的大会开了，各家都去摆摊。', options: [{ id: 'sell', label: `拿丹药去卖`, hint: `库里有${Math.floor(w.sect.pills)}颗` }, { id: 'buy', label: '花 200 灵石买一颗筑基丹' }, { id: 'no', label: '不去' }], fallback: 'no' }),
    resolve(w, _r, _x, o) {
      if (o === 'sell') { const n = Math.floor(w.sect.pills * 0.6); w.sect.pills -= n; w.sect.stones += n * 12; w.sect.rep += 2; report(w, { text: `在坊市卖了${n}颗丹药，得${n * 12}灵石。`, tone: 'good', about: [] }); }
      if (o === 'buy' && w.sect.stones >= 200) { w.sect.stones -= 200; w.sect.fpills += 1; report(w, { text: '在坊市买到一颗筑基丹。', tone: 'good', about: [] }); }
    },
  },
  {
    id: 'rival_strife', weight: (w) => rivalAlive(w).length ? 0.6 : 0,
    start: (w, r) => { const rv = r.pick(rivalAlive(w)); return { title: `${rv.name}内乱`, text: `${rv.name}几个长老为争权闹翻了，人心浮动。`, options: [{ id: 'poach', label: '趁机挖人', hint: '多半能拉来一个好手' }, { id: 'raid', label: '趁火打劫，抢他们的灵石', hint: '名望受损' }, { id: 'no', label: '隔岸观火' }], params: { rival: rv.id }, fallback: 'no' }; },
    resolve(w, r, x, o) {
      const rv = w.rivals.find((v) => v.id === x.rival)!;
      if (o === 'poach') {
        const c = makeCandidate(w, r, 'genius', insight(w, 1));
        const p = w.people[c.id];
        p.realm = 1; p.stage = 0; p.age = r.int(40, 80);
        c.claim = `原是${rv.name}的弟子，看不惯宗门内斗`;
        c.via = 'refer';
        w.candidates.push(c);
        rv.attitude -= 8;
        report(w, { text: `从${rv.name}拉来一个筑基修士，在迎客堂等你见。`, tone: 'good', about: [p.id] });
      }
      if (o === 'raid') { w.sect.stones += 120; rv.stones -= 120; rv.attitude -= 20; w.sect.rep -= 8; w.sect.align = clamp(w.sect.align - 5, -100, 100); report(w, { text: `趁${rv.name}内乱抢了 120 灵石，结下了梁子。`, tone: 'bad', about: [] }); }
    },
  },
  {
    id: 'spirit_rain', weight: () => 0.5,
    start: (w) => { for (const p of everyone(w)) { p.exp += 15; stepUp(p); } report(w, { text: '天降灵雨，全宗修为都涨了一截。', tone: 'good', about: [] }); return null; },
  },
  {
    id: 'beasts', weight: () => 0.8,
    start: (w, r) => {
      const guard = members(w).filter((p) => p.job === 'guard');
      const ok = guard.length > 0 && r.chance(0.4 + guard.reduce((t, p) => t + p.skills.combat, 0) / 200);
      if (ok) { for (const p of guard) { p.merit += 8; p.fame += 2; addLife(w, p, '击退下山的妖兽', 'good'); } report(w, { text: `妖兽下山，被巡山队${names(guard)}打退了。`, tone: 'good', about: guard.map((p) => p.id) }); }
      else { const loss = Math.min(w.sect.herbs, 40); w.sect.herbs -= loss; for (const p of guard) p.hp = clamp(p.hp - 25, 5, 100); report(w, { text: `妖兽下山，毁了灵植园${Math.round(loss)}株灵草${guard.length ? '，巡山的人也挂了彩' : '——山上没人巡山'}。`, tone: 'bad', about: guard.map((p) => p.id) }); }
      return null;
    },
  },
  {
    id: 'cave_map', weight: (w) => members(w).length >= 3 ? 0.6 : 0,
    start: (w, r) => { const p = r.pick(members(w)); return { title: '前辈遗府', text: `${p.name}在旧书摊淘到一张前辈遗府的地图。`, options: [{ id: 'go', label: `让${p.name}带两个人去探`, hint: '凶吉难料' }, { id: 'sell', label: '把图卖了，换 60 灵石' }], params: { who: p.id }, fallback: 'sell', about: [p.id] }; },
    resolve(w, r, x, o) {
      const p = P(w, String(x.who));
      if (!p?.alive) return;
      if (o === 'sell') { w.sect.stones += 60; return; }
      const team = [p, ...members(w).filter((q) => q.id !== p.id && (q.ops[p.id]?.aff ?? 0) > 10).slice(0, 2)];
      const res = expedition(w, r, team, 0.35, '前辈遗府');
      report(w, { text: `${p.name}带人探前辈遗府：${res}。`, tone: 'story', about: team.map((q) => q.id), big: true });
    },
  },
  {
    id: 'tournament_invite', weight: (w) => rivalAlive(w).length ? 0.5 : 0,
    start: (w, r) => { const rv = r.pick(rivalAlive(w)); return { title: `${rv.name}办比武大会`, text: `${rv.name}广发请帖，请各宗年轻弟子去比武。`, options: [{ id: 'go', label: '派最强的弟子去' }, { id: 'no', label: '不去', hint: '对方觉得你看不起他们' }], params: { rival: rv.id }, fallback: 'no' }; },
    resolve(w, r, x, o) {
      const rv = w.rivals.find((v) => v.id === x.rival)!;
      if (o === 'no') { rv.attitude -= 4; return; }
      const champ = members(w).filter((p) => p.realm === 0).sort((a, b) => power(b) - power(a))[0] ?? strongest(w, 1)[0];
      if (!champ) return;
      const foe = rv.named.map((id) => P(w, id)!).filter((p) => p?.alive && p.realm === 0).sort((a, b) => power(b) - power(a))[0];
      const win = !foe || r.chance(power(champ) ** 2 / (power(champ) ** 2 + power(foe) ** 2));
      if (win) { champ.fame += 12; w.sect.rep += 10; addLife(w, champ, `在${rv.name}的比武大会上夺魁`, 'good', true); drift(w, r, champ, 'triumph', 0.3); w.acts.push({ kind: 'war_win', text: `派${champ.name}去比武夺魁` }); }
      else { champ.mood = clamp(champ.mood - 15, 0, 100); addLife(w, champ, `在${rv.name}的比武大会上输给了${foe?.name}`, 'bad', true); if (foe) { champ.ops[foe.id] = { aff: -30, respect: 20, tag: 'rival' }; } }
      report(w, { text: win ? `${champ.name}在${rv.name}的比武大会上夺魁，宗门扬名！` : `${champ.name}在${rv.name}的比武大会上输给了${foe?.name}。`, tone: win ? 'good' : 'bad', about: [champ.id], big: win });
    },
  },
  {
    id: 'marriage', weight: (w) => rivalAlive(w).some((r) => r.attitude > -20) ? 0.4 : 0,
    start: (w, r) => {
      const rv = r.pick(rivalAlive(w).filter((x) => x.attitude > -20));
      const p = r.pick(members(w).filter((q) => q.rank !== 'probation'));
      if (!p) return null;
      return { title: '联姻提议', text: `${rv.name}派人来提亲，想让${p.name}和他们宗门的弟子结为道侣。`, options: [{ id: 'yes', label: '答应', hint: `两宗结好；但要看${p.name}自己愿不愿意` }, { id: 'ask', label: `问${p.name}自己的意思` }, { id: 'no', label: '回绝' }], params: { rival: rv.id, who: p.id }, fallback: 'no', about: [p.id] };
    },
    resolve(w, r, x, o) {
      const rv = w.rivals.find((v) => v.id === x.rival)!;
      const p = P(w, String(x.who));
      if (!p?.alive) return;
      const hasLover = Object.values(p.ops).some((v) => v.tag === 'lover');
      const willing = !hasLover && disp(p, 'romance') > -1 && r.chance(0.5);
      if (o === 'no') { rv.attitude -= 5; return; }
      if (o === 'ask' && !willing) { addLife(w, p, '宗主问过意思后，回绝了一门亲事', 'info'); adjust(p, w.me, 8, 5); rv.attitude -= 3; return; }
      rv.attitude += 20;
      if (rv.status === 'hostile' || rv.status === 'neutral') rv.status = 'neutral';
      if (!willing) { p.grudge = clamp(p.grudge + 25, 0, 100); p.loyalty = clamp(p.loyalty - 15, 0, 100); adjust(p, w.me, -25); addLife(w, p, `被宗主许给了${rv.name}的人，心里一百个不愿意`, 'bad', true); if (hasLover) drift(w, r, p, 'heartbreak', 0.6); }
      else { p.mood = clamp(p.mood + 10, 0, 100); addLife(w, p, `与${rv.name}的弟子结为道侣，两宗结好`, 'good', true); }
      report(w, { text: `${p.name}和${rv.name}联姻，两宗关系好了不少。${willing ? '' : `可${p.name}心里并不情愿。`}`, tone: willing ? 'good' : 'story', about: [p.id], big: true });
    },
  },
  {
    id: 'family_visit', weight: (w) => members(w).length ? 0.6 : 0,
    start: (w, r) => {
      const p = r.pick(members(w));
      return { title: `${p.name}的家人找上山`, text: `${p.name}的家人找上山来，说家里出了事，要${pronoun(p)}回去。`, options: [{ id: 'let', label: '准假一年', hint: '他会感激你' }, { id: 'help', label: '派人带 50 灵石去帮衬' }, { id: 'no', label: '修行要紧，不准' }], params: { who: p.id }, fallback: 'no', about: [p.id] };
    },
    resolve(w, _r, x, o) {
      const p = P(w, String(x.who));
      if (!p?.alive) return;
      if (o === 'let') { p.job = 'travel'; p.head = undefined; p.travelUntil = w.t + 4; adjust(p, w.me, 15, 5); p.loyalty = clamp(p.loyalty + 10, 0, 100); addLife(w, p, '家中有事，宗主准假一年回家', 'good'); w.acts.push({ kind: 'gift', who: p.id, text: `准${p.name}回家` }); }
      else if (o === 'help' && w.sect.stones >= 50) { w.sect.stones -= 50; adjust(p, w.me, 20, 8); p.loyalty = clamp(p.loyalty + 15, 0, 100); addLife(w, p, '家中有难，宗主派人送去了灵石', 'good', true); w.acts.push({ kind: 'gift', who: p.id, text: `替${p.name}照顾家人` }); }
      else { p.mood = clamp(p.mood - 20, 0, 100); p.grudge = clamp(p.grudge + (hasTrait(p, 'filial') ? 25 : 10), 0, 100); addLife(w, p, '家中出事，宗主不准回去', 'bad', true); }
    },
  },
  {
    id: 'sage', weight: () => 0.4,
    start: () => ({ title: '云游高人', text: '一位云游的高人路过山门，愿意留下指点几天——但要一笔供奉。', options: [{ id: 'pay', label: '奉上 120 灵石，请他指点' }, { id: 'no', label: '婉谢' }], fallback: 'no' }),
    resolve(w, r, _x, o) {
      if (o !== 'pay' || w.sect.stones < 120) return;
      w.sect.stones -= 120;
      for (const p of members(w)) { const sk = r.pick(SKILLS); p.skills[sk] = Math.min(p.caps[sk], p.skills[sk] + 6); p.exp += 10; stepUp(p); }
      report(w, { text: '高人在山上讲道三日，人人都有所得。', tone: 'good', about: [] });
    },
  },
  {
    id: 'caravan', weight: () => 0.6,
    start: () => ({ title: '商队求护送', text: '一支商队要过黑风岭，请宗门派人护送，报酬丰厚。', options: [{ id: 'go', label: '派两个能打的去' }, { id: 'no', label: '不接' }], fallback: 'no' }),
    resolve(w, r, _x, o) {
      if (o !== 'go') return;
      const team = strongest(w, 2);
      const ok = r.chance(0.7);
      if (ok) { w.sect.stones += 100; for (const p of team) { p.merit += 6; } report(w, { text: `${names(team)}护送商队平安过岭，得 100 灵石。`, tone: 'good', about: team.map((p) => p.id) }); }
      else { for (const p of team) p.hp = clamp(p.hp - 30, 5, 100); report(w, { text: `护送途中遇上劫匪，${names(team)}受了伤。`, tone: 'bad', about: team.map((p) => p.id) }); }
    },
  },
  {
    id: 'beast_cub', weight: (w) => members(w).length >= 2 ? 0.4 : 0,
    start: (w, r) => {
      const [a, b] = r.shuffle([...members(w)]).slice(0, 2);
      return { title: '灵兽幼崽', text: `巡山时捡到一只灵兽幼崽，${a.name}和${b.name}都想养。`, options: [{ id: 'a', label: `给${a.name}` }, { id: 'b', label: `给${b.name}` }, { id: 'sell', label: '卖了，换 80 灵石' }], params: { a: a.id, b: b.id }, fallback: 'sell', about: [a.id, b.id] };
    },
    resolve(w, _r, x, o) {
      const a = P(w, String(x.a)), b = P(w, String(x.b));
      if (!a || !b) return;
      if (o === 'sell') { w.sect.stones += 80; return; }
      const [win, lose] = o === 'a' ? [a, b] : [b, a];
      win.gear += 1; adjust(win, w.me, 10, 3); adjust(lose, win.id, disp(lose, 'envy') > 0 ? -15 : -3); lose.mood = clamp(lose.mood - 8, 0, 100);
      addLife(w, win, '宗主把捡来的灵兽幼崽给了自己', 'good');
      w.acts.push({ kind: 'gift', who: win.id, text: `把灵兽给了${win.name}` });
    },
  },
  {
    id: 'plague', weight: () => 0.3,
    start: (w, r) => { const hit = r.shuffle([...members(w)]).slice(0, 3); for (const p of hit) { p.hp = clamp(p.hp - 30, 5, 100); addLife(w, p, '染了山中瘴气，大病一场', 'bad'); } report(w, { text: `山中起了瘴气，${names(hit)}病倒了。`, tone: 'bad', about: hit.map((p) => p.id) }); return null; },
  },
];

interface PersonEvent { id: string; weight(w: World, p: Person): number; run(w: World, r: Rng, p: Person): void }

const PERSON_EVENTS: PersonEvent[] = [
  { id: 'scroll', weight: () => 1, run(w, r, p) { const sk = r.pick(SKILLS); p.caps[sk] = Math.min(100, p.caps[sk] + 8); p.skills[sk] = Math.min(p.caps[sk], p.skills[sk] + 6); addLife(w, p, `拾得一卷残篇，${SKILL_NAME[sk]}的天分开了窍`, 'good'); } },
  { id: 'master_pass', weight: (_w, p) => p.job === 'travel' ? 2 : 0.4, run(w, _r, p) { p.exp += 35; stepUp(p); addLife(w, p, '偶遇一位隐世高人，得他传了一段心法', 'good', true); } },
  { id: 'pet', weight: (_w, p) => p.job === 'travel' || p.job === 'guard' ? 1 : 0.3, run(w, _r, p) { p.gear += 1; addLife(w, p, '收服了一只灵兽', 'good', true); } },
  { id: 'qi_dev', weight: (_w, p) => (p.grudge > 40 || p.mood < 30 ? 1.5 : 0.3) * (disp(p, 'temper') > 0 ? 1.5 : 1), run(w, r, p) { p.hp = clamp(p.hp - 35, 5, 100); p.exp = Math.round(p.exp * 0.6); addLife(w, p, '心浮气躁，修炼时走火入魔', 'bad', true); if (r.chance(0.4)) { const t = r.pick(['extreme', 'gloomy', 'hasty']); if (!p.traits.includes(t)) p.traits.push(t); } report(w, { text: `${p.name}修炼时走火入魔，伤得不轻。`, tone: 'bad', about: [p.id] }); } },
  { id: 'epiphany', weight: (_w, p) => (p.wit / 60) * 0.6, run(w, _r, p) { if (atBottleneck(p)) return; p.stage = p.realm === 0 ? Math.min(9, p.stage + 1) : Math.min(3, p.stage + 1); addLife(w, p, '观云海时忽有所悟，修为连跳一阶', 'good', true); report(w, { text: `${p.name}顿悟了，修为连跳一阶。`, tone: 'good', about: [p.id] }); } },
  { id: 'rescue', weight: (_w, p) => (p.job === 'travel' ? 1.5 : 0.3) * (disp(p, 'kindness') > 0 ? 1.5 : 0.5), run(w, _r, p) { p.fame += 3; w.sect.rep += 2; addLife(w, p, '下山时出手救了一车被劫的百姓', 'good'); } },
  { id: 'letter', weight: () => 0.6, run(w, r, p) { const bad = r.chance(0.5); if (bad) { p.mood = clamp(p.mood - 20, 0, 100); addLife(w, p, '收到家书：家中长辈病重', 'bad'); if (hasTrait(p, 'filial') && !p.wish) p.wish = { kind: 'leave', text: '想回家看一眼病重的长辈', since: w.t, by: 'rule' }; } else { p.mood = clamp(p.mood + 10, 0, 100); addLife(w, p, '收到家书，家里一切安好', 'good'); } } },
  { id: 'fruit', weight: (_w, p) => p.job === 'travel' || p.job === 'herb' ? 0.8 : 0.2, run(w, _r, p) { p.root.apt = Math.round((p.root.apt + 0.1) * 100) / 100; addLife(w, p, '误食一枚朱果，资质好了一些', 'good', true); } },
  { id: 'ambush', weight: (w, p) => p.job === 'travel' && rivalAlive(w).length ? 1.2 : 0, run(w, r, p) {
    const rv = r.pick(rivalAlive(w));
    const foe = rv.named.map((id) => P(w, id)!).filter((q) => q?.alive)[0];
    p.hp = clamp(p.hp - 40, 5, 100);
    addLife(w, p, `在外被${rv.name}的${foe?.name ?? '人'}暗算，重伤而回`, 'bad', true);
    if (foe) { p.ops[foe.id] = { aff: -70, respect: 0, tag: 'enemy' }; if (disp(p, 'grudge') > 0 && !p.wish) p.wish = { kind: 'revenge', target: foe.id, text: `${foe.name}暗算我这一回，我记下了`, since: w.t, by: 'rule' }; }
    report(w, { text: `${p.name}在外被${rv.name}的人暗算，重伤而回。`, tone: 'bad', about: [p.id], big: true });
  } },
  { id: 'gamble', weight: (_w, p) => disp(p, 'greed') > 0 ? 0.6 : 0.1, run(w, r, p) { const win = r.chance(0.45); const n = r.int(20, 60); if (win) { w.sect.stones += n; addLife(w, p, `在坊市赌石，开出好料，交了${n}灵石给宗门`, 'good'); } else { p.mood = clamp(p.mood - 8, 0, 100); addLife(w, p, '在坊市赌石，输了个精光', 'bad'); } } },
  { id: 'old_wound', weight: (_w, p) => p.hp < 70 ? 0.6 : 0, run(w, _r, p) { p.hp = clamp(p.hp - 15, 5, 100); addLife(w, p, '旧伤复发', 'bad'); } },
  { id: 'twilight', weight: (_w, p) => yearsLeft(p) < 15 ? 2 : 0, run(w, _r, p) { if (p.wish?.kind !== 'realm') p.wish = { kind: 'realm', param: String(p.realm + 1), text: `寿元无多，只想在坐化前踏入${REALM_NAME[p.realm + 1]}`, since: w.t, by: 'rule' }; p.mood = clamp(p.mood - 10, 0, 100); addLife(w, p, '察觉寿元将尽，心里开始发慌', 'story', true); } },
  { id: 'sword_intent', weight: (_w, p) => p.skills.combat >= 60 ? 0.5 : 0, run(w, _r, p) { p.fame += 6; p.skills.combat = Math.min(p.caps.combat, p.skills.combat + 4); addLife(w, p, '剑意初成，一剑斩断山涧瀑布', 'good', true); report(w, { text: `${p.name}剑意初成。`, tone: 'good', about: [p.id] }); } },
  { id: 'pill_omen', weight: (_w, p) => p.job === 'alchemy' && p.skills.alchemy >= 55 ? 0.6 : 0, run(w, _r, p) { w.sect.pills += 12; p.fame += 4; addLife(w, p, '开炉时丹成异象，一炉出了十二颗上品丹', 'good', true); report(w, { text: `${p.name}开炉时丹成异象，一炉出了十二颗上品丹。`, tone: 'good', about: [p.id] }); } },
  { id: 'stars', weight: (_w, p) => p.skills.insight >= 50 ? 0.4 : 0, run(w, _r, p) { w.sect.foresight = w.t + 4; addLife(w, p, '夜观星象，看出近期有刀兵之灾', 'story'); report(w, { text: `${p.name}夜观星象，说近期有刀兵之灾。下一场仗我们会有准备。`, tone: 'info', about: [p.id] }); } },
  { id: 'secret_found', weight: (w, p) => members(w).some((q) => q.id !== p.id && q.secret && !q.secret.exposed) ? 0.4 + Math.max(0, disp(p, 'cunning')) * 0.2 : 0, run(w, r, p) {
    const q = r.pick(members(w).filter((x) => x.id !== p.id && x.secret && !x.secret.exposed));
    addLife(w, p, `无意中撞破了${q.name}的秘密`, 'story', true);
    if (q.secret!.kind === 'spy' || disp(p, 'order') > 0.5 || (p.ops[q.id]?.aff ?? 0) < 0) {
      q.secret!.exposed = true;
      if (q.secret!.kind === 'spy') addDecision(w, 'spy_caught', { who: q.id, patron: q.secret!.patron ?? '' });
      else report(w, { text: `${p.name}撞破了${q.name}的秘密：${q.name}${q.secret!.text}。`, tone: 'story', about: [p.id, q.id], big: true });
    } else { adjust(q, p.id, 20, 5); addLife(w, p, `替${q.name}守住了秘密`, 'good'); }
  } },
  { id: 'heart_demon', weight: (_w, p) => p.grudge >= 60 ? 1 : 0, run(w, r, p) { drift(w, r, p, 'oppressed', 0.8); p.grudge = clamp(p.grudge - 10, 0, 100); } },
  { id: 'friend_outside', weight: (_w, p) => p.job === 'travel' && disp(p, 'romance') > 0 ? 0.6 : 0, run(w, _r, p) { p.mood = clamp(p.mood + 15, 0, 100); addLife(w, p, '在外结识了一位知己，书信往来不断', 'good'); } },
];


export function rollEvents(w: World, r: Rng) {
  // 宗门大事
  if (w.t >= 1 && r.chance(0.55 + (w.sect.site === 'market' ? 0.15 : 0))) {
    const ev = r.weighted(SECT_EVENTS.map((e) => [e, e.weight(w)] as [SectEvent, number]));
    if (ev) {
      const spec = ev.start(w, r);
      if (spec) {
        const d: Decision = { id: `d${w.nextId++}`, kind: `ev:${ev.id}`, title: spec.title, text: spec.text, options: spec.options, params: spec.params ?? {}, about: spec.about ?? [], fallback: spec.fallback };
        w.decisions.push(d);
      }
    }
  }
  // 个人奇遇
  const ps = members(w);
  const n = Math.min(ps.length, r.int(1, 3));
  const done = new Set<string>();
  for (let i = 0; i < n; i++) {
    const p = r.weighted(ps.filter((q) => !done.has(q.id)).map((q) => [q, q.job === 'travel' ? 3 : 1] as [Person, number]));
    if (!p) break;
    done.add(p.id);
    const ev = r.weighted(PERSON_EVENTS.map((e) => [e, e.weight(w, p)] as [PersonEvent, number]));
    if (ev && r.chance(p.job === 'travel' ? 0.9 : 0.5)) ev.run(w, r, p);
  }
}

/** 历练的人回山 */
export function travelTick(w: World, r: Rng) {
  for (const p of members(w)) {
    if (p.job !== 'travel') continue;
    if (r.chance(0.04)) {
      p.alive = false; p.death = '在外历练时陨落';
      addLife(w, p, '在外历练时陨落，尸骨无存', 'bad', true);
      report(w, { text: `噩耗传来：${p.name}在外历练时陨落了。`, tone: 'bad', about: [p.id], big: true });
      continue;
    }
    if (p.travelUntil !== undefined && w.t >= p.travelUntil) {
      p.job = 'none'; p.travelUntil = undefined;
      addLife(w, p, '历练归来', 'info');
      report(w, { text: `${p.name}历练归来，等你安排差事。`, tone: 'info', about: [p.id] });
    }
  }
  w.members = w.members.filter((id) => P(w, id)?.alive);
}

setEventResolver((w, r, d, o) => {
  if (resolveRivalEvent(w, d.kind, d.params, o, r)) return;
  const ev = SECT_EVENTS.find((e) => `ev:${e.id}` === d.kind);
  ev?.resolve?.(w, r, d.params, o);
});

export const EVENT_COUNT = SECT_EVENTS.length + PERSON_EVENTS.length;
