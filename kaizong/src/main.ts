// 网页入口：时间按天自己走（MainLoop.js 驱动），界面分块刷新，点击处理，存档，接 AI。

import MainLoop from 'mainloop.js';
import { createDeepSeek, replySoFar, asJson, type AiClient } from './ai/client';
import { createMeter, loadConfig, saveConfig, type AiConfig } from './ai/config';
import { chatPrompt } from './ai/prompts';
import { afterSeason, askSeason, cleanLine } from './ai/runner';
import type { RANK_ORDER } from './game/data/world';
import { breakNow, resolveDecision, type BreakWay } from './game/decisions';
import { drainFx, type Fx } from './game/fx';
import { admit, checkOrigin, dismiss, heartTest, testRoot, testSkill } from './game/recruit';
import { diplomacy } from './game/rivals';
import { chooseGoal } from './game/goals';
import { setMasterPlan } from './game/master';
import { dispatch, tripDays } from './game/missions';
import { migrate } from './game/save';
import { AI_LIMIT, checkEnd, choosePolicy, dayTick, giftPill, holdTourney, learnTech, planSeason, vouch, type AiPicks, type Summary } from './game/season';
import { startWork } from './game/build';
import { assignJob, setHead, setRank, unconvinced } from './game/sect';
import { expel } from './game/decisions';
import { newWorld, randomStart, rollFate, type StartChoice } from './game/setup';
import type { HallId, JobId, MasterAct, Skill, World } from './game/types';
import { noteFreeTalk, talk, type Topic } from './game/talk';
import { endWar, fightRound, healTeam } from './game/war';
import { adjust, clamp, members, P, pronoun, rngOf, seasonName, year } from './game/world';
import { idleLine } from './game/lines';
import { hudView, lettersView, masterBar, questView, railView, tickerView, warBanner } from './ui/hud';
import { isRotated, setupOrientation, tryFullscreenLandscape } from './ui/orient';
import { Scene } from './ui/scene';
import { setSound, sfx, unlockSound } from './ui/sfx';
import { esc } from './ui/util';
import { gameShell, modalView, setupView, TAB_TITLE, tabView, titleView, type Tab, type Ui } from './ui/views';

const SAVE = 'kaizong.save.v1';
/** 正常速度下一天多长（毫秒）：一季九十天约三十六秒 */
const DAY_MS = 400;

const app = document.getElementById('app')!;
let w: World | null = null;
let cfg: AiConfig = loadConfig();
const meter = createMeter();
let pauseOn: Ui['pauseOn'] = 'big';
try { pauseOn = (localStorage.getItem('kaizong.pause') as Ui['pauseOn']) || 'big'; } catch { /* 用默认 */ }
const ui: Ui = {
  screen: 'title', tab: 'people', modal: null, setup: randomStart(Date.now() % 1e9), busy: null, toast: null, sort: 'rank',
  chats: {}, streaming: null, testPick: {}, showHistory: false, hasSave: false, team: {},
  drawer: null, speed: 1, letter: null, hold: false, pauseOn,
};

function load(): World | null {
  try {
    const s = localStorage.getItem(SAVE);
    if (!s) return null;
    const o = JSON.parse(s) as World;
    return o && o.v === 1 ? migrate(o) : null;
  } catch { return null; }
}
let savedAt = 0;
function save() {
  if (!w) return;
  savedAt = performance.now();
  try { localStorage.setItem(SAVE, JSON.stringify(w)); } catch { /* 存不下就算了 */ }
}
ui.hasSave = !!load();

function ai(): AiClient | null {
  if (cfg.kind !== 'deepseek' || !cfg.apiKey) return null;
  return createDeepSeek({ apiKey: cfg.apiKey, onUsage: (u, ms) => meter.record(u, ms) });
}

// ───────────── 时间 ─────────────

/** 时间为什么走不了（null 是能走） */
function frozen(): string | null {
  if (!w) return '…';
  if (w.over) return '本局结束';
  if (w.war) return '打仗中';
  if (w.needGoal || w.needPolicy || w.needTech) return '开春：先定今年的事';
  if (ui.modal) return '看着呢，时间停了';
  if (ui.hold) return '有事等你拍板';
  return null;
}
const running = () => ui.screen === 'game' && !!w && ui.speed > 0 && !frozen();

/** 会让时间停下来等你的事 */
const BIG = new Set(['breakthrough', 'challenge', 'spy_caught', 'theft', 'scheme_caught', 'leave_request', 'fight', 'poach_alert', 'found_leave']);
const holdIds = new Set<string>();
function wantsHold(id: string) {
  const d = w?.decisions.find((x) => x.id === id);
  if (!d || ui.pauseOn === 'none') return false;
  return ui.pauseOn === 'all' || BIG.has(d.kind) || d.kind.startsWith('ev:');
}

let acc = 0;
let aiPicks: AiPicks = {};
let aiSeason = -1;

/** 这一季开头：在后台问 AI 重要的人想做什么；答案回来前到日子的人按规则自己拿主意 */
function startAiSeason() {
  if (!w) return;
  aiSeason = w.t;
  aiPicks = {};
  const client = ai();
  if (!client) return;
  const plan = planSeason(w, cfg.mode);
  if (!plan.aiWho.length && !plan.aiRivals.length) return;
  const world = w, t = w.t;
  void askSeason(world, plan, client, () => {}).then((res) => {
    if (w !== world || w.t !== t) return;
    aiPicks = { picks: res.picks, rivalPicks: res.rivalPicks };
    if (res.error && !Object.keys(res.picks).length) toast(`AI 没连上：${res.error}。这一季用规则代替。`);
  });
}

function afterSeasonEnd(sum: Summary) {
  if (!w) return;
  const client = ai();
  if (client && (sum.newWishes.length || sum.wishNews.some((x) => x.credit))) {
    const world = w;
    void afterSeason(world, client, sum.newWishes, sum.wishNews, AI_LIMIT[cfg.mode]).then((n) => { if (n && w === world) save(); });
  }
  const spring = w.t % 4 === 0;
  queueBanner(spring ? `第${year(w.t)}年 · 开春` : `${seasonName(w.t)}天到了`, 'gold');
  sfx('chime');
  save();
}

/** 过一天 */
function step() {
  if (!w) return;
  if (aiSeason !== w.t) startAiSeason();
  const t0 = w.t;
  const sum = dayTick(w, aiPicks);
  if (sum || w.t !== t0) afterSeasonEnd(sum ?? { t: w.t, wishNews: [], newWishes: [], deaths: [] });
  takeFx();
  checkStops();
}

/** 该自己弹出来的：开春、打仗、结局 */
function checkStops() {
  if (!w) return;
  if (w.over && ui.modal?.kind !== 'end') { ui.modal = { kind: 'end' }; save(); }
  else if (w.war && !ui.modal) { ui.modal = { kind: 'war' }; sfx('drum'); }
  else if ((w.needGoal || w.needPolicy || w.needTech) && !ui.modal) ui.modal = { kind: 'year' };
}

MainLoop.setSimulationTimestep(50)
  .setUpdate((delta) => {
    if (!running()) { acc = 0; return; }
    acc += delta * ui.speed;
    let n = 0;
    while (acc >= DAY_MS && n < 4) {
      acc -= DAY_MS;
      step();
      n++;
      if (!running()) { acc = 0; break; }
    }
    if (acc > DAY_MS * 4) acc = 0;
    if (performance.now() - savedAt > 4000) save();
  })
  .setDraw(() => draw())
  .setEnd((_fps, panic) => { if (panic) MainLoop.resetFrameDelta(); })
  .start();

// ───────────── 画面提示：飘字、气泡、横幅、音效 ─────────────

const banners: { text: string; tone: string; at: number }[] = [];
let bannerUntil = 0;
function queueBanner(text: string, tone: string) {
  if (banners.some((b) => b.text === text)) return;
  banners.push({ text, tone, at: performance.now() });
  if (banners.length > 4) banners.shift();
}

function takeFx() {
  const list = drainFx();
  if (!w || ui.screen !== 'game') return;
  for (const f of list) handleFx(f);
}

function handleFx(f: Fx) {
  if (!w) return;
  if (f.k === 'banner') { queueBanner(f.text, f.tone); if (f.tone === 'bad') sfx('drum'); return; }
  if (f.k === 'decision') {
    if (wantsHold(f.id)) { holdIds.add(f.id); ui.hold = true; ui.letter = f.id; }
    sfx('bell');
    return;
  }
  if (f.k === 'report') { if (f.big && f.tone === 'bad') sfx('fail'); return; }
  const snd = scene?.fx(f, w);
  if (snd) sfx(snd as 'coin');
}

// ───────────── 画面 ─────────────

let scene: Scene | null = null;
let shown: 'title' | 'setup' | 'game' | null = null;
const parts = new Map<string, string>();
let pressing = false;
let chatterAt = 0;
let lastSlow = 0;

/** 把一块内容填进去；没变就不动。换了返回 true */
function put(sel: string, html: string): boolean {
  if (parts.get(sel) === html) return false;
  const el = app.querySelector(sel) as HTMLElement | null;
  if (!el) return false;
  parts.set(sel, html);
  el.innerHTML = html;
  return true;
}

/** 纪事一条条淡出：按每条第一次出现的时间接着播，别因为重画又亮起来 */
const tickerSeen = new Map<string, number>();
function ageTicker(now: number) {
  app.querySelectorAll<HTMLElement>('.ticker .tk').forEach((el) => {
    const key = el.textContent ?? '';
    if (!tickerSeen.has(key)) tickerSeen.set(key, now);
    el.style.animationDelay = `${-(now - tickerSeen.get(key)!)}ms`;
  });
  if (tickerSeen.size > 60) for (const k of [...tickerSeen.keys()].slice(0, 30)) tickerSeen.delete(k);
}

/** 正在点、正在选下拉框、正在打字时别重画那一块 */
function busyIn(sel: string) {
  if (pressing) return true;
  const a = document.activeElement as HTMLElement | null;
  const box = app.querySelector(sel);
  return !!(a && box?.contains(a) && (a.tagName === 'SELECT' || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
}

function draw() {
  if (ui.screen !== 'game' || !w) return;
  if (shown !== 'game' || !scene?.attached()) mountGame();
  const now = performance.now();
  takeFx();
  scene!.sync(w, now);
  // 时间在走的时候，隔一阵有人随口说句闲话，山上看着是活的
  if (running() && now > chatterAt) {
    chatterAt = now + 3500 + Math.random() * 4000;
    const ps = members(w).filter((p) => p.job !== 'travel' && !p.breaking);
    const p = ps[Math.floor(Math.random() * ps.length)];
    const line = p && idleLine(w, p, Math.random());
    if (line) scene!.fx({ k: 'say', who: p.id, text: line }, w);
  }
  const stop = frozen();
  put('.hud', hudView(w, ui, ui.speed === 0 ? null : stop));
  if (now < lastSlow + 250) return;
  lastSlow = now;
  if (!busyIn('.rail')) put('.rail', railView(w, ui));
  if (!busyIn('.letters')) put('.letters', lettersView(w, ui));
  if (put('.ticker', tickerView(w))) ageTicker(now);
  put('.quest-slot', questView(w));
  put('.war-slot', warBanner(w));
  if (!busyIn('.master-slot')) put('.master-slot', masterBar(w));
  // 横幅一次一条
  // 快进时横幅会积压：太久以前的就不播了
  while (banners.length && now - banners[0].at > 3500) banners.shift();
  if (now > bannerUntil && banners.length) {
    const b = banners.shift()!;
    bannerUntil = now + 2600;
    put('.banner-slot', `<div class="banner-pop ${b.tone}">${esc(b.text)}</div>`);
  } else if (now > bannerUntil) put('.banner-slot', '');
  const g = app.querySelector('.g') as HTMLElement;
  g.classList.toggle('dw-open', !!ui.drawer);
  g.classList.toggle('has-letter', w.decisions.length > 0);
  g.classList.toggle('paused', !running());
  if (ui.drawer && !busyIn('.drawer') && (parts.get('.dw-tab') !== ui.drawer || now > (drawerAt + 700))) refreshDrawer();
  if (ui.modal && !busyIn('.modal-slot') && ui.streaming === null && now > modalAt + 700) refreshModal();
}

let drawerAt = 0, modalAt = 0;
function refreshDrawer() {
  if (!w || !ui.drawer) return;
  drawerAt = performance.now();
  const tab = ui.drawer;
  const body = app.querySelector('.dw-body') as HTMLElement | null;
  const fresh = parts.get('.dw-tab') !== tab;
  const top = body?.scrollTop ?? 0;
  parts.set('.dw-tab', tab);
  put('#dw-title', TAB_TITLE[tab][0]);
  put('.dw-sub', TAB_TITLE[tab][1]);
  put('.dw-body', tabView(w, { ...ui, tab }));
  if (body) body.scrollTop = fresh ? 0 : top;
}

function refreshModal() {
  modalAt = performance.now();
  const slot = app.querySelector('.modal-slot') as HTMLElement | null;
  if (!slot || !w) return;
  const old = slot.querySelector('.modal') as HTMLElement | null;
  const top = old?.scrollTop ?? 0;
  const lines = slot.querySelector('.chat-lines') as HTMLElement | null;
  const html = ui.modal ? modalView(w, ui, cfg, meter) : '';
  if (parts.get('.modal-slot') === html) return;
  parts.set('.modal-slot', html);
  slot.innerHTML = html;
  const m = slot.querySelector('.modal') as HTMLElement | null;
  if (m) { m.scrollTop = top; if (!old) m.focus({ preventScroll: true }); }
  const nl = slot.querySelector('.chat-lines') as HTMLElement | null;
  if (nl) nl.scrollTop = nl.scrollHeight;
  if (lines && ui.streaming === null) (slot.querySelector('input[name=say]') as HTMLInputElement | null)?.focus();
}

function mountGame() {
  app.innerHTML = gameShell();
  shown = 'game';
  parts.clear();
  scene = new Scene(app.querySelector('.scene') as HTMLElement);
  scene.layout();
}

/** 换屏、点了东西之后：标题和开局整页画；游戏里各块立刻刷新 */
function render() {
  if (ui.screen === 'title') { app.innerHTML = titleView(ui, cfg, meter); shown = 'title'; scene = null; return; }
  if (ui.screen === 'setup') { app.innerHTML = setupView(ui); shown = 'setup'; scene = null; return; }
  if (!w) return;
  if (shown !== 'game' || !scene?.attached()) mountGame();
  lastSlow = 0; drawerAt = 0; modalAt = 0;
  parts.delete('.modal-slot');
  if (!ui.modal) put('.modal-slot', '');
  draw();
  put('.toast-slot', ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
  document.documentElement.dataset.season = String(w.t % 4);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(t: string) {
  ui.toast = t;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; render(); }, 2600);
  render();
}

function afterChange() {
  if (w?.over && ui.modal?.kind !== 'end') ui.modal = { kind: 'end' };
  // 拍完板：要停的事都办了就接着走
  if (w) for (const id of [...holdIds]) if (!w.decisions.some((d) => d.id === id)) holdIds.delete(id);
  if (ui.hold && holdIds.size === 0) ui.hold = false;
  save();
  render();
}

// ───────────── 宗门战 ─────────────

function warRound(useMaster: boolean) {
  if (!w?.war) return;
  const r = rngOf(w);
  w.war.phase = 'round';
  fightRound(w, r, useMaster);
  sfx('drum');
  if (w.war.wins >= 2 || w.war.losses >= 2 || w.war.round >= 3) {
    const res = endWar(w, r);
    if (res.wiped) w.over = { win: false, text: `${res.text}${w.sect.name}从此成了一州的往事。` };
  }
  r.save();
  afterChange();
}

// ───────────── 召见说话 ─────────────

async function chat(id: string, said: string) {
  const client = ai();
  if (!w || !client) return;
  const p = P(w, id);
  if (!p) return;
  const note = noteFreeTalk(w, p);
  if (!note.ok) { toast(note.why); return; }
  const lines = (ui.chats[id] ??= []);
  lines.push({ from: 'me', text: said });
  ui.streaming = '';
  save();
  render(); refreshModal();
  const q = chatPrompt(w, p);
  try {
    const res = await client.chat({ system: q.system, prompt: q.prompt(said, unconvinced(w)), history: chatHistory(lines.slice(0, -1)), maxTokens: 160, onText: (t) => { ui.streaming = replySoFar(t); modalAt = 0; parts.delete('.modal-slot'); refreshStreaming(); } });
    const o = asJson(res.text);
    const reply = cleanLine(o?.reply, 80) ?? '……';
    const mood = Math.max(-2, Math.min(2, Math.round(Number(o?.mood) || 0)));
    lines.push({ from: 'them', text: reply });
    if (note.counts && mood) {
      p.mood = clamp(p.mood + mood * 3, 0, 100);
      adjust(p, w.me, mood * 2);
      lines.push({ from: 'note', text: mood > 0 ? `${pronoun(p)}心里很受用` : `${pronoun(p)}听了不太舒服` });
    }
  } catch (e) {
    lines.push({ from: 'them', text: `（没说上话：${e instanceof Error ? e.message : e}）` });
  }
  ui.streaming = null;
  afterChange(); refreshModal();
}

/** 流式回话：只改正在打字的那一行 */
function refreshStreaming() {
  const li = app.querySelector('.chat-lines .typing');
  if (li) li.textContent = ui.streaming || '……';
  else refreshModal();
}

/** 召见时挑一个话题：后果按规矩算；接了 AI 就让 AI 照这个意思说 */
async function chatTopic(id: string, topic: Topic) {
  if (!w || ui.streaming !== null) return;
  const p = P(w, id);
  if (!p) return;
  const r = rngOf(w);
  const res = talk(w, r, p, topic);
  r.save();
  if (typeof res === 'string') { toast(res); return; }
  const lines = (ui.chats[id] ??= []);
  lines.push({ from: 'me', text: res.said });
  const client = ai();
  if (!client) { lines.push({ from: 'them', text: res.reply }, { from: 'note', text: res.effect }); afterChange(); refreshModal(); return; }
  ui.streaming = '';
  save();
  render(); refreshModal();
  const q = chatPrompt(w, p);
  let reply = res.reply;
  try {
    const out = await client.chat({ system: q.system, prompt: q.prompt(res.said, unconvinced(w), res.reply), history: chatHistory(lines.slice(0, -1)), maxTokens: 160, onText: (t) => { ui.streaming = replySoFar(t); refreshStreaming(); } });
    reply = cleanLine(asJson(out.text)?.reply, 80) ?? res.reply;
  } catch { /* 没连上就用规则的话 */ }
  lines.push({ from: 'them', text: reply }, { from: 'note', text: res.effect });
  ui.streaming = null;
  afterChange(); refreshModal();
}

function chatHistory(lines: Ui['chats'][string]) {
  return lines.filter((l) => l.from !== 'note').slice(-8).map((l) => ({ role: l.from === 'me' ? 'user' as const : 'assistant' as const, content: l.from === 'me' ? `宗主对你说：${l.text}` : JSON.stringify({ reply: l.text, mood: 0 }) }));
}

// ───────────── 点击 ─────────────

function openDrawer(tab: Tab) {
  ui.drawer = ui.drawer === tab ? null : tab;
  ui.tab = tab;
  parts.delete('.dw-tab');
}

function act(a: string, id: string, v: string) {
  const r = w ? rngOf(w) : null;
  const done = (msg?: string | null) => { if (msg) ui.toast = msg, clearTimeout(toastTimer), toastTimer = setTimeout(() => { ui.toast = null; render(); }, 2600); r?.save(); afterChange(); };
  switch (a) {
    case 'continue': w = load(); if (w) { ui.screen = 'game'; ui.modal = w.over ? { kind: 'end' } : w.war ? { kind: 'war' } : null; ui.drawer = null; ui.hold = false; holdIds.clear(); aiSeason = -1; meter.resetGame(); void tryFullscreenLandscape(); checkStops(); } render(); return;
    case 'new': ui.screen = 'setup'; ui.modal = null; ui.setup = randomStart(Date.now() % 1e9); render(); return;
    case 'back-title': ui.screen = 'title'; render(); return;
    case 'setup-pick': (ui.setup as unknown as Record<string, string>)[id] = v; render(); return;
    case 'setup-random': { const rs = randomStart(Date.now() % 1e9); ui.setup = { ...ui.setup, sectName: rs.sectName, masterName: rs.masterName, gender: rs.gender }; render(); return; }
    case 'start': {
      readSetupFields();
      const seed = Date.now() % 1e9;
      w = newWorld({ ...ui.setup, ...rollFate(seed), seed });
      drainFx();
      meter.resetGame();
      ui.chats = {};
      ui.screen = 'game'; ui.drawer = null; ui.modal = { kind: 'year' }; ui.speed = 1; ui.hold = false; holdIds.clear(); aiSeason = -1;
      void tryFullscreenLandscape();
      afterChange();
      return;
    }
    case 'help': ui.modal = { kind: 'help' }; render(); refreshModal(); return;
    case 'settings': ui.modal = { kind: 'settings' }; render(); refreshModal(); return;
    case 'close': case 'close-bg': ui.modal = w?.over && ui.screen === 'game' ? { kind: 'end' } : null; render(); return;
    case 'quit': ui.screen = 'title'; ui.modal = null; ui.hasSave = !!load(); render(); return;
    case 'ai-kind': cfg = { ...cfg, kind: id as AiConfig['kind'] }; saveConfig(cfg); render(); refreshModal(); return;
    case 'ai-mode': cfg = { ...cfg, mode: id as AiConfig['mode'] }; saveConfig(cfg); render(); refreshModal(); return;
    case 'ai-test': void testAi(); return;
    case 'export': exportSave(); return;
    case 'sound': setSound(v === 'on'); if (v === 'on') { unlockSound(); sfx('chime'); } render(); refreshModal(); return;
    case 'pause-on': ui.pauseOn = ({ big: 'all', all: 'none', none: 'big' } as const)[ui.pauseOn]; try { localStorage.setItem('kaizong.pause', ui.pauseOn); } catch { /* 无妨 */ } render(); refreshModal(); return;
  }
  if (!w || !r) { if (ui.screen === 'title') render(); return; }
  // 时间一直在走：点下去的那一刻，人可能已经走了、事可能已经过期了
  switch (a) {
    case 'c-root': case 'c-test': case 'c-heart': case 'c-check': case 'admit': case 'dismiss': if (!w.candidates.some((x) => x.id === id)) return done('这个人已经下山了'); break;
    case 'vouch': case 'gift-pill': case 'expel': case 'chat': case 'break': case 'unassign': case 'star': if (!P(w, id)?.alive || P(w, id)?.sect !== 'me') return done('这个人已经不在山上了'); break;
    case 'dispatch': if (!w.missions.some((x) => x.id === id)) return done('这件差事已经没了'); break;
    case 'decide': if (!w.decisions.some((x) => x.id === id)) return done('这件事已经按默认办了'); break;
  }
  switch (a) {
    case 'tab': openDrawer(id as Tab); render(); return;
    case 'drawer-close': ui.drawer = null; render(); return;
    case 'tab-seclude': openDrawer('staff'); render(); setTimeout(() => app.querySelector('.hall-card.seclude')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); return;
    case 'tab-recruit': openDrawer('recruit'); render(); return;
    case 'person': ui.modal = { kind: 'person', id }; render(); refreshModal(); return;
    case 'hall': ui.drawer = 'staff'; ui.tab = 'staff'; ui.modal = null; parts.delete('.dw-tab'); render(); setTimeout(() => document.getElementById(`hall-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); return;
    case 'speed': {
      const sp = Number(v);
      ui.speed = sp;
      if (sp > 0) { ui.hold = false; holdIds.clear(); }
      if (sp > 0 && (w.needGoal || w.needPolicy || w.needTech)) ui.modal = { kind: 'year' };
      else if (sp > 0 && w.war) ui.modal = { kind: 'war' };
      render(); if (ui.modal) refreshModal();
      return;
    }
    case 'letter': ui.letter = id; render(); return;
    case 'open-year': ui.modal = { kind: 'year' }; render(); refreshModal(); return;
    case 'open-war': ui.modal = { kind: 'war' }; render(); refreshModal(); return;
    case 'toggle-history': ui.showHistory = !ui.showHistory; parts.delete('.dw-tab'); render(); return;
    case 'decide': { const e = resolveDecision(w, r, id, v); if (!e) { ui.letter = null; sfx('click'); } return done(e); }
    case 'star': { const p = P(w, id)!; p.starred = !p.starred; done(p.starred ? `已标记${p.name}：${pronoun(p)}的事一定写进纪事${cfg.kind === 'deepseek' && cfg.apiKey ? '，由 AI 来想' : ''}` : null); refreshModal(); return; }
    case 'break': {
      const p = P(w, id)!;
      const e = breakNow(w, r, p, v as BreakWay);
      done(e ?? `${p.name}进洞闭关了，过些日子出结果`);
      if (!e) { ui.modal = null; render(); }
      return;
    }
    case 'topic': void chatTopic(id, v as Topic); return;
    case 'guide-off': w.guideOff = true; return done();
    case 'unassign': { const p = P(w, id)!; assignJob(w, p, 'none'); return done(); }
    case 'build': { const e = startWork(w, id as HallId); if (!e) sfx('build'); return done(e ?? '动工了，山上搭起了脚手架'); }
    case 'tourney': return done(holdTourney(w));
    case 'policy': choosePolicy(w, id); if (!w.needTech && !w.needGoal) ui.modal = null; done(); refreshModal(); return;
    case 'tech': { const e = learnTech(w, id); if (!e && !w.needPolicy && !w.needGoal) ui.modal = null; done(e); refreshModal(); return; }
    case 'goal': { const e = chooseGoal(w, Number(id)); if (!e && !w.needPolicy && !w.needTech) ui.modal = null; done(e); refreshModal(); return; }
    case 'open-master': ui.modal = { kind: 'master' }; render(); refreshModal(); return;
    case 'master-act': { const e = setMasterPlan(w, id as MasterAct); if (!e) ui.modal = null; return done(e); }
    case 'dispatch': {
      const m = w.missions.find((x) => x.id === id);
      const e = dispatch(w, id, ui.team[id] ?? []);
      if (!e) { delete ui.team[id]; sfx('whoosh'); return done(`派出去了，一趟 ${m ? tripDays(m) : ''} 日`); }
      return done(e);
    }
    case 'vouch': done(vouch(w, P(w, id)!)); refreshModal(); return;
    case 'gift-pill': done(giftPill(w, P(w, id)!)); refreshModal(); return;
    case 'expel': ui.modal = { kind: 'confirm', text: `真要把${P(w, id)!.name}逐出山门？`, act: `expel-yes:${id}` }; render(); refreshModal(); return;
    case 'chat': ui.modal = { kind: 'chat', id }; render(); refreshModal(); return;
    case 'dip': { const rv = w.rivals.find((x) => x.id === id)!; const e = diplomacy(w, rv, v as 'gift'); if (!e && v === 'war') toast(`向${rv.name}宣战了。大军二十日后开拔。`); return done(e); }
    case 'c-root': { const c = w.candidates.find((x) => x.id === id)!; return done(testRoot(w, c)); }
    case 'c-test': { const c = w.candidates.find((x) => x.id === id)!; return done(testSkill(w, c, (ui.testPick[id] ?? 'combat') as Skill)); }
    case 'c-heart': { const c = w.candidates.find((x) => x.id === id)!; return done(heartTest(w, c)); }
    case 'c-check': { const c = w.candidates.find((x) => x.id === id)!; return done(checkOrigin(w, c)); }
    case 'admit': { const c = w.candidates.find((x) => x.id === id)!; const ok = admit(w, r, c, v as 'outer'); if (ok) sfx('chime'); return done(ok ? `${P(w, id)!.name}拜入了山门，记得给${P(w, id)!.gender === 'f' ? '她' : '他'}安排差事` : `${P(w, id)!.name}婉拒了`); }
    case 'dismiss': { const c = w.candidates.find((x) => x.id === id)!; dismiss(w, c); return done(); }
    case 'war-stance': w.war!.stance = id as 'hold'; done(); refreshModal(); return;
    case 'war-go': warRound(false); refreshModal(); return;
    case 'war-round': warRound(v === 'master'); refreshModal(); return;
    case 'war-heal': healTeam(w); done(); refreshModal(); return;
    case 'war-retreat': { const res = endWar(w, r, true); if (res.wiped) w.over = { win: false, text: res.text }; done(); refreshModal(); return; }
    case 'war-close': w.war = null; checkEnd(w); ui.modal = w.needPolicy || w.needTech || w.needGoal ? { kind: 'year' } : null; done(); refreshModal(); return;
    case 'play-on': w.endYear += 10; w.over = null; ui.modal = null; return done('再玩十年。');
  }
  if (a.startsWith('expel-yes:')) { const p = P(w, a.slice(10))!; expel(w, r, p, '宗主之命'); ui.modal = null; return done(); }
}

function readSetupFields() {
  for (const el of app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
    const k = el.dataset.field as keyof StartChoice;
    const v = el.value.trim();
    if (v) (ui.setup as unknown as Record<string, string>)[k] = v;
  }
}

function change(a: string, id: string, v: string, el: HTMLInputElement | HTMLSelectElement) {
  if (a === 'import') { void importSave(el as HTMLInputElement); return; }
  if (!w) return;
  const r = rngOf(w);
  const done = () => { r.save(); (el as HTMLElement).blur(); afterChange(); if (ui.modal) refreshModal(); };
  switch (a) {
    case 'sort': ui.sort = v as Ui['sort']; (el as HTMLElement).blur(); render(); return;
    case 'p-job': case 'p-rank': if (!P(w, id)?.alive || P(w, id)?.sect !== 'me') { toast('这个人已经不在山上了'); return; } break;
    case 'assign': case 'set-head': if (v && v !== '-' && (!P(w, v)?.alive || P(w, v)?.sect !== 'me')) { toast('这个人已经不在山上了'); return; } break;
  }
  switch (a) {
    case 'set-head': if (v === '-') setHead(w, id as HallId, null); else if (v) setHead(w, id as HallId, P(w, v)!); return done();
    case 'assign': if (v) assignJob(w, P(w, v)!, id as JobId); return done();
    case 'p-job': if (v) assignJob(w, P(w, id)!, v as JobId); return done();
    case 'p-rank': if (v) setRank(w, P(w, id)!, v as (typeof RANK_ORDER)[number]); return done();
    case 'pill-rule': w.sect.pillRule = v as World['sect']['pillRule']; return done();
    case 'c-pick': ui.testPick[id] = v; return;
    case 'master-target': { if (!v) return; const e = setMasterPlan(w, id as MasterAct, v); if (!e) ui.modal = null; if (e) toast(e); else done(); return; }
    case 'team': {
      const [mid, slot] = id.split(':');
      const t = [...(ui.team[mid] ?? [])];
      if (v === '-' || !v) t.splice(Number(slot), 1); else t[Number(slot)] = v;
      ui.team[mid] = t.filter(Boolean);
      (el as HTMLElement).blur();
      parts.delete('.dw-tab');
      render();
      return;
    }
    case 'war-team': {
      const war = w.war!;
      const on = (el as HTMLInputElement).checked;
      if (on && war.team.length >= 8) { (el as HTMLInputElement).checked = false; toast('最多派 8 人'); return; }
      war.team = on ? [...new Set([...war.team, id])] : war.team.filter((x) => x !== id);
      return done();
    }
  }
}

async function testAi() {
  const client = ai();
  if (!client) { toast('先填密钥'); return; }
  toast('正在连 DeepSeek……');
  try {
    const res = await client.chat({ system: '只输出 JSON：{"reply":"一句话"}', prompt: '用一句古风的话打个招呼。', maxTokens: 60 });
    toast(`连上了：${cleanLine(asJson(res.text)?.reply, 40) ?? res.text.slice(0, 40)}`);
  } catch (e) {
    toast(`没连上：${e instanceof Error ? e.message : e}`);
  }
}

function exportSave() {
  if (!w) return;
  const blob = new Blob([JSON.stringify(w)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `开宗立派-${w.sect.name}-第${Math.floor(w.t / 4) + 1}年.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importSave(input: HTMLInputElement) {
  const f = input.files?.[0];
  if (!f) return;
  try {
    const o = JSON.parse(await f.text()) as World;
    if (o?.v !== 1 || !o.sect) throw new Error('不是开宗立派的存档');
    w = migrate(o);
    ui.screen = 'game'; ui.modal = null; aiSeason = -1;
    afterChange();
    toast('存档已导入');
  } catch (e) {
    toast(`导入失败：${e instanceof Error ? e.message : e}`);
  }
}

app.addEventListener('pointerdown', () => { pressing = true; unlockSound(); });
const release = () => setTimeout(() => { pressing = false; }, 60);
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  if (el.dataset.act === 'close-bg' && e.target !== el) return;
  if ((el as HTMLButtonElement).disabled) return;
  e.preventDefault();
  pressing = false;
  act(el.dataset.act!, el.dataset.id ?? '', el.dataset.v ?? '');
});
app.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (!el.dataset.act) return;
  change(el.dataset.act, el.dataset.id ?? '', el.value, el);
});
app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  if (f.dataset.form === 'key') {
    const key = (new FormData(f).get('key') as string | null)?.trim();
    if (key) { cfg = { ...cfg, kind: 'deepseek', apiKey: key }; saveConfig(cfg); toast('密钥已保存在本机浏览器里'); refreshModal(); }
  }
  if (f.dataset.form === 'chat') {
    const said = (new FormData(f).get('say') as string | null)?.trim();
    if (said && ui.streaming === null) void chat(f.dataset.id!, said);
  }
});
document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
  if (e.key === 'Tab' && ui.modal) {
    const dialog = app.querySelector<HTMLElement>('.modal');
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) { e.preventDefault(); dialog?.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus(); }
  }
  if (e.key === 'Escape') {
    if (ui.modal && ui.modal.kind !== 'war' && ui.modal.kind !== 'end') { ui.modal = null; render(); }
    else if (ui.drawer) { ui.drawer = null; render(); }
    return;
  }
  if (typing || ui.screen !== 'game') return;
  // 空格暂停/继续，1 2 3 调快慢
  if (e.key === ' ') { e.preventDefault(); act('speed', '', String(ui.speed > 0 && !ui.hold ? 0 : 1)); }
  if (e.key === '1' || e.key === '2' || e.key === '3') act('speed', '', ({ 1: '1', 2: '2', 3: '4' } as Record<string, string>)[e.key]);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// 调试和自动化测试用：控制台里 kaizong.world() 看存档
(window as unknown as { kaizong: unknown }).kaizong = { world: () => w, ui };

setupOrientation(app, () => { scene?.layout(); document.documentElement.classList.toggle('rot', isRotated()); });
render();
