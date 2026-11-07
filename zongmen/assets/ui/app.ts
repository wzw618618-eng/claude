// 界面控制器：画面切换、输入、存档、给引擎下舞台指令，以及让地点标签和情绪图标贴住 3D 画面。

import { GAME_DATA } from '../game/data/bundle.gen';
import type { DiscipleId, Emotion, GameData, LocationId } from '../game/data/types';
import { GameSession, type SessionState } from '../game/game/state';
import { askAboutQuestion, quickQuestions } from '../game/game/quick';
import { closeupShot, fitOverviewShot, fitPlazaShot, stepShot, LOCATION_LABEL_HEIGHT, LOCATION_POS, locationShot, PLAZA_SLOTS, projectToScreen, SHOTS, type CameraShot, type Vec3 } from '../scene/layout';
import { characterHeight, lookOf } from '../scene/models';
import { STAGE_CHANNEL } from '../scene/refs';
import type { Pose, StageCommand } from '../scene/stage-protocol';
import { pickClient, type ProviderSetting } from './ai';
import { portraitUrl } from './portrait';
import { CSS } from './style';
import { render, type TextSpeed, type UiState } from './view';

const SAVE_KEY = 'zongmen.save.v1';
const SETTINGS_KEY = 'zongmen.settings.v1';
const SPEED_MS: Record<TextSpeed, number> = { slow: 70, normal: 38, fast: 16, instant: 0 };
const INTRO_SHOTS: CameraShot[] = [SHOTS.libraryIntro, SHOTS.overview, SHOTS.plaza, SHOTS.plaza];

const POSE_FOR: Record<Emotion, Pose> = { calm: 'idle', relieved: 'idle', nervous: 'nervous', scared: 'nervous', angry: 'talk', sad: 'down' };

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function load<T>(key: string): T | undefined {
  try {
    const s = storage()?.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, value: unknown) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式等情况下存不了档，游戏照常进行
  }
}

export async function createGameUi(opts: { uiRoot: HTMLElement; port?: MessagePort; data?: GameData }) {
  const data = opts.data ?? GAME_DATA;
  const doc = opts.uiRoot.ownerDocument;
  const hostEl = doc.createElement('div');
  hostEl.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  opts.uiRoot.appendChild(hostEl);
  // 引擎宿主页自带的帧率角标压在顶栏上，玩家用不着；样式放在 uiRoot 里，随界面一起卸载
  const hostStyle = doc.createElement('style');
  hostStyle.textContent = '#forgeax-fps { display: none !important; }';
  hostEl.appendChild(hostStyle);
  const shadow = hostEl.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const mount = doc.createElement('div');
  shadow.append(style, mount);

  const settings = { textSpeed: 'normal' as TextSpeed, provider: 'auto' as ProviderSetting, ...load<UiState['settings']>(SETTINGS_KEY) };
  let picked = await pickClient(data, settings.provider);
  const ui: UiState = {
    screen: 'title',
    introStep: 0,
    newClues: [],
    clueMode: 'view',
    accuse: { evidence: [] },
    thinking: false,
    settings,
    aiLabel: picked.label,
    hasSave: !!load<SessionState>(SAVE_KEY)?.seed && load<SessionState>(SAVE_KEY)?.phase !== 'ending',
    showStats: data.config.dev.show_call_stats && picked.label.includes('代理'),
    epilogueLoading: false,
  };
  let game: GameSession | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let typingTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  // ---------- 舞台 ----------
  const port = opts.port;
  port?.start?.();
  const send = (cmd: StageCommand) => port?.postMessage({ channel: STAGE_CHANNEL, ...cmd });
  let targetShot: CameraShot = SHOTS.overview;
  let currentShot: CameraShot = SHOTS.overview;
  const shot = (s: CameraShot, instant = false) => {
    targetShot = s;
    hostEl.dataset.cameraSettled = instant ? '1' : '0';
    if (instant) currentShot = s;
    send({ kind: 'shot', shot: s, instant });
  };
  const plazaShot = () => {
    const r = hostEl.getBoundingClientRect();
    return fitPlazaShot(r.width || 1280, r.height || 720);
  };
  const mapShot = () => {
    const r = hostEl.getBoundingClientRect();
    return fitOverviewShot(r.width || 1280, r.height || 720);
  };
  const slotOf = (id: DiscipleId): Vec3 => PLAZA_SLOTS[game!.case.disciples.findIndex((d) => d.id === id)] ?? PLAZA_SLOTS[2];
  const heights = new Map(data.characters.map((c) => [c.id, characterHeight(lookOf(c)) * 0.1]));
  const syncPoses = () => {
    if (!game) return;
    for (const d of game.case.disciples) {
      const st = game.state.disciples[d.id];
      const pose: Pose = ui.thinking && ui.focus === d.id ? 'talk' : st.refused ? 'down' : POSE_FOR[st.emotion];
      send({ kind: 'pose', id: d.id, pose });
    }
  };

  // ---------- 渲染 ----------
  const portrait = (id: string) => portraitUrl(doc, id);
  const draw = () => {
    if (disposed) return;
    const logEl = mount.querySelector<HTMLElement>('[data-log]');
    const atBottom = !logEl || logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    mount.innerHTML = render({ ui, game, data, portrait });
    const newLog = mount.querySelector<HTMLElement>('[data-log]');
    if (newLog && atBottom) newLog.scrollTop = newLog.scrollHeight;
    positionFloats();
  };

  /** 最新一句话逐字显示；点一下直接显示完 */
  const typeLatest = () => {
    if (typingTimer) clearInterval(typingTimer);
    const el = mount.querySelector<HTMLElement>('[data-typing]');
    const ms = SPEED_MS[ui.settings.textSpeed];
    if (!el || ms === 0) return;
    const full = el.textContent ?? '';
    const chars = [...full];
    let n = 0;
    el.textContent = '';
    typingTimer = setInterval(() => {
      n++;
      el.textContent = chars.slice(0, n).join('');
      const log = mount.querySelector<HTMLElement>('[data-log]');
      if (log) log.scrollTop = log.scrollHeight;
      if (n >= chars.length && typingTimer) clearInterval(typingTimer);
    }, ms);
    el.dataset.full = full;
  };
  const finishTyping = (): boolean => {
    const el = mount.querySelector<HTMLElement>('[data-typing]');
    if (typingTimer && el?.dataset.full && el.textContent !== el.dataset.full) {
      clearInterval(typingTimer);
      el.textContent = el.dataset.full;
      return true;
    }
    return false;
  };

  const toast = (html: string) => {
    ui.toast = html;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast = undefined;
      mount.querySelector('.toast')?.remove();
    }, 6000);
  };

  let noticeSeen = 0;
  const flushNotices = () => {
    if (!game) return;
    const ns = game.state.notices.slice(noticeSeen);
    noticeSeen = game.state.notices.length;
    const last = ns.at(-1);
    if (last) toast(`${last.from === 'elder' ? '<b>严长老：</b>' : '<b>【提示】</b>'}${escapeHtml(last.text)}`);
  };

  const persist = () => {
    save(SETTINGS_KEY, ui.settings);
    if (game) save(SAVE_KEY, game.toJSON());
  };

  // ---------- 浮动标签贴住画面 ----------
  let raf = 0;
  let last = 0;
  let floatsDirty = true;
  const positionFloats = () => {
    const rect = hostEl.getBoundingClientRect();
    const w = rect.width || 1280;
    const h = rect.height || 720;
    for (const el of mount.querySelectorAll<HTMLElement>('[data-float-loc]')) {
      const loc = el.dataset.floatLoc as LocationId;
      const p = LOCATION_POS[loc];
      const s = projectToScreen([p[0], LOCATION_LABEL_HEIGHT[loc], p[2]], currentShot, w, h);
      el.style.display = s ? '' : 'none';
      if (s) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      el.style.left = '0';
      el.style.top = '0';
    }
    for (const el of mount.querySelectorAll<HTMLElement>('[data-float-char]')) {
      const id = el.dataset.floatChar!;
      const p = slotOf(id);
      const s = projectToScreen([p[0], (heights.get(id) ?? 1.7) + 0.35, p[2]], currentShot, w, h);
      el.style.display = s ? '' : 'none';
      if (s) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      el.style.left = '0';
      el.style.top = '0';
    }
  };
  const frame = (t: number) => {
    if (disposed) return;
    const dt = last ? Math.min(0.5, (t - last) / 1000) : 0;
    last = t;
    if (currentShot !== targetShot || floatsDirty) {
      currentShot = stepShot(currentShot, targetShot, dt);
      floatsDirty = false;
      positionFloats();
      // 自动化测试用：镜头到位后标签才稳定可点
      hostEl.dataset.cameraSettled = currentShot === targetShot ? '1' : '0';
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const onResize = () => {
    floatsDirty = true;
  };
  doc.defaultView?.addEventListener('resize', onResize);

  // ---------- 流程 ----------
  const startGame = (seed: number, restore?: SessionState) => {
    game = restore ? new GameSession(data, picked.client, { restore }) : new GameSession(data, picked.client, { seed });
    noticeSeen = game.state.notices.length;
    ui.accuse = { evidence: [] };
    ui.newClues = [];
    ui.modal = undefined;
    ui.focus = undefined;
    send({ kind: 'cast', ids: game.case.disciples.map((d) => d.id) });
    send({ kind: 'elder', visible: true });
    syncPoses();
    if (restore && game.state.phase !== 'title' && game.state.phase !== 'intro') {
      ui.screen = game.state.phase === 'ending' ? 'ending' : 'main';
      if (game.state.phase === 'accuse') ui.modal = 'accuse';
      shot(plazaShot(), true);
    } else {
      game.start();
      ui.screen = 'intro';
      ui.introStep = 0;
      shot(INTRO_SHOTS[0], true);
    }
    persist();
    draw();
    typeLatest();
  };

  const goMain = () => {
    ui.screen = 'main';
    ui.modal = undefined;
    ui.focus = undefined;
    shot(plazaShot());
    syncPoses();
    draw();
  };

  const afterTurn = (id: DiscipleId) => {
    ui.thinking = false;
    syncPoses();
    persist();
    if (game!.state.phase === 'accuse') {
      ui.modal = 'accuse';
      ui.accuse = { evidence: [] };
    }
    draw();
    typeLatest();
    flushNotices();
    if (ui.toast) draw();
    void id;
  };

  const ask = async (id: DiscipleId, text: string) => {
    if (!game || ui.thinking) return;
    ui.thinking = true;
    syncPoses();
    draw();
    const r = await game.ask(id, text);
    if (!r.ok) {
      ui.thinking = false;
      toast(escapeHtml(r.error));
      draw();
      return;
    }
    afterTurn(id);
  };

  const present = async (id: DiscipleId, factId: string) => {
    if (!game || ui.thinking) return;
    ui.modal = undefined;
    ui.thinking = true;
    syncPoses();
    draw();
    const r = await game.present(id, factId);
    if (!r.ok) {
      ui.thinking = false;
      toast(escapeHtml(r.error));
      draw();
      return;
    }
    afterTurn(id);
  };

  const finishAccusation = async () => {
    if (!game || !ui.accuse.who) return;
    const r = game.accuse(ui.accuse.who, ui.accuse.evidence);
    if (!r.ok) {
      toast(escapeHtml(r.error));
      ui.modal = 'accuse';
      draw();
      return;
    }
    ui.modal = undefined;
    ui.screen = 'ending';
    ui.epilogueLoading = true;
    shot(closeupShot(slotOf(game.case.culprit)));
    send({ kind: 'pose', id: game.case.culprit, pose: r.rating.correct ? 'down' : 'idle' });
    draw();
    await game.epilogue();
    ui.epilogueLoading = false;
    persist();
    draw();
    typeLatest();
  };

  // ---------- 输入 ----------
  const onClick = async (ev: Event) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!target) {
      finishTyping();
      return;
    }
    if (target.hasAttribute('disabled')) return;
    const act = target.dataset.act!;
    const id = target.dataset.id as DiscipleId | undefined;
    switch (act) {
      case 'new':
        startGame(Math.floor(Math.random() * 1e8));
        return;
      case 'replay':
        if (game) startGame(game.case.seed);
        return;
      case 'continue': {
        const s = load<SessionState>(SAVE_KEY);
        if (s) startGame(s.seed, s);
        return;
      }
      case 'title':
        ui.screen = 'title';
        ui.modal = undefined;
        ui.hasSave = false;
        shot(mapShot());
        draw();
        return;
      case 'intro-next':
        if (finishTyping()) return;
        if (ui.introStep < game!.introLines().length - 1) {
          ui.introStep++;
          shot(ui.introStep >= 2 ? plazaShot() : INTRO_SHOTS[ui.introStep] ?? plazaShot());
          draw();
          typeLatest();
          return;
        }
      // 最后一句：进入调查
      // falls through
      case 'intro-skip':
        game!.finishIntro();
        noticeSeen = game!.state.notices.length;
        persist();
        goMain();
        toast('<b>严长老：</b>点下方的弟子审问，点「勘察各处」去现场看看。');
        draw();
        return;
      case 'plaza':
        goMain();
        return;
      case 'map':
        ui.screen = 'map';
        ui.modal = undefined;
        shot(mapShot());
        draw();
        return;
      case 'goto': {
        const loc = target.dataset.loc as LocationId;
        const r = game!.investigate(loc);
        if (!r.ok) {
          toast(escapeHtml(r.error));
          draw();
          return;
        }
        ui.screen = 'location';
        ui.location = loc;
        ui.newClues = r.found;
        shot(locationShot(loc));
        persist();
        draw();
        return;
      }
      case 'talk': {
        if (!id) return;
        ui.screen = 'talk';
        ui.focus = id;
        ui.modal = undefined;
        shot(closeupShot(slotOf(id)));
        draw();
        mount.querySelector<HTMLInputElement>('[data-input="ask"]')?.focus({ preventScroll: true });
        return;
      }
      case 'quick':
        await ask(ui.focus!, quickQuestions(game!)[Number(target.dataset.i)]);
        return;
      case 'askAbout':
        ui.modal = 'askAbout';
        draw();
        return;
      case 'ask-about':
        ui.modal = undefined;
        await ask(ui.focus!, askAboutQuestion(game!, id!));
        return;
      case 'present':
        ui.modal = 'cluebook';
        ui.clueMode = 'present';
        draw();
        return;
      case 'present-fact':
        await present(ui.focus!, target.dataset.fact!);
        return;
      case 'cluebook':
        ui.modal = 'cluebook';
        ui.clueMode = 'view';
        draw();
        return;
      case 'dossier':
        ui.modal = 'dossier';
        ui.focus = id ?? ui.focus;
        draw();
        return;
      case 'accuse':
        game!.beginAccusation();
        ui.modal = 'accuse';
        ui.accuse = { evidence: [] };
        draw();
        return;
      case 'pick-who':
        ui.accuse.who = id;
        draw();
        return;
      case 'pick-ev': {
        const f = target.dataset.fact!;
        const ev = ui.accuse.evidence;
        if (ev.includes(f)) ui.accuse.evidence = ev.filter((x) => x !== f);
        else if (ev.length < 2) ev.push(f);
        else toast('最多选 2 条证据。');
        draw();
        return;
      }
      case 'accuse-confirm':
        ui.modal = 'confirm';
        draw();
        return;
      case 'accuse-back':
        ui.modal = 'accuse';
        draw();
        return;
      case 'accuse-final':
        await finishAccusation();
        return;
      case 'settings':
        ui.modal = 'settings';
        draw();
        return;
      case 'howto':
        ui.modal = 'help';
        draw();
        return;
      case 'set': {
        const k = target.dataset.k as keyof UiState['settings'];
        const v = target.dataset.v!;
        if (k === 'textSpeed') ui.settings.textSpeed = v as TextSpeed;
        if (k === 'provider') {
          ui.settings.provider = v as ProviderSetting;
          picked = await pickClient(data, ui.settings.provider);
          ui.aiLabel = picked.label;
          ui.showStats = data.config.dev.show_call_stats && picked.label.includes('代理');
          game?.setClient(picked.client);
        }
        persist();
        draw();
        return;
      }
      case 'close':
        if (ui.modal === 'accuse' && game?.state.phase === 'accuse') {
          if (!game.cancelAccusation().ok) return;
        }
        ui.modal = undefined;
        draw();
        return;
    }
  };

  const onSubmit = async (ev: Event) => {
    const form = (ev.target as HTMLElement).closest('form[data-form="ask"]');
    if (!form) return;
    ev.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input');
    const text = input?.value.trim() ?? '';
    if (!text || !ui.focus) return;
    await ask(ui.focus, text);
  };

  const onKey = (ev: KeyboardEvent) => {
    // 输入法选字时的回车不算提交
    if (ev.key === 'Enter' && (ev.isComposing || ev.keyCode === 229)) ev.preventDefault();
  };

  shadow.addEventListener('click', onClick);
  shadow.addEventListener('submit', onSubmit);
  shadow.addEventListener('keydown', onKey as EventListener);

  // 开场：标题画面配全景
  shot(mapShot(), true);
  send({ kind: 'cast', ids: [] });
  send({ kind: 'elder', visible: false });
  draw();

  // 调试与自动化测试用：读当前状态
  (hostEl as HTMLElement & { zongmen?: unknown }).zongmen = { get game() { return game; }, ui };
  hostEl.dataset.zongmen = 'ready';

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      doc.defaultView?.removeEventListener('resize', onResize);
      if (typingTimer) clearInterval(typingTimer);
      if (toastTimer) clearTimeout(toastTimer);
      shadow.removeEventListener('click', onClick);
      shadow.removeEventListener('submit', onSubmit);
      hostEl.remove();
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
