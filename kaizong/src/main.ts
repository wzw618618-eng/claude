// 网页入口：状态、点击处理、存档、接 AI、过季流程。

import { createDeepSeek, replySoFar, asJson, type AiClient } from './ai/client';
import { createMeter, loadConfig, saveConfig, type AiConfig } from './ai/config';
import { chatPrompt } from './ai/prompts';
import { afterSeason, askSeason, cleanLine } from './ai/runner';
import type { RANK_ORDER } from './game/data/world';
import { REALM_NAME } from './game/cult';
import { breakNow, resolveDecision, type BreakWay } from './game/decisions';
import { admit, checkOrigin, dismiss, heartTest, testRoot, testSkill } from './game/recruit';
import { diplomacy } from './game/rivals';
import { chooseGoal } from './game/goals';
import { setMasterPlan } from './game/master';
import { dispatch } from './game/missions';
import { migrate } from './game/save';
import { advanceSeason, AI_LIMIT, checkEnd, choosePolicy, giftPill, holdTourney, learnTech, planSeason, vouch } from './game/season';
import { startWork } from './game/build';
import { assignJob, setHead, setRank, unconvinced } from './game/sect';
import { expel } from './game/decisions';
import { newWorld, randomStart, rollFate, type StartChoice } from './game/setup';
import type { HallId, JobId, MasterAct, Skill, World } from './game/types';
import { noteFreeTalk, talk, type Topic } from './game/talk';
import { endWar, fightRound, healTeam } from './game/war';
import { adjust, clamp, P, pronoun, rngOf } from './game/world';
import { gameView, setupView, titleView, type Tab, type Ui } from './ui/views';

const SAVE = 'kaizong.save.v1';
const app = document.getElementById('app')!;
let w: World | null = null;
let cfg: AiConfig = loadConfig();
const meter = createMeter();
const ui: Ui = {
  screen: 'title', tab: 'report', modal: null, setup: randomStart(Date.now() % 1e9), busy: null, toast: null, sort: 'rank',
  chats: {}, streaming: null, testPick: {}, showHistory: false, hasSave: false, team: {},
};

function load(): World | null {
  try {
    const s = localStorage.getItem(SAVE);
    if (!s) return null;
    const o = JSON.parse(s) as World;
    return o && o.v === 1 ? migrate(o) : null;
  } catch { return null; }
}
function save() {
  if (!w) return;
  try { localStorage.setItem(SAVE, JSON.stringify(w)); } catch { /* 存不下就算了 */ }
}
ui.hasSave = !!load();

function ai(): AiClient | null {
  if (cfg.kind !== 'deepseek' || !cfg.apiKey) return null;
  return createDeepSeek({ apiKey: cfg.apiKey, onUsage: (u, ms) => meter.record(u, ms) });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(t: string) {
  ui.toast = t;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; render(); }, 2600);
}

let renderedTab: Tab | null = null;
let returnFocus: { act: string; id?: string } | null = null;
function render() {
  const previousDialog = app.querySelector('.modal');
  const active = document.activeElement as HTMLElement | null;
  const activeKey = active?.dataset.act ? { act: active.dataset.act, id: active.dataset.id } : null;
  if (!previousDialog && ui.modal) returnFocus = activeKey;
  const scroll = (app.querySelector('.panel') as HTMLElement | null)?.scrollTop ?? 0;
  const mScroll = (app.querySelector('.modal') as HTMLElement | null)?.scrollTop ?? 0;
  const lines = app.querySelector('.chat-lines') as HTMLElement | null;
  const focusChat = document.activeElement?.getAttribute('name') === 'say';
  if (ui.screen === 'title') app.innerHTML = titleView(ui, cfg, meter);
  else if (ui.screen === 'setup') app.innerHTML = setupView(ui);
  else if (w) app.innerHTML = gameView(w, ui, cfg, meter);
  const panel = app.querySelector('.panel') as HTMLElement | null;
  if (panel) panel.scrollTop = renderedTab === ui.tab ? scroll : 0;
  renderedTab = ui.tab;
  const modal = app.querySelector('.modal') as HTMLElement | null;
  if (modal) modal.scrollTop = mScroll;
  const restore = (key: {act: string; id?: string} | null) => {
    const target = key && Array.from(app.querySelectorAll<HTMLElement>('[data-act]')).find(el => el.dataset.act === key.act && el.dataset.id === key.id);
    target?.focus({ preventScroll: true });
    return !!target;
  };
  if (modal && !previousDialog) modal.focus({ preventScroll: true });
  else if (modal && previousDialog && !focusChat) { if (!restore(activeKey)) modal.focus({ preventScroll: true }); }
  else if (!modal && previousDialog) restore(returnFocus);
  const nl = app.querySelector('.chat-lines') as HTMLElement | null;
  if (nl) nl.scrollTop = nl.scrollHeight;
  if (focusChat || (lines && ui.streaming === null)) (app.querySelector('input[name=say]') as HTMLInputElement | null)?.focus();
  document.documentElement.dataset.season = w ? String(w.t % 4) : '0';
}

function afterChange() {
  if (w?.over && ui.modal?.kind !== 'end') ui.modal = { kind: 'end' };
  save();
  render();
}

// ───────────── 过季 ─────────────

async function advance() {
  if (!w || ui.busy || w.over) return;
  if (w.needPolicy || w.needTech || w.needGoal) { ui.modal = { kind: 'year' }; render(); return; }
  const client = ai();
  const mode = client ? cfg.mode : 'off';
  const plan = planSeason(w, mode);
  let picks = {}, rivalPicks = {};
  if (client && (plan.aiWho.length || plan.aiRivals.length)) {
    ui.busy = '弟子们各自盘算着这一季要做什么……';
    render();
    const res = await askSeason(w, plan, client, (done, total, who) => { ui.busy = `弟子们各自盘算着这一季要做什么……（${done}/${total}：${who}）`; render(); });
    picks = res.picks; rivalPicks = res.rivalPicks;
    if (res.error && Object.keys(picks).length === 0) toast(`AI 没连上：${res.error}。这一季用规则代替。`);
  }
  const sum = advanceSeason(w, plan, picks, rivalPicks);
  ui.busy = null;
  ui.tab = 'report';
  ui.showHistory = false;
  if (w.war && w.war.phase === 'prep') ui.modal = { kind: 'war' };
  else if (w.needPolicy || w.needTech || w.needGoal) ui.modal = { kind: 'year' };
  ui.team = {};
  afterChange();
  if (client && (sum.newWishes.length || sum.wishNews.some((x) => x.credit))) {
    const world = w;
    void afterSeason(world, client, sum.newWishes, sum.wishNews, AI_LIMIT[cfg.mode]).then((n) => { if (n && w === world) { save(); render(); } });
  }
}

// ───────────── 宗门战 ─────────────

function warRound(useMaster: boolean) {
  if (!w?.war) return;
  const r = rngOf(w);
  w.war.phase = 'round';
  fightRound(w, r, useMaster);
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
  if (!note.ok) { toast(note.why); render(); return; }
  const lines = (ui.chats[id] ??= []);
  lines.push({ from: 'me', text: said });
  ui.streaming = '';
  save();
  render();
  const q = chatPrompt(w, p);
  try {
    const res = await client.chat({ system: q.system, prompt: q.prompt(said, unconvinced(w)), history: chatHistory(lines.slice(0, -1)), maxTokens: 160, onText: (t) => { ui.streaming = replySoFar(t); render(); } });
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
  afterChange();
}

/** 召见时挑一个话题：后果按规矩算；接了 AI 就让 AI 照这个意思说 */
async function chatTopic(id: string, topic: Topic) {
  if (!w || ui.streaming !== null) return;
  const p = P(w, id);
  if (!p) return;
  const r = rngOf(w);
  const res = talk(w, r, p, topic);
  r.save();
  if (typeof res === 'string') { toast(res); render(); return; }
  const lines = (ui.chats[id] ??= []);
  lines.push({ from: 'me', text: res.said });
  const client = ai();
  if (!client) { lines.push({ from: 'them', text: res.reply }, { from: 'note', text: res.effect }); afterChange(); return; }
  ui.streaming = '';
  save();
  render();
  const q = chatPrompt(w, p);
  let reply = res.reply;
  try {
    const out = await client.chat({ system: q.system, prompt: q.prompt(res.said, unconvinced(w), res.reply), history: chatHistory(lines.slice(0, -1)), maxTokens: 160, onText: (t) => { ui.streaming = replySoFar(t); render(); } });
    reply = cleanLine(asJson(out.text)?.reply, 80) ?? res.reply;
  } catch { /* 没连上就用规则的话 */ }
  lines.push({ from: 'them', text: reply }, { from: 'note', text: res.effect });
  ui.streaming = null;
  afterChange();
}

function chatHistory(lines: Ui['chats'][string]) {
  return lines.filter((l) => l.from !== 'note').slice(-8).map((l) => ({ role: l.from === 'me' ? 'user' as const : 'assistant' as const, content: l.from === 'me' ? `宗主对你说：${l.text}` : JSON.stringify({ reply: l.text, mood: 0 }) }));
}

// ───────────── 点击 ─────────────

function act(a: string, id: string, v: string, el: HTMLElement) {
  const r = w ? rngOf(w) : null;
  const done = (msg?: string | null) => { if (msg) toast(msg); r?.save(); afterChange(); };
  switch (a) {
    case 'continue': w = load(); if (w) { ui.screen = 'game'; ui.modal = w.over ? { kind: 'end' } : w.war ? { kind: 'war' } : null; meter.resetGame(); } render(); return;
    case 'new': ui.screen = 'setup'; ui.modal = null; ui.setup = randomStart(Date.now() % 1e9); render(); return;
    case 'back-title': ui.screen = 'title'; render(); return;
    case 'setup-pick': (ui.setup as unknown as Record<string, string>)[id] = v; render(); return;
    case 'setup-random': { const r = randomStart(Date.now() % 1e9); ui.setup = { ...ui.setup, sectName: r.sectName, masterName: r.masterName, gender: r.gender }; render(); return; }
    case 'start': {
      readSetupFields();
      const seed = Date.now() % 1e9;
      w = newWorld({ ...ui.setup, ...rollFate(seed), seed });
      meter.resetGame();
      ui.chats = {};
      ui.screen = 'game'; ui.tab = 'report'; ui.modal = { kind: 'year' };
      afterChange();
      return;
    }
    case 'help': ui.modal = { kind: 'help' }; render(); return;
    case 'settings': ui.modal = { kind: 'settings' }; render(); return;
    case 'close': case 'close-bg': ui.modal = w?.over && ui.screen === 'game' ? { kind: 'end' } : null; render(); return;
    case 'quit': ui.screen = 'title'; ui.modal = null; ui.hasSave = !!load(); render(); return;
    case 'ai-kind': cfg = { ...cfg, kind: id as AiConfig['kind'] }; saveConfig(cfg); render(); return;
    case 'ai-mode': cfg = { ...cfg, mode: id as AiConfig['mode'] }; saveConfig(cfg); render(); return;
    case 'ai-test': void testAi(); return;
    case 'export': exportSave(); return;
  }
  if (!w || !r) return;
  switch (a) {
    case 'tab': ui.tab = id as Tab; render(); if (matchMedia('(max-width: 860px)').matches) app.querySelector('.right')?.scrollIntoView({ block: 'start' }); return;
    case 'person': ui.modal = { kind: 'person', id }; render(); return;
    case 'hall': ui.tab = 'staff'; ui.modal = null; render(); document.getElementById(`hall-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    case 'advance':
      if (w.decisions.length && !(ui.modal?.kind === 'confirm')) { ui.modal = { kind: 'confirm', text: `还有 ${w.decisions.length} 件事没裁决，过季时会按"不管"的默认处理。确定过季？`, act: 'advance-yes' }; render(); return; }
      ui.modal = null; void advance(); return;
    case 'advance-yes': ui.modal = null; void advance(); return;
    case 'open-year': ui.modal = { kind: 'year' }; render(); return;
    case 'open-war': ui.modal = { kind: 'war' }; render(); return;
    case 'toggle-history': ui.showHistory = !ui.showHistory; render(); return;
    case 'decide': return done(resolveDecision(w, r, id, v));
    case 'star': { const p = P(w, id)!; p.starred = !p.starred; return done(p.starred ? `已标记${p.name}，${pronoun(p)}的事排在季报最前面${cfg.kind === 'deepseek' && cfg.apiKey ? `，每季由 AI 来想` : ''}` : null); }
    case 'break': {
      const p = P(w, id)!;
      const was = p.realm;
      const e = breakNow(w, r, p, v as BreakWay);
      if (e) return done(e);
      return done(p.realm > was ? `${p.name}冲关成功，踏入${REALM_NAME[p.realm]}！` : `${p.name}冲关失败，受了内伤。`);
    }
    case 'topic': void chatTopic(id, v as Topic); return;
    case 'guide-off': w.guideOff = true; return done();
    case 'unassign': { const p = P(w, id)!; assignJob(w, p, 'none'); return done(); }
    case 'build': { const e = startWork(w, id as HallId); return done(e ?? '动工了'); }
    case 'tourney': return done(holdTourney(w));
    case 'policy': choosePolicy(w, id); if (!w.needTech && !w.needGoal) ui.modal = null; return done();
    case 'tech': { const e = learnTech(w, id); if (!e && !w.needPolicy && !w.needGoal) ui.modal = null; return done(e); }
    case 'goal': { const e = chooseGoal(w, Number(id)); if (!e && !w.needPolicy && !w.needTech) ui.modal = null; return done(e); }
    case 'open-master': ui.modal = { kind: 'master' }; render(); return;
    case 'master-act': { const e = setMasterPlan(w, id as MasterAct); if (!e) ui.modal = null; return done(e); }
    case 'dispatch': {
      const e = dispatch(w, id, ui.team[id] ?? []);
      if (!e) { const m = w.expeditions[w.expeditions.length - 1]; delete ui.team[id]; return done(`派出去了，${m.back <= w.t + 1 ? '这一季过完' : '过两季'}回来`); }
      return done(e);
    }
    case 'vouch': return done(vouch(w, P(w, id)!));
    case 'gift-pill': return done(giftPill(w, P(w, id)!));
    case 'expel': ui.modal = { kind: 'confirm', text: `真要把${P(w, id)!.name}逐出山门？`, act: `expel-yes:${id}` }; render(); return;
    case 'chat': ui.modal = { kind: 'chat', id }; render(); return;
    case 'dip': { const rv = w.rivals.find((x) => x.id === id)!; const e = diplomacy(w, rv, v as 'gift'); if (!e && v === 'war') toast(`向${rv.name}宣战了。下一季开打。`); return done(e); }
    case 'c-root': { const c = w.candidates.find((x) => x.id === id)!; return done(testRoot(w, c)); }
    case 'c-test': { const c = w.candidates.find((x) => x.id === id)!; return done(testSkill(w, c, (ui.testPick[id] ?? 'combat') as Skill)); }
    case 'c-heart': { const c = w.candidates.find((x) => x.id === id)!; return done(heartTest(w, c)); }
    case 'c-check': { const c = w.candidates.find((x) => x.id === id)!; return done(checkOrigin(w, c)); }
    case 'admit': { const c = w.candidates.find((x) => x.id === id)!; const ok = admit(w, r, c, v as 'outer'); return done(ok ? `${P(w, id)!.name}拜入了山门，记得给${P(w, id)!.gender === 'f' ? '她' : '他'}安排差事` : `${P(w, id)!.name}婉拒了`); }
    case 'dismiss': { const c = w.candidates.find((x) => x.id === id)!; dismiss(w, c); return done(); }
    case 'war-stance': w.war!.stance = id as 'hold'; return done();
    case 'war-go': warRound(false); return;
    case 'war-round': warRound(v === 'master'); return;
    case 'war-heal': healTeam(w); return done();
    case 'war-retreat': { const res = endWar(w, r, true); if (res.wiped) w.over = { win: false, text: res.text }; return done(); }
    case 'war-close': w.war = null; checkEnd(w); ui.modal = w.needPolicy || w.needTech || w.needGoal ? { kind: 'year' } : null; return done();
    case 'play-on': w.endYear += 10; w.over = null; ui.modal = null; return done('再玩十年。');
  }
  if (a.startsWith('expel-yes:')) { const p = P(w, a.slice(10))!; expel(w, r, p, '宗主之命'); ui.modal = null; return done(); }
  void el;
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
  const done = () => { r.save(); afterChange(); };
  switch (a) {
    case 'sort': ui.sort = v as Ui['sort']; render(); return;
    case 'set-head': if (v === '-') setHead(w, id as HallId, null); else if (v) setHead(w, id as HallId, P(w, v)!); return done();
    case 'assign': if (v) assignJob(w, P(w, v)!, id as JobId); return done();
    case 'p-job': if (v) assignJob(w, P(w, id)!, v as JobId); return done();
    case 'p-rank': if (v) setRank(w, P(w, id)!, v as (typeof RANK_ORDER)[number]); return done();
    case 'pill-rule': w.sect.pillRule = v as World['sect']['pillRule']; return done();
    case 'c-pick': ui.testPick[id] = v; return;
    case 'master-target': { if (!v) return; const e = setMasterPlan(w, id as MasterAct, v); if (!e) ui.modal = null; return e ? (toast(e), render()) : done(); }
    case 'team': {
      const [mid, slot] = id.split(':');
      const t = [...(ui.team[mid] ?? [])];
      if (v === '-' || !v) t.splice(Number(slot), 1); else t[Number(slot)] = v;
      ui.team[mid] = t.filter(Boolean);
      render();
      return;
    }
    case 'war-team': {
      const war = w.war!;
      const on = (el as HTMLInputElement).checked;
      if (on && war.team.length >= 8) { (el as HTMLInputElement).checked = false; toast('最多派 8 人'); render(); return; }
      war.team = on ? [...new Set([...war.team, id])] : war.team.filter((x) => x !== id);
      return done();
    }
  }
}

async function testAi() {
  const client = ai();
  if (!client) { toast('先填密钥'); return; }
  ui.busy = '正在连 DeepSeek……';
  render();
  try {
    const res = await client.chat({ system: '只输出 JSON：{"reply":"一句话"}', prompt: '用一句古风的话打个招呼。', maxTokens: 60 });
    toast(`连上了：${cleanLine(asJson(res.text)?.reply, 40) ?? res.text.slice(0, 40)}`);
  } catch (e) {
    toast(`没连上：${e instanceof Error ? e.message : e}`);
  }
  ui.busy = null;
  render();
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
    ui.screen = 'game'; ui.modal = null;
    afterChange();
    toast('存档已导入');
  } catch (e) {
    toast(`导入失败：${e instanceof Error ? e.message : e}`);
  }
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  if (el.dataset.act === 'close-bg' && e.target !== el) return;
  if ((el as HTMLButtonElement).disabled) return;
  e.preventDefault();
  act(el.dataset.act!, el.dataset.id ?? '', el.dataset.v ?? '', el);
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
    if (key) { cfg = { ...cfg, kind: 'deepseek', apiKey: key }; saveConfig(cfg); toast('密钥已保存在本机浏览器里'); render(); }
  }
  if (f.dataset.form === 'chat') {
    const said = (new FormData(f).get('say') as string | null)?.trim();
    if (said && ui.streaming === null) void chat(f.dataset.id!, said);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && ui.modal) {
    const dialog = app.querySelector<HTMLElement>('.modal');
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) { e.preventDefault(); dialog?.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus(); }
  }
  if (e.key === 'Escape' && ui.modal && ui.modal.kind !== 'war' && ui.modal.kind !== 'end') { ui.modal = null; render(); }
});

render();

