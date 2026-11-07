// 案件生成器：完全由代码按种子确定性生成，不调用大模型。
// 同一种子永远得到同一个案件；生成后必须通过求解器，不通过就换下一个子种子重来。

import { createRng, hashSeed, type Rng } from '../core/rng';
import type {
  CharacterData,
  DiscipleId,
  GameData,
  LocationId,
  NightSpot,
  SecretData,
  SlipData,
  TraitId,
} from '../data/types';
import { deriveContradictions, type Contradiction, type Fact, type Visibility } from './facts';
import { solveCase } from './solver';

export type Role = 'culprit' | 'secret' | 'witness';
export type Pattern = 'A' | 'B' | 'C';

export interface DiscipleCase {
  id: DiscipleId;
  role: Role;
  true_location: LocationId;
  claim_location: LocationId;
  /** 对掌门的说法：在那做什么、为什么在那。说实话的人就是真实经过 */
  claim_story: { doing: string; detail: string };
  secret_id?: string;
  /** 拥有藏经阁特征线索的无辜者 */
  co_suspect: boolean;
}

export interface KnowledgeCard {
  disciple: DiscipleId;
  role: Role;
  /** 他知道的当晚事实（含自己的说法），按 id 引用案件事实表 */
  facts: Array<{ id: string; visibility: Visibility }>;
  claim_fact: string;
  claim_is_lie: boolean;
  culprit?: { motive: string; slip: SlipData; slip_fact: string };
  secret?: { id: string; summary: string; confession_points: string[]; confession_fact: string; keywords: string[] };
}

export interface CaseData {
  seed: number;
  version: number;
  attempt: number;
  tutorial: boolean;
  time_slot: string;
  stolen_item: { id: string; name: string };
  culprit: DiscipleId;
  motive: string;
  slip_detail: SlipData;
  pattern: Pattern;
  trait: TraitId;
  disciples: DiscipleCase[];
  facts: Fact[];
  contradictions: Contradiction[];
  conviction_set: string[];
  /** 每个地点勘察可得的物证 id */
  investigation: Record<LocationId, string[]>;
  knowledge: Record<DiscipleId, KnowledgeCard>;
}

export interface GenerateOptions {
  /** 新手引导：嫌疑 2 人，只有 1 名弟子有秘密 */
  tutorial?: boolean;
}

const ALL_LOCATIONS: LocationId[] = ['library', 'dorm', 'alchemy', 'kitchen', 'training', 'bamboo', 'gate'];

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export class CaseGenerationError extends Error {}

/** 生成一个通过求解器的案件。单个种子最多尝试 config.generator.max_attempts 次。 */
export function generateCase(seed: number, data: GameData, options: GenerateOptions = {}): CaseData {
  const max = data.config.generator.max_attempts;
  const failures: string[] = [];
  for (let attempt = 0; attempt < max; attempt++) {
    const built = tryGenerate(seed, attempt, data, options);
    if (typeof built === 'string') {
      failures.push(built);
      continue;
    }
    const result = solveCase(built, data);
    if (result.ok) return built;
    failures.push(result.errors.join('；'));
  }
  throw new CaseGenerationError(`种子 ${seed} 尝试 ${max} 次都没有生成可解的案件：${failures.slice(0, 3).join(' | ')}`);
}

interface Placement {
  location: LocationId;
  spot?: NightSpot;
}

/** 生成一次。失败时返回原因字符串。 */
export function tryGenerate(seed: number, attempt: number, data: GameData, options: GenerateOptions = {}): CaseData | string {
  const cfg = data.config;
  const tutorial = !!options.tutorial;
  const rng = createRng(hashSeed('zongmen-case', cfg.generator.version, seed, attempt, tutorial ? 't' : 'n'));
  const charById = new Map(data.characters.map((c) => [c.id, c]));
  const secretById = new Map(data.secrets.map((s) => [s.id, s]));
  const secretOf = (c: CharacterData): SecretData => {
    const s = secretById.get(c.secret_id);
    if (!s) throw new Error(`${c.name} 的秘密 ${c.secret_id} 不存在`);
    return s;
  };

  // 1. 抽 5 名弟子，定下时辰、被盗物、动机、失言细节
  const present = rng.shuffle(data.characters).slice(0, cfg.suspects_per_case);
  const timeSlot = rng.pick(data.templates.time_slots_crime);
  const item = rng.pick(data.templates.stolen_items);
  const slip = rng.pick(item.slips);
  const motive = rng.pick(data.templates.motives).text;

  // 2. 内奸、有秘密的无辜者（秘密地点不能相同）、老实目击者
  const culprit = rng.pick(present);
  const others = rng.shuffle(present.filter((c) => c !== culprit));
  const secretCount = tutorial ? 1 : 2;
  const secretHolders: CharacterData[] = [];
  for (const o of others) {
    if (secretHolders.length >= secretCount) break;
    const loc = secretOf(o).location;
    if (secretHolders.some((s) => secretOf(s).location === loc)) continue;
    secretHolders.push(o);
  }
  if (secretHolders.length < secretCount) return '凑不齐秘密地点不同的有秘密者';
  const witnesses = others.filter((o) => !secretHolders.includes(o));

  // 3. 真实位置
  const where = new Map<DiscipleId, Placement>();
  where.set(culprit.id, { location: 'library' });
  for (const s of secretHolders) where.set(s.id, { location: secretOf(s).location });
  for (const w of witnesses) {
    const spot = rng.pick(w.night_spots);
    where.set(w.id, { location: spot.location, spot });
  }

  // 4. 藏经阁的特征线索：内奸的某个特征，在场拥有者恰好 2–3 人
  const [minSus, maxSus] = tutorial ? [2, 2] : [cfg.generator.suspects_min, cfg.generator.suspects_max];
  let trait: TraitId | undefined;
  let owners: CharacterData[] = [];
  for (const t of rng.shuffle(culprit.traits)) {
    const o = present.filter((c) => c.traits.includes(t));
    if (o.length >= minSus && o.length <= maxSus) {
      trait = t;
      owners = o;
      break;
    }
  }
  if (!trait) return '内奸的特征都挑不出 2–3 名拥有者';
  const coSuspects = owners.filter((c) => c !== culprit);

  // 陪绑者是老实目击者时，把另一名老实目击者调到他所在的地点，互相证实
  const witnessCo = coSuspects.filter((c) => witnesses.includes(c));
  if (witnessCo.length > 0) {
    const anchor = witnessCo[0];
    const mate = witnesses.find((w) => w !== anchor);
    if (!mate) return '陪绑者没有可以互证的目击者';
    const loc = where.get(anchor.id)!.location;
    if (where.get(mate.id)!.location !== loc) {
      const own = mate.night_spots.find((s) => s.location === loc);
      where.set(mate.id, { location: loc, spot: own ?? genericSpot(rng, data, loc) });
    }
  }

  const peopleAt = (loc: LocationId) => present.filter((c) => where.get(c.id)!.location === loc);
  const locOf = (c: CharacterData) => where.get(c.id)!.location;

  // 5. 内奸的伪证模式
  const options_: Array<{ pattern: Pattern; claim: LocationId }> = [];
  const witnessLocs = unique(witnesses.map(locOf));
  for (const l of witnessLocs) if (l !== 'dorm') options_.push({ pattern: 'A', claim: l });
  if (witnessLocs.includes('dorm')) options_.push({ pattern: 'B', claim: 'dorm' });
  for (const l of ['alchemy', 'kitchen'] as LocationId[]) if (peopleAt(l).length === 0) options_.push({ pattern: 'C', claim: l });
  if (options_.length === 0) return '没有可用的伪证模式';
  const patterns = unique(options_.map((o) => o.pattern));
  const pattern = rng.pick(patterns);
  const claimChoices = options_.filter((o) => o.pattern === pattern).map((o) => o.claim);
  const preferred = claimChoices.filter((l) => culprit.night_spots.some((s) => s.location === l));
  const culpritClaim = rng.pick(preferred.length > 0 ? preferred : claimChoices);

  // 组装每名弟子
  const disciples: DiscipleCase[] = present.map((c) => {
    const role: Role = c === culprit ? 'culprit' : secretHolders.includes(c) ? 'secret' : 'witness';
    const truth = locOf(c);
    if (role === 'witness') {
      const spot = where.get(c.id)!.spot!;
      return { id: c.id, role, true_location: truth, claim_location: truth, claim_story: { doing: spot.doing, detail: spot.detail }, co_suspect: coSuspects.includes(c) };
    }
    const claimLoc: LocationId = role === 'culprit' ? culpritClaim : 'dorm';
    const own = c.night_spots.find((s) => s.location === claimLoc);
    const story = own ? { doing: own.doing, detail: own.detail } : genericStory(rng, data, claimLoc);
    return {
      id: c.id,
      role,
      true_location: truth,
      claim_location: claimLoc,
      claim_story: story,
      secret_id: role === 'secret' ? c.secret_id : undefined,
      co_suspect: coSuspects.includes(c),
    };
  });
  // 6–8. 事实表
  const facts: Fact[] = [];
  const T = data.templates.testimony;
  const nameOf = (id: DiscipleId) => charById.get(id)!.name;
  const locName = (l: LocationId) => data.locations.find((x) => x.id === l)!.name;
  const add = (f: Omit<Fact, 'id'>): Fact => {
    const fact = { ...f, id: `f${String(facts.length + 1).padStart(2, '0')}` } as Fact;
    facts.push(fact);
    return fact;
  };
  const say = (holder: DiscipleId, quote: string) => ({ quote, text: `${nameOf(holder)}：${quote}` });

  const traitData = data.traits.find((t) => t.id === trait)!;
  add({
    kind: 'trait_clue',
    params: { trait },
    text: fill(data.templates.trait_clue, { clue: traitData.clue, hint: traitData.hint }),
    found_at: 'library',
    visibility: 'public',
    source: 'investigation',
  });

  const claimFacts = new Map<DiscipleId, string>();
  for (const d of disciples) {
    const quote = fill(T.claim, { time: timeSlot, doing: d.claim_story.doing });
    const where = locName(d.claim_location);
    const said = say(d.id, quote);
    // 说法里没点出地点名（如“在房里睡觉”）时，线索簿文本补上地点
    if (!quote.includes(where)) said.text = `${said.text}（${where}）`;
    const f = add({
      kind: 'claim',
      params: { person: d.id, location: d.claim_location },
      ...said,
      holder: d.id,
      visibility: 'public',
      source: 'testimony',
    });
    claimFacts.set(d.id, f.id);
  }

  // 目击：同一时辰身处同一地点的人互相知道对方在场
  const presenceQuote = (holder: DiscipleId, person: DiscipleId, loc: LocationId) =>
    loc === 'dorm'
      ? fill(T.presence_dorm, { time: timeSlot, person: nameOf(person), pronoun: charById.get(person)!.pronoun })
      : fill(T.presence, { time: timeSlot, loc: locName(loc), person: nameOf(person) });

  const exclusiveDone = new Set<LocationId>();
  for (const w of witnesses) {
    const loc = locOf(w);
    const mates = peopleAt(loc).filter((c) => c !== w);
    for (const m of mates) {
      add({ kind: 'presence', params: { person: m.id, location: loc }, ...say(w.id, presenceQuote(w.id, m.id, loc)), holder: w.id, visibility: 'public', source: 'testimony' });
    }
    if (loc !== 'dorm' && !exclusiveDone.has(loc)) {
      exclusiveDone.add(loc);
      const quote =
        mates.length === 0
          ? fill(T.exclusive_alone, { time: timeSlot, loc: locName(loc) })
          : fill(T.exclusive_with, { time: timeSlot, loc: locName(loc), people: mates.map((m) => m.name).join('、') });
      add({ kind: 'exclusive', params: { location: loc, people: [w.id, ...mates.map((m) => m.id)] }, ...say(w.id, quote), holder: w.id, visibility: 'public', source: 'testimony' });
    }
  }
  if (pattern === 'B') {
    const dormWitness = rng.pick(witnesses.filter((w) => locOf(w) === 'dorm'));
    add({
      kind: 'empty_room',
      params: { person: culprit.id },
      ...say(dormWitness.id, fill(T.empty_room, { time: timeSlot, person: culprit.name })),
      holder: dormWitness.id,
      visibility: 'public',
      source: 'testimony',
    });
  }

  const confessionFacts = new Map<DiscipleId, string>();
  for (const s of secretHolders) {
    const sec = secretOf(s);
    const quote = fill(sec.confession_quote, { time: timeSlot });
    const conf = add({
      kind: 'presence',
      params: { person: s.id, location: sec.location },
      quote,
      text: `${s.name}坦白：${quote}`,
      holder: s.id,
      visibility: 'hidden',
      source: 'confession',
    });
    confessionFacts.set(s.id, conf.id);
    for (const m of peopleAt(sec.location).filter((c) => c !== s)) {
      add({ kind: 'presence', params: { person: m.id, location: sec.location }, ...say(s.id, presenceQuote(s.id, m.id, sec.location)), holder: s.id, visibility: 'hidden', source: 'testimony' });
    }
    add({
      kind: 'presence',
      params: { person: s.id, location: sec.location },
      text: fill(sec.evidence, { time: timeSlot }),
      found_at: sec.location,
      visibility: 'public',
      source: 'investigation',
    });
  }

  if (pattern === 'C') {
    add({
      kind: 'inaccessible',
      params: { location: culpritClaim },
      text: fill(data.templates.inaccessible[culpritClaim]!, { time: timeSlot }),
      found_at: culpritClaim,
      visibility: 'public',
      source: 'investigation',
    });
  }

  const slipFact = add({
    kind: 'slip',
    params: { detail: slip.text },
    quote: slip.line,
    text: fill(data.templates.slip_clue, { name: culprit.name, slip: slip.text }),
    holder: culprit.id,
    visibility: 'slip',
    source: 'slip',
  });

  // 9. 矛盾对、定罪证据集、勘察表、知识卡
  const contradictions = deriveContradictions(facts);
  const culpritClaimFact = claimFacts.get(culprit.id)!;
  const conviction_set = unique([
    facts[0].id,
    ...contradictions.filter((c) => c.claim === culpritClaimFact).map((c) => c.evidence),
    slipFact.id,
  ]);

  const investigation = Object.fromEntries(ALL_LOCATIONS.map((l) => [l, facts.filter((f) => f.found_at === l).map((f) => f.id)])) as Record<LocationId, string[]>;

  const knowledge: Record<DiscipleId, KnowledgeCard> = {};
  for (const d of disciples) {
    const own = facts.filter((f) => f.holder === d.id);
    const card: KnowledgeCard = {
      disciple: d.id,
      role: d.role,
      facts: own.map((f) => ({ id: f.id, visibility: f.visibility })),
      claim_fact: claimFacts.get(d.id)!,
      claim_is_lie: d.role !== 'witness',
    };
    if (d.role === 'culprit') card.culprit = { motive, slip, slip_fact: slipFact.id };
    if (d.role === 'secret') {
      const sec = secretOf(charById.get(d.id)!);
      card.secret = {
        id: sec.id,
        summary: sec.summary,
        confession_points: sec.confession_points,
        confession_fact: confessionFacts.get(d.id)!,
        keywords: sec.keywords,
      };
    }
    knowledge[d.id] = card;
  }

  return {
    seed,
    version: cfg.generator.version,
    attempt,
    tutorial,
    time_slot: timeSlot,
    stolen_item: { id: item.id, name: item.name },
    culprit: culprit.id,
    motive,
    slip_detail: slip,
    pattern,
    trait,
    disciples,
    facts,
    contradictions,
    conviction_set,
    investigation,
    knowledge,
  };
}

function genericStory(rng: Rng, data: GameData, loc: LocationId): { doing: string; detail: string } {
  const list = data.templates.claim_stories[loc];
  if (!list || list.length === 0) throw new Error(`地点 ${loc} 没有可用的说法模板`);
  return rng.pick(list);
}

function genericSpot(rng: Rng, data: GameData, loc: LocationId): NightSpot {
  return { location: loc, ...genericStory(rng, data, loc) };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function factById(c: CaseData, id: string): Fact {
  const f = c.facts.find((x) => x.id === id);
  if (!f) throw new Error(`案件里没有事实 ${id}`);
  return f;
}

export function discipleCase(c: CaseData, id: DiscipleId): DiscipleCase {
  const d = c.disciples.find((x) => x.id === id);
  if (!d) throw new Error(`本案没有弟子 ${id}`);
  return d;
}
