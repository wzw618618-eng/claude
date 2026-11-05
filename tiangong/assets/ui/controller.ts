// 界面控制器（浏览器主线程 / Host 侧）：
// - 把界面画进引擎给的 uiRoot；
// - 把玩家操作发给游戏世界，收到状态后重画；
// - 托管 AI 提供方：密钥只在这一侧，经引擎的 Intelligence 端口桥接给游戏世界。

import { bindIntelligencePort, createIntelligenceRuntime, type IntelligencePortBinding } from '@forgeax/engine/intelligence';
import type { Topic } from '../hanyi/ai/dialogue.ts';
import type { GameState, TaskId } from '../hanyi/core/types.ts';
import { type Act, CHANNEL, type ToEngine, type ToHost } from '../camp/protocol.ts';
import { createChatApiProvider, createClaudeProvider, createOfflineProvider, TALK_LIMITS } from '../souls/providers.ts';
import artCss from './art.css?raw';
import css from './style.css?raw';
import { createSound, CUE_FOR_ACT } from './audio.ts';
import { createFx } from './fx.ts';
import { endingScreen, type EngineView, gameScreen, hasOverlay, TIPS, titleScreen, type UI } from './view.ts';

const SAVE_KEY = 'hanyi.engine.save.v1';
const AI_KEY = 'hanyi.engine.ai.v1';
const TIPS_KEY = 'hanyi.tips.v1';
const SOUND_KEY = 'hanyi.sound.v1';
const FONTS = 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600&display=swap';

type Kind = EngineView['settings']['kind'];
interface AiConfig { kind: Kind; baseUrl: string; model: string; apiKey: string }

export interface HanyiHost {
  readonly uiRoot: HTMLElement;
  readonly port: MessagePort;
}

export function mountHanyi(host: HanyiHost) {
  const doc = host.uiRoot.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis & { claude?: any }) | null;
  const store = (() => { try { return win?.localStorage ?? null; } catch { return null; } })();
  const read = (k: string) => { try { return store?.getItem(k) ?? null; } catch { return null; } };
  const write = (k: string, v: string) => { try { store?.setItem(k, v); } catch { /* 存不了不影响游玩 */ } };

  const shell = doc.createElement('div');
  shell.className = 'hanyi hanyi-scroll';
  shell.setAttribute('data-hanyi', '');
  const fonts = doc.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = FONTS;
  const style = doc.createElement('style');
  style.textContent = artCss + css;
  const app = doc.createElement('div');
  const layer = doc.createElement('div');
  layer.className = 'hanyi-fx';
  layer.setAttribute('aria-hidden', 'true');
  shell.append(fonts, style, app, layer);
  host.uiRoot.append(shell);
  const sound = createSound(win, { muted: read(SOUND_KEY) === 'off' });
  const fx = createFx(app, layer, win, sound);

  let s: GameState | null = null;
  let cfg: AiConfig = loadConfig();
  let sample: unknown = null;
  let binding: IntelligencePortBinding | null = null;
  const ui: UI = {
    screen: 'title', tab: 'people', sheet: null, outcome: null, confirmReset: false,
    thinking: null, aiNote: null, reportOpen: false, ai: cfg.kind !== 'offline', hasSave: !!read(SAVE_KEY),
    tips: (() => { try { return JSON.parse(read(TIPS_KEY) ?? '[]') as string[]; } catch { return []; } })(),
    sound: read(SOUND_KEY) !== 'off',
    engine: {
      souls: [], provider: '连接中', sessions: {}, stream: null,
      settings: { kind: cfg.kind, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey, claude: false, editing: false },
    },
  };
  const saveTips = () => write(TIPS_KEY, JSON.stringify(ui.tips));
  const send = (m: ToEngine, transfer?: Transferable[]) => host.port.postMessage(m, transfer ?? []);
  const actOn = (a: Act) => send({ channel: CHANNEL, kind: 'act', act: a });

  // ───────────── 渲染 ─────────────

  let lastKey = '';
  const render = (opts: { top?: boolean; chatBottom?: boolean } = {}) => {
    const y = opts.top ? 0 : shell.scrollTop;
    const prev = app.querySelector('.sheet');
    const sheetY = prev?.scrollTop ?? 0;
    if (ui.screen === 'title' || !s) app.innerHTML = titleScreen(ui);
    else if (s.phase === 'ending') app.innerHTML = endingScreen(s);
    else app.innerHTML = gameScreen(s, ui);
    shell.dataset.phase = ui.screen === 'title' || !s ? 'title' : s.phase;
    const overlay = !!s && ui.screen === 'game' && s.phase !== 'ending' && hasOverlay(s, ui);
    shell.classList.toggle('lock', overlay);
    shell.scrollTop = y;
    const sheet = app.querySelector('.sheet');
    const key = ui.outcome ? 'outcome' : s?.pending[0] ? `ev:${s.pending[0].id}:${s.pending.length}` : ui.sheet ? `${ui.sheet.kind}:${ui.sheet.id}` : '';
    if (sheet) {
      if (opts.chatBottom) sheet.scrollTop = sheet.scrollHeight;
      else if (key === lastKey) sheet.scrollTop = sheetY;
    }
    if (key && key === lastKey) app.querySelectorAll('.scrim, .sheet').forEach((el) => el.classList.add('still'));
    lastKey = key;
    fx.after(s, ui);
  };

  // ───────────── 来自游戏世界 ─────────────

  const receive = (event: MessageEvent) => {
    const m = event.data as ToHost;
    if (!m || m.channel !== CHANNEL) return;
    const e = ui.engine!;
    if (m.kind === 'stream') {
      e.stream = { id: m.id, text: m.text };
      render({ chatBottom: true });
      return;
    }
    const wasThinking = ui.thinking;
    s = m.state;
    e.souls = m.souls;
    e.provider = m.talk.provider;
    e.sessions = m.talk.sessions;
    ui.thinking = m.talk.thinking;
    ui.aiNote = m.talk.note;
    if (!ui.thinking) e.stream = null;
    if (m.outcome) ui.outcome = m.outcome;
    ui.hasSave = s.phase !== 'ending';
    write(SAVE_KEY, JSON.stringify(s));
    render({ chatBottom: !!wasThinking || ui.sheet?.kind === 'chat' });
  };
  host.port.addEventListener('message', receive);
  host.port.start();

  // ───────────── 玩家操作 ─────────────

  const onClick = (event: Event) => {
    const t = event.target as HTMLElement;
    const el = t.closest<HTMLElement>('[data-act]');
    if (!el || !app.contains(el)) return;
    const stop = t.closest('[data-stop]');
    if (stop && !stop.contains(el)) return;
    sound.unlock();
    if ((el as HTMLButtonElement).disabled) { sound.play('deny'); return; }
    const a = el.dataset.act!;
    const id = el.dataset.id ?? '';
    const v = el.dataset.v ?? '';
    let top = false;
    if (CUE_FOR_ACT[a]) sound.play(CUE_FOR_ACT[a]);
    switch (a) {
      case 'sound':
        sound.setMuted(!sound.muted);
        ui.sound = !sound.muted;
        write(SOUND_KEY, ui.sound ? 'on' : 'off');
        if (ui.sound) sound.play('tap');
        break;
      case 'info': ui.sheet = { kind: 'info', id: v }; break;
      case 'end-check': ui.sheet = { kind: 'end', id: '' }; break;
      case 'tip': if (!ui.tips!.includes(v)) ui.tips!.push(v); saveTips(); break;
      case 'tip-skip': ui.tips = [...new Set([...ui.tips!, ...TIPS.map((t) => t.id).filter((t) => ['people', 'assign', 'res', 'end'].includes(t))])]; saveTips(); break;
      case 'tip-reset': ui.tips = []; saveTips(); ui.tab = 'people'; top = true; break;
      case 'new':
      case 'reset-yes':
        actOn({ type: 'new' });
        Object.assign(ui, { screen: 'game', tab: 'people', sheet: null, outcome: null, confirmReset: false, reportOpen: false });
        top = true;
        break;
      case 'continue': ui.screen = 'game'; top = true; break;
      case 'tab':
        ui.tab = v as UI['tab']; ui.confirmReset = false; top = true;
        if (v === 'build' && !ui.tips!.includes('build')) { ui.tips!.push('build'); saveTips(); }
        break;
      case 'pick': ui.sheet = { kind: 'task', id }; break;
      case 'set': actOn({ type: 'setTask', id, task: v as TaskId }); ui.sheet = null; break;
      case 'person': ui.sheet = { kind: 'person', id }; break;
      case 'chat': ui.sheet = { kind: 'chat', id }; send({ channel: CHANNEL, kind: 'focus', id }); break;
      case 'close':
        if (ui.sheet?.kind === 'chat') send({ channel: CHANNEL, kind: 'focus', id: null });
        ui.sheet = null;
        break;
      case 'topic': send({ channel: CHANNEL, kind: 'talk', id, topic: v as Topic }); return;
      case 'choose': actOn({ type: 'choose', i: Number(el.dataset.i) }); return;
      case 'ok': ui.outcome = null; break;
      case 'end-day': actOn({ type: 'endDay' }); ui.sheet = null; ui.reportOpen = false; ui.tab = 'people'; top = true; break;
      case 'night': actOn({ type: 'toNight' }); ui.tab = 'people'; top = true; break;
      case 'sleep': actOn({ type: 'endNight' }); ui.sheet = null; ui.reportOpen = false; ui.tab = 'people'; top = true; break;
      case 'policy': actOn({ type: 'policy', k: el.dataset.k as 'ration' | 'heat', v }); return;
      case 'adopt': actOn({ type: 'adopt', id }); return;
      case 'adopt-all': actOn({ type: 'adopt' }); return;
      case 'build': actOn({ type: 'build', id }); return;
      case 'cancel': actOn({ type: 'cancel' }); return;
      case 'report': ui.reportOpen = !ui.reportOpen; break;
      case 'reset': ui.confirmReset = true; break;
      case 'reset-no': ui.confirmReset = false; break;
      case 'ai-kind': {
        const kind = v as Kind;
        cfg = { ...cfg, kind };
        ui.engine!.settings.kind = kind;
        ui.engine!.settings.editing = (kind === 'deepseek' || kind === 'custom') && !cfg.apiKey;
        if (!ui.engine!.settings.editing) { saveConfig(); void connectAI(); }
        break;
      }
      case 'ai-edit': ui.engine!.settings.editing = true; break;
    }
    render({ top });
  };

  const onSubmit = (event: Event) => {
    const f = event.target as HTMLFormElement;
    if (!app.contains(f)) return;
    event.preventDefault();
    if (f.hasAttribute('data-ai-form')) {
      const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? '';
      cfg = {
        ...cfg,
        baseUrl: cfg.kind === 'custom' ? val('base') : cfg.baseUrl,
        model: val('model') || (cfg.kind === 'deepseek' ? 'deepseek-chat' : cfg.model),
        apiKey: val('key') || cfg.apiKey,
      };
      ui.engine!.settings.editing = false;
      saveConfig();
      void connectAI();
      render();
      return;
    }
    const text = (f.querySelector('input') as HTMLInputElement | null)?.value.trim().slice(0, 120);
    if (f.dataset.id && text) send({ channel: CHANNEL, kind: 'talk', id: f.dataset.id, text });
  };
  app.addEventListener('click', onClick);
  app.addEventListener('submit', onSubmit);

  // ───────────── AI 提供方 ─────────────

  function loadConfig(): AiConfig {
    try {
      const c = JSON.parse(read(AI_KEY) ?? 'null');
      if (c && ['offline', 'deepseek', 'custom', 'claude'].includes(c.kind)) return { kind: c.kind, baseUrl: c.baseUrl ?? '', model: c.model ?? '', apiKey: c.apiKey ?? '' };
    } catch { /* 用默认 */ }
    return { kind: 'offline', baseUrl: '', model: '', apiKey: '' };
  }
  function saveConfig() {
    write(AI_KEY, JSON.stringify(cfg));
    ui.engine!.settings = { ...ui.engine!.settings, kind: cfg.kind, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey };
  }

  async function connectAI() {
    let provider;
    let label: string;
    if ((cfg.kind === 'deepseek' || cfg.kind === 'custom') && cfg.apiKey && (cfg.kind === 'deepseek' || cfg.baseUrl)) {
      const model = cfg.model || 'deepseek-chat';
      provider = createChatApiProvider({
        id: cfg.kind === 'deepseek' ? 'deepseek' : 'chat-api',
        baseUrl: cfg.kind === 'deepseek' ? 'https://api.deepseek.com' : cfg.baseUrl,
        apiKey: cfg.apiKey,
        model,
      });
      label = cfg.kind === 'deepseek' ? `DeepSeek（${model}）` : `${model || '自定义接口'}`;
    } else if (cfg.kind === 'claude' && sample) {
      provider = createClaudeProvider(sample);
      label = 'Claude';
    } else {
      provider = createOfflineProvider();
      label = '离线台词';
    }
    ui.ai = label !== '离线台词';
    const runtime = createIntelligenceRuntime(provider, { limits: TALK_LIMITS });
    const channel = new MessageChannel();
    const prev = binding;
    binding = bindIntelligencePort(channel.port1, runtime);
    channel.port1.start();
    send({ channel: CHANNEL, kind: 'intelligence', providerId: runtime.providerId, label }, [channel.port2]);
    if (prev) await prev.close().catch(() => undefined);
  }

  // ───────────── 启动 ─────────────

  send({ channel: CHANNEL, kind: 'hello', save: read(SAVE_KEY) ?? undefined });
  void connectAI();
  render();
  try {
    win?.claude?.use?.('sample')?.then((fn: unknown) => {
      if (!fn) return;
      sample = fn;
      ui.engine!.settings.claude = true;
      if (cfg.kind === 'claude') void connectAI();
      render();
    }, () => undefined);
  } catch { /* 不在 claude.ai 里时没有 Claude */ }

  return {
    dispose() {
      host.port.removeEventListener('message', receive);
      app.removeEventListener('click', onClick);
      app.removeEventListener('submit', onSubmit);
      void binding?.close();
      fx.dispose();
      sound.dispose();
      shell.remove();
    },
  };
}
