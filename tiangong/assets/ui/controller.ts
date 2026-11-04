// 界面控制器（浏览器主线程 / Host 侧）：
// - 把界面画进引擎给的 uiRoot；
// - 把玩家操作发给游戏世界，收到状态后重画；
// - 托管 AI 提供方：密钥只在这一侧，经引擎的 Intelligence 端口桥接给游戏世界。

import { bindIntelligencePort, createIntelligenceRuntime, type IntelligencePortBinding } from '@forgeax/engine/intelligence';
import type { Topic } from '../hanyi/ai/dialogue.ts';
import type { GameState, TaskId } from '../hanyi/core/types.ts';
import { type Act, CHANNEL, type ToEngine, type ToHost } from '../camp/protocol.ts';
import { createChatApiProvider, createClaudeProvider, createOfflineProvider, TALK_LIMITS } from '../souls/providers.ts';
import css from './style.css?raw';
import { endingScreen, type EngineView, gameScreen, hasOverlay, titleScreen, type UI } from './view.ts';

const SAVE_KEY = 'hanyi.engine.save.v1';
const AI_KEY = 'hanyi.engine.ai.v1';
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
  style.textContent = css;
  const app = doc.createElement('div');
  shell.append(fonts, style, app);
  host.uiRoot.append(shell);

  let s: GameState | null = null;
  let cfg: AiConfig = loadConfig();
  let sample: unknown = null;
  let binding: IntelligencePortBinding | null = null;
  const ui: UI = {
    screen: 'title', tab: 'people', sheet: null, outcome: null, confirmReset: false,
    thinking: null, aiNote: null, reportOpen: false, ai: cfg.kind !== 'offline', hasSave: !!read(SAVE_KEY),
    engine: {
      souls: [], provider: '连接中', sessions: {}, stream: null,
      settings: { kind: cfg.kind, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey, claude: false, editing: false },
    },
  };
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
    if (ui.screen === 'title' || s?.phase === 'ending') snow(app, win);
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
    if ((el as HTMLButtonElement).disabled) return;
    const a = el.dataset.act!;
    const id = el.dataset.id ?? '';
    const v = el.dataset.v ?? '';
    let top = false;
    switch (a) {
      case 'new':
      case 'reset-yes':
        actOn({ type: 'new' });
        Object.assign(ui, { screen: 'game', tab: 'people', sheet: null, outcome: null, confirmReset: false, reportOpen: false });
        top = true;
        break;
      case 'continue': ui.screen = 'game'; top = true; break;
      case 'tab': ui.tab = v as UI['tab']; ui.confirmReset = false; top = true; break;
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
      case 'end-day': actOn({ type: 'endDay' }); ui.reportOpen = false; ui.tab = 'people'; top = true; break;
      case 'night': actOn({ type: 'toNight' }); ui.tab = 'people'; top = true; break;
      case 'sleep': actOn({ type: 'endNight' }); ui.sheet = null; ui.reportOpen = false; ui.tab = 'people'; top = true; break;
      case 'policy': actOn({ type: 'policy', k: el.dataset.k as 'ration' | 'heat', v }); return;
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
      shell.remove();
    },
  };
}

// ───────────── 雪 ─────────────

function snow(app: HTMLElement, win: Window | null) {
  const cv = app.querySelector<HTMLCanvasElement>('#snow');
  if (!cv || !win) return;
  const g = cv.getContext('2d');
  if (!g) return;
  const dpr = Math.min(2, win.devicePixelRatio || 1);
  const flakes = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.0006 + Math.random() * 0.0016, w: Math.random() * 6.28 }));
  const still = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const draw = () => {
    if (!cv.isConnected) return;
    if (cv.width !== cv.clientWidth * dpr) { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; }
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(231, 235, 238, 0.55)';
    for (const f of flakes) {
      if (!still) { f.y += f.v; f.w += 0.01; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); } }
      g.beginPath();
      g.arc((f.x + Math.sin(f.w) * 0.01) * cv.width, f.y * cv.height, f.r * dpr, 0, Math.PI * 2);
      g.fill();
    }
    if (!still) win.requestAnimationFrame(draw);
  };
  draw();
}
