// 入口：持有游戏状态，处理点击，存档，接上 AI 对话。

import { applyTalk, buildPrompt, canTalk, parseAI, scriptedReply, TalkResult, Topic, TOPICS } from '../tiangong/assets/hanyi/ai/dialogue';
import { makeRng } from '../tiangong/assets/hanyi/core/rng';
import { GameState, TaskId } from '../tiangong/assets/hanyi/core/types';
import { cancelProject, choose, endDay, endNight, newGame, setTask, startProject, toNight } from '../tiangong/assets/hanyi/game';
import { adoptAll, adoptIntent, openChat } from '../tiangong/assets/hanyi/ai/intent';
import { createSound, CUE_FOR_ACT } from '../tiangong/assets/ui/audio';
import { createFx } from '../tiangong/assets/ui/fx';
import { endingScreen, gameScreen, hasOverlay, storyTotal, TIPS, titleScreen, UI } from '../tiangong/assets/ui/view';

declare global {
  interface Window { claude?: any }
}

const KEY = 'hanyi.save.v1';
const TIPS_KEY = 'hanyi.tips.v1';
const SOUND_KEY = 'hanyi.sound.v1';
const HEART_KEY = 'hanyi.heart.v1';
const app = document.getElementById('app')!;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 存不了不影响游玩 */ } };
const sound = createSound(window, { muted: read(SOUND_KEY) === 'off' });
const layer = document.createElement('div');
layer.className = 'hanyi-fx';
layer.setAttribute('aria-hidden', 'true');
document.body.append(layer);
const fx = createFx(app, layer, window, sound);
let s: GameState | null = null;
let sample: any = null;
let aiOff = false;

const ui: UI = {
  screen: 'title',
  tab: 'people',
  sheet: null,
  outcome: null,
  confirmReset: false,
  thinking: null,
  aiNote: null,
  reportOpen: false,
  ai: false,
  hasSave: false,
  tips: (() => { try { return JSON.parse(read(TIPS_KEY) ?? '[]'); } catch { return []; } })(),
  sound: read(SOUND_KEY) !== 'off',
  heartSeen: Number(read(HEART_KEY) ?? 0) || 0,
};
const saveTips = () => write(TIPS_KEY, JSON.stringify(ui.tips));

function save() {
  if (!s) return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 无痕模式等情况下存不了，不影响游玩 */ }
}
function load(): GameState | null {
  try {
    const t = localStorage.getItem(KEY);
    const g = t ? JSON.parse(t) : null;
    return g && g.v === 1 ? g : null;
  } catch {
    return null;
  }
}

let lastSheetKey = '';
function render(opts: { top?: boolean; chatBottom?: boolean } = {}) {
  const y = opts.top ? 0 : window.scrollY;
  const prevSheet = app.querySelector('.sheet');
  const sheetY = prevSheet?.scrollTop ?? 0;
  if (ui.screen === 'title' || !s) app.innerHTML = titleScreen(ui);
  else if (s.phase === 'ending') app.innerHTML = endingScreen(s);
  else app.innerHTML = gameScreen(s, ui);
  const phase = ui.screen === 'title' || !s ? 'title' : s.phase;
  document.documentElement.dataset.phase = phase;
  app.dataset.phase = phase;
  const overlay = !!s && ui.screen === 'game' && s.phase !== 'ending' && hasOverlay(s, ui);
  document.documentElement.classList.toggle('lock', overlay);
  window.scrollTo(0, y);
  const sheet = app.querySelector('.sheet');
  const key = ui.outcome ? 'outcome' : s?.pending[0] ? `ev:${s.pending[0].id}:${s.pending.length}` : ui.sheet ? `${ui.sheet.kind}:${ui.sheet.id}` : '';
  if (sheet) {
    if (opts.chatBottom) sheet.scrollTop = sheet.scrollHeight;
    else if (key === lastSheetKey) sheet.scrollTop = sheetY;
  }
  if (key && key === lastSheetKey) app.querySelectorAll('.scrim, .sheet').forEach((el) => el.classList.add('still'));
  lastSheetKey = key;
  fx.after(s, ui);
}

// ───────────── 点击 ─────────────

app.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const el = t.closest<HTMLElement>('[data-act]');
  if (!el) return;
  const stop = t.closest('[data-stop]');
  if (stop && !stop.contains(el)) return; // 点在面板里的空白处，不当作点了背后的遮罩
  sound.unlock();
  if ((el as HTMLButtonElement).disabled) { sound.play('deny'); return; }
  const a = el.dataset.act!;
  const id = el.dataset.id ?? '';
  const v = el.dataset.v ?? '';
  let top = false;
  if (CUE_FOR_ACT[a]) sound.play(CUE_FOR_ACT[a]);
  if (a === 'sound') {
    sound.setMuted(!sound.muted);
    ui.sound = !sound.muted;
    write(SOUND_KEY, ui.sound ? 'on' : 'off');
    if (ui.sound) sound.play('tap');
    return render();
  }

  if (a === 'new') {
    s = newGame();
    ui.heartSeen = 0;
    write(HEART_KEY, '0');
    Object.assign(ui, { screen: 'game', tab: 'people', sheet: null, outcome: null, confirmReset: false, reportOpen: false, aiNote: null });
    top = true;
  } else if (a === 'continue') {
    ui.screen = 'game';
    top = true;
  }
  if (!s) return render();

  switch (a) {
    case 'tab':
      ui.tab = v as UI['tab']; ui.confirmReset = false; top = true;
      if (v === 'build' && !ui.tips!.includes('build')) { ui.tips!.push('build'); saveTips(); }
      if (v === 'heart') {
        if (!ui.tips!.includes('heart')) { ui.tips!.push('heart'); saveTips(); }
        ui.heartSeen = storyTotal(s);
        write(HEART_KEY, String(ui.heartSeen));
      }
      break;
    case 'info': ui.sheet = { kind: 'info', id: v }; break;
    case 'end-check': ui.sheet = { kind: 'end', id: '' }; break;
    case 'tip': if (!ui.tips!.includes(v)) ui.tips!.push(v); saveTips(); break;
    case 'tip-skip': ui.tips = [...new Set([...ui.tips!, ...TIPS.map((t) => t.id).filter((t) => ['people', 'assign', 'res', 'end'].includes(t))])]; saveTips(); break;
    case 'tip-reset': ui.tips = []; saveTips(); ui.tab = 'people'; top = true; break;
    case 'pick': ui.sheet = { kind: 'task', id }; break;
    case 'set': setTask(s, id, v as TaskId); ui.sheet = null; break;
    case 'person': ui.sheet = { kind: 'person', id }; break;
    case 'chat': ui.sheet = { kind: 'chat', id }; ui.aiNote = null; openChat(s, id); break;
    case 'adopt': adoptIntent(s, id); break;
    case 'adopt-all': adoptAll(s); break;
    case 'close': ui.sheet = null; break;
    case 'topic': void talk(id, v as Topic); return;
    case 'choose': { const r = choose(s, Number(el.dataset.i)); if (r) ui.outcome = r; break; }
    case 'ok': ui.outcome = null; break;
    case 'end-day': endDay(s); ui.sheet = null; ui.reportOpen = false; ui.tab = 'people'; top = true; break;
    case 'night': toNight(s); ui.tab = 'people'; top = true; break;
    case 'sleep': endNight(s); ui.sheet = null; ui.reportOpen = false; ui.tab = 'people'; top = true; break;
    case 'policy': {
      const k = el.dataset.k;
      if (k === 'ration') s.policy.ration = v as GameState['policy']['ration'];
      if (k === 'heat') s.policy.heat = v as GameState['policy']['heat'];
      break;
    }
    case 'build': startProject(s, id); break;
    case 'cancel': cancelProject(s); break;
    case 'report': ui.reportOpen = !ui.reportOpen; break;
    case 'reset': ui.confirmReset = true; break;
    case 'reset-no': ui.confirmReset = false; break;
    case 'reset-yes':
      s = newGame();
      ui.heartSeen = 0;
      write(HEART_KEY, '0');
      Object.assign(ui, { tab: 'people', sheet: null, outcome: null, confirmReset: false });
      top = true;
      break;
  }
  ui.hasSave = s.phase !== 'ending';
  save();
  render({ top });
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const input = f.querySelector('input');
  const text = input?.value.trim().slice(0, 120);
  if (f.dataset.id && text) void talk(f.dataset.id, null, text);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.sheet && !ui.outcome && !s?.pending.length) {
    ui.sheet = null;
    render();
  }
});

// ───────────── 夜谈 ─────────────

const OFF_CODES = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

async function talk(id: string, topic: Topic | null, text?: string) {
  if (!s || !canTalk(s, id) || ui.thinking) return;
  const game = s;
  const said = text ?? TOPICS.find((t) => t.id === topic)!.ask;
  const log = (game.chat[id] ??= []);
  const history = log.slice();
  log.push({ from: 'me', text: said });
  let result: TalkResult | null = null;

  if (sample && !aiOff) {
    ui.thinking = id;
    ui.aiNote = null;
    render({ chatBottom: true });
    try {
      const raw = await sample.json(buildPrompt(game, id, history, said), { modelTier: 'quick', cache: false });
      result = parseAI(raw);
      if (!result) ui.aiNote = '没听清。换个说法试试？';
    } catch (err: any) {
      const code = err?.code;
      if (OFF_CODES.includes(code)) {
        aiOff = true;
        ui.ai = false;
        ui.aiNote = 'AI 对话没有开启，改用预设台词。';
      } else if (code === 'rate_limited') ui.aiNote = '说得太快了，歇一会儿再聊。';
      else if (code === 'refused') ui.aiNote = '这句话对方不想接。换个话题吧。';
      else ui.aiNote = '风太大，没听清。再说一次？';
    }
    ui.thinking = null;
    if (s !== game) return;
  }

  if (!result) {
    if (!topic) {
      log.pop();
      render({ chatBottom: true });
      return;
    }
    const rng = makeRng(game.rng);
    result = scriptedReply(game, id, topic, rng);
    game.rng = rng.state();
  }
  applyTalk(game, id, result, { topic, said });
  log.push({ from: 'them', text: result.reply });
  save();
  render({ chatBottom: true });
}

// ───────────── 启动 ─────────────

function start(data: { save?: string; screen?: UI['screen'] } = {}) {
  let restored: GameState | null = null;
  if (data.save) {
    try { restored = JSON.parse(data.save); } catch { restored = null; }
  }
  s = restored ?? load();
  ui.hasSave = !!s && s.phase !== 'ending';
  if (restored && data.screen) ui.screen = data.screen;
  render();
  try {
    window.claude?.use?.('sample')?.then((fn: unknown) => {
      if (fn) {
        sample = fn;
        ui.ai = true;
        render();
      }
    }, () => {});
  } catch { /* 不在 claude.ai 里打开时没有 AI，游戏照常 */ }
}

try {
  window.claude?.hot?.snapshot?.(() => ({ save: s ? JSON.stringify(s) : undefined, screen: ui.screen }));
} catch { /* ignore */ }
const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
