// 界面渲染：纯函数，(界面状态 + 一局状态) → HTML。动态文字（含 AI 的话）一律转义。

import { categoryOf, type Fact } from '../game/case/facts';
import type { DiscipleId, Emotion, GameData, LocationId } from '../game/data/types';
import { GRADE_NAMES } from '../game/game/rules';
import { quickQuestions } from '../game/game/quick';
import type { GameSession } from '../game/game/state';
import type { ProviderSetting } from './ai';

export type Screen = 'title' | 'intro' | 'main' | 'map' | 'location' | 'talk' | 'ending';
export type Modal = 'cluebook' | 'dossier' | 'accuse' | 'confirm' | 'settings' | 'askAbout' | 'help';
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

export interface UiState {
  screen: Screen;
  modal?: Modal;
  introStep: number;
  focus?: DiscipleId;
  location?: LocationId;
  newClues: string[];
  clueMode: 'view' | 'present';
  accuse: { who?: DiscipleId; evidence: string[] };
  thinking: boolean;
  toast?: string;
  settings: { textSpeed: TextSpeed; provider: ProviderSetting };
  aiLabel: string;
  hasSave: boolean;
  showStats: boolean;
  epilogueLoading: boolean;
}

export const EMOTION_GLYPH: Record<Emotion, string> = { calm: '静', nervous: '慌', angry: '怒', scared: '惧', sad: '悲', relieved: '安' };
const EMOTION_NAME: Record<Emotion, string> = { calm: '平静', nervous: '紧张', angry: '恼火', scared: '害怕', sad: '难过', relieved: '松了口气' };

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface ViewCtx {
  ui: UiState;
  game?: GameSession;
  data: GameData;
  portrait: (id: string) => string;
}

const char = (data: GameData, id: string) => data.characters.find((c) => c.id === id)!;
const locName = (data: GameData, id: string) => data.locations.find((l) => l.id === id)?.name ?? id;

function mood(e: Emotion, extra = ''): string {
  return `<span class="mood ${e} ${extra}" title="${EMOTION_NAME[e]}">${EMOTION_GLYPH[e]}</span>`;
}

function stressBar(stress: number): string {
  return `<div class="stress" title="压力"><i style="width:${Math.round(stress)}%"></i></div>`;
}

export function render(ctx: ViewCtx): string {
  const { ui } = ctx;
  let body = '';
  switch (ui.screen) {
    case 'title':
      body = titleView(ctx);
      break;
    case 'intro':
      body = introView(ctx);
      break;
    case 'ending':
      body = endingView(ctx);
      break;
    default:
      body = playView(ctx);
  }
  if (ui.modal) body += modalView(ctx);
  if (ui.toast) body += `<div class="toast panel">${ui.toast}</div>`;
  return `<div class="root">${body}</div>`;
}

function titleView({ ui }: ViewCtx): string {
  return `<div class="title">
    <h1 class="serif">宗门内奸</h1>
    <div class="sub">雨夜，藏经阁的镇派秘籍失窃。五个会撒谎的弟子，天亮前找出魔门内奸。</div>
    <div class="menu">
      <button class="primary" data-act="new">开始新案</button>
      ${ui.hasSave ? '<button data-act="continue">继续本局</button>' : ''}
      <button data-act="howto">怎么玩</button>
      <button data-act="settings">设置</button>
    </div>
    <div class="notice" style="margin-top:14px">AI：${esc(ui.aiLabel)}</div>
  </div>`;
}

function introView({ ui, game }: ViewCtx): string {
  const lines = game!.introLines();
  const i = Math.min(ui.introStep, lines.length - 1);
  return `<div class="intro panel" data-act="intro-next">
    <div class="line"><span class="who">严长老</span><span data-typing>${esc(lines[i])}</span></div>
    <div class="bar"><button class="ghost" data-act="intro-skip">跳过</button><button class="primary" data-act="intro-next">${i < lines.length - 1 ? '继续' : '开始审案'}</button></div>
  </div>`;
}

function topBar({ game, data, ui }: ViewCtx): string {
  const g = game!;
  const left = g.state.questionsLeft;
  return `<div class="top">
    <div class="censer panel ${left <= data.config.dawn_warning_at ? 'low' : ''}" title="剩余问话">
      ${censerIcon()}<span class="num">${left}</span><span class="lbl">炷香<br>天亮前</span>
    </div>
    <div class="case-info panel">案发${esc(g.case.time_slot)} · 失窃${esc(g.case.stolen_item.name)} · 案件 ${g.case.seed}</div>
    <div class="spacer"></div>
    <button class="ghost" data-act="howto" title="怎么玩">？</button>
    <button class="ghost" data-act="settings" title="设置">设置</button>
    ${ui.screen === 'main' ? '' : ''}
  </div>`;
}

function censerIcon(): string {
  return `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M7 16h20l-3 9H10z" fill="#b8893f"/><rect x="5" y="14" width="24" height="3" rx="1" fill="#d9a54a"/><path d="M11 25l-2 5M23 25l2 5M17 25v5" stroke="#8a6630" stroke-width="2"/><path d="M14 13c0-3 3-3 2-7M18 13c0-3 3-3 2-7" stroke="#cfc6b4" stroke-width="1.5" fill="none" opacity=".8"/></svg>`;
}

function castBar(ctx: ViewCtx): string {
  const g = ctx.game!;
  return `<div class="cast panel">${g.case.disciples
    .map((d) => {
      const c = char(ctx.data, d.id);
      const st = g.state.disciples[d.id];
      return `<button class="card ghost ${st.refused ? 'refused' : ''}" data-act="talk" data-id="${d.id}" title="审问${esc(c.name)}">
        ${mood(st.emotion)}${st.confessed ? '<span class="tag">已坦白</span>' : st.refused ? '<span class="tag">拒答</span>' : ''}
        <img src="${ctx.portrait(d.id)}" alt="">
        <span class="nm">${esc(c.name)}</span><span class="id">${esc(c.identity)}</span>${stressBar(st.stress)}
      </button>`;
    })
    .join('')}</div>`;
}

function actionButtons(ctx: ViewCtx): string {
  const g = ctx.game!;
  return `<div class="actions">
    <button class="ghost" data-act="map">勘察各处</button>
    <button class="ghost" data-act="cluebook">线索簿（${g.state.clues.length}）</button>
    <button class="danger" data-act="accuse">指认内奸</button>
  </div>`;
}

function statsView(ctx: ViewCtx): string {
  if (!ctx.ui.showStats || !ctx.game) return '';
  const s = ctx.game.state.stats;
  return `<div class="stats panel">开发 · ${esc(ctx.ui.aiLabel)} · 调用 ${s.calls}/${ctx.data.config.budget.max_calls_per_case} · token ${s.inputTokens}/${s.outputTokens}（缓存 ${s.cachedInputTokens}） · 平均 ${ctx.game.averageLatencyMs()} 毫秒 · 兜底 ${s.fallbackTurns}/${s.turns}</div>`;
}

function playView(ctx: ViewCtx): string {
  const { ui } = ctx;
  let main = topBar(ctx);
  if (ui.screen === 'main') main += floatingMoods(ctx) + castBar(ctx) + actionButtons(ctx);
  if (ui.screen === 'map') main += mapView(ctx);
  if (ui.screen === 'location') main += locationView(ctx);
  if (ui.screen === 'talk') main += talkView(ctx);
  return main + statsView(ctx);
}

function floatingMoods(ctx: ViewCtx): string {
  const g = ctx.game!;
  return g.case.disciples.map((d) => `<div class="float head-mood" data-float-char="${d.id}">${mood(g.state.disciples[d.id].emotion)}</div>`).join('');
}

function mapView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const labels = ctx.data.locations
    .map((l) => `<button class="float loc-label ${g.state.visited.includes(l.id) ? 'visited' : ''}" data-act="goto" data-loc="${l.id}" data-float-loc="${l.id}">${esc(l.name)}</button>`)
    .join('');
  return `${labels}<div class="sheet panel"><div class="row"><span style="flex:1">点一处地点前去勘察。勘察不耗问话，找到的物证会自动记进线索簿。</span><button class="primary" data-act="plaza">回广场</button></div></div>`;
}

function clueHtml(ctx: ViewCtx, f: Fact, opts: { isNew?: boolean; meta?: string; button?: string } = {}): string {
  return `<div class="clue ${opts.isNew ? 'new' : ''} ${opts.button ? 'pickable' : ''}">${esc(f.text)}${opts.meta ? `<div class="meta">${opts.meta}</div>` : ''}${opts.button ?? ''}</div>`;
}

function locationView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const loc = ctx.data.locations.find((l) => l.id === ctx.ui.location)!;
  const ids = g.case.investigation[loc.id] ?? [];
  const clues = ids.map((id) => clueHtml(ctx, g.fact(id), { isNew: ctx.ui.newClues.includes(id) })).join('');
  return `<div class="sheet panel">
    <h2 class="serif">${esc(loc.name)}</h2>
    <div class="desc">${esc(loc.desc)}${ids.length ? '' : esc(loc.empty_text)}</div>
    ${clues}
    ${ids.length ? '<div class="notice">已记进线索簿。</div>' : ''}
    <div class="row" style="margin-top:8px"><button data-act="map">看看别处</button><button class="primary" data-act="plaza">回广场</button></div>
  </div>`;
}

function talkView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const id = ctx.ui.focus!;
  const c = char(ctx.data, id);
  const st = g.state.disciples[id];
  const lines = g.state.transcripts[id];
  const log = lines
    .map((l, i) => {
      const last = i === lines.length - 1;
      if (l.from === 'player') return `<div class="msg player"><span>${esc(l.text)}</span></div>`;
      if (l.from === 'system') {
        const cls = l.text.startsWith('【矛盾成立') ? 'verdict' : l.text.startsWith('【') ? 'verdict ok' : 'system';
        return `<div class="msg ${cls}"><span>${esc(l.text)}</span></div>`;
      }
      return `<div class="msg disciple"><span ${last ? 'data-typing' : ''}>${esc(l.text)}</span></div>`;
    })
    .join('');
  const quick = quickQuestions(g);
  const disabled = ctx.ui.thinking || st.refused || g.state.questionsLeft <= 0 ? 'disabled' : '';
  return `<div class="talk panel">
    <header>
      <img src="${ctx.portrait(id)}" alt="">
      <div><div class="who">${esc(c.name)}</div><div class="notice">${esc(c.identity)} · ${esc(c.personality)}</div></div>
      ${mood(st.emotion)}
      <div class="stress" style="width:110px" title="压力">${''}<i style="width:${st.stress}%"></i></div>
      <div class="spacer"></div>
      <button class="ghost" data-act="dossier" data-id="${id}">档案</button>
      <button class="ghost" data-act="plaza">返回</button>
    </header>
    <div class="log" data-log>${log || `<div class="msg system"><span>${esc(c.name)}站在你面前，等你开口。问一句或出示一条证据，都要烧掉一炷香。</span></div>`}
      ${ctx.ui.thinking ? `<div class="msg system"><span class="thinking">（${esc(c.name)}思索中……）</span></div>` : ''}</div>
    <div class="quick">
      ${quick.map((q, i) => `<button data-act="quick" data-i="${i}" ${disabled}>${esc(q)}</button>`).join('')}
      <button data-act="askAbout" ${disabled}>问某人的事</button>
      <button class="primary" data-act="present" ${disabled}>出示证据</button>
    </div>
    <form class="inputrow" data-form="ask">
      <input data-input="ask" maxlength="${ctx.data.config.input_max_chars}" placeholder="${st.refused ? `${esc(c.name)}不肯再开口了` : '想问什么？（最多 60 字）'}" ${disabled} enterkeyhint="send" autocomplete="off">
      <button class="primary" type="submit" ${disabled}>问</button>
    </form>
  </div>`;
}

function modalView(ctx: ViewCtx): string {
  switch (ctx.ui.modal) {
    case 'cluebook':
      return clueBookView(ctx);
    case 'dossier':
      return dossierView(ctx);
    case 'accuse':
      return accuseView(ctx);
    case 'confirm':
      return confirmView(ctx);
    case 'settings':
      return settingsView(ctx);
    case 'askAbout':
      return askAboutView(ctx);
    case 'help':
      return helpView();
    default:
      return '';
  }
}

const GROUP_NAMES = { physical: '物证（勘察所得）', testimony: '证词（弟子说的话）', confession: '坦白与失言' } as const;

function clueBookView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const present = ctx.ui.clueMode === 'present' && ctx.ui.focus;
  const st = present ? g.state.disciples[ctx.ui.focus!] : undefined;
  const groups = (['physical', 'testimony', 'confession'] as const)
    .map((cat) => {
      const items = g.state.clues.filter((c) => c.category === cat);
      if (!items.length) return '';
      return `<div class="group"><h3>${GROUP_NAMES[cat]}</h3>${items
        .map((c) => {
          const f = g.fact(c.factId);
          const presented = st?.presented.includes(c.factId);
          const button = present
            ? presented
              ? '<button disabled>已出示</button>'
              : `<button class="primary" data-act="present-fact" data-fact="${c.factId}">出示</button>`
            : undefined;
          return clueHtml(ctx, f, { meta: `第 ${c.order} 条 · 来自${esc(c.via)}`, button });
        })
        .join('')}</div>`;
    })
    .join('');
  const title = present ? `向${esc(char(ctx.data, ctx.ui.focus!).name)}出示证据` : '线索簿';
  return `<div class="modal"><div class="panel">
    <div class="row"><h2 class="serif" style="flex:1">${title}</h2><button data-act="close">关闭</button></div>
    ${present ? '<div class="notice">出示一条证据要烧掉一炷香。和他的说法对不上，他就会慌；同一条证据对同一个人只能出示一次。</div>' : ''}
    <div class="scroll">${groups || '<div class="notice">线索簿还是空的。先去各处勘察，或者问问弟子们。</div>'}</div>
  </div></div>`;
}

const TRAIT_NOTE: Record<string, string> = { robe: '外袍', habit: '习惯', item: '随身物' };

/** 与某名弟子相关的已获线索：他说的、说到他的、指向他的物证 */
export function relatedClues(g: GameSession, id: DiscipleId): string[] {
  return g.state.clues
    .map((c) => g.fact(c.factId))
    .filter((f) => {
      if (f.holder === id) return true;
      switch (f.kind) {
        case 'presence':
        case 'empty_room':
        case 'claim':
          return f.params.person === id;
        case 'exclusive':
          return f.params.people.includes(id);
        default:
          return false;
      }
    })
    .map((f) => f.id);
}

function dossierView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const id = ctx.ui.focus!;
  const c = char(ctx.data, id);
  const traits = c.traits
    .map((t) => ctx.data.traits.find((x) => x.id === t)!)
    .map((t) => `<span class="${t.visible ? '' : 'hidden-trait'}" title="${t.visible ? '看得出来' : '看不出来，档案里写着'}">${TRAIT_NOTE[t.category]}：${esc(t.name)}</span>`)
    .join('');
  const clues = relatedClues(g, id).map((fid) => clueHtml(ctx, g.fact(fid))).join('');
  return `<div class="modal"><div class="panel">
    <div class="row"><img src="${ctx.portrait(id)}" style="width:64px;height:64px;image-rendering:pixelated;border-radius:10px" alt="">
      <div style="flex:1"><h2 class="serif">${esc(c.name)}</h2><div class="notice">${esc(c.identity)} · ${esc(c.personality)}</div></div>
      <button data-act="close">关闭</button></div>
    <div class="traits">${traits}</div>
    <div class="notice">${esc(c.bio)}</div>
    <div class="scroll"><div class="group"><h3>与${esc(c.name)}相关的线索</h3>${clues || '<div class="notice">还没有。</div>'}</div></div>
  </div></div>`;
}

function accuseView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const a = ctx.ui.accuse;
  const forced = g.state.phase === 'accuse' && g.state.questionsLeft <= 0;
  const cards = g.case.disciples
    .map((d) => {
      const c = char(ctx.data, d.id);
      return `<button class="card ghost ${a.who === d.id ? 'on' : ''}" data-act="pick-who" data-id="${d.id}"><img src="${ctx.portrait(d.id)}" alt=""><span class="nm">${esc(c.name)}</span></button>`;
    })
    .join('');
  const clues = g.state.clues
    .map((c) => {
      const f = g.fact(c.factId);
      const on = a.evidence.includes(c.factId);
      return `<div class="clue pickable ${on ? 'picked' : ''}">${esc(f.text)}<div class="meta">${categoryName(f)} · 来自${esc(c.via)}</div><button class="${on ? '' : 'primary'}" data-act="pick-ev" data-fact="${c.factId}">${on ? '取消' : '选它'}</button></div>`;
    })
    .join('');
  const ready = a.who && a.evidence.length === 2;
  return `<div class="modal"><div class="panel">
    <div class="row"><h2 class="serif" style="flex:1">${forced ? '天亮了，必须指认' : '指认内奸'}</h2>${forced ? '' : '<button data-act="close">再想想</button>'}</div>
    <div class="notice">选出你认定的内奸，再从线索簿里挑 2 条最能定罪的证据。</div>
    <div class="pick" style="margin:8px 0">${cards}</div>
    <div class="notice">已选证据 ${a.evidence.length}/2</div>
    <div class="scroll">${clues || '<div class="notice">线索簿是空的。</div>'}</div>
    <button class="danger" data-act="accuse-confirm" ${ready ? '' : 'disabled'}>就是${a.who ? esc(char(ctx.data, a.who).name) : '他'}！</button>
  </div></div>`;
}

function categoryName(f: Fact): string {
  return { physical: '物证', testimony: '证词', confession: '坦白与失言' }[categoryOf(f)];
}

function confirmView(ctx: ViewCtx): string {
  const who = char(ctx.data, ctx.ui.accuse.who!).name;
  return `<div class="modal"><div class="panel" style="width:min(420px,100%)">
    <h2 class="serif">确定指认${esc(who)}？</h2>
    <div class="notice" style="margin:10px 0">指认之后就不能反悔了。</div>
    <div class="row"><button data-act="accuse-back">再想想</button><button class="danger" data-act="accuse-final">确定</button></div>
  </div></div>`;
}

function askAboutView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const cards = g.case.disciples
    .filter((d) => d.id !== ctx.ui.focus)
    .map((d) => `<button class="card ghost" data-act="ask-about" data-id="${d.id}"><img src="${ctx.portrait(d.id)}" alt=""><span class="nm">${esc(char(ctx.data, d.id).name)}</span></button>`)
    .join('');
  return `<div class="modal"><div class="panel" style="width:min(620px,100%)">
    <div class="row"><h2 class="serif" style="flex:1">问问他见没见过谁</h2><button data-act="close">关闭</button></div>
    <div class="notice">会问：「你${esc(g.case.time_slot)}见过某某吗？」</div>
    <div class="pick" style="margin-top:10px">${cards}</div>
  </div></div>`;
}

function settingsView(ctx: ViewCtx): string {
  const s = ctx.ui.settings;
  const opt = (name: string, value: string, label: string, cur: string) => `<button class="${cur === value ? 'primary' : ''}" data-act="set" data-k="${name}" data-v="${value}">${label}</button>`;
  return `<div class="modal"><div class="panel" style="width:min(560px,100%)">
    <div class="row"><h2 class="serif" style="flex:1">设置</h2><button data-act="close">关闭</button></div>
    <div class="group"><h3>文字速度</h3><div class="row">${opt('textSpeed', 'slow', '慢', s.textSpeed)}${opt('textSpeed', 'normal', '中', s.textSpeed)}${opt('textSpeed', 'fast', '快', s.textSpeed)}${opt('textSpeed', 'instant', '立即', s.textSpeed)}</div></div>
    <div class="group"><h3>AI 由谁来演</h3><div class="row">${opt('provider', 'auto', '自动', s.provider)}${opt('provider', 'template', '模板应答（离线）', s.provider)}${opt('provider', 'proxy', '本地代理（开发）', s.provider)}</div>
      <div class="notice" style="margin-top:6px">当前：${esc(ctx.ui.aiLabel)}。发布版接入模型服务前，用模板应答也能完整玩一局。</div></div>
    <div class="group"><h3>音量</h3><div class="notice">音效在打磨阶段加入。</div></div>
  </div></div>`;
}

function helpView(): string {
  return `<div class="modal"><div class="panel" style="width:min(640px,100%)">
    <div class="row"><h2 class="serif" style="flex:1">怎么玩</h2><button data-act="close">知道了</button></div>
    <div class="scroll" style="line-height:1.8">
      <p>藏经阁的秘籍被偷了。五名弟子里藏着一个魔门内奸。天亮前（30 炷香）找出他。</p>
      <p><b>勘察各处</b>：不耗香。藏经阁里留着窃贼的特征（比如穿什么颜色的袍子、个子高不高），其他地方可能有人留下的痕迹。</p>
      <p><b>审问</b>：点下方的弟子。每问一句、每出示一条证据，烧掉一炷香。</p>
      <p><b>出示证据</b>：和他的说法对不上，他就会慌。被逼急了，有秘密的人会坦白；内奸会说漏嘴。</p>
      <p><b>推理</b>：先用特征缩小嫌疑；再看谁的不在场证明有别人或物证作证；剩下那个说法被戳穿的人，就是内奸。</p>
      <p><b>指认</b>：选出内奸，再附 2 条证据。证据越硬、剩的香越多，评级越高。</p>
    </div>
  </div></div>`;
}

function endingView(ctx: ViewCtx): string {
  const g = ctx.game!;
  const e = g.state.ending!;
  const grade = e.rating.grade;
  const rows = g
    .truthTable()
    .map(
      (r) => `<tr class="${r.role === '内奸' ? 'culprit' : ''}"><td><b>${esc(r.name)}</b><br><span class="notice">${esc(r.role)}</span></td><td>${esc(r.truth)}</td><td>${esc(r.claim)}${r.truth === r.claim ? '' : ' ✗'}</td><td>${r.secret ? esc(r.secret) : '—'}${
        r.role === '内奸' ? r.flaws.map((f) => `<div class="flaw">破绽：${esc(f)}</div>`).join('') : ''
      }</td></tr>`,
    )
    .join('');
  return `<div class="modal"><div class="panel">
    <div class="grade serif ${grade === 'fail' ? 'fail' : ''}">${esc(GRADE_NAMES[grade])}</div>
    <div class="notice" style="text-align:center">指认：${esc(char(ctx.data, e.accused).name)} · 真正的内奸：${esc(char(ctx.data, g.case.culprit).name)} · 有效证据 ${e.rating.validEvidence.length}/2 · 剩余 ${g.state.questionsLeft} 炷香</div>
    <div class="scroll">
      <div class="epilogue">${ctx.ui.epilogueLoading ? '（尾声撰写中……）' : `<span data-typing>${esc(e.epilogue ?? '')}</span>`}</div>
      <h3 style="color:var(--gold);margin:14px 0 4px">真相复盘 · 案发${esc(g.case.time_slot)}</h3>
      <table class="truth"><tr><th>弟子</th><th>真实位置</th><th>对掌门说</th><th>秘密 / 破绽</th></tr>${rows}</table>
      <div class="notice" style="margin-top:8px">案件编号 ${g.case.seed}，把它告诉朋友，可以挑战同一个案子。</div>
    </div>
    <div class="row"><button class="primary" data-act="new">再来一局</button><button data-act="replay">重玩本案</button><button data-act="title">回标题</button></div>
  </div></div>`;
}

export { locName };
