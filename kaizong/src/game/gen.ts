// 随机生成一个人：名字、灵根、悟性、性格、价值取向、才干、喜好、来历、怪癖、秘密。

import { LIFESPAN, ROOT_APT } from './cult';
import { TRAIT, TRAITS } from './data/traits';
import { ELEMENTS, GIVEN_F, GIVEN_M, HALLS, ORIGIN_TEXT, QUIRKS, SKILLS, SURNAMES, VALUES, VOICES } from './data/world';
import type { Rng } from './rng';
import type { JobId, Person, Realm, Root, RootKind, SecretKind, Skill, Value, World } from './types';
import { disp, newId } from './world';

export interface GenOpts {
  sect?: string | null;
  gender?: 'm' | 'f';
  realm?: Realm;
  stage?: number;
  /** 资质好一点（天才） */
  gifted?: boolean;
  secret?: SecretKind | null;
  /** 有秘密的概率 */
  secretChance?: number;
  age?: number;
  traits?: string[];
  name?: string;
}

function rollRoot(r: Rng, gifted: boolean): Root {
  const kind = r.weighted<RootKind>(gifted ? [['heaven', 30], ['dual', 50], ['triple', 20]] : [['heaven', 5], ['dual', 22], ['triple', 38], ['mixed', 35]])!;
  const n = { heaven: 1, dual: 2, triple: 3, mixed: r.int(4, 5) }[kind];
  const els = r.shuffle([...ELEMENTS]).slice(0, n);
  const apt = Math.round(ROOT_APT[kind] * r.range(0.9, 1.1) * 100) / 100;
  return { kind, els, apt };
}

function rollTraits(r: Rng, n: number, base: string[] = []): string[] {
  const out = [...base];
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const t = r.pick(TRAITS);
    if (out.includes(t.id)) continue;
    if (out.some((o) => TRAIT[o].clash?.includes(t.id) || t.clash?.includes(o))) continue;
    out.push(t.id);
  }
  return out;
}

export function usedNames(w: World) {
  return new Set(Object.values(w.people).map((p) => p.name));
}

export function rollName(r: Rng, gender: 'm' | 'f', taken: Set<string>) {
  for (let i = 0; i < 50; i++) {
    const n = r.pick(SURNAMES) + r.pick(gender === 'm' ? GIVEN_M : GIVEN_F);
    if (!taken.has(n)) return n;
  }
  return r.pick(SURNAMES) + r.pick(gender === 'm' ? GIVEN_M : GIVEN_F) + r.int(2, 9);
}

const SECRET_TEXT: Record<SecretKind, string[]> = {
  spy: ['是{patron}派来的奸细，要摸清这里的底细', '受{patron}之命混进山门，伺机偷取功法'],
  fugitive: ['在山下犯了命案，是官府通缉的要犯', '偷了某个世家的传家宝，正被人追杀'],
  vendetta: ['全家被仇人所杀，入山门只为学本事报仇', '师父被人害死，他要找到凶手'],
  noble: ['其实是某个修仙世家的嫡子，逃婚出来的', '出身显赫世家，家里一直在找他回去'],
  demon: ['身上流着魔修的血，一动怒双眼就会泛红', '小时候被魔修种下过血咒，至今未解'],
};

export function genPerson(w: World, r: Rng, o: GenOpts = {}): Person {
  const gender = o.gender ?? (r.chance(0.5) ? 'm' : 'f');
  const gifted = !!o.gifted;
  const root = rollRoot(r, gifted);
  const wit = Math.round(Math.min(100, Math.max(10, r.range(25, 75) + (gifted ? 20 : 0))));
  const traits = o.traits ?? rollTraits(r, r.chance(0.4) ? 3 : 2);
  const values = Object.fromEntries(VALUES.map((v) => [v, Math.round(r.range(0.1, 0.9) * 100) / 100])) as Record<Value, number>;
  // 才干天分：每项 30–100 的上限，现有水平是上限的一部分
  const caps = {} as Record<Skill, number>;
  const skills = {} as Record<Skill, number>;
  const strong = r.shuffle([...SKILLS]).slice(0, 2);
  for (const s of SKILLS) {
    caps[s] = Math.round(strong.includes(s) ? r.range(65, 100) : r.range(25, 80));
    skills[s] = Math.round(caps[s] * r.range(0.1, 0.45));
  }
  const realm = o.realm ?? 0;
  const stage = o.stage ?? (realm === 0 ? r.int(1, 4) : r.int(0, 2));
  const minAge = realm === 0 ? 14 : [0, 40, 120, 300, 800][realm];
  const age = o.age ?? Math.round(minAge + r.range(0, realm === 0 ? 16 : 0.3 * LIFESPAN[realm]));

  const p: Person = {
    id: newId(w, 'p'),
    name: o.name ?? rollName(r, gender, usedNames(w)),
    gender, age, alive: true, sect: o.sect ?? null,
    look: { hue: r.int(0, 359), hair: r.int(0, 5), face: r.int(0, 5), portrait: r.int(0, 39) },
    root, wit, realm, stage, exp: 0, fails: 0, hp: 100,
    skills, caps, traits, values, likes: [], dislikes: [],
    origin: r.pick(ORIGIN_TEXT), quirk: r.pick(QUIRKS), voice: r.pick(VOICES),
    rank: 'outer', job: 'none', tenure: 0, served: {}, merit: 0, seniority: 0, favor: 0, fame: 0,
    mood: 60, grudge: 0, loyalty: 50, gear: 0, ops: {}, wish: null, life: [], honestOrigin: true,
  };
  // 喜欢、讨厌的活计：性格给的 + 才干给的
  const likes = new Set<JobId>();
  const dislikes = new Set<JobId>();
  for (const t of traits) {
    for (const j of TRAIT[t].likes ?? []) likes.add(j);
    for (const j of TRAIT[t].dislikes ?? []) dislikes.add(j);
  }
  for (const h of HALLS) if (strong.includes(h.skill) && !dislikes.has(h.id)) likes.add(h.id);
  if (likes.size === 0) likes.add(r.pick(HALLS).id);
  if (dislikes.size === 0) {
    const d = r.pick(HALLS).id;
    if (!likes.has(d)) dislikes.add(d);
  }
  for (const j of likes) dislikes.delete(j);
  p.likes = [...likes].slice(0, 3);
  p.dislikes = [...dislikes].slice(0, 3);
  // 秘密
  const sk = o.secret !== undefined ? o.secret : r.chance(o.secretChance ?? 0.15) ? r.weighted<SecretKind>([['fugitive', 3], ['vendetta', 4], ['noble', 3], ['demon', 2]]) : null;
  if (sk) {
    p.secret = { kind: sk, text: r.pick(SECRET_TEXT[sk]), exposed: false };
    if (sk === 'fugitive' || sk === 'noble' || sk === 'spy') p.honestOrigin = false;
  }
  p.loyalty = Math.round(40 + disp(p, 'order') * 5 + r.range(-5, 10));
  return p;
}

export function setPatron(p: Person, rivalId: string, rivalName: string) {
  if (p.secret) {
    p.secret.patron = rivalId;
    p.secret.text = p.secret.text.replace('{patron}', rivalName);
  }
}

/** 一个人的大致样子（候选人和占位头像用） */
export function lookText(p: Person) {
  const age = p.age < 20 ? '少年' : p.age < 35 ? '青年' : p.age < 60 ? '中年' : '老者';
  return `${age}${p.gender === 'f' ? '女子' : '男子'}`;
}
