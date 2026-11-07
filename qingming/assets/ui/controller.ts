// 界面控制器（浏览器主线程 / Host 侧）：
// - 把正式界面画进引擎给的 uiRoot（view.ts 出 HTML，这里只管挂上去、保住滚动和输入框）；
// - 把点击、表单翻译成发给游戏世界的消息，收到世界的状态就重画；存档跟着状态走；
// - 托管 AI 提供方：密钥只在这一侧，经引擎的 Intelligence 端口桥接给游戏世界，顺带记账。

import type { PlaceId, World } from '../game/core/types.ts';
import type { RootId } from '../game/core/world.ts';
import { isMode, type Mode } from '../game/mind/bond.ts';
import type { MainAct, SocialKind } from '../game/player.ts';
import { type AiConfig, loadConfig, providerFor, saveConfig } from '../souls/config.ts';
import { type HostLink, linkProvider } from '../souls/host.ts';
import { createMeter, totalsText } from '../souls/meter.ts';
import type { SoulView } from '../souls/soul-client.ts';
import { type Act, type AiView, CHANNEL, type ToEngine, type ToHost } from '../world/protocol.ts';
import baseCss from './style.css?raw';
import illustrationCss from './illustrations.css?raw';
const css = baseCss + '\n' + illustrationCss;
import { type AiKind, type Model, newUI, screen, type Sheet, type Tab, type UI } from './view.ts';

const SAVE_KEY = 'qingming.save.v1';
const FONTS = 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600&display=swap';

export interface QingmingHost {
  readonly uiRoot: HTMLElement;
  readonly port: MessagePort;
}

/** 存档能不能接着玩 */
function playable(save: string | null): World | null {
  try {
    const w = save ? JSON.parse(save) as World : null;
    return w && w.v === 1 && w.me && w.people && w.phase === 'year' ? w : null;
  } catch {
    return null;
  }
}

export function mountQingming(host: QingmingHost) {
  const doc = host.uiRoot.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis & { claude?: any }) | null;
  const store = (() => { try { return win?.localStorage ?? null; } catch { return null; } })();
  const read = (k: string) => { try { return store?.getItem(k) ?? null; } catch { return null; } };
  const write = (k: string, v: string) => { try { store?.setItem(k, v); } catch { /* 存不下不影响玩 */ } };

  const shell = doc.createElement('div');
  shell.className = 'qm';
  const fonts = doc.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = FONTS;
  const style = doc.createElement('style');
  style.textContent = css;
  const app = doc.createElement('div');
  app.className = 'qm-app';
  shell.append(fonts, style, app);
  host.uiRoot.append(shell);

  let w: World | null = null;
  let ai: AiView | null = null;
  let souls: SoulView[] = [];
  let cfg: AiConfig = loadConfig(store);
  const meter = createMeter(store);
  let sample: unknown = null;
  let link: HostLink | null = null;
  /** 刚说完一句：等能再说时把光标放回输入框 */
  let refocus = false;
  const ui: UI = newUI();
  ui.hasSave = !!playable(read(SAVE_KEY));
  const syncSettings = () => {
    ui.settings = { kind: cfg.kind, hasKey: !!cfg.apiKey, model: cfg.model, mode: cfg.mode, claude: !!sample };
  };
  const syncSpend = () => {
    ui.spend = {
      game: totalsText(meter.game),
      all: totalsText(meter.all),
      top: meter.bySoul().slice(0, 4).map(([id, t]) => `${w?.people[id.replace(/^qingming\./, '')]?.name ?? id} ${t.calls} 次`),
    };
  };
  syncSettings();
  syncSpend();

  const send = (m: ToEngine, transfer: Transferable[] = []) => host.port.postMessage(m, transfer);
  const act = (a: Act) => send({ channel: CHANNEL, kind: 'act', act: a });
  const focus = (id: string | null) => send({ channel: CHANNEL, kind: 'focus', id });

  // ───────────── 画 ─────────────

  const sheetKey = (s: Sheet | null) => (s ? `${s.kind}:${'id' in s ? s.id : ''}` : '');
  let lastSheet = '';
  let lastLog = 0;

  const render = (opts: { top?: boolean } = {}) => {
    const y = opts.top ? 0 : shell.scrollTop;
    const oldSheet = app.querySelector<HTMLElement>('.sheet');
    const sheetY = oldSheet?.scrollTop ?? 0;
    const oldLog = app.querySelector<HTMLElement>('.log');
    const logAtBottom = !oldLog || oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 40;
    const input = app.querySelector<HTMLInputElement>('form[data-form="talk"] input[name="text"]');
    const typed = input?.value ?? '';
    const hadFocus = !!input && doc.activeElement === input;

    const model: Model = { w, ai, souls, ui };
    app.innerHTML = screen(model);

    const overlay = !!app.querySelector('.scrim');
    shell.classList.toggle('lock', overlay);
    shell.scrollTop = y;
    const key = sheetKey(ui.sheet);
    const sheet = app.querySelector<HTMLElement>('.sheet');
    if (sheet && key === lastSheet) {
      sheet.scrollTop = sheetY;
      app.querySelectorAll('.scrim, .sheet').forEach((el) => el.classList.add('still'));
    }
    const log = app.querySelector<HTMLElement>('.log');
    if (log) {
      const n = log.childElementCount;
      if (logAtBottom || n !== lastLog || key !== lastSheet) log.scrollTop = log.scrollHeight;
      else if (oldLog) log.scrollTop = oldLog.scrollTop;
      lastLog = n;
    }
    const box = app.querySelector<HTMLInputElement>('form[data-form="talk"] input[name="text"]');
    if (box && key === lastSheet) {
      if (typed && !box.disabled) box.value = typed;
      if ((hadFocus || refocus) && !box.disabled) { box.focus(); refocus = false; }
    }
    lastSheet = key;
  };

  // ───────────── 来自游戏世界 ─────────────

  const receive = (event: MessageEvent) => {
    const m = event.data as ToHost;
    if (!m || m.channel !== CHANNEL) return;
    if (m.kind === 'stream') {
      ui.stream = { id: m.id, text: m.text };
      render();
      return;
    }
    const prev = w;
    let top = false;
    w = m.world;
    ai = m.ai;
    souls = m.souls;
    if (!ai.thinking) ui.stream = null;
    if (prev && prev.seed !== w.seed) meter.resetGame();
    // 这一句的结果已经写进谈话记录了，对话开着就不再弹纸条
    if (m.outcome && ui.sheet?.kind !== 'chat') ui.outcome = m.outcome;
    // 过了年（或者闭关了几年）：翻一页，看看这些年发生了什么
    if (prev && prev.seed === w.seed && w.year > prev.year && ui.screen === 'game' && w.phase === 'year') {
      ui.sheet = { kind: 'year', from: prev.year, to: w.year - 1 };
      ui.tab = 'here';
      ui.confirmEnd = false;
      top = true;
    }
    if (ui.screen === 'game') {
      write(SAVE_KEY, JSON.stringify(w));
      ui.hasSave = w.phase === 'year';
    }
    syncSpend();
    render({ top });
  };
  host.port.addEventListener('message', receive);
  host.port.start();

  // ───────────── AI ─────────────

  const connect = async () => {
    const old = link;
    const { provider, label } = providerFor(cfg, { meter, sample });
    link = linkProvider(provider);
    send({ channel: CHANNEL, kind: 'intelligence', providerId: link.providerId, label, mode: cfg.mode }, [link.port]);
    if (old) await old.close();
  };
  const offMeter = meter.onChange(() => {
    syncSpend();
    if (ui.sheet?.kind === 'settings') render();
  });

  // ───────────── 玩家操作 ─────────────

  const needsConfirm = () => !!w && (!w.turn.main || (w.turn.social > 0 && Object.values(w.people).some((n) => n.alive && n.place === w!.me.place)));

  const onClick = (event: Event) => {
    const t = event.target as Element;
    const el = t.closest<HTMLElement | SVGElement>('[data-act]');
    if (!el || !app.contains(el)) return;
    // 点在抽屉里空白处，不算点了外面的遮罩
    const stop = t.closest('[data-stop]');
    if (stop && !stop.contains(el)) return;
    if ((el as HTMLButtonElement).disabled) return;
    const a = el.dataset.act!;
    const id = el.dataset.id ?? '';
    const v = el.dataset.v ?? '';
    const arg = el.dataset.arg ?? '';
    let top = false;
    switch (a) {
      case 'continue': ui.screen = 'game'; ui.tab = 'here'; ui.sheet = null; top = true; break;
      case 'go-title': ui.screen = 'title'; ui.sheet = null; ui.outcome = null; focus(null); top = true; break;
      case 'tab': ui.tab = v as Tab; ui.sheet = null; ui.confirmEnd = false; top = true; break;
      case 'sheet':
        ui.sheet = v === 'settings' ? { kind: 'settings' } : v === 'retreat' ? { kind: 'retreat' } : v === 'new' ? { kind: 'new' }
          : v === 'gift' ? { kind: 'gift', id } : v === 'tell' ? { kind: 'tell', id } : null;
        break;
      case 'close':
        if (ui.sheet?.kind === 'chat' || ui.sheet?.kind === 'person') focus(null);
        ui.sheet = null;
        break;
      case 'ok': ui.outcome = null; break;
      case 'person': ui.sheet = { kind: 'person', id }; focus(id); break;
      case 'chat': ui.sheet = { kind: 'chat', id }; focus(id); refocus = true; break;
      case 'place': ui.sheet = { kind: 'place', id: v as PlaceId }; break;
      case 'move': act({ type: 'move', place: v as PlaceId }); ui.sheet = null; ui.tab = 'here'; top = true; break;
      case 'main': act({ type: 'main', act: v as MainAct }); return;
      case 'buy': act({ type: 'buy', item: v }); return;
      case 'use': act({ type: 'use', item: v }); return;
      case 'choose': act({ type: 'choose', i: Number(el.dataset.i) }); return;
      case 'offer': act({ type: 'offer', accept: v === 'yes' }); return;
      case 'social':
        // 选项对话的回话也写进谈话记录，直接打开对话看他怎么说
        send({ channel: CHANNEL, kind: 'social', id, topic: v as SocialKind, arg });
        ui.sheet = { kind: 'chat', id };
        focus(id);
        break;
      case 'end':
        if (needsConfirm() && !ui.confirmEnd) ui.confirmEnd = true;
        else { act({ type: 'endTurn' }); ui.confirmEnd = false; }
        break;
      case 'end-yes': act({ type: 'endTurn' }); ui.confirmEnd = false; break;
      case 'end-no': ui.confirmEnd = false; break;
      case 'retreat': act({ type: 'retreat', years: Number(v) || 1 }); ui.sheet = null; return;
      case 'news': ui.newsFilter = v as UI['newsFilter']; break;
      case 'ai-kind': {
        cfg = { ...cfg, kind: v as AiKind };
        saveConfig(store, cfg);
        syncSettings();
        // DeepSeek 还没填密钥就先把表单露出来，填了再连
        if (v !== 'deepseek' || cfg.apiKey) void connect();
        break;
      }
      case 'mode':
        if (isMode(v)) {
          cfg = { ...cfg, mode: v as Mode };
          saveConfig(store, cfg);
          syncSettings();
          send({ channel: CHANNEL, kind: 'budget', mode: cfg.mode });
        }
        break;
      default: return;
    }
    render({ top });
  };

  const onSubmit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    const kind = form.dataset.form;
    if (!kind) return;
    event.preventDefault();
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value?.trim() ?? '';
    if (kind === 'new') {
      const root = (form.querySelector<HTMLInputElement>('input[name="root"]:checked')?.value ?? ui.setup.root) as RootId;
      const gender = (form.querySelector<HTMLInputElement>('input[name="gender"]:checked')?.value ?? ui.setup.gender) as 'm' | 'f';
      ui.setup = { name: field('name'), gender, root };
      act({ type: 'new', name: ui.setup.name || undefined, gender, root });
      meter.resetGame();
      Object.assign(ui, { screen: 'game', tab: 'here', sheet: null, outcome: null, confirmEnd: false, newsFilter: 'all' } satisfies Partial<UI>);
      render({ top: true });
      return;
    }
    if (kind === 'talk') {
      const text = field('text');
      const id = form.dataset.id ?? '';
      if (!text || !id) return;
      send({ channel: CHANNEL, kind: 'talk', id, text });
      (form.elements.namedItem('text') as HTMLInputElement).value = '';
      refocus = true;
      return;
    }
    if (kind === 'ai') {
      const key = field('key');
      const model = field('model');
      cfg = { ...cfg, kind: 'deepseek', apiKey: key || cfg.apiKey, model: model || cfg.model };
      saveConfig(store, cfg);
      syncSettings();
      void connect();
      ui.outcome = cfg.apiKey ? '已保存。角色接下来由 DeepSeek 来演。' : '还没填密钥，先用离线的台词。';
      render();
    }
  };

  /** 开局表单：单选一改就重画（好显示选中），名字只记下不重画 */
  const onChange = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (!t.closest('form[data-form="new"]')) return;
    if (t.name === 'root') ui.setup.root = t.value as RootId;
    else if (t.name === 'gender') ui.setup.gender = t.value as 'm' | 'f';
    else return;
    render();
  };
  const onInput = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (t.name === 'name' && t.closest('form[data-form="new"]')) ui.setup.name = t.value;
  };
  /** 舆图上的地方不是按钮：回车、空格也能点 */
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = (event.target as Element).closest?.('svg [data-act]');
    if (!el) return;
    event.preventDefault();
    onClick({ target: el } as unknown as Event);
  };

  app.addEventListener('click', onClick);
  app.addEventListener('submit', onSubmit);
  app.addEventListener('change', onChange);
  app.addEventListener('input', onInput);
  app.addEventListener('keydown', onKey);

  // ───────────── 开始 ─────────────

  render();
  void connect();
  const saved = read(SAVE_KEY);
  send({ channel: CHANNEL, kind: 'hello', ...(playable(saved) ? { save: saved! } : {}) });

  // 在 claude.ai 里打开时，可以让 Claude 来演
  try {
    win?.claude?.use?.('sample')?.then((fn: unknown) => {
      sample = fn;
      syncSettings();
      if (cfg.kind === 'claude') void connect();
      render();
    }, () => undefined);
  } catch { /* 不在 claude.ai 里 */ }

  return {
    dispose() {
      host.port.removeEventListener('message', receive);
      app.removeEventListener('click', onClick);
      app.removeEventListener('submit', onSubmit);
      app.removeEventListener('change', onChange);
      app.removeEventListener('input', onInput);
      app.removeEventListener('keydown', onKey);
      offMeter();
      void link?.close();
      shell.remove();
    },
  };
}
