import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../assets/game/core/rng';
import { defaultData } from '../assets/game/data/index';
import { generateCase } from '../assets/game/case/generator';
import { solveCase } from '../assets/game/case/solver';
import { contradicts, deriveContradictions, type ClaimFact, type Fact } from '../assets/game/case/facts';
import { readFileSync } from 'node:fs';
import { buildBundleSource, OUT } from '../tools/bundle-data';

const data = defaultData();

describe('随机数', () => {
  it('同一种子输出完全一致', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 100 }, () => a.next());
    const ys = Array.from({ length: 100 }, () => b.next());
    expect(xs).toEqual(ys);
  });
  it('不同种子输出不同，且落在 [0,1)', () => {
    const a = createRng(1);
    const b = createRng(2);
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(xs).not.toEqual(Array.from({ length: 50 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it('hashSeed 稳定', () => {
    expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a', 2));
  });
});

describe('数据', () => {
  it('打包结果是最新的（改了 data/ 要运行 npm run data）', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(buildBundleSource());
  });
  it('每个特征恰好由 2–3 人拥有', () => {
    for (const t of data.traits) {
      const n = data.characters.filter((c) => c.traits.includes(t.id)).length;
      expect(n, t.name).toBeGreaterThanOrEqual(2);
      expect(n, t.name).toBeLessThanOrEqual(3);
    }
  });
  it('每人恰好 3 个特征，各属外袍、习惯、随身物', () => {
    for (const c of data.characters) {
      const cats = c.traits.map((id) => data.traits.find((t) => t.id === id)!.category).sort();
      expect(cats, c.name).toEqual(['habit', 'item', 'robe']);
    }
  });
  it('每人都有秘密、回避台词至少 5 条、拒答台词和模板口吻', () => {
    for (const c of data.characters) {
      expect(data.secrets.find((s) => s.id === c.secret_id)?.owner).toBe(c.id);
      expect(data.fallback.evasive[c.id].length).toBeGreaterThanOrEqual(5);
      expect(data.fallback.refuse[c.id]).toBeTruthy();
      expect(data.templateLines.voices[c.id]).toBeTruthy();
    }
  });
});

describe('生成器与求解器', () => {
  it('连续 1000 个种子 100% 通过，单个案件 50 毫秒内', () => {
    let maxMs = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const t0 = performance.now();
      const c = generateCase(seed, data);
      const r = solveCase(c, data);
      maxMs = Math.max(maxMs, performance.now() - t0);
      expect(r.ok, `种子 ${seed}：${r.errors.join('；')}`).toBe(true);
      expect(c.attempt).toBeLessThan(data.config.generator.max_attempts);
    }
    expect(maxMs).toBeLessThan(50);
  });

  it('同一种子永远得到同一个案件', () => {
    expect(generateCase(20261207, data)).toEqual(generateCase(20261207, data));
  });

  it('身份分配、事实数量、特征分布符合要求', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const c = generateCase(seed, data);
      const roles = c.disciples.map((d) => d.role);
      expect(roles.filter((r) => r === 'culprit')).toHaveLength(1);
      expect(roles.filter((r) => r === 'secret')).toHaveLength(2);
      expect(roles.filter((r) => r === 'witness')).toHaveLength(2);
      expect(c.facts.length).toBeGreaterThanOrEqual(10);
      expect(c.facts.length).toBeLessThanOrEqual(20);
      // 秘密地点不能相同
      const secretLocs = c.disciples.filter((d) => d.role === 'secret').map((d) => d.true_location);
      expect(new Set(secretLocs).size).toBe(2);
      // 无辜者都不在藏经阁
      for (const d of c.disciples) expect(d.true_location === 'library').toBe(d.role === 'culprit');
      // 特征线索拥有者 2–3 人
      const owners = c.disciples.filter((d) => data.characters.find((x) => x.id === d.id)!.traits.includes(c.trait));
      expect(owners.length).toBeGreaterThanOrEqual(2);
      expect(owners.length).toBeLessThanOrEqual(3);
      // 无辜者的提示词（知识卡）里不出现内奸是谁
      for (const d of c.disciples.filter((x) => x.role !== 'culprit')) {
        expect(c.knowledge[d.id].culprit).toBeUndefined();
      }
    }
  });

  it('三种伪证模式都会出现', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) seen.add(generateCase(seed, data).pattern);
    expect([...seen].sort()).toEqual(['A', 'B', 'C']);
  });

  it('新手局：嫌疑 2 人，只有 1 名弟子有秘密', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = generateCase(seed, data, { tutorial: true });
      expect(solveCase(c, data).ok).toBe(true);
      expect(c.disciples.filter((d) => d.role === 'secret')).toHaveLength(1);
      expect(c.disciples.filter((d) => d.co_suspect)).toHaveLength(1);
    }
  });

  it('求解器能发现被篡改的案件', () => {
    const c = structuredClone(generateCase(7, data));
    // 删掉所有打破内奸说法的证据
    const claim = c.facts.find((f) => f.kind === 'claim' && f.params.person === c.culprit)!;
    const breakers = new Set(c.contradictions.filter((x) => x.claim === claim.id).map((x) => x.evidence));
    c.facts = c.facts.filter((f) => !breakers.has(f.id));
    c.contradictions = deriveContradictions(c.facts);
    const r = solveCase(c, data);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('内奸的说法没有被任何证据打破');
  });
});

describe('矛盾推导', () => {
  const claim = (person: string, location: string): ClaimFact =>
    ({ id: 'c', kind: 'claim', params: { person, location }, text: '', visibility: 'public', source: 'testimony' }) as ClaimFact;
  const fact = (f: Partial<Fact> & Pick<Fact, 'kind' | 'params'>): Fact => ({ id: 'e', text: '', visibility: 'public', source: 'testimony', ...f }) as Fact;

  it('presence(X,Z)，Z≠Y 时矛盾；Z=Y 或不是本人时不矛盾', () => {
    expect(contradicts(fact({ kind: 'presence', params: { person: 'x', location: 'gate' } }), claim('x', 'dorm'))).toBe(true);
    expect(contradicts(fact({ kind: 'presence', params: { person: 'x', location: 'dorm' } }), claim('x', 'dorm'))).toBe(false);
    expect(contradicts(fact({ kind: 'presence', params: { person: 'y', location: 'gate' } }), claim('x', 'dorm'))).toBe(false);
  });
  it('exclusive(Y,S)，X 不在 S 中时矛盾', () => {
    expect(contradicts(fact({ kind: 'exclusive', params: { location: 'training', people: ['w'] } }), claim('x', 'training'))).toBe(true);
    expect(contradicts(fact({ kind: 'exclusive', params: { location: 'training', people: ['w', 'x'] } }), claim('x', 'training'))).toBe(false);
    expect(contradicts(fact({ kind: 'exclusive', params: { location: 'gate', people: ['w'] } }), claim('x', 'training'))).toBe(false);
  });
  it('empty_room(X)，Y 是弟子居所时矛盾', () => {
    expect(contradicts(fact({ kind: 'empty_room', params: { person: 'x' } }), claim('x', 'dorm'))).toBe(true);
    expect(contradicts(fact({ kind: 'empty_room', params: { person: 'x' } }), claim('x', 'gate'))).toBe(false);
    expect(contradicts(fact({ kind: 'empty_room', params: { person: 'y' } }), claim('x', 'dorm'))).toBe(false);
  });
  it('inaccessible(Y) 时矛盾', () => {
    expect(contradicts(fact({ kind: 'inaccessible', params: { location: 'alchemy' } }), claim('x', 'alchemy'))).toBe(true);
    expect(contradicts(fact({ kind: 'inaccessible', params: { location: 'alchemy' } }), claim('x', 'kitchen'))).toBe(false);
  });
  it('特征线索、失言、说法本身不构成矛盾', () => {
    expect(contradicts(fact({ kind: 'trait_clue', params: { trait: 'tall' } }), claim('x', 'dorm'))).toBe(false);
    expect(contradicts(fact({ kind: 'slip', params: { detail: '紫檀' } }), claim('x', 'dorm'))).toBe(false);
    expect(contradicts(fact({ kind: 'claim', params: { person: 'x', location: 'gate' } }), claim('x', 'dorm'))).toBe(false);
  });
});
