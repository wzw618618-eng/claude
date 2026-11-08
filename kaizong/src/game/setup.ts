// 开局：宗主、山门、出身、传承、开山弟子、敌宗。

import { genPerson } from './gen';
import { newCandidates } from './recruit';
import { setupRivals } from './rivals';
import { makeRng } from './rng';
import { fit } from './sect';
import type { HallId, Person, World } from './types';
import { addLife, adjust, report } from './world';
import { ruleWish } from './wishes';

export interface StartChoice {
  seed: number;
  sectName: string;
  masterName: string;
  gender: 'm' | 'f';
  site: 'vein' | 'deep' | 'market';
  origin: 'sword' | 'alchemist' | 'array' | 'renegade' | 'demon';
  heritage: 'sword' | 'herb' | 'mind' | 'trade';
  endYear?: number;
}

export function randomStart(seed: number): StartChoice {
  const r = makeRng(seed ^ 0x5bd1e995);
  return {
    seed,
    sectName: r.pick(['青云宗', '天衍宗', '紫霞派', '玄天宗', '归元门', '凌霄阁', '落霞宗', '太虚观', '问剑宗', '长生门']),
    masterName: r.pick(['云中鹤', '沈千秋', '叶孤城', '苏青衣', '顾长歌', '林照雪', '萧不语', '柳寒烟']),
    gender: r.chance(0.5) ? 'm' : 'f',
    site: r.pick(['vein', 'deep', 'market'] as const),
    origin: r.pick(['sword', 'alchemist', 'array', 'renegade', 'demon'] as const),
    heritage: r.pick(['sword', 'herb', 'mind', 'trade'] as const),
  };
}

export function newWorld(c: StartChoice): World {
  const r = makeRng(c.seed);
  const w: World = {
    v: 1, seed: c.seed, rng: 0, t: 0, me: '', people: {}, members: [], candidates: [], rivals: [], war: null, decisions: [], report: [], history: [], acts: [],
    needPolicy: true, needTech: true, over: null, nextId: 1, endYear: c.endYear ?? 10, pairings: {}, misdeeds: [], offers: {},
    sect: {
      name: c.sectName, site: c.site, origin: c.origin, heritage: c.heritage,
      stones: 320 + (c.heritage === 'trade' ? 150 : 0) + (c.site === 'vein' ? 80 : c.site === 'deep' ? -60 : 0),
      herbs: 30, pills: c.origin === 'alchemist' ? 30 : 8, fpills: c.origin === 'alchemist' ? 1 : 0, armory: c.origin === 'array' ? 40 : 0,
      rep: c.origin === 'renegade' ? 30 : 20, authority: 50, align: c.origin === 'demon' ? -35 : 20, veins: 2,
      halls: { herb: 0, alchemy: 0, forge: 0, teach: 0, law: 0, diplomacy: 0, recruit: 0, guard: 0 },
      tech: [{ sword: 'sword_array', alchemist: 'pill_hall', array: 'guard_array', renegade: 'technique_2', demon: 'blood_art' }[c.origin]],
      policy: null, pillRule: 'merit', ledger: {},
    },
  };
  // 宗主
  const m = genPerson(w, r, { sect: 'me', name: c.masterName, gender: c.gender, realm: 2, stage: c.origin === 'renegade' || c.origin === 'demon' ? 1 : 0, gifted: true, secret: null });
  m.age = r.int(150, 210);
  m.rank = 'master';
  const sk = { sword: 'combat', alchemist: 'alchemy', array: 'array', renegade: 'combat', demon: 'combat' }[c.origin] as keyof Person['skills'];
  m.caps[sk] = 95; m.skills[sk] = 82;
  m.skills.manage = Math.max(m.skills.manage, 40);
  m.loyalty = 100;
  w.people[m.id] = m;
  w.me = m.id;
  w.members.push(m.id);
  addLife(w, m, `在${{ vein: '灵脉宝地', deep: '深山', market: '坊市旁' }[c.site]}开宗立派，立名${c.sectName}`, 'good', true);
  // 开山弟子：跟着你来的人，忠心些
  for (let i = 0; i < 3; i++) {
    const p = genPerson(w, r, { sect: 'me', realm: 0, stage: r.int(2, 5), secretChance: 0.1 });
    p.loyalty = Math.max(p.loyalty, 65);
    p.rank = i === 0 ? 'inner' : 'outer';
    w.people[p.id] = p;
    w.members.push(p.id);
    adjust(p, m.id, 40, 30);
    addLife(w, p, `跟着${m.name}开山，成了${c.sectName}的开山弟子`, 'good', true);
  }
  const founders = w.members.map((id) => w.people[id]).filter((p) => p.id !== m.id);
  // 开山弟子先按最合适的活安排好，玩家再调
  const open: HallId[] = ['herb', 'alchemy', 'guard'];
  for (const p of founders) {
    const best = open.sort((a, b) => fit(p, b) - fit(p, a))[0];
    p.job = best;
    open.splice(open.indexOf(best), 1);
  }
  for (const a of founders) for (const b of founders) if (a !== b) adjust(a, b.id, r.int(5, 30));
  for (const p of founders) p.wish = ruleWish(w, r, p);
  setupRivals(w, r);
  const ch = w.rivals.find((x) => x.id === 'chixiao')!;
  const xs = w.rivals.find((x) => x.id === 'xuanshui')!;
  const ty = w.rivals.find((x) => x.id === 'taiyi')!;
  if (c.origin === 'renegade') { ch.attitude = -55; ch.status = 'hostile'; }
  if (c.origin === 'demon') { ty.attitude = -40; xs.attitude -= 15; }
  if (c.site === 'vein') { ch.attitude -= 10; xs.attitude -= 10; }
  if (c.site === 'deep') { ch.attitude += 10; }
  if (c.site === 'market') xs.attitude -= 5;
  newCandidates(w, r, 0);
  w.report = [];
  report(w, { text: `${c.sectName}开山了。你带着${founders.map((p) => p.name).join('、')}三个开山弟子，在山上安顿下来。`, tone: 'story', about: founders.map((p) => p.id), big: true });
  report(w, { text: `开山收徒，来了${w.candidates.length}个人，在迎客堂等你见。`, tone: 'info', about: [] });
  report(w, { text: `一州之内，${ch.name}霸道，${xs.name}精明，${ty.name}是正道之首。十年之内，站稳脚跟。`, tone: 'info', about: [] });
  w.rng = r.state();
  return w;
}
