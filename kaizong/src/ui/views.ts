// 所有画面：模板字符串拼 HTML。点击统一用 data-act / data-id / data-v，交给 main.ts 处理。

import type { AiConfig, Meter } from '../ai/config';
import { money } from '../ai/config';
import { atBottleneck, breakChance, lifespan, lvl, need, power, REALM_NAME, realmText, ROOT_NAME, yearsLeft } from '../game/cult';
import { TRAIT } from '../game/data/traits';
import { BUILD, buildBlock, doneText, isBuilt, MAX_LV, nextStep, workOn } from '../game/build';
import { HALL, HALL_CAP, HALLS, HERITAGES, JOB_NAME, ORIGINS, POLICIES, POLICY, RANK_NAME, rankLv, SITES, SKILL_NAME, SKILLS, TECHS, UPKEEP, VALUE_NAME, VALUES } from '../game/data/world';
import { acceptChance, candidateDaysLeft, CHECK_DAYS, ROOT_COST, visibleFacts, WANT_TEXT } from '../game/recruit';
import { MOVE_NAME, rivalStrength } from '../game/rivals';
import { breakOptions } from '../game/decisions';
import { epilogue } from '../game/ending';
import { boardSize, goalProgress, rewardText, TIER_PERK, TIERS, tierReqs, talkLimit } from '../game/goals';
import { MASTER_ACT, MASTER_ACTS, MASTER_DAYS, masterBlock, masterBreakChance, masterLeft, masterProgress } from '../game/master';
import { awayText, canSend, MAX_TEAM, missionChance, missionNeeds, suitability, tripDays, tripProgress } from '../game/missions';
import { canLearn, WAR_DAYS } from '../game/season';
import { fit, fitWord, hallHead, hallMembers, postText, sectStrength, unconvinced, underqualified } from '../game/sect';
import { audience, talkBlock, TOPIC, topicsFor, topicUsed } from '../game/talk';
import type { StartChoice } from '../game/setup';
import type { Candidate, Decision, Expedition, HallId, Mission, Person, ReportItem, Rival, World } from '../game/types';
import { enemyPower, STANCE_NAME } from '../game/war';
import { visibleWish, WISH_NAME } from '../game/wishes';
import { daysLeft, lacks, members, me, nm, P, prestige, pronoun, SEASON_DAYS, seasonName, timeText, year } from '../game/world';
import { BREAK_DAYS } from '../game/decisions';
import { soundOn } from './sfx';
import { avatar } from './avatar';
import { hudView, lettersView, masterBar, questView, railView, tickerView, warBanner } from './hud';
import { bar, esc, n0, word } from './util';

export type Tab = 'report' | 'people' | 'staff' | 'mission' | 'recruit' | 'sect' | 'world';
export type Modal =
  | null
  | { kind: 'person'; id: string }
  | { kind: 'year' }
  | { kind: 'settings' }
  | { kind: 'war' }
  | { kind: 'chat'; id: string }
  | { kind: 'end' }
  | { kind: 'help' }
  | { kind: 'confirm'; text: string; act: string }
  | { kind: 'master' };

export interface Ui {
  screen: 'title' | 'setup' | 'game';
  tab: Tab;
  /** 右边抽屉开着哪一页；null 是关着 */
  drawer: Tab | null;
  /** 时间快慢：0 暂停，1、2、4 倍 */
  speed: number;
  /** 摊开的那封待裁决 */
  letter: string | null;
  /** 因为来了急事自动停下了 */
  hold: boolean;
  /** 有事就停：all 全部、big 大事、none 不停 */
  pauseOn: 'all' | 'big' | 'none';
  modal: Modal;
  setup: StartChoice;
  busy: string | null;
  toast: string | null;
  sort: 'rank' | 'realm' | 'grudge' | 'mood' | 'loyalty';
  chats: Record<string, { from: 'me' | 'them' | 'note'; text: string }[]>;
  streaming: string | null;
  testPick: Record<string, string>;
  showHistory: boolean;
  hasSave: boolean;
  /** 任务栏上正在挑的人：任务 id → 队员 */
  team: Record<string, string[]>;
}

const TAG_NAME: Record<string, string> = { friend: '至交', rival: '死对头', lover: '道侣', enemy: '仇人', master: '师父', pupil: '徒弟', kin: '亲人' };

// ───────────────────────── 标题、开局 ─────────────────────────

export function titleView(ui: Ui, cfg: AiConfig, meter: Meter) {
  return `<main class="title-screen">
    <div class="title-art" aria-hidden="true"></div>
    <div class="title-box">
      <span class="eyebrow">修仙 · 宗门经营</span>
      <h1 class="logo">开宗立派</h1>
      <p class="tagline">从一座荒山，到一方仙门。<br>择良徒，安人心；承道统，御强敌。</p>
      <div class="title-btns">
        ${ui.hasSave ? '<button class="btn primary big" data-act="continue">继续</button>' : ''}
        <button class="btn ${ui.hasSave ? '' : 'primary'} big" data-act="new">开新局</button>
        <button class="btn ghost" data-act="settings">游戏设置</button>
        <button class="btn ghost" data-act="help">怎么玩</button>
      </div>
      <p class="fine">十年一局 · 时间自己走，可暂停、可快进 · 进度自动保存</p>
    </div>
    ${ui.modal ? modalView(null, ui, cfg, meter) : ''}
  </main>`;
}

export function setupView(ui: Ui) {
  const c = ui.setup;
  const pick = (name: string, opts: { id: string; name: string; desc: string }[], v: string) =>
    `<div class="choice-row">${opts.map((o) => `<button class="choice${o.id === v ? ' on' : ''}" data-act="setup-pick" data-id="${name}" data-v="${o.id}"><b>${esc(o.name)}</b><span>${esc(o.desc)}</span></button>`).join('')}</div>`;
  return `<main class="setup">
    <h2 class="sec-title">开宗立派</h2>
    <p class="muted">只有一件大事要你来定：山门立在哪。你的出身、宗门的传承由天定，开宗之后揭晓。</p>
    <div class="form-row">
      <label>宗门名<input data-field="sectName" value="${esc(c.sectName)}" maxlength="6"></label>
      <label>宗主道号<input data-field="masterName" value="${esc(c.masterName)}" maxlength="6"></label>
      <label>宗主<select data-field="gender"><option value="m"${c.gender === 'm' ? ' selected' : ''}>男</option><option value="f"${c.gender === 'f' ? ' selected' : ''}>女</option></select></label>
    </div>
    <h3>山门立在哪</h3>${pick('site', SITES, c.site)}
    <div class="setup-btns">
      <button class="btn ghost" data-act="back-title">返回</button>
      <button class="btn" data-act="setup-random">换个名字</button>
      <button class="btn primary big" data-act="start">开宗</button>
    </div>
  </main>`;
}

// ───────────────────────── 主界面 ─────────────────────────

/** 主界面骨架：顶栏、左边菜单、中间山门场景和四角的小块、右边抽屉、弹窗。内容由 main.ts 按块填 */
export function gameShell() {
  return `<div class="g">
    <header class="hud"></header>
    <nav class="rail" aria-label="宗门事务"></nav>
    <main class="stage">
      <div class="scene" aria-label="山门"></div>
      <div class="quest-slot"></div>
      <div class="war-slot"></div>
      <div class="banner-slot" aria-live="polite"></div>
      <div class="letters"></div>
      <div class="ticker"></div>
      <div class="master-slot"></div>
    </main>
    <aside class="drawer" aria-labelledby="dw-title">
      <header class="dw-head"><h2 id="dw-title"></h2><span class="dw-sub"></span><button class="close" data-act="drawer-close" aria-label="收起">×</button></header>
      <div class="dw-body"></div>
    </aside>
    <div class="modal-slot"></div>
    <div class="toast-slot"></div>
  </div>`;
}

/** 一次画全（测试用；网页里按块填） */
export function gameView(w: World, ui: Ui, cfg: AiConfig, meter: Meter) {
  return `<div class="g"><header class="hud">${hudView(w, ui, null)}</header><nav class="rail">${railView(w, { ...ui, drawer: ui.tab })}</nav>
    <main class="stage"><div class="quest-slot">${questView(w)}</div><div class="war-slot">${warBanner(w)}</div><div class="letters">${lettersView(w, ui)}</div><div class="ticker">${tickerView(w)}</div><div class="master-slot">${masterBar(w)}</div></main>
    <aside class="drawer" aria-labelledby="dw-title"><header class="dw-head"><h2 id="dw-title">${TAB_TITLE[ui.tab][0]}</h2></header><div class="dw-body">${tabView(w, ui)}</div></aside>${ui.modal ? modalView(w, ui, cfg, meter) : ''}</div>`;
}

export const TAB_TITLE: Record<Tab, [string, string]> = {
  report: ['宗门纪事', '知兴衰，察人心'], people: ['门下弟子', '识其才，尽其用'], staff: ['殿堂执事', '各司其职，人尽其才'], mission: ['宗门任务', '遣将出山，历练扬名'],
  recruit: ['山门迎客', '仙缘初至，择才入门'], sect: ['宗门营造', '薪火相传，道统不息'], world: ['天下风云', '远交近攻，纵览一州'],
};

export function tabView(w: World, ui: Ui) {
  switch (ui.tab) {
    case 'report': return reportTab(w, ui);
    case 'people': return peopleTab(w, ui);
    case 'staff': return staffTab(w);
    case 'mission': return missionTab(w, ui);
    case 'recruit': return recruitTab(w, ui);
    case 'sect': return sectTab(w);
    case 'world': return worldTab(w);
  }
}

// ── 季报 ──

function decisionCard(w: World, d: Decision) {
  const ppl = d.about.map((id) => P(w, id)).filter((p): p is Person => !!p);
  return `<article class="decision">
    <div class="d-head">${ppl.slice(0, 2).map((p) => `<button class="ava-btn" data-act="person" data-id="${p.id}">${avatar(p, 40)}</button>`).join('')}<h4>${esc(d.title)}</h4></div>
    <p>${esc(d.text)}</p>
    <div class="d-opts">${d.options.map((o) => { const no = lacks(w, o.cost); const hint = no ?? o.hint; return `<button class="btn sm${o.id === d.fallback ? '' : ' primary'}" data-act="decide" data-id="${d.id}" data-v="${o.id}"${no ? ' disabled' : ''}>${esc(o.label)}${hint ? `<small>${esc(hint)}</small>` : ''}</button>`; }).join('')}</div>
    <p class="fine">${d.due !== undefined ? `还有 ${daysLeft(w, d.due)} 日，` : ''}不管的话：${esc(d.options.find((o) => o.id === d.fallback)?.label ?? '')}</p>
  </article>`;
}

function reportItem(w: World, it: ReportItem) {
  const q = it.quote;
  const qp = q ? P(w, q.who) : undefined;
  const who = it.about.map((id) => P(w, id)).find(Boolean);
  return `<li class="ri ${it.tone}${it.big ? ' big' : ''}">
    ${who ? `<button class="ava-btn" data-act="person" data-id="${who.id}">${avatar(who, 30)}</button>` : '<span class="ri-dot"></span>'}
    <div><p>${linkNames(w, it.text, it.about)}</p>${q && qp ? `<blockquote>"${esc(q.text)}"<cite>——${esc(qp.name)}</cite></blockquote>` : ''}</div>
  </li>`;
}

function linkNames(w: World, text: string, ids: string[]) {
  let out = esc(text);
  for (const id of ids) {
    const p = P(w, id);
    if (p) out = out.split(esc(p.name)).join(`<button class="link" data-act="person" data-id="${p.id}">${esc(p.name)}</button>`);
  }
  return out;
}

function reportTab(w: World, ui: Ui) {
  const ds = w.decisions;
  const items = [...w.report];
  return `${ds.length ? `<h3 class="h">待裁决（${ds.length}）</h3>${ds.map((d) => decisionCard(w, d)).join('')}` : ''}
    <h3 class="h">${timeText(w.t)}（到今天）</h3>
    ${items.length ? `<ul class="report">${items.reverse().map((it) => reportItem(w, it)).join('')}</ul>` : '<p class="muted">这一季还风平浪静。</p>'}
    ${w.history.length ? `<button class="btn ghost sm" data-act="toggle-history">${ui.showHistory ? '收起往事' : '翻看往事'}</button>` : ''}
    ${ui.showHistory ? w.history.map((h) => `<h4 class="h small">${h.t < 0 ? '开山' : `${timeText(h.t)}发生的事`}</h4><ul class="report old">${h.items.map((it) => reportItem(w, it)).join('')}</ul>`).join('') : ''}`;
}

// ── 弟子 ──

function moodIcons(p: Person) {
  return `<span class="meters">${bar(p.mood, p.mood >= 50 ? 'good' : 'bad', '心情')}${bar(p.grudge, 'bad', '怨气')}${bar(p.loyalty, 'gold', '忠心')}</span>`;
}

function peopleTab(w: World, ui: Ui) {
  const sorters: Record<Ui['sort'], (a: Person, b: Person) => number> = {
    rank: (a, b) => rankLv(b.rank) - rankLv(a.rank) || lvl(b) - lvl(a),
    realm: (a, b) => lvl(b) - lvl(a) || b.exp - a.exp,
    grudge: (a, b) => b.grudge - a.grudge,
    mood: (a, b) => a.mood - b.mood,
    loyalty: (a, b) => a.loyalty - b.loyalty,
  };
  const ps = members(w).sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || sorters[ui.sort](a, b));
  const unc = unconvinced(w);
  return `<div class="row-between"><h3 class="h">弟子（${ps.length}）</h3>
    <label class="sort">排序 <select data-act="sort">${(['rank', 'realm', 'grudge', 'mood', 'loyalty'] as const).map((k) => `<option value="${k}"${ui.sort === k ? ' selected' : ''}>${{ rank: '身份', realm: '修为', grudge: '怨气大的', mood: '心情差的', loyalty: '不忠心的' }[k]}</option>`).join('')}</select></label></div>
    <p class="fine">点 ★ 标记你关心的人：他们的事一定写进纪事，接了 AI 时由 AI 来想。</p>
    <ul class="roster">${ps.map((p) => {
      const u = unc.filter((x) => x.who === p.id);
      return `<li>
        <button class="star-btn${p.starred ? ' on' : ''}" data-act="star" data-id="${p.id}" title="标记">★</button>
        <button class="roster-main" data-act="person" data-id="${p.id}">${avatar(p, 44)}
          <span class="rm-text"><b>${esc(p.name)}</b><small>${esc(realmText(p))} ${p.realm < 4 ? bar((p.exp / need(p)) * 100, 'gold', '修为') : ''} · ${esc(postText(w, p))}</small>
          <small class="wish">${visibleWish(p) ? `心愿：${esc(visibleWish(p)!.text)}` : '暂无心愿'}</small></span></button>
        <span class="rm-side">${moodIcons(p)}${u.length ? `<span class="tag bad">不服${esc(nm(w, u[0].over))}</span>` : ''}${underqualified(p) ? '<span class="tag bad">德不配位</span>' : ''}${p.breaking ? `<span class="tag gold">闭关中 ${daysLeft(w, p.breaking.until)}日</span>` : atBottleneck(p) ? '<span class="tag gold">待冲关</span>' : ''}</span>
      </li>`;
    }).join('')}</ul>`;
}

// ── 人事 ──

function staffTab(w: World) {
  const ps = members(w);
  const free = ps.filter((p) => p.job === 'none');
  const unc = unconvinced(w);
  return `<p class="fine">把人放到合适、他也愿意干的岗位上，换了差事他会自己走过去。修为高的人屈居人下会不服；修为低的人坐高位，下面的人也不服。</p>
    ${unc.length ? `<div class="warn"><b>谁不服谁：</b>${unc.slice(0, 6).map((u) => `${esc(nm(w, u.who))}不服${esc(nm(w, u.over))}`).join('；')}</div>` : ''}
    ${free.length ? `<div class="idle"><b>闲着的人：</b>${free.map((p) => `<button class="chip" data-act="person" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <div class="halls">${HALLS.filter((h) => isBuilt(w, h.id)).map((h) => hallCard(w, h.id, ps)).join('')}
      ${specialCard(w, 'seclude', '闭关', '全力修炼，不干活')}
    </div>
    ${HALLS.some((h) => !isBuilt(w, h.id)) ? `<h3 class="h">还没建的殿堂</h3><div class="halls">${HALLS.filter((h) => !isBuilt(w, h.id)).map((h) => emptyCard(w, h.id)).join('')}</div>` : ''}
    <div class="pill-rule"><b>丹药怎么分</b>
      <select data-act="pill-rule">${([['merit', '按功劳'], ['talent', '按资质'], ['equal', '雨露均沾'], ['core', '只给真传以上']] as const).map(([k, n]) => `<option value="${k}"${w.sect.pillRule === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <small>每季开头每人分一颗，那一季修炼快两成半。没分到的人如果善妒会眼红。</small></div>`;
}

/** 营造按钮：新建或扩建 */
function buildBtn(w: World, h: HallId, cls = 'xs') {
  const job = workOn(w, h);
  if (job) return `<span class="fine building">在建 · ${esc(doneText(w, job.done))}</span>`;
  const step = nextStep(w, h);
  if (!step) return '<span class="fine">已最高</span>';
  const no = buildBlock(w, h);
  return `<button class="btn ${cls}" data-act="build" data-id="${h}"${no ? ' disabled' : ''}>${step.to === 1 ? '建造' : '扩建'}（${step.cost}灵石，${step.days}日）${no && !no.startsWith('灵石不够') ? `<small>${esc(no)}</small>` : ''}</button>`;
}

function emptyCard(w: World, h: HallId) {
  const d = HALL[h];
  const need = BUILD[h].need?.(w);
  return `<article class="hall-card empty" id="hall-${h}">
    <header><h4>${d.name}<small>空地</small></h4><span class="fine">${esc(d.desc)} · 看${SKILL_NAME[d.skill]}${d.skill2 ? `、${SKILL_NAME[d.skill2]}` : ''}</span></header>
    ${need ? `<p class="fine bad-t">条件：${esc(need)}</p>` : ''}
    <div>${buildBtn(w, h, 'sm')}</div>
  </article>`;
}

const stars = (lv: number) => `${'★'.repeat(Math.max(0, lv - 1))}${'☆'.repeat(MAX_LV - Math.max(1, lv))}`;

function hallCard(w: World, h: HallId, ps: Person[]) {
  const d = HALL[h];
  const head = hallHead(w, h);
  const crew = hallMembers(w, h);
  const cap = HALL_CAP[w.sect.halls[h]];
  const out = w.sect.ledger;
  const candidates = ps.filter((p) => p.job !== h && p.job !== 'travel').sort((a, b) => fit(b, h) - fit(a, h));
  return `<article class="hall-card" id="hall-${h}">
    <header><h4>${d.name}<small>${stars(w.sect.halls[h])}</small></h4><span class="fine">${esc(d.desc)} · 看${SKILL_NAME[d.skill]}${d.skill2 ? `、${SKILL_NAME[d.skill2]}` : ''}</span></header>
    <div class="head-row"><span>主事：</span>${head ? `<button class="chip ${underqualified(head) ? 'bad' : ''}" data-act="person" data-id="${head.id}">${esc(head.name)}<small>${esc(realmText(head))}</small></button>` : '<span class="muted">空缺</span>'}
      <select data-act="set-head" data-id="${h}"><option value="">${head ? '换人…' : '任命…'}</option>${crew.concat(ps.filter((p) => !crew.includes(p) && p !== head && p.job !== 'travel')).slice(0, 30).map((p) => `<option value="${p.id}">${esc(p.name)}（${esc(realmText(p))}，${fitWord(p, h).text}）</option>`).join('')}${head ? '<option value="-">撤掉主事</option>' : ''}</select></div>
    <ul class="crew">${crew.filter((p) => p !== head).map((p) => { const f = fitWord(p, h); return `<li><button class="chip ${f.tone}" data-act="person" data-id="${p.id}">${esc(p.name)}<small>${esc(f.text)}</small></button><button class="x" data-act="unassign" data-id="${p.id}" title="撤下">×</button></li>`; }).join('')}</ul>
    ${crew.length < cap ? `<select data-act="assign" data-id="${h}"><option value="">＋ 安排人（${crew.length}/${cap}）</option>${candidates.slice(0, 30).map((p) => `<option value="${p.id}">${esc(p.name)}：${fitWord(p, h).text}${p.job !== 'none' ? `（现在${JOB_NAME[p.job]}）` : ''}</option>`).join('')}</select>` : `<p class="fine">满员（${cap}人）。${buildBtn(w, h)}</p>`}
    ${h === 'herb' && out.herbs ? `<p class="fine">这一季已产灵草 ${n0(out.herbs)}</p>` : ''}${h === 'alchemy' && out.pills ? `<p class="fine">这一季已出丹 ${n0(out.pills)}${out.fpills ? `，筑基丹 ${out.fpills}` : ''}</p>` : ''}${h === 'diplomacy' && out.trade ? `<p class="fine">这一季已赚灵石 ${n0(out.trade)}</p>` : ''}
  </article>`;
}

function specialCard(w: World, job: 'seclude', name: string, desc: string) {
  const crew = members(w).filter((p) => p.job === job);
  const others = members(w).filter((p) => p.job !== job && p.job !== 'travel');
  return `<article class="hall-card ${job}"><header><h4>${name}</h4><span class="fine">${desc}</span></header>
    <ul class="crew">${crew.map((p) => `<li><button class="chip" data-act="person" data-id="${p.id}">${esc(p.name)}<small>${esc(realmText(p))}</small></button><button class="x" data-act="unassign" data-id="${p.id}">×</button></li>`).join('')}</ul>
    <select data-act="assign" data-id="${job}"><option value="">＋ 安排人</option>${others.map((p) => `<option value="${p.id}">${esc(p.name)}（${esc(realmText(p))}）</option>`).join('')}</select></article>`;
}

// ── 任务 ──

const DANGER = (d: number) => `${'●'.repeat(d)}${'○'.repeat(5 - d)}`;

function missionTab(w: World, ui: Ui) {
  return `<p class="fine">挑一到三个弟子出去办事：打打杀杀的看战力，炼丹调解的看本事。越凶险赏得越多，也越可能有人回不来。出门的人放下手头的差事，走一趟要一两个月，回来后自己回去。任务栏有 ${boardSize(w)} 格（宗门品阶越高越多），每季开头换新的。</p>
    ${w.expeditions.length ? `<h3 class="h">在外的队伍（${w.expeditions.length}）</h3>${w.expeditions.map((e) => expeditionCard(w, e)).join('')}` : ''}
    <h3 class="h">任务栏</h3>
    ${w.missions.length ? w.missions.map((m) => missionCard(w, ui, m)).join('') : '<p class="muted">任务栏空着，下一季开头会有新的差事。</p>'}`;
}

function rewardLine(m: Mission) {
  const r = m.reward;
  return [rewardText({ ...r, gear: 0, exp: 0, candidate: 0 }), r.gear ? '一件法宝' : '', r.exp ? `每人修为 +${r.exp}` : '', r.candidate ? '带回一个好苗子' : ''].filter(Boolean).join('，');
}

function missionCard(w: World, ui: Ui, m: Mission) {
  const pick = (ui.team[m.id] ?? []).map((id) => P(w, id)).filter((p): p is Person => !!p && canSend(w, p));
  const chance = missionChance(m, pick);
  const pool = members(w).filter((p) => canSend(w, p)).sort((a, b) => suitability(b, m) - suitability(a, m));
  const slot = (i: number) => {
    if (i > pick.length) return '';
    const opts = pool.filter((p) => !pick.some((q, j) => j !== i && q.id === p.id));
    return `<select data-act="team" data-id="${m.id}:${i}"><option value="">${i === 0 ? '挑领队…' : '再添一人…'}</option>${opts.map((p) => `<option value="${p.id}"${pick[i]?.id === p.id ? ' selected' : ''}>${esc(p.name)} · ${esc(realmText(p))} · 战力${n0(power(p))} · ${SKILL_NAME[m.skill]}${Math.round(p.skills[m.skill])}${p.head ? ' · 主事' : ''}</option>`).join('')}${pick[i] ? '<option value="-">不派这人</option>' : ''}</select>`;
  };
  const heads = pick.filter((p) => p.head);
  return `<article class="mission">
    <header><h4>${esc(m.title)}</h4><span class="danger" title="凶险">${DANGER(m.danger)}</span></header>
    <p>${esc(m.desc)}</p>
    <p class="fine">${esc(missionNeeds(m))} · 一趟 ${tripDays(m)} 日 · ${m.expires <= w.t ? `这一季没人接就撤下（还有 ${SEASON_DAYS - (w.day ?? 0)} 日）` : '还能挂两季'}</p>
    <p class="fine">办成了：<b class="good-t">${esc(rewardLine(m))}</b>${m.danger >= 3 ? ' · <span class="bad-t">没办成可能有人回不来</span>' : ''}</p>
    <div class="team-pick">${Array.from({ length: MAX_TEAM }, (_, i) => slot(i)).join('')}</div>
    ${heads.length ? `<p class="warn">${heads.map((p) => `${esc(p.name)}是${HALL[p.head!].name}主事，走了${HALL[p.head!].name}就没人主事`).join('；')}。</p>` : ''}
    <div class="d-opts"><button class="btn sm primary" data-act="dispatch" data-id="${m.id}"${pick.length ? '' : ' disabled'}>派出去<small>${pick.length ? `把握 ${Math.round(chance * 100)}%` : '先挑人'}</small></button></div>
  </article>`;
}

function expeditionCard(w: World, e: Expedition) {
  const team = e.team.map((id) => P(w, id)).filter((p): p is Person => !!p);
  return `<div class="exp-row"><b>${esc(e.mission.title)}</b><span>${team.map((p) => `<button class="link" data-act="person" data-id="${p.id}">${esc(p.name)}</button>`).join('、')}</span><small class="fine">把握 ${Math.round(e.chance * 100)}% · 还有 ${daysLeft(w, e.back)} 日回山 ${bar(tripProgress(w, e) * 100, 'gold')}</small></div>`;
}

// ── 宗主 ──

function masterModal(w: World) {
  const m = me(w);
  const cur = w.masterPlan;
  const stuck = atBottleneck(m);
  const card = (act: (typeof MASTER_ACTS)[number]) => {
    const d = MASTER_ACT[act];
    const on = cur.act === act;
    let extra = '';
    if (d.target === 'disciple') {
      const ps = members(w).filter((p) => p.job !== 'travel').sort((a, b) => b.root.apt - a.root.apt || lvl(b) - lvl(a));
      extra = `<select data-act="master-target" data-id="teach"><option value="">${on ? `正在教${esc(nm(w, cur.target))}，换人…` : '教谁…'}</option>${ps.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(realmText(p))} · ${ROOT_NAME[p.root.kind]}${atBottleneck(p) ? ' · 圆满' : ''}</option>`).join('')}</select>`;
    } else if (d.target === 'rival') {
      const rs = w.rivals.filter((r) => r.alive && r.status !== 'war');
      extra = `<select data-act="master-target" data-id="visit"><option value="">${on ? `正要拜访${esc(w.rivals.find((r) => r.id === cur.target)?.name)}，换一家…` : '拜访哪家…'}</option>${rs.map((r) => `<option value="${r.id}">${esc(r.name)}（对你${word(r.attitude, [[40, '友善'], [10, '客气'], [-20, '冷淡'], [-50, '敌视'], [-100, '仇视']])}）</option>`).join('')}</select>`;
    } else {
      const no = masterBlock(w, act);
      extra = `<button class="btn sm${on ? '' : ' primary'}" data-act="master-act" data-id="${act}"${no || on ? ' disabled' : ''}>${on ? '正在做' : '就这么定'}${no ? `<small>${esc(no)}</small>` : ''}</button>`;
    }
    const desc = act === 'seclude' && stuck ? `修为圆满，闭关一轮就冲击${REALM_NAME[m.realm + 1]}，成算 ${Math.round(masterBreakChance(w) * 100)}%。失败会受伤、跌修为。` : d.desc;
    return `<div class="choice${on ? ' on' : ''}"><b>${d.name}<small> · 一轮 ${MASTER_DAYS[act]} 日</small></b><span>${esc(desc)}</span>${on ? `<span class="fine">已做 ${Math.round(masterProgress(w) * 100)}%，还有 ${masterLeft(w)} 日</span>` : ''}${extra}</div>`;
  };
  return `<h3 class="sec-title">宗主在做什么</h3>
    <p class="muted">${esc(m.name)}，${esc(realmText(m))}${m.realm < 4 ? `，修为 ${Math.round(stuck ? 100 : (m.exp / need(m)) * 100)}%` : ''}。每件事做满一轮出结果，然后接着做；中途换别的，这一轮就白做了。</p>
    <div class="choice-row">${MASTER_ACTS.map(card).join('')}</div>`;
}

// ── 招募 ──

function candidateCard(w: World, c: Candidate, ui: Ui) {
  const f = visibleFacts(w, c);
  const p = f.p;
  const pickSkill = ui.testPick[c.id] ?? 'combat';
  const via = { open: '开山收徒', walkin: '上门投奔', spy: '上门投奔', refer: '引荐', genius: '慕名而来' }[c.via];
  const rk = (r: 'probation' | 'outer' | 'inner' | 'core') => `<button class="btn sm${r === 'outer' ? ' primary' : ''}" data-act="admit" data-id="${c.id}" data-v="${r}">收为${RANK_NAME[r]}<small>愿意来 ${Math.round(acceptChance(w, c, r) * 100)}%</small></button>`;
  return `<article class="cand">
    <div class="cand-top">${avatar(p, 56, { mood: false })}<div>
      <h4>${esc(p.name)} <small>${p.gender === 'f' ? '女' : '男'} · ${p.age}岁 · ${esc(f.realm)}</small></h4>
      <p class="fine">${via}${c.courtedBy ? ` · <b class="bad-t">${esc(w.rivals.find((r) => r.id === c.courtedBy)?.name)}也在请他</b>` : ''} · 还能等 ${candidateDaysLeft(w, c)} 日 · 耐心 ${'●'.repeat(Math.max(0, c.patience))}${'○'.repeat(Math.max(0, 4 - c.patience))}</p>
    </div></div>
    <p><b>自述：</b>${esc(c.claim)}</p>
    <p><b>想要：</b>${WANT_TEXT[c.wants]}</p>
    ${c.rumor ? `<p><b>传闻：</b>${esc(c.rumor)}</p>` : ''}
    <p><b>你的印象：</b>${c.hints.map(esc).join('；')}<small class="fine">（迎客堂越得力，印象越准）</small></p>
    <div class="known">
      <span>灵根：${c.known.root ? `<b>${ROOT_NAME[p.root.kind]}</b>（${p.root.els.join('')}）` : `<button class="btn xs" data-act="c-root" data-id="${c.id}">测灵根（${ROOT_COST}灵石）</button>`}</span>
      <span>才干：${f.skills.map((s) => `${s.name} <b>${s.v}</b>/天分${s.cap}`).join('，') || '未考'}
        <select data-act="c-pick" data-id="${c.id}">${SKILLS.filter((s) => !c.known.skills.includes(s)).map((s) => `<option value="${s}"${s === pickSkill ? ' selected' : ''}>${SKILL_NAME[s]}</option>`).join('')}</select>
        <button class="btn xs" data-act="c-test" data-id="${c.id}">考一考（耗耐心）</button></span>
      <span>性格：${f.traits ? `<b>${f.traits.join('、')}</b>；喜欢${f.likes!.map((j) => JOB_NAME[j]).join('、')}` : w.sect.tech.includes('heart_array') ? `<button class="btn xs" data-act="c-heart" data-id="${c.id}">入问心阵</button>` : '<span class="muted">看不透（要问心阵）</span>'}</span>
      <span>来历：${f.secretHint ? `<b class="${c.known.origin === 'false' ? 'bad-t' : ''}">${esc(f.secretHint)}</b>` : c.known.origin === 'checking' ? `派人去查了，还有 ${daysLeft(w, c.checkAt ?? 0)} 日出结果` : `<button class="btn xs" data-act="c-check" data-id="${c.id}">派人去查（要 ${CHECK_DAYS} 日）</button>`}</span>
    </div>
    <div class="d-opts">${rk('probation')}${rk('outer')}${rk('inner')}${rk('core')}<button class="btn sm ghost" data-act="dismiss" data-id="${c.id}">婉拒</button></div>
  </article>`;
}

function recruitTab(w: World, ui: Ui) {
  const cs = w.candidates;
  const upkeep = Object.entries(UPKEEP).filter(([k]) => k !== 'master').map(([k, v]) => `${RANK_NAME[k as 'outer']}${v}`).join('、');
  return `<p class="fine">招人是为了安排岗位：先弄清他会什么、喜欢干什么、靠不靠得住。测灵根花灵石，考才干花他的耐心，查来历要等一个多月。他们不会一直等。记名弟子试用一年再定。<br>每季月例（分三个月发）：${upkeep}灵石。</p>
    ${cs.length ? cs.map((c) => candidateCard(w, c, ui)).join('') : `<p class="muted">迎客堂里没人。${w.t % 4 === 0 ? '' : '每年春天开山收徒，平时也会有人上门投奔。'}</p>`}`;
}

// ── 宗门 ──

function sectTab(w: World) {
  const s = w.sect;
  const branches = [...new Set(TECHS.map((t) => t.branch))];
  const l = s.ledger;
  const next = w.tier + 1 < TIERS.length ? tierReqs(w, w.tier + 1) : [];
  const g = w.goal;
  const gp = g ? goalProgress(w, g) : null;
  return `<h3 class="h">宗门品阶：${TIERS[w.tier]}</h3>
    ${next.length ? `<p class="fine">晋为「${TIERS[w.tier + 1]}」要：</p><ul class="reqs">${next.map((r) => `<li class="${r.have >= r.need ? 'ok' : ''}"><span>${esc(r.label)}</span><b>${r.have}/${r.need}</b></li>`).join('')}</ul><p class="fine">晋阶后：${esc(TIER_PERK[w.tier + 1])}。品阶只升不降。</p>` : '<p>已是一方圣地。</p>'}
    <h3 class="h">今年的大计</h3>
    <p>${g ? `<b>${esc(g.text)}</b>${g.done ? ' <span class="good-t">已成</span>' : `（${gp!.have}/${g.target}${gp!.atYearEnd ? '，年末算' : ''}）`}<br><small class="fine">赏：${esc(rewardText(g.reward))}</small>` : w.needGoal ? '<span class="bad-t">还没定</span>' : '今年没定大计'}</p>
    <h3 class="h">今年的方略</h3>
    <p>${s.policy ? `<b>${POLICY[s.policy].name}</b>：${esc(POLICY[s.policy].desc)}` : '<span class="bad-t">还没定</span>'} <button class="btn sm" data-act="open-year" ${w.needPolicy || w.needTech || w.needGoal ? '' : 'disabled'}>${w.needPolicy || w.needTech || w.needGoal ? '去定' : '明年再定'}</button></p>
    <h3 class="h">传承</h3>
    <div class="tree">${branches.map((b) => `<div class="branch"><b>${b}</b>${TECHS.filter((t) => t.branch === b).map((t) => `<span class="node ${s.tech.includes(t.id) ? 'have' : canLearn(w, t.id) ? 'can' : 'lock'}" title="${esc(t.desc)}">${esc(t.name)}<small>${esc(t.desc)}</small></span>`).join('')}</div>`).join('')}</div>
    <h3 class="h">殿堂</h3>
    <p class="fine">殿堂要一座座建：花灵石，盖一两个月才落成，山上能看见脚手架一点点长高。工匠有限，同时只能建 ${s.works.length ? `${s.works.length}/` : ''}${w.tier >= 2 ? 2 : 1} 处${w.tier >= 2 ? '' : '（中品宗门以后两处）'}。</p>
    <div class="up-list">${HALLS.map((h) => { const lv = s.halls[h.id]; return `<div class="up${lv ? '' : ' empty'}"><span>${h.name} ${lv ? stars(lv) : ''}<small>${lv ? `可放 ${HALL_CAP[lv]} 人` : '空地'}</small></span>${buildBtn(w, h.id)}</div>`; }).join('')}</div>
    <h3 class="h">宗门大比</h3>
    <p class="fine">按实力排座次，一年内大家都认这个排名，最能服众。要演武场，花 60 灵石，每年一次。</p>
    <button class="btn" data-act="tourney" ${s.tech.includes('arena') && s.tourneyYear !== year(w.t) ? '' : 'disabled'}>办宗门大比</button>
    <h3 class="h">这一季到今天的收支</h3>
    <p class="fine">山门收入 ${n0(l.income ?? 0)}，外事堂 ${n0(l.trade ?? 0)}，器阁花费 ${n0(-(l.forge ?? 0))}，月例 ${n0(-(l.upkeep ?? 0))}，季初分丹药 ${l.pillsUsed ?? 0} 颗。</p>
    <p class="fine">正邪：${s.align >= 30 ? '名门正派' : s.align >= 0 ? '中正' : s.align > -40 ? '亦正亦邪' : '魔道'}（${Math.round(s.align)}）</p>`;
}

// ── 天下 ──

function rivalCard(w: World, rv: Rival) {
  const m = P(w, rv.master);
  const ours = sectStrength(w);
  const theirs = rivalStrength(w, rv);
  const att = rv.attitude;
  const status = { neutral: '相安无事', ally: '盟友', hostile: '交恶', war: '交战中', truce: '休战' }[rv.status];
  return `<article class="rival" style="--c:${rv.color}">
    <header>${m ? avatar(m, 48) : ''}<div><h4>${esc(rv.name)}${rv.alive ? '' : '（已覆灭）'}</h4><p class="fine">宗主${esc(m?.name)} · ${m ? esc(realmText(m)) : ''} · ${status}</p></div></header>
    ${rv.alive ? `<p>实力约为你的 <b>${(theirs / Math.max(1, ours)).toFixed(1)}</b> 倍；对你${word(att, [[40, '颇有好感'], [10, '还算客气'], [-20, '看不顺眼'], [-50, '敌意很深'], [-100, '恨之入骨']])}（${Math.round(att)}）${bar((att + 100) / 2, att >= 0 ? 'good' : 'bad')}</p>
    ${rv.lastMove && !rv.passive ? `<p class="fine">最近：${rv.hidden ? '没看出什么动静' : `${esc(rv.lastMove)}${rv.lastWhy ? `——"${esc(rv.lastWhy)}"` : ''}`}</p>` : ''}
    <p class="fine">名望 ${n0(rv.rep)} · 灵脉 ${rv.veins} · 有名有姓的：${[rv.master, ...rv.named].map((id) => P(w, id)).filter((p) => p?.alive && p.sect === rv.id).map((p) => `<button class="link" data-act="person" data-id="${p!.id}">${esc(p!.name)}</button>`).join('、')}</p>
    ${rv.passive ? '<p class="fine">太一门超然物外，不掺和小宗门的事。</p>' : `<div class="d-opts">
      <button class="btn sm" data-act="dip" data-id="${rv.id}" data-v="gift">送礼（80灵石）</button>
      <button class="btn sm" data-act="dip" data-id="${rv.id}" data-v="ally" ${att >= 40 && rv.status !== 'ally' ? '' : 'disabled'}>结盟</button>
      <button class="btn sm" data-act="dip" data-id="${rv.id}" data-v="insult">挑衅</button>
      <button class="btn sm danger" data-act="dip" data-id="${rv.id}" data-v="war" ${rv.status === 'war' || rv.status === 'truce' || w.war || w.pendingWar ? 'disabled' : ''}>宣战（抢灵脉，${WAR_DAYS}日后开打）</button>
    </div>`}` : ''}
  </article>`;
}

function worldTab(w: World) {
  const rows = [{ name: w.sect.name, rep: w.sect.rep, str: sectStrength(w), me: true }, ...w.rivals.filter((r) => r.alive).map((r) => ({ name: r.name, rep: r.rep, str: rivalStrength(w, r), me: false }))].sort((a, b) => b.rep - a.rep);
  return `<h3 class="h">一州宗门（按名望）</h3>
    <ol class="ranking">${rows.map((r) => `<li class="${r.me ? 'me' : ''}"><b>${esc(r.name)}</b><span>名望 ${n0(r.rep)} · 实力 ${n0(r.str)}</span></li>`).join('')}</ol>
    ${w.rivals.map((rv) => rivalCard(w, rv)).join('')}`;
}

// ───────────────────────── 弹窗 ─────────────────────────

export function modalView(w: World | null, ui: Ui, cfg: AiConfig, meter: Meter) {
  const m = ui.modal!;
  let body = '';
  let wide = false;
  switch (m.kind) {
    case 'person': wide = true; body = w ? personModal(w, P(w, m.id)!, cfg) : ''; break;
    case 'year': body = w ? yearModal(w) : ''; wide = true; break;
    case 'settings': body = settingsModal(cfg, meter, !!w, ui.pauseOn); break;
    case 'war': body = w ? warModal(w) : ''; wide = true; break;
    case 'chat': body = w ? chatModal(w, ui, P(w, m.id)!, cfg) : ''; break;
    case 'end': body = w ? endModal(w) : ''; break;
    case 'help': body = helpModal(); wide = true; break;
    case 'master': body = w ? masterModal(w) : ''; wide = true; break;
    case 'confirm': body = `<p>${esc(m.text)}</p><div class="d-opts"><button class="btn primary" data-act="${m.act}" data-v="yes">确定</button><button class="btn ghost" data-act="close">取消</button></div>`; break;
  }
  const closable = !(m.kind === 'war' || m.kind === 'end');
  return `<div class="modal-bg"${closable ? ' data-act="close-bg"' : ''}><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${{master:'宗主亲为',person:'弟子详情',year:'开春',settings:'游戏设置',war:'宗门战',chat:'召见',end:'本局结算',help:'玩法说明',confirm:'确认操作'}[m.kind]}" tabindex="-1">${closable ? '<button class="close" data-act="close" aria-label="关闭">×</button>' : ''}${body}</div></div>`;
}

function personModal(w: World, p: Person, cfg: AiConfig) {
  const mine = p.sect === 'me';
  const isMe = p.id === w.me;
  const unc = mine ? unconvinced(w) : [];
  const myUnc = unc.filter((u) => u.who === p.id);
  const overMe = unc.filter((u) => u.over === p.id);
  const ties = Object.entries(p.ops).filter(([id, o]) => P(w, id)?.alive && (o.tag || Math.abs(o.aff) >= 25)).sort((a, b) => Math.abs(b[1].aff) - Math.abs(a[1].aff)).slice(0, 8);
  const life = [...p.life].reverse();
  const wish = visibleWish(p);
  const tb = mine && !isMe ? talkBlock(w, p) : null;
  void cfg;
  return `<div class="pcard">
    <div class="pc-left">
      ${avatar(p, 128)}
      <h3>${esc(p.name)}${p.starred ? ' ★' : ''}</h3>
      <p class="muted">${p.gender === 'f' ? '女' : '男'} · ${p.age}岁 · 寿元${lifespan(p)}${yearsLeft(p) < 20 ? `（<b class="bad-t">只剩${yearsLeft(p)}年</b>）` : ''}</p>
      <p><b>${esc(realmText(p))}</b>${p.realm < 4 ? ` ${bar((p.exp / need(p)) * 100, 'gold', '修为进度')}` : ''}</p>
      ${atBottleneck(p) && !isMe && !mine ? `<p class="fine">修为圆满，冲关成算：不用丹 ${Math.round(breakChance(p, false) * 100)}% / 用丹 ${Math.round(breakChance(p, true) * 100)}%</p>` : ''}
      <p>${ROOT_NAME[p.root.kind]}（${p.root.els.join('')}）· 悟性 ${p.wit} · 战力 ${n0(power(p))}</p>
      <p>${mine ? esc(postText(w, p)) : p.sect ? esc(w.rivals.find((r) => r.id === p.sect)?.name ?? '') + ' · ' + RANK_NAME[p.rank] : '散修'}</p>
      ${mine && !isMe ? `<div class="meters-big"><span>心情 ${bar(p.mood, p.mood >= 50 ? 'good' : 'bad')}</span><span>怨气 ${bar(p.grudge, 'bad')}</span><span>忠心 ${bar(p.loyalty, 'gold')}</span><span>威望 <b>${prestige(w, p)}</b></span></div>` : ''}
      ${p.death ? `<p class="bad-t">${esc(p.death)}</p>` : ''}
      ${awayText(w, p) ? `<p class="fine">${esc(awayText(w, p))}</p>` : ''}
    </div>
    <div class="pc-right">
      ${wish && mine ? `<div class="wish-box"><b>心愿：</b>${esc(wish.text)}<small>${WISH_NAME[wish.kind]}${wish.by === 'ai' ? ` · ${pronoun(p)}自己说的` : ''}</small></div>` : ''}
      ${p.breaking ? `<div class="break-box"><b>正在洞府里闭关，冲击${REALM_NAME[p.realm + 1]}</b><p class="fine">还有 ${daysLeft(w, p.breaking.until)} 日出关${p.breaking.pill ? '（服了丹药）' : ''}。</p></div>` : ''}
      ${mine && !isMe && atBottleneck(p) && !p.breaking ? `<div class="break-box"><b>修为圆满，可以冲击${REALM_NAME[p.realm + 1]}了</b><div class="d-opts">${breakOptions(w, p).map((o) => { const no = lacks(w, o.cost); return `<button class="btn sm${o.id === 'go' ? '' : ' primary'}" data-act="break" data-id="${p.id}" data-v="${o.id}"${no ? ' disabled' : ''}>${esc(o.label)}<small>${esc(no ?? o.hint ?? '')}</small></button>`; }).join('')}</div><small class="fine">进洞闭关 ${BREAK_DAYS} 日出结果。失败会受内伤、跌一半修为、折两年寿元；败得越多越难。</small></div>` : ''}
      ${p.lastWhy && mine ? `<div class="quote">"${esc(p.lastWhy)}"</div>` : ''}
      <h4>性格</h4><div class="chips">${p.traits.map((t) => `<span class="chip" title="${esc(TRAIT[t]?.desc)}">${esc(TRAIT[t]?.name)}<small>${esc(TRAIT[t]?.desc)}</small></span>`).join('')}</div>
      <p class="fine">看重：${[...VALUES].sort((a, b) => p.values[b] - p.values[a]).slice(0, 2).map((v) => VALUE_NAME[v]).join('、')} · 出身：${esc(p.origin)} · 怪癖：${esc(p.quirk)}</p>
      <p class="fine">喜欢干：${p.likes.map((j) => JOB_NAME[j]).join('、') || '—'}；讨厌：${p.dislikes.map((j) => JOB_NAME[j]).join('、') || '—'}</p>
      ${p.secret?.exposed ? `<p class="bad-t">已知秘密：${esc(p.name)}${esc(p.secret.text)}</p>` : ''}
      <h4>才干</h4><div class="skills">${SKILLS.map((s) => `<span><em>${SKILL_NAME[s]}</em>${bar(p.skills[s], 'info')}<small>${Math.round(p.skills[s])}/${Math.round(p.caps[s])}</small></span>`).join('')}</div>
      ${myUnc.length || overMe.length ? `<p class="warn">${myUnc.map((u) => `不服${esc(nm(w, u.over))}`).join('；')}${myUnc.length && overMe.length ? '；' : ''}${overMe.map((u) => `${esc(nm(w, u.who))}不服${p.gender === 'f' ? '她' : '他'}`).join('；')}</p>` : ''}
      ${ties.length ? `<h4>人情</h4><ul class="ties">${ties.map(([id, o]) => `<li><button class="link" data-act="person" data-id="${id}">${esc(nm(w, id))}</button>${o.tag ? `<span class="tag">${TAG_NAME[o.tag]}</span>` : ''}<span class="${o.aff >= 0 ? 'good-t' : 'bad-t'}">${o.aff >= 50 ? '很亲近' : o.aff >= 25 ? '有好感' : o.aff <= -50 ? '很厌恶' : '不喜欢'}</span></li>`).join('')}</ul>` : ''}
      ${mine && !isMe ? `<h4>宗主的安排</h4><div class="acts">
        <button class="btn sm" data-act="star" data-id="${p.id}">${p.starred ? '取消标记' : '★ 标记'}</button>
        ${p.job === 'travel' ? '' : `<select data-act="p-job" data-id="${p.id}"><option value="">调岗…</option>${[...HALLS.filter((h) => isBuilt(w, h.id)).map((h) => h.id), 'seclude', 'none'].map((j) => `<option value="${j}">${JOB_NAME[j as HallId]}${j in HALL ? `（${fitWord(p, j as HallId).text}）` : ''}</option>`).join('')}</select>`}
        <select data-act="p-rank" data-id="${p.id}"><option value="">身份…</option>${(['probation', 'outer', 'inner', 'core', 'chief', 'elder'] as const).filter((r) => r !== p.rank).map((r) => `<option value="${r}">${RANK_NAME[r]}</option>`).join('')}</select>
        <button class="btn sm" data-act="vouch" data-id="${p.id}" title="花 5 点宗主威望">当众撑腰</button>
        <button class="btn sm" data-act="gift-pill" data-id="${p.id}" title="3 颗丹药">赏丹</button>
        <button class="btn sm" data-act="chat" data-id="${p.id}"${tb ? ` disabled title="${esc(tb)}"` : ''}>召见${p.talked?.t === w.t ? '（这一季见过）' : ''}<small>${esc(tb ?? `这一季还能见 ${talkLimit(w) - audience(w).length} 人`)}</small></button>
        <button class="btn sm danger" data-act="expel" data-id="${p.id}">逐出山门</button>
      </div>` : ''}
      <h4>经历</h4><ol class="life">${life.map((l) => `<li class="${l.tone}${l.big ? ' big' : ''}"><time>${timeText(l.t)}</time>${esc(l.text)}</li>`).join('') || '<li class="muted">还没什么经历。</li>'}</ol>
    </div>
  </div>`;
}

function yearModal(w: World) {
  const s = w.sect;
  const ly = w.lastYear;
  const todo = [w.needGoal && '大计', w.needPolicy && '方略', w.needTech && '传承'].filter(Boolean);
  return `<h3 class="sec-title">第${year(w.t)}年 · 开春</h3>
    <p class="muted">${todo.length ? `定下今年的${todo.join('、')}，时间就接着走。` : '都定好了。'}</p>
    ${w.needGoal ? `<h3>今年的大计</h3><p class="muted">办成了有赏；没办成，弟子们会觉得宗主说话不算数。</p>
    <div class="choice-row">${w.goalOffers.map((g, i) => `<button class="choice" data-act="goal" data-id="${i}"><b>${esc(g.text)}</b><span>赏：${esc(rewardText(g.reward))}</span></button>`).join('')}</div>` : w.goal ? `<p>今年大计：<b>${esc(w.goal.text)}</b></p>` : ''}
    ${w.needPolicy ? `<h3>今年的方略</h3><p class="muted">选中的方向全年有加成，也会影响弟子们的心态。</p>
    <div class="choice-row">${POLICIES.map((p) => `<button class="choice" data-act="policy" data-id="${p.id}"><b>${p.name}</b><span>${esc(p.desc)}</span></button>`).join('')}</div>` : s.policy ? `<p>今年方略：<b>${POLICY[s.policy].name}</b></p>` : ''}
    ${w.needTech ? `<h3>点一格传承</h3><div class="choice-row">${TECHS.filter((t) => canLearn(w, t.id)).map((t) => `<button class="choice${t.align ? ' evil' : ''}" data-act="tech" data-id="${t.id}"><b>${t.branch} · ${t.name}</b><span>${esc(t.desc)}</span></button>`).join('')}</div>` : ''}
    ${w.t === 0 ? openingBlock(w) : ''}
    ${ly ? `<section class="review"><h4>第${ly.year}年回顾</h4>
      ${ly.goal ? `<p class="${ly.goal.ok ? 'good-t' : 'bad-t'}">大计「${esc(ly.goal.text)}」${ly.goal.ok ? `成了，得${esc(ly.goal.reward)}` : '没成'}</p>` : ''}
      <div class="end-nums">${ly.lines.map(([k, v]) => `<div><em>${esc(k)}</em><b>${esc(v)}</b></div>`).join('')}</div></section>` : ''}`;
}

/** 开宗头一个春天：天定的出身、传承，和亲手选的山门 */
function openingBlock(w: World) {
  const s = w.sect;
  const o = ORIGINS.find((x) => x.id === s.origin), h = HERITAGES.find((x) => x.id === s.heritage), site = SITES.find((x) => x.id === s.site);
  const built = HALLS.filter((x) => isBuilt(w, x.id)).map((x) => x.name).join('、');
  return `<section class="review"><h4>天定的来历</h4>
    <div class="end-nums fate-nums">
      <div><em>你的出身</em><b>${esc(o?.name)}</b><small>${esc(o?.desc)}</small></div>
      <div><em>宗门传承</em><b>${esc(h?.name)}</b><small>${esc(h?.desc)}</small></div>
      <div><em>山门</em><b>${esc(site?.name)}</b><small>${esc(site?.desc)}</small></div>
    </div>
    <p class="fine">山上眼下只有${esc(built)}。其余殿堂要在「宗门」里花灵石一座座建起来。</p></section>`;
}

function warModal(w: World) {
  const war = w.war!;
  const rv = w.rivals.find((r) => r.id === war.enemy)!;
  const team = war.team.map((id) => P(w, id)).filter((p): p is Person => !!p);
  if (war.phase === 'prep') {
    const ms = members(w).filter((p) => p.job !== 'travel').sort((a, b) => power(b) - power(a));
    return `<h3 class="sec-title bad-t">${esc(rv.name)}${war.byPlayer ? '之战' : '打上门来了'}</h3>
      <p>${war.byPlayer ? `你向${esc(rv.name)}开战，要抢他们一条灵脉。` : `${esc(rv.name)}宗主${esc(nm(w, rv.master))}带人攻山。守不住会丢灵脉、毁殿堂；灵脉丢光后再输，山门就没了。`}</p>
      <p>敌方实力约 <b>${n0(enemyPower(w))}</b>（会派出一部分人）。你这边全宗实力约 <b>${n0(sectStrength(w))}</b>。</p>
      <h4>派谁出战（最多 8 人）</h4>
      <ul class="team">${ms.map((p) => `<li><label><input type="checkbox" data-act="war-team" data-id="${p.id}"${war.team.includes(p.id) ? ' checked' : ''}> ${avatar(p, 28)} ${esc(p.name)} <small>${esc(realmText(p))} · 战力${n0(power(p))}${p.hp < 60 ? ' · 有伤' : ''}${p.grudge >= 60 ? ' · 怨气大' : ''}</small></label></li>`).join('')}</ul>
      <h4>打法</h4>
      <div class="choice-row">${(['hold', 'sally', 'ambush'] as const).map((st) => `<button class="choice${war.stance === st ? ' on' : ''}" data-act="war-stance" data-id="${st}"><b>${STANCE_NAME[st]}</b><span>${{ hold: war.stake === 'mountain' ? `守在山门里${w.sect.tech.includes('guard_array') ? '，护山大阵加成 ×1.6' : '，×1.3'}` : '稳扎稳打', sally: '主动出击，战力 +12%，但伤亡更大', ambush: '设伏：有情报（星象预警、策反的奸细）时 ×1.45，没有反而吃亏' }[st]}</span></button>`).join('')}</div>
      <div class="d-opts"><button class="btn primary big" data-act="war-go" ${team.length ? '' : 'disabled'}>开战</button></div>`;
  }
  const last = war.log.map((l) => `<li class="ri ${l.tone}"><p>${esc(l.text)}</p></li>`).join('');
  const roster = team.map((p) => `<span class="chip ${p.alive ? (p.hp < 40 ? 'bad' : '') : 'dead'}">${esc(p.name)}<small>${p.alive ? (p.sect === 'me' ? `气血${Math.round(p.hp)}` : '倒戈') : '战死'}</small></span>`).join('');
  if (war.phase === 'done') {
    return `<h3 class="sec-title">${esc(rv.name)}之战 · 结束</h3><ul class="report">${last}</ul><p><b>${war.wins >= 2 ? '我方获胜' : '我方落败'}</b>（${war.wins} 胜 ${war.losses} 负）</p><div class="chips">${roster}</div><div class="d-opts"><button class="btn primary" data-act="war-close">收兵</button></div>`;
  }
  const meP = me(w);
  return `<h3 class="sec-title">${esc(rv.name)}之战 · 第${war.round}轮后</h3>
    <ul class="report">${last}</ul>
    <p>战况：${war.wins} 胜 ${war.losses} 负（三轮两胜）。你的气血 ${Math.round(meP.hp)}。</p>
    <div class="chips">${roster}</div>
    <div class="d-opts">
      <button class="btn primary" data-act="war-round" data-v="push">继续打</button>
      <button class="btn" data-act="war-round" data-v="master" ${meP.hp > 30 ? '' : 'disabled'}>宗主亲自出手<small>可能和对方宗主交手</small></button>
      <button class="btn" data-act="war-heal" ${w.sect.pills >= 3 ? '' : 'disabled'}>用丹药疗伤<small>库里 ${n0(w.sect.pills)} 颗</small></button>
      <button class="btn ghost" data-act="war-retreat">撤兵求和<small>损失小一些</small></button>
    </div>`;
}

function chatModal(w: World, ui: Ui, p: Person, cfg: AiConfig) {
  const lines = ui.chats[p.id] ?? [];
  const ai = cfg.kind === 'deepseek' && !!cfg.apiKey;
  const busy = ui.streaming !== null;
  const block = talkBlock(w, p);
  const left = talkLimit(w) - audience(w).length;
  const topics = topicsFor(p).map((t) => {
    const used = topicUsed(w, p, t);
    return `<button class="btn sm" data-act="topic" data-id="${p.id}" data-v="${t}"${used || block || busy ? ' disabled' : ''}>${TOPIC[t].name}<small>${used ? '这一季问过了' : esc(TOPIC[t].hint)}</small></button>`;
  }).join('');
  return `<div class="chat">
    <header>${avatar(p, 48)}<div><h3>${esc(p.name)}</h3><p class="fine">${esc(postText(w, p))} · ${esc(realmText(p))} · ${esc(p.voice)}</p></div></header>
    <ol class="chat-lines">${lines.length ? '' : `<li class="note">${esc(p.name)}来了，站在一旁等你开口。</li>`}${lines.map((l) => `<li class="${l.from}">${esc(l.text)}</li>`).join('')}${busy ? `<li class="them typing">${esc(ui.streaming) || '……'}</li>` : ''}</ol>
    ${block ? `<p class="warn">${esc(block)}</p>` : ''}
    <div class="topics">${topics}</div>
    ${ai ? `<form data-form="chat" data-id="${p.id}"><input name="say" maxlength="80" placeholder="或者随便说点什么……" autocomplete="off" ${busy || block ? 'disabled' : ''}><button class="btn primary" ${busy || block ? 'disabled' : ''}>说</button></form>` : ''}
    <p class="fine">${p.talked?.t === w.t ? '这一季已经召见过' + pronoun(p) + '，接着说不再占名额。' : `这一季还能召见 ${left} 人。`}每个话题一季问一次，后果按规矩算${ai ? '；AI 照这个意思用他的口吻说。随便说的话，每季前三句会影响他的心情' : '。在设置里接上 AI，还能随便聊'}。</p>
  </div>`;
}

function settingsModal(cfg: AiConfig, meter: Meter, inGame: boolean, pauseOn: Ui['pauseOn']) {
  return `<h3 class="sec-title">设置</h3>
    <h4>AI</h4>
    <p class="fine">接上 DeepSeek 后，重要的弟子和敌宗宗主每季由 AI 按性格拿主意、说心里话（头上冒的气泡就是）、写心愿。AI 在后台想，时间不用停。不接也能玩：用规则和写好的台词。</p>
    <div class="choice-row two">
      <button class="choice${cfg.kind === 'offline' ? ' on' : ''}" data-act="ai-kind" data-id="offline"><b>离线</b><span>免费，不联网</span></button>
      <button class="choice${cfg.kind === 'deepseek' ? ' on' : ''}" data-act="ai-kind" data-id="deepseek"><b>DeepSeek</b><span>要你自己的密钥</span></button>
    </div>
    ${cfg.kind === 'deepseek' ? `<form data-form="key" class="key-form"><label>DeepSeek 密钥<input name="key" type="password" placeholder="${cfg.apiKey ? '已填（重新填写可替换）' : 'sk-…'}" autocomplete="off"></label><button class="btn primary">保存</button><button type="button" class="btn ghost" data-act="ai-test">测一下</button></form>
    <p class="fine">密钥只存在这台电脑的浏览器里，由浏览器直接发给 DeepSeek，不经过任何别的服务器。在 platform.deepseek.com 申请。</p>
    <h4>档位</h4>
    <div class="choice-row">${([['save', '省钱', '每季 3 人'], ['normal', '正常', '每季 8 人 + 敌宗宗主'], ['rich', '阔气', '每季 16 人 + 敌宗宗主']] as const).map(([k, n, d]) => `<button class="choice${cfg.mode === k ? ' on' : ''}" data-act="ai-mode" data-id="${k}"><b>${n}</b><span>${d}</span></button>`).join('')}</div>
    <p class="fine">被你标记 ★ 的人优先用 AI。本局花了${money(meter.game.yuan)}（${meter.game.calls} 次），这台设备累计${money(meter.all.yuan)}。</p>` : ''}
    <h4>声音和节奏</h4>
    <div class="choice-row two">
      <button class="choice${soundOn() ? ' on' : ''}" data-act="sound" data-v="${soundOn() ? 'off' : 'on'}"><b>音效：${soundOn() ? '开' : '关'}</b><span>点一下切换</span></button>
      <button class="choice" data-act="pause-on"><b>有事就停：${{ all: '每件事', big: '只停大事', none: '不停' }[pauseOn]}</b><span>来了要你拍板的事，时间要不要停下等你。点一下切换</span></button>
    </div>
    ${inGame ? `<h4>存档</h4><div class="d-opts"><button class="btn sm" data-act="export">导出存档</button><label class="btn sm">导入存档<input type="file" accept=".json" data-act="import" hidden></label><button class="btn sm danger" data-act="quit">回到标题</button></div><p class="fine">进度自动存在这个浏览器里。换电脑或清浏览器数据前，先导出。</p>` : ''}`;
}

function endModal(w: World) {
  const o = w.over!;
  const e = epilogue(w);
  return `<div class="ending">
    <p class="eyebrow">${o.win ? `${esc(w.sect.name)} · ${w.endYear} 年` : esc(w.sect.name)}</p>
    <h3 class="sec-title">${esc(e.title)}</h3>
    <p>${esc(o.text)}</p><p class="muted">${esc(e.verdict)}</p>
    <div class="end-nums">${e.numbers.map(([k, v]) => `<div><em>${esc(k)}</em><b>${esc(v)}</b></div>`).join('')}</div>
    <h4>门人去向</h4>
    ${e.fates.map((g) => `<div class="fate"><b class="${g.tone === 'good' ? 'good-t' : g.tone === 'bad' ? 'bad-t' : ''}">${g.group}（${g.people.length}）</b><div class="chips">${g.people.map((f) => `<button class="chip" data-act="person" data-id="${f.id}" title="${esc(f.note)}">${esc(f.name)}<small>${esc(f.note)}</small></button>`).join('')}</div></div>`).join('')}
    ${w.annals.length ? `<h4>宗门志</h4><ol class="life annals">${w.annals.map((a) => `<li class="${a.tone}"><time>${timeText(a.t)}</time>${esc(a.text)}</li>`).join('')}</ol>` : ''}
    <div class="d-opts">${o.win ? '<button class="btn primary" data-act="play-on">再玩十年</button>' : ''}<button class="btn" data-act="new">开新局</button><button class="btn ghost" data-act="quit">回到标题</button></div>
  </div>`;
}

function helpModal() {
  return `<h3 class="sec-title">怎么玩</h3>
    <ol class="help">
      <li><b>时间自己走。</b>一季九十天，顶上能暂停、正常、两倍、四倍。弟子们按天干活、修炼；每人一季里会挑一天自己拿主意——修炼、偷懒、交朋友、表白、使绊子、挑战上级、叛逃……头上冒的气泡就是他心里的话。</li>
      <li><b>事情要花时间。</b>盖殿堂一两个月，脚手架一点点长高；派人下山办差事一两个月才回来；弟子冲关要进洞闭关十五天才出结果；宗主闭关、亲传一季一轮。</li>
      <li><b>有事来找你。</b>弟子想冲关、想调岗、出了意外……右上角会冒出一封信，默认会停下来等你拍板（设置里能改）。拖久了按"不管"办。</li>
      <li><b>用人。</b>左边"殿堂"里把人放到殿堂，他会自己走过去。干得好不好 = 才干 × 他愿不愿意 × 心情。讨厌的活会让人积怨。修为高的人屈居人下会不服；修为低的人当主事，下面的人也不服。</li>
      <li><b>招人。</b>上山来的人在山门口等着，不会一直等。测灵根花灵石，考才干花他的耐心，查来历要一个多月。有人撒谎，有人是敌宗派来的奸细。天才会被别家抢。</li>
      <li><b>心愿。</b>每个人心里都有想要的东西。你的决定如果碰巧成全了谁的心愿——哪怕你根本不知道——他会记在你头上，从此更忠心。</li>
      <li><b>开春。</b>每年开春时间停一下：看去年回顾，挑一件今年的大计，定方略，点一格传承。</li>
      <li><b>天下。</b>赤霄宗霸道，玄水阁精明。送礼、结盟、挑衅、宣战都由你定；宣战或被宣战后二十天打上门，顶上会倒计时。打仗时派谁、怎么打、要不要亲自出手由你定。</li>
      <li><b>召见。</b>每季能当面见三个人：问近况、问心愿、勉励、安抚、敲打。离线也能召见；接上 AI 后还能随便聊。</li>
      <li><b>人心隔肚皮。</b>偷东西、使绊子、给敌宗送信的事不会写进纪事。库房少了东西、有人日子莫名不好过，就是有人在搞鬼——执法堂越得力，越容易抓到人。</li>
      <li><b>宗门任务、品阶、大计。</b>任务栏每季换新，挑一到三人组队出去。宗门从草创一路晋到一方圣地，每升一阶有赏。</li>
      <li><b>十年一局。</b>到年头会给宗门下评语，列出每个入过山门的人的去向和宗门志。还想接着玩可以再玩十年。</li>
    </ol>`;
}

export { REALM_NAME, seasonName, MOVE_NAME };

