import { describe, expect, it } from 'vitest';
import { createMeter, type AiConfig } from '../src/ai/config';
import { choicesFor } from '../src/game/choices';
import { atBottleneck, need } from '../src/game/cult';
import { addDecision, breakNow, resolveDecision } from '../src/game/decisions';
import { epilogue } from '../src/game/ending';
import { admit } from '../src/game/recruit';
import { migrate } from '../src/game/save';
import { advanceSeason, planSeason } from '../src/game/season';
import { assignJob, setHead, unconvinced } from '../src/game/sect';
import { newWorld, randomStart } from '../src/game/setup';
import { talk, TALK_LIMIT } from '../src/game/talk';
import type { Person, World } from '../src/game/types';
import { visibleWish } from '../src/game/wishes';
import { members, rngOf } from '../src/game/world';
import { gameView, type Ui } from '../src/ui/views';

const fresh = (seed = 7): World => newWorld({ ...randomStart(seed), site: 'deep', origin: 'sword', heritage: 'mind' });
const offline: AiConfig = { kind: 'offline', apiKey: '', mode: 'normal' };
const ui = (over: Partial<Ui> = {}): Ui => ({ screen: 'game', tab: 'report', modal: null, setup: randomStart(7), busy: null, toast: null, sort: 'rank', chats: {}, streaming: null, testPick: {}, showHistory: false, hasSave: true, team: {}, ...over });

/** 收一个奸细进门 */
function plantSpy(w: World): Person {
  const c = w.candidates[0];
  const p = w.people[c.id];
  p.secret = { kind: 'spy', text: '是赤霄宗派来的奸细', patron: 'chixiao', exposed: false };
  admit(w, rngOf(w), c, 'outer');
  p.sect = 'me';
  if (!w.members.includes(p.id)) w.members.push(p.id);
  p.wish = { kind: 'spy', target: 'chixiao', text: '摸清这里的底细，偷到功法，回去复命', since: 0, by: 'rule' };
  return p;
}

describe('奸细藏得住', () => {
  it('别人看见的心愿是一套说辞，被揭穿后才看见真的', () => {
    const w = fresh(51);
    const p = plantSpy(w);
    expect(visibleWish(p)?.text).not.toContain('底细');
    const html = gameView(w, ui({ tab: 'people' }), offline, createMeter());
    expect(html).not.toContain('摸清这里的底细');
    p.secret!.exposed = true;
    expect(visibleWish(p)?.text).toContain('底细');
  });
  it('给主家送信不进季报、不进经历', () => {
    const w = fresh(52);
    const p = plantSpy(w);
    const plan = planSeason(w, 'off');
    advanceSeason(w, plan, { [p.id]: { id: 'leak', by: 'rule' } }, {});
    expect(p.lastAct).toBe('leak');
    expect(w.report.some((it) => it.text.includes('送信'))).toBe(false);
    expect(p.life.some((l) => l.text.includes('送信'))).toBe(false);
    expect(p.lastWhy).toBeUndefined();
  });
});

describe('花不起的选项选不了', () => {
  it('灵石不够时拒绝，事情留着等你再定', () => {
    const w = fresh(53);
    const p = members(w)[0];
    const d = addDecision(w, 'poach_alert', { who: p.id, rival: 'xuanshui' })!;
    w.sect.stones = 10;
    const err = resolveDecision(w, rngOf(w), d.id, 'raise');
    expect(err).toContain('灵石不够');
    expect(w.decisions.some((x) => x.id === d.id)).toBe(true);
    w.sect.stones = 100;
    expect(resolveDecision(w, rngOf(w), d.id, 'raise')).toBeNull();
    expect(w.sect.stones).toBe(60);
  });
});

describe('冲关', () => {
  const stuck = (w: World) => {
    const p = members(w)[0];
    p.realm = 0; p.stage = 9; p.exp = need(p);
    return p;
  };
  it('压一压之后，开春会再来求', () => {
    const w = fresh(54);
    const p = stuck(w);
    // 守规矩又胆小的人不会自己跑去闭关，只会等宗主发话
    p.traits = ['orderly', 'timid']; p.wish = null;
    while (w.t % 4 !== 3) { advanceSeason(w, planSeason(w, 'off'), {}, {}); w.decisions = []; }
    p.realm = 0; p.stage = 9; p.exp = need(p); p.alive = true;
    expect(w.decisions.length).toBe(0);
    advanceSeason(w, planSeason(w, 'off'), {}, {});
    expect(w.t % 4).toBe(0);
    expect(atBottleneck(p)).toBe(true);
    expect(w.decisions.some((d) => d.kind === 'breakthrough' && d.params.who === p.id)).toBe(true);
  });
  it('人物卡上直接下令冲关，季报里那件事就消了', () => {
    const w = fresh(55);
    const p = stuck(w);
    addDecision(w, 'breakthrough', { who: p.id });
    w.sect.fpills = 0;
    expect(breakNow(w, rngOf(w), p, 'pill')).toContain('筑基丹不够');
    expect(breakNow(w, rngOf(w), p, 'go')).toBeNull();
    expect(w.decisions.some((d) => d.kind === 'breakthrough')).toBe(false);
    expect(p.realm === 1 || p.fails === 1).toBe(true);
  });
});

describe('召见', () => {
  it('每季最多见三个人，每个话题一季一次', () => {
    const w = fresh(56);
    for (const c of w.candidates.slice(0, 2)) { const q = w.people[c.id]; q.sect = 'me'; w.members.push(q.id); }
    const ps = members(w);
    expect(ps.length).toBeGreaterThan(TALK_LIMIT);
    for (const p of ps.slice(0, TALK_LIMIT)) expect(typeof talk(w, rngOf(w), p, 'cheer')).toBe('object');
    expect(talk(w, rngOf(w), ps[0], 'cheer')).toContain('说过了');
    expect(typeof talk(w, rngOf(w), ps[0], 'status')).toBe('object');
    expect(talk(w, rngOf(w), ps[TALK_LIMIT], 'cheer')).toContain('召见了');
  });
  it('问近况能听出他不服谁', () => {
    const w = fresh(57);
    const [a, b] = members(w);
    a.realm = 0; a.stage = 1; a.merit = 0; a.fame = 0;
    b.realm = 1; b.stage = 1; b.traits = ['proud']; b.grudge = 10;
    setHead(w, 'herb', a);
    assignJob(w, b, 'herb');
    expect(unconvinced(w).some((u) => u.who === b.id)).toBe(true);
    const res = talk(w, rngOf(w), b, 'status');
    expect(typeof res === 'object' && res.reply).toContain(a.name);
  });
  it('敲打过的人，这一季不太会偷懒', () => {
    const w = fresh(58);
    const p = members(w)[0];
    p.grudge = 40; p.traits = ['lazy'];
    const before = choicesFor(w, p, { unc: [] }).find((c) => c.kind === 'slack')!.score;
    talk(w, rngOf(w), p, 'warn');
    const after = choicesFor(w, p, { unc: [] }).find((c) => c.kind === 'slack')!.score;
    expect(after).toBeLessThan(before - 2);
  });
  it('离线也能召见：对话框里有话题按钮，没有随便说的输入框', () => {
    const w = fresh(59);
    const p = members(w)[0];
    const html = gameView(w, ui({ modal: { kind: 'chat', id: p.id } }), offline, createMeter());
    expect(html).toContain('data-act="topic"');
    expect(html).not.toContain('name="say"');
  });
});

describe('结局', () => {
  it('列出每个入过山门的人的去向和宗门志', () => {
    const w = fresh(60);
    for (let i = 0; i < 12 && !w.over; i++) {
      for (const d of [...w.decisions]) resolveDecision(w, rngOf(w), d.id, d.fallback);
      w.war = null; w.needPolicy = false; w.needTech = false;
      advanceSeason(w, planSeason(w, 'off'), {}, {});
    }
    w.over = { win: true, text: '十年过去了。' };
    const e = epilogue(w);
    const listed = e.fates.flatMap((g) => g.people.map((f) => f.id));
    expect(new Set(listed)).toEqual(new Set(w.alumni));
    expect(w.annals.length).toBeGreaterThan(0);
    const html = gameView(w, ui({ modal: { kind: 'end' } }), offline, createMeter());
    expect(html).toContain('门人去向');
    expect(html).toContain('宗门志');
  });
  it('旧存档读进来补上新字段', () => {
    const w = fresh(61) as Partial<World> as World;
    delete (w as Partial<World>).annals; delete (w as Partial<World>).alumni; delete (w as Partial<World>).stats; delete (w as Partial<World>).delta;
    const m = migrate(JSON.parse(JSON.stringify(w)));
    expect(m.annals).toEqual([]);
    expect(m.alumni.length).toBe(m.members.length);
    expect(m.stats.warsWon).toBe(0);
  });
});
