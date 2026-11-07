// 正式界面：全是纯函数，把「世界 + 界面状态」画成 HTML 字符串。不改世界，只读。
// 按钮上的 data-act / data-v / data-id / data-arg 由 controller.ts 解释成发给游戏世界的消息。
// AI 写的话、玩家起的名字都要转义后才能放进 HTML。

import type { ChatLine, Npc, PlaceId, World } from '../game/core/types.ts';
import { expNeed, lifeLeft, lifeOf, ME, nm, npcs, placeName, realmText, ROOTS, type RootId } from '../game/core/world.ts';
import { ITEMS, PLACES, PLACE_ORDER, SECT_NAME, TRAITS } from '../game/data/world-data.ts';
import { PERSON } from '../game/data/people.ts';
import { goalText } from '../game/mind/goals.ts';
import { aboutMe, describe, feel } from '../game/mind/memory.ts';
import { bondScore, MODES, type Mode, TIER_AT, TIER_NAME } from '../game/mind/bond.ts';
import { canSocial, mainActs, secretLine, SHOP, type SocialKind, tellables, viewEncounter } from '../game/player.ts';
import { canTalk, MAX_LINES } from '../game/ai/talk.ts';
import { heardText } from '../game/ai/souls.ts';
import type { AiView } from '../world/protocol.ts';
import type { SoulView } from '../souls/soul-client.ts';
import { mapSvg } from './map.ts';
import { art, portraitKey } from './art.ts';

// ───────────── 界面状态 ─────────────

export type Tab = 'here' | 'map' | 'people' | 'news' | 'self';
export type Sheet =
  | { kind: 'person'; id: string }
  | { kind: 'chat'; id: string }
  | { kind: 'place'; id: PlaceId }
  | { kind: 'gift'; id: string }
  | { kind: 'tell'; id: string }
  | { kind: 'settings' }
  | { kind: 'year'; from: number; to: number }
  | { kind: 'retreat' }
  | { kind: 'new' };
export type AiKind = 'offline' | 'deepseek' | 'claude';

export interface UI {
  screen: 'title' | 'game';
  tab: Tab;
  sheet: Sheet | null;
  /** 上一个操作的结果（弹一张小纸条） */
  outcome: string | null;
  newsFilter: 'all' | 'big' | 'me' | 'heard';
  /** 开局时填的 */
  setup: { name: string; gender: 'm' | 'f'; root: RootId };
  /** 正在边写边显示的那句话 */
  stream: { id: string; text: string } | null;
  /** 过年前确认一下（主事没做、还能打交道） */
  confirmEnd: boolean;
  hasSave: boolean;
  /** AI 设置：密钥本身不进界面，只记有没有 */
  settings: { kind: AiKind; hasKey: boolean; model: string; mode: Mode; claude: boolean };
  spend: { game: string; all: string; top: string[] };
}

export interface Model {
  readonly w: World | null;
  readonly ai: AiView | null;
  readonly souls: readonly SoulView[];
  readonly ui: UI;
}

export const newUI = (): UI => ({
  screen: 'title', tab: 'here', sheet: null, outcome: null, newsFilter: 'all',
  setup: { name: '', gender: 'm', root: 'dual' }, stream: null, confirmEnd: false, hasSave: false,
  settings: { kind: 'offline', hasKey: false, model: 'deepseek-flash', mode: 'normal', claude: false },
  spend: { game: '还没用过', all: '还没用过', top: [] },
});

// ───────────── 小工具 ─────────────

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const attr = (k: string, v: unknown) => (v === undefined || v === null || v === '' ? '' : ` data-${k}="${esc(v)}"`);
const btn = (label: string, act: string, o: { v?: unknown; id?: string; arg?: string; cls?: string; disabled?: boolean; title?: string; i?: number } = {}) =>
  `<button type="button" class="${o.cls ?? ''}" data-act="${act}"${attr('v', o.v)}${attr('id', o.id)}${attr('arg', o.arg)}${attr('i', o.i)}${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${label}</button>`;
const sheetHead = (title: string, sub = '', lead = '') => `<header class="sheet-head">${lead}<div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${btn('×', 'close', { cls: 'x', title: '关上' })}</header>`;
const pct = (v: number, max: number) => Math.max(0, Math.min(100, Math.round((v / Math.max(1, max)) * 100)));

/** 交情档位：0~3，刻骨再分知己、宿敌 */
function tierOf(m: Model, n: Npc) {
  const t = m.ai?.tiers[n.id] ?? '陌路';
  const i = Math.max(0, TIER_NAME.indexOf(t as (typeof TIER_NAME)[number]));
  return { name: t, cls: t === '宿敌' ? 'foe' : t === '知己' ? 't3' : `t${i}` };
}

/** 印章头像：两个字竖排，交情越深颜色越重 */
export function sealText(name: string) {
  if (name === '花婆婆') return '花婆';
  return [...name].length <= 2 ? name : [...name].slice(1, 3).join('');
}
const seal = (name: string, cls = '', big = false) => `<span class="seal ${cls}${big ? ' big' : ''}" aria-hidden="true">${[...sealText(name)].map((c) => `<i>${esc(c)}</i>`).join('')}</span>`;

const portrait = (n: Npc, cls = '', big = false) => `<span class="portrait ${cls}${big ? ' big' : ''}${n.alive ? '' : ' gone'}"><img src="${art(portraitKey(n), 'avatar')}" alt="" width="96" height="96" loading="lazy" decoding="async"></span>`;
const landscape = (id: string, cls = '') => `<div class="landscape ${cls}" aria-hidden="true"><img src="${art(id)}" alt="" width="960" height="640" loading="lazy" decoding="async"></div>`;

const itemArt = (id: string) => id === 'sword' || id === 'letter' ? `<img class="item-art" src="${art(id)}" alt="" width="56" height="56" loading="lazy">` : `<svg class="item-icon ${id}" viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12v8l6 8v16q0 6-12 6T12 37V21l6-8Z"/><path d="M17 8h14M13 26h22M18 35q6-10 12 0"/><circle cx="24" cy="25" r="5"/></svg>`;

const soulOf = (m: Model, id: string) => m.souls.find((s) => s.soulId === `qingming.${id}`);
const LOD: Record<string, string> = { spotlight: '聚光', ambient: '在场', offstage: '离场' };
const SEX = (g: 'm' | 'f') => (g === 'f' ? '女' : '男');

// ───────────── 整个画面 ─────────────

export function screen(m: Model): string {
  const { w, ui } = m;
  let body: string;
  if (ui.screen === 'title' || !w) body = titleScreen(m);
  else if (w.phase === 'ending') body = endingScreen(m);
  else body = gameScreen(m);
  return body + overlays(m);
}

/** 盖在上面的：找上门的事、结果小纸条、抽屉 */
function overlays(m: Model): string {
  const { w, ui } = m;
  const game = ui.screen === 'game' && !!w;
  // 先看清上一件事的结果，再处理下一件找上门的事
  if (ui.outcome) return `<div class="scrim center" data-act="ok"><div class="note-card" role="dialog" aria-live="polite">${paras(ui.outcome)}${btn('知道了', 'ok', { cls: 'primary' })}</div></div>`;
  if (game && w.phase === 'year' && w.pending.length) return encounterModal(m);
  if (!ui.sheet) return '';
  return `<div class="scrim" data-act="close"><div class="sheet ${ui.sheet.kind}-sheet" role="dialog" data-stop>${sheet(m, ui.sheet)}</div></div>`;
}

const paras = (t: string) => t.split('\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

// ───────────── 开局 ─────────────

function titleScreen(m: Model): string {
  const { ui } = m;
  const roots = (Object.keys(ROOTS) as RootId[]).map((r) => `<label class="root${ui.setup.root === r ? ' on' : ''}">
      <input type="radio" name="root" value="${r}"${ui.setup.root === r ? ' checked' : ''}><b>${ROOTS[r].name}</b><small>${esc(ROOTS[r].desc)}</small>
    </label>`).join('');
  return `<main class="title">
    <div class="title-ink" aria-hidden="true"><img src="${art('title')}" alt="" width="800" height="1200" fetchpriority="high"></div><p class="title-kicker">山河有灵 · 人间有情</p>
    <h1 class="brush">青冥录</h1>
    <p class="sub">一州七地，十二个有名有姓的修士。<br>他们各有心事，也会记得你。</p>
    ${ui.hasSave && m.w && m.w.phase === 'year' ? `<div class="resume">${btn(`接着走下去 · 第${m.w.year}年 · ${esc(m.w.me.name)}`, 'continue', { cls: 'primary wide' })}</div>` : ''}
    <form class="setup card" data-form="new">
      <h2>${ui.hasSave ? '另起一局' : '踏上修行路'}</h2>
      <label class="field"><span>道号</span><input name="name" maxlength="8" autocomplete="off" placeholder="无名" value="${esc(ui.setup.name)}"></label>
      <div class="field"><span>性别</span>
        <label class="pill${ui.setup.gender === 'm' ? ' on' : ''}"><input type="radio" name="gender" value="m"${ui.setup.gender === 'm' ? ' checked' : ''}>男</label>
        <label class="pill${ui.setup.gender === 'f' ? ' on' : ''}"><input type="radio" name="gender" value="f"${ui.setup.gender === 'f' ? ' checked' : ''}>女</label>
      </div>
      <div class="roots">${roots}</div>
      <button type="submit" class="primary wide">入青冥</button>
    </form>
    <p class="ai-line">${aiLine(m)} · ${btn('AI 设置', 'sheet', { v: 'settings', cls: 'link' })}</p>
  </main>`;
}

const aiLine = (m: Model) => {
  const s = m.ui.settings;
  return s.kind === 'deepseek' && s.hasKey ? `角色由 DeepSeek（${esc(s.model)}）来演，用量${MODES[s.mode].name}` : s.kind === 'claude' && s.claude ? '角色由 Claude 来演' : '角色说的是规则写好的话（离线）';
};

// ───────────── 每一年 ─────────────

function gameScreen(m: Model): string {
  const w = m.w!;
  const tabs: [Tab, string][] = [['here', '此地'], ['map', '舆图'], ['people', '人物'], ['news', '江湖'], ['self', '自身']];
  const body = m.ui.tab === 'map' ? mapTab(m) : m.ui.tab === 'people' ? peopleTab(m) : m.ui.tab === 'news' ? newsTab(m) : m.ui.tab === 'self' ? selfTab(m) : hereTab(m);
  return `${header(m)}
    <main class="main tab-${m.ui.tab}">${body}</main>
    <nav class="dock" aria-label="菜单">${tabs.map(([t, l]) => `<button type="button" data-act="tab" data-v="${t}" class="${m.ui.tab === t ? 'on' : ''}"${m.ui.tab === t ? ' aria-current="page"' : ''}><i class="ico ico-${t}" aria-hidden="true"></i>${l}</button>`).join('')}</nav>`;
}

function header(m: Model): string {
  const w = m.w!;
  const me = w.me;
  const t = w.turn;
  const bar = (label: string, v: number, max: number, text: string, cls: string) =>
    `<div class="bar ${cls}" title="${esc(label)}"><span>${label}</span><b style="--p:${pct(v, max)}%"></b><em>${text}</em></div>`;
  const steps: [string, boolean, string][] = [
    ['动身', t.moved, t.moved ? placeName(me.place) : '选地方'],
    ['主事', t.main, t.main ? '已做' : '未做'],
    ['打交道', t.social === 0, `余 ${t.social}`],
  ];
  const thinking = m.ai?.thinking ? w.people[m.ai.thinking]?.name : '';
  const deciding = npcs(w).filter((n) => n.plan.asking).length;
  return `<header class="top">
    <div class="row">
      <div class="year"><b class="brush">第${w.year}年</b><span>${esc(placeName(me.place))}</span></div>
      ${btn(`${seal(me.name, 'me')}<span><b>${esc(me.name)}</b><small>${realmText(me)} · ${me.age}岁</small></span>`, 'tab', { v: 'self', cls: 'me-chip' })}
      ${btn('<i class="ico ico-gear" aria-hidden="true"></i>', 'sheet', { v: 'settings', cls: 'gear', title: '设置' })}
    </div>
    <div class="bars">
      ${me.realm < 4 ? bar('修为', me.exp, expNeed(me), `${Math.floor(me.exp)}/${expNeed(me)}`, 'exp') : ''}
      ${bar('气血', me.hp, 100, `${me.hp}`, me.hp < 40 ? 'hp low' : 'hp')}
      ${bar('寿元', lifeLeft(me), lifeOf(me), `余${lifeLeft(me)}年`, lifeLeft(me) < 15 ? 'life low' : 'life')}
      <div class="stones" title="灵石"><i class="ico ico-stone" aria-hidden="true"></i>${me.stones}</div>
    </div>
    <ol class="steps">${steps.map(([k, done, v]) => `<li class="${done ? 'done' : ''}"><b>${k}</b><span>${esc(v)}</span></li>`).join('')}<li class="${t.moved && t.main ? 'ready' : ''}"><b>过年</b><span>${t.moved ? '可以' : '先动身'}</span></li></ol>
    ${thinking || deciding || m.ai?.note ? `<p class="status">${thinking ? `<span class="pulse">${esc(thinking)}正在想怎么回你…</span>` : ''}${deciding ? `<span class="pulse">${deciding}人正在想今年做什么…</span>` : ''}${m.ai?.note ? `<span class="warn">${esc(m.ai.note)}</span>` : ''}</p>` : ''}
  </header>`;
}

// 此地

function hereTab(m: Model): string {
  const w = m.w!;
  if (!w.turn.moved) {
    return `<section class="card intro">
        <h2 class="brush">今年去哪？</h2>
        <p>选一个地方待上一年：做一件主事，和那里的人打两次交道。冲着你来的人，会在那里找上你。</p>
        ${mapSvg(w, { here: w.me.place })}
        <p class="hint">点地图上的地方看看谁在那里。</p>
      </section>
      <section class="places">${PLACE_ORDER.map((p) => placeCard(m, p)).join('')}</section>`;
  }
  const p = PLACES[w.me.place];
  const here = npcs(w).filter((n) => n.place === w.me.place).sort((a, b) => bondScore(w, b) - bondScore(w, a));
  const heard = (w.heard ?? []).filter((h) => h.y === w.year && h.at === w.me.place);
  const offer = w.offer && w.offer.y === w.year ? w.people[w.offer.who] : null;
  return `<section class="banner">${landscape(w.me.place)}
      <h2 class="brush">${esc(p.name)}</h2>
      <p>${esc(p.desc)}</p>
      <p class="tags"><span>修炼 ×${p.cultivate}</span>${p.danger >= 0.1 ? '<span class="bad">凶险</span>' : p.danger > 0.02 ? '<span>有些危险</span>' : '<span>太平</span>'}</p>
    </section>
    ${offer ? `<section class="card offer-bar">${portrait(offer, tierOf(m, offer).cls)}<p><b>${esc(offer.name)}</b>在等你答复。</p>${btn('去看看', 'chat', { id: offer.id, cls: 'primary' })}</section>` : ''}
    <section class="card acts">
      <h3>今年的主事 <small>${w.turn.main ? '做完了' : '选一件'}</small></h3>
      <div class="grid4">${mainActs(w).map((a) => btn(`<b>${a.label}</b><small>${esc(a.hint)}</small>`, 'main', { v: a.id, disabled: !a.ok || w.turn.main })).join('')}</div>
    </section>
    ${w.me.place === 'market' ? shopCard(m) : ''}
    <section class="card here-people">
      <h3>此地的人 <small>还能打 ${w.turn.social} 次交道</small></h3>
      ${here.length ? here.map((n) => personRow(m, n, true)).join('') : '<p class="empty">这里今年没有别人。</p>'}
    </section>
    ${heard.length ? `<section class="card heard"><h3>你听见</h3>${heard.map((h) => `<blockquote>${heardText(w, h).split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</blockquote>`).join('')}</section>` : ''}
    ${endCard(m)}`;
}

function endCard(m: Model): string {
  const w = m.w!;
  const left: string[] = [];
  if (!w.turn.main) left.push('今年的主事还没做');
  if (w.turn.social > 0 && npcs(w).some((n) => n.place === w.me.place)) left.push(`还能打 ${w.turn.social} 次交道`);
  if (m.ui.confirmEnd && left.length) {
    return `<section class="card end warn"><p>${left.join('，')}。确定就这样过年？</p><div class="row2">${btn('再想想', 'end-no')}${btn('过年', 'end-yes', { cls: 'primary' })}</div></section>`;
  }
  return `<section class="end">${btn('过年', 'end', { cls: 'primary wide' })}${btn('闭关几年…', 'sheet', { v: 'retreat', cls: 'ghost' })}</section>`;
}

function shopCard(m: Model): string {
  const w = m.w!;
  const stock = Number(w.flags.lifeStock ?? 0);
  return `<section class="card shop"><h3>坊市 <small>灵石 ${w.me.stones}</small></h3>
    ${Object.entries(SHOP).map(([id, price]) => {
      const sold = id === 'life' && stock <= 0;
      return `<div class="ware">${itemArt(id)}<div><b>${ITEMS[id].name}</b><small>${esc(ITEMS[id].desc)}${sold ? '（卖完了）' : ''}</small></div>${btn(`${price} 灵石`, 'buy', { v: id, disabled: sold || w.me.stones < price })}</div>`;
    }).join('')}
  </section>`;
}

function placeCard(m: Model, p: PlaceId): string {
  const w = m.w!;
  const ppl = npcs(w).filter((n) => n.place === p);
  return `<button type="button" class="place-card${w.me.place === p ? ' cur' : ''}" data-act="place" data-v="${p}">
    ${landscape(p, 'place-thumbnail')}
    <b>${esc(PLACES[p].name)}${w.me.place === p ? '<small>（你在这）</small>' : ''}</b>
    <small>${esc(PLACES[p].desc)}</small>
    <span class="seals">${ppl.slice(0, 6).map((n) => portrait(n, tierOf(m, n).cls)).join('')}${ppl.length > 6 ? `<em>+${ppl.length - 6}</em>` : ''}${ppl.length ? '' : '<em>没有人</em>'}</span>
  </button>`;
}

/** 一个人的一行：印章、名字、境界、今年的打算、交情 */
function personRow(m: Model, n: Npc, here = false): string {
  const w = m.w!;
  const t = tierOf(m, n);
  const plan = n.plan.asking ? '<span class="pulse">正在想今年做什么…</span>' : n.plan.why ? `${esc(n.plan.why)}${n.plan.by === 'ai' ? '<em class="own">自己拿的主意</em>' : ''}` : '';
  const sect = n.sect ? SECT_NAME[n.sect] : '散修';
  return `<div class="person">
    <button type="button" class="who" data-act="person" data-id="${n.id}">
      ${portrait(n, t.cls)}
      <span><b>${esc(n.name)}<em class="tier ${t.cls}">${t.name}</em></b><small>${realmText(n)} · ${sect}${here ? '' : ` · 在${placeName(n.place)}`}</small>${plan ? `<small class="plan">${plan}</small>` : ''}</span>
    </button>
    ${here && w.turn.moved ? btn('说话', 'chat', { id: n.id, cls: 'talk', disabled: !canTalk(w, n.id) && !(w.chat[n.id] ?? []).length }) : ''}
  </div>`;
}

// 舆图

function mapTab(m: Model): string {
  const w = m.w!;
  return `<section class="card">
      <h2 class="brush">青冥州</h2>
      ${mapSvg(w)}
      <p class="hint">朱砂点是你在的地方，小圈里是那里有几个人。点一处看看。</p>
    </section>
    <section class="places">${PLACE_ORDER.map((p) => placeCard(m, p)).join('')}</section>`;
}

// 人物

function peopleTab(m: Model): string {
  const w = m.w!;
  const live = npcs(w).sort((a, b) => bondScore(w, b) - bondScore(w, a));
  const here = live.filter((n) => n.place === w.me.place);
  const close = live.filter((n) => n.place !== w.me.place && tierOf(m, n).cls !== 't0');
  const rest = live.filter((n) => n.place !== w.me.place && tierOf(m, n).cls === 't0');
  const dead = Object.values(w.people).filter((n) => !n.alive);
  const group = (title: string, xs: Npc[], sub = '') => (xs.length ? `<section class="card"><h3>${title}${sub ? ` <small>${sub}</small>` : ''}</h3>${xs.map((n) => personRow(m, n, n.place === w.me.place)).join('')}</section>` : '');
  return `${group('身边的人', here)}
    ${group('有交情的人', close, '交情越深，演得越用心')}
    ${group('其他人', rest)}
    ${dead.length ? `<section class="card dead"><h3>故人</h3>${dead.map((n) => `<button type="button" class="dead-row" data-act="person" data-id="${n.id}">${portrait(n, 'gone')}<span><b>${esc(n.name)}</b><small>${esc(n.died?.note ?? '已故')}${n.died ? ` · 第${n.died.y}年` : ''}</small></span></button>`).join('')}</section>` : ''}`;
}

// 江湖

function newsTab(m: Model): string {
  const w = m.w!;
  const f = m.ui.newsFilter;
  const filters: [UI['newsFilter'], string][] = [['all', '全部'], ['big', '大事'], ['me', '与我有关'], ['heard', '听见的话']];
  const seg = `<div class="seg">${filters.map(([k, l]) => btn(l, 'news', { v: k, cls: f === k ? 'on' : '' })).join('')}</div>`;
  if (f === 'heard') {
    const hs = [...(w.heard ?? [])].reverse();
    return `${seg}<section class="card heard">${hs.length ? hs.map((h) => `<h4>第${h.y}年 · ${esc(placeName(h.at))}</h4><blockquote>${heardText(w, h).split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</blockquote>`).join('') : '<p class="empty">还没听见过谁说话。和人交情深了，他们在你身边说的话你会听见。</p>'}</section>`;
  }
  const xs = (f === 'me' ? w.life : f === 'big' ? w.news.filter((x) => x.big) : w.news).slice().reverse();
  let lastY = -1;
  const rows = xs.slice(0, 160).map((x) => {
    const head = x.y !== lastY ? `<h4>第${x.y}年</h4>` : '';
    lastY = x.y;
    return `${head}<p class="news ${x.tone}${x.big ? ' big' : ''}">${esc(x.text)}</p>`;
  }).join('');
  return `${seg}<section class="card feed">${rows || '<p class="empty">还没有消息。</p>'}</section>`;
}

// 自身

function selfTab(m: Model): string {
  const w = m.w!;
  const me = w.me;
  const items = [...new Set(me.items)];
  const secrets = w.knows.map((k) => {
    const who = k.slice(k.indexOf(':') + 1);
    const n = w.people[who];
    if (k.startsWith('goal:')) return n?.mind.goal ? `<li><b>${esc(nm(w, who))}的真实打算</b>${esc(goalText(w, n.mind.goal))}</li>` : '';
    return `<li><b>${esc(nm(w, who))}的秘密</b>${esc(secretLine(w, who))}</li>`;
  }).filter(Boolean);
  const ties = [me.sect ? `${SECT_NAME[me.sect]}弟子` : '散修', me.master ? `师父：${esc(nm(w, me.master))}` : '', me.partner ? `道侣：${esc(nm(w, me.partner))}` : ''].filter(Boolean);
  return `<section class="card self">
      <div class="self-head">${seal(me.name, 'me', true)}<div><h2>${esc(me.name)}</h2><p>${SEX(me.gender)} · ${me.age}岁 · ${realmText(me)}</p><p>${ties.join(' · ')}</p></div></div>
      <dl class="stats">
        <div><dt>资质</dt><dd>${me.talent >= 1.4 ? '上佳' : me.talent >= 1.1 ? '不错' : '平平'}（修炼 ×${me.talent}）</dd></div>
        <div><dt>修为</dt><dd>${me.realm < 4 ? `${Math.floor(me.exp)} / ${expNeed(me)}` : '圆满'}</dd></div>
        <div><dt>气血</dt><dd>${me.hp} / 100</dd></div>
        <div><dt>寿元</dt><dd>还剩 ${lifeLeft(me)} 年（上限 ${lifeOf(me)}）</dd></div>
        <div><dt>灵石</dt><dd>${me.stones}</dd></div>
      </dl>
    </section>
    <section class="card bag"><h3>行囊</h3>
      ${items.length ? items.map((id) => {
        const n = me.items.filter((x) => x === id).length;
        const use = id === 'heal' ? btn('服下', 'use', { v: id, disabled: me.hp >= 100 }) : id === 'life' ? btn('服下', 'use', { v: id }) : '';
        return `<div class="ware">${itemArt(id)}<div><b>${esc(ITEMS[id]?.name ?? id)}${n > 1 ? ` ×${n}` : ''}</b><small>${esc(ITEMS[id]?.desc ?? '')}</small></div>${use}</div>`;
      }).join('') : '<p class="empty">空空如也。</p>'}
    </section>
    <section class="card"><h3>你知道的事</h3>${secrets.length ? `<ul class="secrets">${secrets.join('')}</ul>` : '<p class="empty">还不知道谁的秘密。交情深了，有人会说给你听。</p>'}</section>
    <section class="card"><h3>小传</h3><ol class="life">${w.life.slice().reverse().slice(0, 40).map((x) => `<li><b>第${x.y}年</b>${esc(x.text)}</li>`).join('')}</ol></section>`;
}

// ───────────── 抽屉 ─────────────

function sheet(m: Model, s: Sheet): string {
  switch (s.kind) {
    case 'person': return personSheet(m, s.id);
    case 'chat': return chatSheet(m, s.id);
    case 'place': return placeSheet(m, s.id);
    case 'gift': return giftSheet(m, s.id);
    case 'tell': return tellSheet(m, s.id);
    case 'settings': return settingsSheet(m);
    case 'year': return yearSheet(m, s.from, s.to);
    case 'retreat': return retreatSheet(m);
    case 'new': return `${sheetHead('另起一局？')}<p>这一局会留在这里，回到开头重新起名、选灵根。</p><div class="row2">${btn('不了', 'close')}${btn('回到开头', 'go-title', { cls: 'primary' })}</div>`;
  }
}

const OPINION = (label: string, v: number, lo: number, hi: number, cls = '') => `<div class="meter ${cls}"><span>${label}</span><b style="--p:${pct(v - lo, hi - lo)}%"></b><em>${v}</em></div>`;

/** 能问他、能对他做的事 */
function socialOptions(m: Model, n: Npc): [SocialKind, string][] {
  const w = m.w!;
  const me = w.me;
  const o = n.mind.op[ME];
  const g = n.mind.goal;
  const out: [SocialKind, string][] = [['chat', '寒暄'], ['news', '打听消息'], ['goal', '问他的打算']];
  if (n.realm > me.realm || (n.realm === me.realm && n.stage > me.stage)) out.push(['teach', '请教修行']);
  out.push(['gift', '送礼…'], ['spar', '切磋'], ['provoke', '挑衅']);
  if (n.realm > me.realm && !me.master && n.master !== ME) out.push(['master', '拜师']);
  if (!me.partner && !n.partner && (o?.aff ?? 0) >= 40) out.push(['partner', '结为道侣']);
  if (n.sect && !me.sect) out.push(['join', `请他引荐入${SECT_NAME[n.sect]}`]);
  if (g && !g.ally && w.knows.includes(`goal:${n.id}`) && g.target !== ME && ((g.kind === 'revenge' && g.step === 2) || (g.kind === 'treasure' && g.step === 1))) out.push(['ally', '助他一臂之力']);
  if (tellables(w, n.id).length) out.push(['tell', '说出一个秘密…']);
  return out;
}

const socialButtons = (m: Model, n: Npc) => {
  const ok = canSocial(m.w!, n.id) && !m.ai?.thinking;
  return socialOptions(m, n).map(([k, l]) => (k === 'gift' || k === 'tell'
    ? btn(l, 'sheet', { v: k, id: n.id, disabled: !ok })
    : btn(l, 'social', { v: k, id: n.id, disabled: !ok }))).join('');
};

function personSheet(m: Model, id: string): string {
  const w = m.w!;
  const n = w.people[id];
  if (!n) return sheetHead('查无此人');
  const t = tierOf(m, n);
  const o = n.mind.op[ME];
  const here = n.alive && n.place === w.me.place && w.turn.moved;
  const g = n.mind.goal;
  const knownGoal = g && (!g.secret || w.knows.includes(`goal:${id}`));
  const goal = !g ? '没听说有什么打算' : knownGoal ? goalText(w, g) : `对外说：「${g.cover ?? '没什么打算'}」`;
  const score = bondScore(w, n);
  const next = TIER_AT.find((x) => x * MODES[m.ui.settings.mode].scale > score);
  const soul = soulOf(m, id);
  const souls = soul?.affordances.filter((a) => a.kind === 'soul').map((a) => a.label) ?? [];
  const mems = aboutMe(n).slice(0, 6).map((x) => `<li><b>第${x.y}年</b>${esc(describe(w, x, n.id))}</li>`);
  const traits = n.mind.traits.map((k) => `<span title="${esc(TRAITS[k].desc)}">${TRAITS[k].name}</span>`).join('');
  return `${sheetHead(`${esc(n.name)}<em class="tier ${t.cls}">${t.name}</em>`, `${SEX(n.gender)} · ${n.age}岁 · ${realmText(n)} · ${n.sect ? SECT_NAME[n.sect] : '散修'}${n.alive ? ` · 在${placeName(n.place)}` : ` · ${esc(n.died?.note ?? '已故')}`}`, portrait(n, t.cls, true))}
    <figure class="character-art${n.alive ? '' : ' gone'}"><img src="${art(portraitKey(n))}" alt="${esc(n.name)}立绘" width="800" height="1200" decoding="async"></figure>
    ${n.mind.heart ? `<blockquote class="heart"><p>「${esc(n.mind.heart)}」</p><cite>心里的你 · 第${n.mind.heartY ?? w.year}年</cite></blockquote>` : ''}
    <section class="opinion">
      <p>对你：<b>${feel(n)}</b></p>
      ${o ? `${OPINION('好感', o.aff, -100, 100, o.aff < 0 ? 'neg' : '')}${OPINION('信任', o.trust, 0, 100)}${OPINION('畏惧', o.fear, 0, 100, 'fear')}` : '<p class="empty">你们还没打过交道。</p>'}
      <p class="bond">交情 ${score}${next ? `，到 ${Math.round(next * MODES[m.ui.settings.mode].scale)} 进下一档` : ''}</p>
    </section>
    <dl class="facts">
      <div><dt>来历</dt><dd>${esc(PERSON[id]?.bio ?? n.bio ?? '一个修士。')}</dd></div>
      <div><dt>性子</dt><dd class="traits">${traits}</dd></div>
      <div><dt>打算</dt><dd>${esc(goal)}</dd></div>
      ${n.alive && n.plan.why ? `<div><dt>今年</dt><dd>${esc(n.plan.why)}${n.plan.by === 'ai' ? '（自己拿的主意）' : ''}</dd></div>` : ''}
      ${w.knows.includes(`secret:${id}`) ? `<div><dt>秘密</dt><dd>${esc(secretLine(w, id))}</dd></div>` : ''}
    </dl>
    ${mems.length ? `<section><h3>他记得的事</h3><ul class="mem">${mems.join('')}</ul></section>` : ''}
    ${n.alive ? `<section class="soul"><h3>灵魂 <small>${soul ? LOD[soul.lod] ?? soul.lod : '离场'}</small></h3>
      <p>${souls.length ? `交情到了这一步，${n.gender === 'f' ? '她' : '他'}会：${souls.map(esc).join('、')}。` : '还是陌路人：只有你开口时才由 AI 回答。'}</p></section>` : ''}
    ${here ? `<section class="acts-row">${btn('和' + (n.gender === 'f' ? '她' : '他') + '说话', 'chat', { id, cls: 'primary wide' })}<div class="chips">${socialButtons(m, n)}</div><p class="hint">选项对话花一次打交道，今年还剩 ${w.turn.social} 次。</p></section>` : n.alive ? `<p class="hint">${n.gender === 'f' ? '她' : '他'}今年在${placeName(n.place)}。去那里才能和${n.gender === 'f' ? '她' : '他'}打交道。</p>` : ''}`;
}

function chatSheet(m: Model, id: string): string {
  const w = m.w!;
  const n = w.people[id];
  if (!n) return sheetHead('查无此人');
  const t = tierOf(m, n);
  const u = w.turn.talk[id];
  const left = u ? MAX_LINES - u.lines : w.turn.social > 0 ? MAX_LINES : 0;
  const can = canTalk(w, id);
  const thinking = m.ai?.thinking === id;
  let y = -1;
  const log = (w.chat[id] ?? []).map((l: ChatLine) => {
    const sep = l.y !== y ? `<p class="yr">第${l.y}年</p>` : '';
    y = l.y;
    if (l.from === 'note') return `${sep}<p class="aside">${esc(l.text)}</p>`;
    return `${sep}<div class="bubble ${l.from === 'me' ? 'me' : 'them'}"><p>${esc(l.text)}</p></div>`;
  }).join('');
  const stream = thinking ? `<div class="bubble them live"><p>${m.ui.stream?.id === id && m.ui.stream.text ? esc(m.ui.stream.text) : '<span class="dots"><i></i><i></i><i></i></span>'}</p></div>` : '';
  const offer = w.offer && w.offer.who === id && w.offer.y === w.year ? `<div class="offer card"><p><b>${esc(n.name)}</b>提出：${esc(offerLabel(w.offer.kind))}</p><div class="row2">${btn('婉拒', 'offer', { v: 'no' })}${btn('答应', 'offer', { v: 'yes', cls: 'primary' })}</div></div>` : '';
  const why = !w.turn.moved ? '先选好今年去哪' : n.place !== w.me.place ? `${n.gender === 'f' ? '她' : '他'}不在这里` : w.pending.length ? '先处理找上门的事' : left <= 0 ? '今年说不上话了' : '';
  return `${sheetHead(`${esc(n.name)}<em class="tier ${t.cls}">${t.name}</em>`, can ? `今年还能说 ${left} 句${!u ? '（第一句用掉一次打交道）' : ''}` : esc(why), portrait(n, t.cls))}
    <div class="log" aria-live="polite">${log || `<p class="aside">你们还没说过话。</p>`}${stream}</div>
    ${offer}
    <form class="say" data-form="talk" data-id="${id}">
      <input name="text" maxlength="120" autocomplete="off" placeholder="${can ? '想说什么就说什么' : esc(why)}"${can && !thinking ? '' : ' disabled'}>
      <button type="submit" class="primary"${can && !thinking ? '' : ' disabled'}>说</button>
    </form>
    ${n.place === w.me.place && w.turn.moved ? `<div class="chips">${socialButtons(m, n)}</div>` : ''}
    <p class="ai-note">${aiLine(m)}${t.cls === 't0' ? ' · 陌路人想得浅；交情越深，越用心' : ''}</p>`;
}

function offerLabel(k: string) {
  return ({ teach: '指点你修行', master: '收你为徒', ally: '请你帮一个忙', spar: '和你切磋几招', trade: '卖给你丹药', partner: '和你结为道侣' } as Record<string, string>)[k] ?? k;
}

function placeSheet(m: Model, id: PlaceId): string {
  const w = m.w!;
  const p = PLACES[id];
  const ppl = npcs(w).filter((n) => n.place === id).sort((a, b) => bondScore(w, b) - bondScore(w, a));
  const go = !w.turn.moved && w.phase === 'year';
  return `${sheetHead(esc(p.name), `修炼 ×${p.cultivate}${p.danger >= 0.1 ? ' · 凶险' : ''}`)}
    <p>${esc(p.desc)}</p>
    <section><h3>今年在这里的人</h3>${ppl.length ? ppl.map((n) => personRow(m, n, false)).join('') : '<p class="empty">没有人。</p>'}</section>
    ${go ? btn(id === w.me.place ? `就留在${esc(p.name)}` : `今年去${esc(p.name)}`, 'move', { v: id, cls: 'primary wide' }) : `<p class="hint">${w.me.place === id ? '你今年就在这里。' : '今年已经动身了，明年再来。'}</p>`}`;
}

function giftSheet(m: Model, id: string): string {
  const w = m.w!;
  const n = w.people[id];
  const items = [...new Set(w.me.items)];
  return `${sheetHead(`送${esc(n?.name ?? '')}什么？`, '花一次打交道')}
    <div class="list">
      ${btn('<b>二十块灵石</b>', 'social', { v: 'gift', id, arg: '', disabled: w.me.stones < 20 })}
      ${items.map((it) => btn(`<b>${esc(ITEMS[it]?.name ?? it)}</b><small>${esc(ITEMS[it]?.desc ?? '')}</small>`, 'social', { v: 'gift', id, arg: it })).join('')}
    </div>`;
}

function tellSheet(m: Model, id: string): string {
  const w = m.w!;
  const n = w.people[id];
  return `${sheetHead(`告诉${esc(n?.name ?? '')}什么？`, '和他有关的秘密会改变他的打算；被说的那个人迟早会知道是你说的')}
    <div class="list">${tellables(w, id).map((k) => btn(`<b>${esc(nm(w, k.slice(7)))}的秘密</b><small>${esc(secretLine(w, k.slice(7)))}</small>`, 'social', { v: 'tell', id, arg: k })).join('')}</div>`;
}

function retreatSheet(m: Model): string {
  const w = m.w!;
  return `${sheetHead('闭关', `在${esc(placeName(w.me.place))}闭关，世界照常转`)}
    <p>每年都在这里修炼，修为圆满就冲关。有人找上门会停下来让你处理。闭关时不和人打交道。</p>
    <div class="row4">${[1, 3, 5, 10].map((y) => btn(`${y} 年`, 'retreat', { v: y })).join('')}</div>`;
}

function yearSheet(m: Model, from: number, to: number): string {
  const w = m.w!;
  const span = from === to ? `第${from}年` : `第${from}到${to}年`;
  const xs = w.news.filter((x) => x.y >= from && x.y <= to);
  const hearts = Object.values(w.people).filter((n) => n.mind.heart && (n.mind.heartY ?? 0) >= from && (n.mind.heartY ?? 0) <= to);
  return `${sheetHead(`${span}过去了`, `如今是第${w.year}年，你${w.me.age}岁，${realmText(w.me)}`)}
    ${hearts.length ? `<section><h3>有人想起你</h3>${hearts.map((n) => `<blockquote class="heart small"><p>「${esc(n.mind.heart)}」</p><cite>${esc(n.name)}</cite></blockquote>`).join('')}</section>` : ''}
    <section><h3>江湖上</h3>${xs.length ? xs.map((x) => `<p class="news ${x.tone}${x.big ? ' big' : ''}">${esc(x.text)}</p>`).join('') : '<p class="empty">风平浪静。</p>'}</section>
    ${btn('接着走', 'close', { cls: 'primary wide' })}`;
}

function settingsSheet(m: Model): string {
  const s = m.ui.settings;
  const kinds: [AiKind, string, boolean][] = [['offline', '离线', true], ['deepseek', 'DeepSeek', true], ['claude', 'Claude', s.claude]];
  const modes = (Object.keys(MODES) as Mode[]).map((k) => btn(`<b>${MODES[k].name}</b><small>${k === 'save' ? '门槛高，每年最多 8 次' : k === 'normal' ? '每年最多 24 次' : '门槛低，每年最多 64 次'}</small>`, 'mode', { v: k, cls: s.mode === k ? 'on' : '' })).join('');
  return `${sheetHead('设置')}
    <section><h3>角色由谁来演</h3>
      <div class="seg">${kinds.map(([k, l, ok]) => btn(l, 'ai-kind', { v: k, cls: s.kind === k ? 'on' : '', disabled: !ok, title: ok ? '' : '只有在 claude.ai 里打开时能用' })).join('')}</div>
      ${s.kind === 'deepseek' ? `<form class="ai-form" data-form="ai">
        <label class="field"><span>密钥</span><input name="key" type="password" autocomplete="off" placeholder="${s.hasKey ? '已保存（不显示）；要换就重新粘贴' : 'sk-…'}"></label>
        <label class="field"><span>模型</span><input name="model" autocomplete="off" value="${esc(s.model)}"></label>
        <button type="submit" class="primary">保存</button>
        <p class="hint">密钥只存在这台设备的浏览器里，不进存档。默认模型 deepseek-flash 就是 V4.1 Flash。</p>
      </form>` : ''}
      <p class="hint">${aiLine(m)}${m.ai?.provider ? ` · 当前：${esc(m.ai.provider)}` : ''}</p>
    </section>
    <section><h3>AI 用量</h3>
      <div class="seg modes">${modes}</div>
      <table class="tiers"><thead><tr><th></th><th>陌路</th><th>相识</th><th>相熟</th><th>刻骨</th></tr></thead><tbody>
        <tr><th>你开口</th><td>浅答</td><td>多轮</td><td>浅想</td><td>深想</td></tr>
        <tr><th>配台词</th><td>—</td><td>✓</td><td>✓</td><td>✓</td></tr>
        <tr><th>定打算</th><td>—</td><td>身边</td><td>身边</td><td>远处也</td></tr>
        <tr><th>主动开口</th><td>—</td><td>—</td><td>✓</td><td>✓</td></tr>
        <tr><th>旁听</th><td>—</td><td>—</td><td>✓</td><td>✓</td></tr>
        <tr><th>心里的你</th><td>—</td><td>—</td><td>说过话</td><td>✓</td></tr>
      </tbody></table>
      <p class="hint">和谁打交道越多、爱恨越深，谁就越有灵性。你自己说的话不算在每年的上限里。</p>
    </section>
    <section><h3>花费</h3>
      <p>本局：${esc(m.ui.spend.game)}</p>
      ${m.ui.spend.top.length ? `<p>花在：${m.ui.spend.top.map(esc).join('、')}</p>` : ''}
      <p class="hint">这台设备一共：${esc(m.ui.spend.all)}。按 DeepSeek 高峰价估算，闲时减半。</p>
      ${m.ai ? `<p class="hint">今年 NPC 自己用了 ${m.ai.used}/${m.ai.cap} 次。</p>` : ''}
    </section>
    ${m.ui.screen === 'game' ? `<section>${btn('另起一局…', 'sheet', { v: 'new', cls: 'ghost wide' })}</section>` : ''}`;
}

// ───────────── 找上门 ─────────────

function encounterModal(m: Model): string {
  const w = m.w!;
  const e = w.pending[0];
  const v = viewEncounter(w, e);
  const n = w.people[v.who];
  const t = n ? tierOf(m, n) : { cls: '', name: '' };
  const voiced = typeof e.vars.say === 'string' && e.vars.say;
  return `<div class="scrim center encounter-scrim"><div class="encounter card" role="dialog" aria-modal="true">
    <header>${n ? portrait(n, t.cls, true) : ''}<div><p class="kicker">找上门${w.pending.length > 1 ? ` · 还有 ${w.pending.length - 1} 件` : ''}</p><h2 class="brush">${esc(v.title)}</h2></div></header>
    <p class="speech">${esc(v.text)}</p>
    ${!voiced && m.ai?.online && n ? '<p class="hint pulse">…</p>' : ''}
    <div class="choices">${v.choices.map((c, i) => btn(`<b>${esc(c.label)}</b>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}`, 'choose', { i, disabled: c.disabled })).join('')}</div>
  </div></div>`;
}

// ───────────── 结局 ─────────────

function endingScreen(m: Model): string {
  const w = m.w!;
  const me = w.me;
  const kind = w.ending?.kind ?? 'age';
  const title = kind === 'ascend' ? '化神' : kind === 'age' ? '坐化' : '陨落';
  const line = kind === 'ascend' ? `${esc(me.name)}破境化神，青冥州再也留不住你。` : kind === 'age' ? `${esc(me.name)}寿元耗尽，坐化于${realmText(me)}。` : `${esc(me.name)}${esc(me.died?.note ?? '死于非命')}。`;
  const hearts = Object.values(w.people).filter((n) => n.mind.heart).sort((a, b) => bondScore(w, b) - bondScore(w, a));
  const friends = Object.values(w.people).filter((n) => (n.mind.op[ME]?.aff ?? 0) >= 40).length;
  const foes = Object.values(w.people).filter((n) => (n.mind.op[ME]?.aff ?? 0) <= -40).length;
  return `<main class="ending">${landscape(`ending_${kind}`, 'ending-art')}
    <h1 class="brush">${title}</h1>
    <p class="sub">${line}<br>修行 ${w.year} 年，享年 ${me.age} 岁。</p>
    <dl class="stats"><div><dt>境界</dt><dd>${realmText(me)}</dd></div><div><dt>知交</dt><dd>${friends}</dd></div><div><dt>仇家</dt><dd>${foes}</dd></div><div><dt>知道的秘密</dt><dd>${w.knows.length}</dd></div></dl>
    ${hearts.length ? `<section class="card"><h3>他们心里的你</h3>${hearts.map((n) => `<blockquote class="heart small"><p>「${esc(n.mind.heart)}」</p><cite>${esc(n.name)}${n.alive ? '' : '（已故）'}</cite></blockquote>`).join('')}</section>` : ''}
    <section class="card"><h3>小传</h3><ol class="life">${w.life.map((x) => `<li><b>第${x.y}年</b>${esc(x.text)}</li>`).join('')}</ol></section>
    ${btn('再入青冥', 'go-title', { cls: 'primary wide' })}
  </main>`;
}

