// 界面：纯函数，把游戏状态画成 HTML 字符串。交互由 main.ts 用 data-act 统一处理。

import { CharState, GameState, TaskId } from '../hanyi/core/types';
import {
  act, cnDay, def, eats, has, heatNeed, insulation, lvl, moodWord, nm, rel, relWord, trustWord,
} from '../hanyi/core/world';
import { CHARS, CHAR_ORDER } from '../hanyi/data/characters';
import { BUILDINGS, BUILD_ORDER, LAST_DAY, SKILLS, TASKS, TASK_ORDER, TRAITS } from '../hanyi/data/rules';
import { fate, isPresentAtEnd } from '../hanyi/systems/camp';
import { currentEvent } from '../hanyi/systems/story';
import {
  blocked, buildOut, cookSave, cookScore, huntOut, injuryRisk, preview, scavOut, taskMood, woodOut,
} from '../hanyi/systems/work';
import { MAX_TALKS, TOPICS } from '../hanyi/ai/dialogue';
import { icon } from './icons';

/** 每个人的画：用在他的登记页上 */
const CHAR_ART: Record<string, string> = {
  qin: 'pine', lin: 'plummoon', jie: 'geese', ma: 'retreat', su: 'purewhite', man: 'plumsnow', gesang: 'snowpass', wu: 'ferry',
};
/** 事件配图 */
const EVENT_ART: Record<string, string> = {
  find_bus: 'travelers', find_man: 'plumsnow', find_gesang: 'snowpass', find_wu: 'retreat', stranger: 'travelers',
  cellar: 'pine', jie_portrait: 'pine', jie_signal: 'geese', lin_leave: 'ferry', lin_bond: 'plummoon',
  ma_confess: 'retreat', radio_done: 'inn', phone_done: 'inn', su_phone: 'purewhite', su_challenge: 'purewhite',
  man_fever: 'plumsnow', gesang_story: 'snowpass', wu_carving: 'retreat', wu_speaks: 'ferry',
  wolves: 'snowdark', blizzard: 'snowdark', death: 'purewhite', leave_try: 'ferry', theft: 'snowdark',
  quarrel: 'snowdark', breakdown: 'moonplum', friends: 'moonplum', mentor: 'pine',
};
const art = (name: string) => `--art: var(--art-${name})`;

/** 天工引擎版额外显示的东西（独立网页版不传） */
export interface EngineView {
  souls: {
    soulId: string;
    lod: 'spotlight' | 'ambient' | 'offstage';
    affordances: readonly { id: string; kind: string; label: string }[];
    perception?: { day: number; body: string; heart: string; ties: string; recent: readonly string[] };
    samples: number;
    age: number;
  }[];
  provider: string;
  sessions: Record<string, string>;
  stream: { id: string; text: string } | null;
  settings: { kind: 'offline' | 'deepseek' | 'custom' | 'claude'; baseUrl: string; model: string; hasKey: boolean; claude: boolean; editing: boolean };
}

export interface UI {
  screen: 'title' | 'game';
  tab: 'people' | 'build' | 'log';
  sheet: null | { kind: 'task' | 'person' | 'chat'; id: string };
  outcome: null | { title: string; text: string };
  confirmReset: boolean;
  thinking: string | null;
  aiNote: string | null;
  reportOpen: boolean;
  ai: boolean;
  hasSave: boolean;
  engine?: EngineView;
}

export const esc = (t: unknown) =>
  String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 心情决定表情：好 / 平常 / 低落 */
const moodTier = (c?: CharState) => (!c || c.status !== 'active' ? 1 : c.mood >= 60 ? 0 : c.mood >= 30 ? 1 : 2);
/** 人物形象（Open Peeps），样式类由 art.css 提供 */
export const portrait = (id: string, c?: CharState, cls = '') =>
  `<i class="pt pt-${id}-${moodTier(c)} ${cls}" style="--c:${CHARS[id]?.color ?? '#555'}" aria-hidden="true"></i>`;
const PHASE_WORD = { day: '白天', evening: '傍晚', night: '夜里', ending: '' } as const;

// ───────────── 预估 ─────────────

export function forecast(s: GameState) {
  const A = act(s);
  let food = 0, wood = 0, mat = 0, pts = 0, cook = 0;
  for (const c of A) {
    const t: TaskId = blocked(s, c, c.task) ? 'rest' : c.task;
    if (t === 'wood') wood += woodOut(s, c);
    if (t === 'hunt') food += huntOut(s, c) + (s.built.includes('smoke') ? 0.7 : 0);
    if (t === 'scavenge') mat += scavOut(s, c);
    if (t === 'build') pts += buildOut(s, c);
    if (t === 'cook') cook = Math.max(cook, cookScore(s, c));
  }
  let need = A.reduce((n, c) => n + eats(c), 0);
  if (s.policy.ration === 'half') need = Math.ceil(need / 2);
  const save = cook ? cookSave(cook, A.length) : 0;
  need = Math.max(A.length ? 1 : 0, need - save);
  return { food: Math.round(food), wood: Math.round(wood), mat: Math.round(mat), pts: Math.round(pts), eat: need, burn: heatNeed(s), save };
}

// ───────────── 标题 ─────────────

export function titleScreen(ui: UI) {
  return `<section class="title">
  <div class="title-art" aria-hidden="true"></div>
  <canvas id="snow" aria-hidden="true"></canvas>
  <div class="wrap">
    <h1>寒驿<span>三十个冬夜</span></h1>
    <p class="story">寒潮来得毫无征兆。客车在山道上抛锚，五个陌生人躲进了半山腰一座废弃的驿站。广播里最后一条消息说：大雪封山，道路至少一个月才能打通。<br><br>你成了那个拿主意的人。</p>
    <div class="cast" aria-label="驿站里的人">${CHAR_ORDER.map((id) => (CHARS[id].starter
      ? `<figure>${portrait(id)}<figcaption>${CHARS[id].short}</figcaption></figure>`
      : '<figure class="unknown"><i class="pt pt-unknown-0" aria-hidden="true"></i><figcaption>？</figcaption></figure>')).join('')}</div>
    <div class="row">
      ${ui.hasSave ? '<button class="go" data-act="continue">继续</button><button class="btn ghost" data-act="new">重新开始</button>' : '<button class="go" data-act="new">推开驿站的门</button>'}
    </div>
    <p class="mini">白天给每个人派活：砍柴取暖、打猎果腹、搜寻物资、营建驿站。夜里围着火，和他们说说话。信任，会让他们说出藏在心里的事。${ui.ai ? '<br>夜谈由 Claude 即兴扮演每个角色，你可以说任何话。' : ''}</p>
    <p class="art-credit">画：清 · 袁耀，雪山中的客栈与旅人（1745），大都会艺术博物馆藏</p>
  </div>
</section>`;
}

// ───────────── 日头 ─────────────

const WEATHER = { clear: '晴', snow: '小雪', blizzard: '暴风雪' };
const temp = (t: number) => `${t < 0 ? '−' : ''}${Math.abs(t)}℃`;

function hud(s: GameState) {
  const f = forecast(s);
  const day = s.phase === 'day';
  const cap = (k: 'food' | 'wood' | 'mat' | 'med', label: string, inc: number, out: number) => {
    const v = s.res[k];
    const net = inc - out;
    const short = day && out > 0 && v + inc < out;
    const delta = day && (inc || out) ? `<i class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${net > 0 ? '+' : ''}${net}</i>` : '';
    return `<div class="cap ${short ? 'short' : ''}" title="${label}">${icon(k)}<b>${v}</b>${delta}<small>${label}</small></div>`;
  };
  const rescue = s.rescueBy !== 'road' ? `救援约 ${Math.max(0, s.rescueDay - s.day)} 日后到` : `撑到开路 · 约${cnDay(LAST_DAY)}日`;
  return `<header class="hud" data-phase="${s.phase}"><div class="hud-art" aria-hidden="true"></div><div class="wrap">
  <div class="hud-top">
    <div class="hud-day"><b>第${cnDay(s.day)}日</b><span>${PHASE_WORD[s.phase]} · ${rescue}</span></div>
    <div class="hud-sky"><strong class="${s.weather.kind === 'blizzard' ? 'storm' : ''}">${icon(`w_${s.weather.kind}`)}${WEATHER[s.weather.kind]} ${temp(s.temp)}</strong><span>保暖 ${insulation(s)} 级 · 每日烧柴 ${f.burn} 捆</span></div>
  </div>
  <div class="caps">${cap('food', '食物', f.food, f.eat)}${cap('wood', '柴火', f.wood, f.burn)}${cap('mat', '物资', f.mat, 0)}${cap('med', '药品', 0, 0)}</div>
</div></header>`;
}

function canAfford(s: GameState, id: string) {
  const b = BUILDINGS[id];
  if (s.built.includes(id) || (b.needFlag && !s.flags[b.needFlag])) return false;
  return (b.cost.mat ?? 0) <= s.res.mat && (b.cost.wood ?? 0) <= s.res.wood;
}

// ───────────── 众人 ─────────────

function tags(c: CharState) {
  const out: string[] = [];
  if (c.sick) out.push(`<span class="tag bad">发烧 ${c.sick} 天</span>`);
  if (c.injured) out.push(`<span class="tag bad">有伤 ${c.injured} 天</span>`);
  if (c.hungerDays) out.push(`<span class="tag warn">挨饿</span>`);
  if (c.restDays) out.push(`<span class="tag warn">要歇着</span>`);
  if (c.mood < 12) out.push(`<span class="tag bad">崩溃边缘</span>`);
  return out.join('');
}

function bar(cls: string, label: string, v: number, word?: string) {
  return `<div class="bar ${cls} ${v < 30 ? 'low' : ''}"><span>${label}</span><i style="--v:${v}%"></i><em>${word ?? v}</em></div>`;
}

function card(s: GameState, c: CharState) {
  const d = def(c.id);
  if (c.status !== 'active') {
    const note = c.status === 'dead' ? `第${cnDay(c.endDay ?? s.day)}日 离世` : `第${cnDay(c.endDay ?? s.day)}日 离开`;
    return `<article class="card gone" style="--c:${d.color}">
  <button class="card-face" data-act="person" data-id="${c.id}" aria-label="查看${d.short}">${portrait(c.id, c)}</button>
  <div class="card-body"><div class="card-name"><b>${d.short}</b><span>${d.job}</span></div><p class="card-end">${note}</p></div>
</article>`;
  }
  let bubble = '';
  let say = '';
  let action: string;
  const it = s.intents?.[c.id];
  const want = s.wants?.[c.id];
  if (s.phase === 'day') {
    const t: TaskId = blocked(s, c, c.task) ? 'rest' : c.task;
    if (it) {
      const same = c.task === it.task;
      const can = !blocked(s, c, it.task);
      bubble = `<span class="say-bubble ${it.asking ? 'asking' : same ? 'ok' : ''}">${it.asking ? '在想……' : `想去${TASKS[it.task].name}`}</span>`;
      if (!it.asking) {
        const btn = same ? '<em class="ok">照办了</em>' : can ? `<button class="mini-btn" data-act="adopt" data-id="${c.id}">照办</button>` : '';
        say = `<div class="card-say"><p>「${esc(it.say)}」</p>${btn}</div>`;
      }
    }
    action = `<button class="task-btn" data-act="pick" data-id="${c.id}" aria-label="给${d.short}派活，现在是${TASKS[t].name}">${icon(`t_${t}`)}<b>${TASKS[t].name}</b><small>${esc(preview(s, c, t))}</small></button>`;
  } else if (s.phase === 'night') {
    const left = MAX_TALKS - c.talks;
    const wants = want && !want.done;
    if (wants) {
      bubble = '<span class="say-bubble want">有话想说</span>';
      say = `<div class="card-say"><p>${esc(want.reason)}。</p></div>`;
    }
    action = `<button class="task-btn talk ${left ? '' : 'done'} ${wants ? 'want' : ''}" data-act="chat" data-id="${c.id}">${icon('talk')}<b>${wants ? '听听' + (d.gender === 'f' ? '她' : '他') + '说' : '说说话'}</b><small>${left ? (c.talks ? `还能聊 ${left} 句` : '围着火聊聊') : '已经困了'}</small></button>`;
  } else {
    action = `<div class="task-btn static">${icon(`t_${c.task}`)}<b>${TASKS[c.task].name}</b><small>今天的活</small></div>`;
  }
  return `<article class="card" style="--c:${d.color}">
  <button class="card-face" data-act="person" data-id="${c.id}" aria-label="查看${d.short}">
    ${portrait(c.id, c)}
    <span class="card-tags">${tags(c)}</span>
    ${bubble}
  </button>
  <div class="card-body">
    <div class="card-name"><b>${d.short}</b><span>${d.age} · ${d.job}</span></div>
    <div class="card-bars">${bar('h', '健康', c.health)}${bar('s', '体力', c.stamina)}${bar('m', '心情', c.mood, moodWord(c.mood))}</div>
    ${say}
    ${action}
  </div>
</article>`;
}

/** 围炉：大家围坐在火边；每句闲话旁边，是说话人的脸 */
function campfire(s: GameState, ui: UI) {
  const A = act(s);
  const lines = s.ambient.length ? s.ambient : ['火噼啪地响着。'];
  const half = Math.ceil(A.length / 2);
  const seat = (c: CharState) => `<button class="seat" data-act="chat" data-id="${c.id}" aria-label="和${def(c.id).short}说话">${portrait(c.id, c)}${s.wants?.[c.id] && !s.wants[c.id].done ? '<span class="dot" aria-label="有话想说"></span>' : ''}</button>`;
  const faces = (line: string) => A.filter((c) => line.includes(nm(c.id))).slice(0, 2).map((c) => portrait(c.id, c, 'mini')).join('');
  return `<section class="campfire" data-phase="${s.phase}"><div class="campfire-art" aria-hidden="true"></div>
  <div class="ring">${A.slice(0, half).map(seat).join('')}<span class="fire" aria-hidden="true">${icon('fire')}</span>${A.slice(half).map(seat).join('')}</div>
  <div class="lines">${lines.map((l) => `<p class="${l.includes('\n') ? 'talkline' : ''}"><span class="faces">${faces(l)}</span><span class="text">${esc(l)}</span></p>`).join('')}</div>
  <p class="ai">${ui.engine ? `天工引擎 · ${ui.engine.souls.filter((x) => x.lod !== 'offstage').length} 个 NPC 灵魂在场 · 由「${esc(ui.engine.provider)}」来演 · 每人每晚最多聊四句。` : ui.ai ? '夜谈由 Claude 即兴扮演，每人每晚最多聊四句。' : '点火边的人和他们说话。每人每晚最多聊四句。'}</p>
</section>`;
}

function reportCard(s: GameState, ui: UI, title: string) {
  if (!s.report.length) return '';
  const lines = s.report;
  const show = ui.reportOpen ? lines : lines.slice(0, 6);
  const more = lines.length > 6 ? `<button data-act="report">${ui.reportOpen ? '收起' : `全部 ${lines.length} 条`}</button>` : '';
  return `<section class="note"><h3>${title}${more}</h3><ul>${show.map((l) => `<li class="${l.tone}">${esc(l.text)}</li>`).join('')}</ul></section>`;
}

function people(s: GameState, ui: UI) {
  const parts: string[] = [];
  const A = act(s);
  if (s.phase === 'day') {
    if (s.day > 1) parts.push(reportCard(s, ui, '昨夜'));
    if (s.day <= 2) {
      parts.push(`<section class="note tip"><p>点每张卡片下面的<b>活计</b>给他们派活，点<b>人像</b>看他们的底细。头顶的气泡是他们自己想干的活。柴火保暖，食物果腹，物资用来<b>营建</b>。派完活点右下角「结束今天」。</p><p>夜里可以和大家聊天。<b>信任</b>够了，他们会说出心里的事——那往往会改变很多。</p></section>`);
    }
    const f = forecast(s);
    const foodWarn = s.res.food + f.food < f.eat;
    const woodWarn = s.res.wood + f.wood < f.burn;
    parts.push(`<section class="note">
  <div class="plan">
    <div><small>口粮</small><div class="seg">${segBtn(s.policy.ration === 'normal', 'ration', 'normal', '吃饱')}${segBtn(s.policy.ration === 'half', 'ration', 'half', '减半')}</div></div>
    <div><small>取暖</small><div class="seg">${segBtn(s.policy.heat === 'normal', 'heat', 'normal', '烧够')}${segBtn(s.policy.heat === 'save', 'heat', 'save', '省着烧')}</div></div>
  </div>
  ${adoptAllRow(s)}
  <p class="forecast">今天预计：吃掉 <b>${f.eat}</b> 份口粮${f.save ? `（掌勺省 ${f.save}）` : ''}，烧掉 <b>${f.burn}</b> 捆柴。${foodWarn ? '<span class="warn">粮食不够分。</span>' : ''}${woodWarn ? '<span class="warn">柴火不够烧。</span>' : ''}</p>
</section>`);
  } else if (s.phase === 'evening') {
    parts.push(reportCard(s, ui, `第${cnDay(s.day)}日 · 收工`));
  } else if (s.phase === 'night') {
    parts.push(campfire(s, ui));
  }
  const gone = s.chars.filter((c) => c.status !== 'active');
  parts.push(`<h2 class="sec">驿站里的人 · ${A.length}</h2><section class="cards">${A.map((c) => card(s, c)).join('')}${gone.map((c) => card(s, c)).join('')}</section>`);
  return parts.join('');
}

function adoptAllRow(s: GameState) {
  const diff = act(s).filter((c) => {
    const it = s.intents?.[c.id];
    return it && !it.asking && c.task !== it.task && !blocked(s, c, it.task);
  }).length;
  if (!diff) return '';
  return `<div class="adopt-all"><button class="btn" data-act="adopt-all">按大家的意思派活</button><span class="mini">${diff} 人想干的和你派的不一样。每人每天第一次被采纳，信任 +1。</span></div>`;
}

function segBtn(on: boolean, k: string, v: string, label: string) {
  return `<button aria-pressed="${on}" data-act="policy" data-k="${k}" data-v="${v}">${label}</button>`;
}

// ───────────── 营建 ─────────────

function works(s: GameState) {
  const cards = BUILD_ORDER.map((id) => {
    const b = BUILDINGS[id];
    const cost = [b.cost.mat ? `物资 ${b.cost.mat}` : '', b.cost.wood ? `柴火 ${b.cost.wood}` : ''].filter(Boolean).join(' · ');
    if (s.built.includes(id)) return `<article class="work done"><header><h3>${b.name}</h3><span>已建成</span></header><p>${b.desc}</p></article>`;
    if (b.needFlag && !s.flags[b.needFlag]) return `<article class="work locked"><header><h3>？？？</h3><span>未解锁</span></header><p>${b.lockedHint ?? ''}</p></article>`;
    if (s.project?.id === id) {
      const v = Math.min(100, (s.project.progress / b.pts) * 100);
      const builders = act(s).filter((c) => c.task === 'build' && !blocked(s, c, 'build')).map((c) => c.id);
      return `<article class="work on"><header><h3>${b.name}</h3><span>${Math.floor(s.project.progress)} / ${b.pts}</span></header><p>${b.desc}</p><div class="bar"><i style="--v:${v}%"></i></div>
      <div class="row"><span class="why">${builders.length ? `在干：${builders.map(nm).join('、')}` : '还没人去干——派人去「营建」'}</span>${s.phase === 'day' ? '<button class="btn ghost" data-act="cancel">停工（退一半料）</button>' : ''}</div></article>`;
    }
    let why = '';
    if (s.project) why = '一次只能干一个工程';
    else if ((b.cost.mat ?? 0) > s.res.mat) why = '物资不够';
    else if ((b.cost.wood ?? 0) > s.res.wood) why = '柴火不够';
    else if (s.phase !== 'day') why = '白天才能开工';
    return `<article class="work"><header><h3>${b.name}</h3><span>${cost} · 工时 ${b.pts}</span></header><p>${b.desc}</p>
    <div class="row"><span class="why">${why}</span><button class="btn ${why ? '' : 'hot'}" data-act="build" data-id="${id}" ${why ? 'disabled' : ''}>开工</button></div></article>`;
  });
  return `<p class="mini">开工时先付材料。派人去「营建」推进进度，手艺越好越快。</p><section class="works">${cards.join('')}</section>`;
}

// ───────────── 日志 ─────────────

function logView(s: GameState, ui: UI) {
  const byDay = new Map<number, typeof s.log>();
  for (const l of s.log) {
    if (!byDay.has(l.day)) byDay.set(l.day, []);
    byDay.get(l.day)!.push(l);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const secs = days.map((d) => `<section><h3>第${cnDay(d)}日</h3>${byDay.get(d)!.filter((l) => l.tone !== 'info' || byDay.get(d)!.length < 14).map((l) => `<p class="${l.tone}">${esc(l.text)}</p>`).join('')}</section>`);
  return `${ui.engine ? aiSettings(ui.engine) : ''}<section class="log">${secs.join('')}</section>
  <section class="note credits"><h3>画作与图标</h3><p class="mini">画作均来自大都会艺术博物馆开放获取（公有领域，CC0）：袁耀、刘松年、马远、马麟、刘世儒、姚彦卿、Xu Jing 以及几位佚名宋元画家笔下的雪景和梅花。人物形象用 Open Peeps（Pablo Stanley，CC0）拼成。图标来自 game-icons.net，作者 Lorc、Delapouite，按 CC BY 3.0 使用。完整清单见仓库里的 CREDITS.md。</p></section>
  <section class="note"><h3>重新开始</h3><p class="mini">这一局的进度会被清掉。</p><div class="row">${ui.confirmReset ? '<button class="btn hot" data-act="reset-yes">确定重开</button> <button class="btn ghost" data-act="reset-no">算了</button>' : '<button class="btn" data-act="reset">重开一局</button>'}</div></section>`;
}

// ───────────── AI 设置（天工引擎版） ─────────────

function aiSettings(e: EngineView) {
  const k = e.settings.kind;
  const seg = (v: EngineView['settings']['kind'], label: string, disabled = false) =>
    `<button aria-pressed="${k === v}" data-act="ai-kind" data-v="${v}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const needsForm = k === 'deepseek' || k === 'custom';
  const form = needsForm && e.settings.editing
    ? `<form class="ai-form" data-ai-form>
        ${k === 'custom' ? `<label>接口地址<input id="ai-base" name="base" value="${esc(e.settings.baseUrl)}" placeholder="https://…/v1" autocomplete="off"></label>` : ''}
        <label>模型<input id="ai-model" name="model" value="${esc(e.settings.model || (k === 'deepseek' ? 'deepseek-chat' : ''))}" autocomplete="off"></label>
        <label>API Key<input id="ai-key" name="key" type="password" placeholder="${e.settings.hasKey ? '已保存，留空则沿用' : 'sk-…'}" autocomplete="off"></label>
        <button class="btn hot">保存并连接</button>
      </form>`
    : needsForm ? '<button class="btn" data-act="ai-edit">修改接口和密钥</button>' : '';
  return `<section class="note ai-card"><h3>AI 角色由谁来演</h3>
    <p class="mini">每个角色都是天工引擎里的一个 NPC 灵魂（NpcBrain）。夜谈时，游戏通过引擎的 Intelligence 接口向这里选的 AI 要一句回答；只有格式合规的回答才会改变信任和心情。现在：<b>${esc(e.provider)}</b></p>
    <div class="seg">${seg('offline', '离线台词')}${seg('deepseek', 'DeepSeek')}${seg('custom', '其他接口')}${seg('claude', 'Claude', !e.settings.claude)}</div>
    ${form}
    <p class="mini">${k === 'offline' ? '不联网，用手写台词。' : k === 'claude' ? '只在 claude.ai 里打开时可用。' : '密钥只存在这台设备的浏览器里，只发给你填写的接口。接口需要允许浏览器直接访问（CORS）。'}</p>
  </section>`;
}

// ───────────── 行动条 ─────────────

function dock(s: GameState, ui: UI) {
  const A = act(s);
  let label = '', a = '', hint = '';
  if (s.phase === 'day') {
    label = '结束今天'; a = 'end-day';
    const idle = A.filter((c) => (blocked(s, c, c.task) ? 'rest' : c.task) === 'rest').length;
    hint = idle ? `${idle} 人在休息` : '大家都有活干';
  } else if (s.phase === 'evening') {
    label = '围炉夜话'; a = 'night'; hint = '天黑了';
  } else {
    label = '熄火入睡'; a = 'sleep';
    const guards = A.filter((c) => c.task === 'guard').map((c) => nm(c.id));
    hint = guards.length ? `守夜：${guards.join('、')}` : '今晚没人守夜';
  }
  const busy = s.pending.length > 0;
  const canBuild = !s.project && s.phase === 'day' && BUILD_ORDER.some((id) => canAfford(s, id));
  const tab = (id: UI['tab'], label: string, ic: string, badge = false) =>
    `<button role="tab" aria-selected="${ui.tab === id}" data-act="tab" data-v="${id}">${icon(ic)}<span>${label}</span>${badge ? '<i class="badge" aria-label="有可开工的工程"></i>' : ''}</button>`;
  return `<nav class="dock" aria-label="菜单"><div class="wrap">
  <div class="dock-tabs" role="tablist">${tab('people', '众人', 'nav_people')}${tab('build', '营建', 'nav_build', canBuild)}${tab('log', '日志', 'nav_log')}</div>
  <button class="go" data-act="${a}" ${busy ? 'disabled' : ''}><b>${label}</b><small>${hint}</small></button>
</div></nav>`;
}

// ───────────── 浮层 ─────────────

function eventSheet(s: GameState, ui: UI) {
  if (ui.outcome) {
    return `<div class="scrim vn" role="dialog" aria-modal="true" aria-label="${esc(ui.outcome.title)}">
      <div class="vn-bg" style="${art(lastArt)}" aria-hidden="true"></div>
      <div class="vn-stage">${lastCast}</div>
      <section class="sheet vn-box"><h2 class="vn-title">${esc(ui.outcome.title)}</h2><p class="story">${esc(ui.outcome.text)}</p>
      <div class="choices"><button class="choice" data-act="ok"><b>继续</b></button></div></section></div>`;
  }
  const cur = currentEvent(s);
  if (!cur) return '';
  const cast = cur.ev.actors.filter((id) => CHARS[id]);
  const live = (id: string) => s.chars.find((c) => c.id === id);
  lastArt = EVENT_ART[cur.ev.id] ?? 'inn';
  lastCast = cast.map((id, i) => `<figure class="${i ? 'second' : ''}" style="--c:${CHARS[id].color}">${portrait(id, live(id))}<figcaption>${CHARS[id].short}</figcaption></figure>`).join('');
  const more = s.pending.length > 1 ? `<p class="step">还有 ${s.pending.length - 1} 件事</p>` : '';
  return `<div class="scrim vn" role="dialog" aria-modal="true" aria-label="${esc(cur.title)}">
    <div class="vn-bg" style="${art(lastArt)}" aria-hidden="true"></div>
    <div class="vn-stage">${lastCast}</div>
    <section class="sheet vn-box">
      <h2 class="vn-title">${esc(cur.title)}</h2>
      <p class="story">${esc(cur.text)}</p>
      <div class="choices">${cur.choices.map((c, i) => `<button class="choice" data-act="choose" data-i="${i}" ${c.disabled ? 'disabled' : ''}><b>${esc(c.label)}</b>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('')}</div>
      ${more}
    </section>
  </div>`;
}
/** 结果页沿用刚才那件事的画和人 */
let lastArt = 'inn';
let lastCast = '';

function taskSheet(s: GameState, c: CharState) {
  const d = def(c.id);
  const rows = TASK_ORDER.map((t) => {
    const why = blocked(s, c, t);
    const risk = injuryRisk(s, c, t);
    const mood = taskMood(c, t, false);
    const extra = [
      risk ? `<small class="risk">受伤 ${Math.round(risk * 100)}%</small>` : '',
      mood < 0 ? `<small class="risk">${d.short}不太情愿</small>` : mood > 0 ? `<small>${d.short}乐意干</small>` : '',
      why && why !== '没工程' ? `<small>${why}</small>` : '',
    ].join('');
    return `<button class="task" data-act="set" data-id="${c.id}" data-v="${t}" aria-pressed="${c.task === t}" ${why ? 'disabled' : ''}>
      <b>${icon(`t_${t}`, 'big')}${TASKS[t].name}</b><div><span>${esc(preview(s, c, t))}</span>${extra}</div></button>`;
  });
  return `<div class="scrim" data-act="close"><section class="sheet" role="dialog" aria-modal="true" aria-label="给${d.short}派活" data-stop>
    <div class="sheet-head">${portrait(c.id, c, 'head')}<div><h2>给${d.short}派活</h2><p>体力 ${c.stamina} · 心情${moodWord(c.mood)} · ${(Object.keys(SKILLS) as (keyof typeof SKILLS)[]).map((k) => `${SKILLS[k]}${lvl(c, k)}`).join(' ')}</p></div><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <div class="tasks">${rows.join('')}</div>
  </section></div>`;
}

const LOD_TEXT = {
  spotlight: ['聚光', '正在和你说话。每一帧都在感知，回答时用的是最新的状态。'],
  ambient: ['在场', '在营地里。每两秒感知一次周围。'],
  offstage: ['离场', '已经不在营地，不再感知。'],
} as const;

function soulPanel(e: EngineView, c: CharState) {
  const soul = e.souls.find((x) => x.soulId === `hanyi.${c.id}`);
  if (!soul) return '';
  const [word, explain] = LOD_TEXT[soul.lod];
  const p = soul.perception;
  const chips = soul.affordances.map((a) => `<span class="chip ${a.kind === 'secret' ? 'warn' : ''}">${esc(a.label)}</span>`).join('');
  const session = e.sessions[c.id];
  return `<div class="kv soul"><h3>天工引擎 · NPC 灵魂</h3>
    <p class="soul-id"><code>${esc(soul.soulId)}</code><span class="chip ${soul.lod === 'spotlight' ? 'good' : soul.lod === 'offstage' ? 'bad' : ''}">认知层级：${word}</span></p>
    <p class="mini">${explain}已感知 ${soul.samples} 次${Number.isFinite(soul.age) ? `，上次在 ${soul.age.toFixed(1)} 秒前` : ''}。${session ? `对话会话 <code>${esc(session.slice(0, 18))}</code>。` : ''}</p>
    ${p ? `<dl class="perceive"><dt>身体</dt><dd>${esc(p.body)}</dd><dt>心里</dt><dd>${esc(p.heart)}</dd><dt>关系</dt><dd>${esc(p.ties)}</dd>${p.recent.length ? `<dt>记得</dt><dd>${p.recent.map((r) => esc(r)).join('<br>')}</dd>` : ''}</dl>` : ''}
    <div class="soul-aff"><small>能做的事</small><div>${chips}</div></div>
  </div>`;
}

function personSheet(s: GameState, c: CharState, ui?: UI) {
  const d = def(c.id);
  const heard = !!s.flags[`heard_${c.id}`];
  const others = s.chars.filter((o) => o.id !== c.id && o.status === 'active');
  const rels = others.map((o) => {
    const r = rel(s, c.id, o.id);
    const w = Math.abs(r) / 2;
    const style = r >= 0 ? `left:50%;width:${w}%;background:var(--good)` : `right:50%;width:${w}%;background:var(--bad)`;
    return `<div class="rel"><span>${nm(o.id)}</span><span class="track"><i style="${style}"></i></span><span>${relWord(r)}</span></div>`;
  });
  const talkBtn = s.phase === 'night' && c.status === 'active' ? `<button class="btn hot" data-act="chat" data-id="${c.id}">说说话</button>` : '';
  return `<div class="scrim" data-act="close"><section class="sheet person-sheet" role="dialog" aria-modal="true" aria-label="${d.name}" data-stop>
    <div class="hero" style="${art(CHAR_ART[c.id] ?? 'inn')}" aria-hidden="true">${portrait(c.id, c, 'hero-pt')}</div>
    <div class="sheet-head hero-head"><div><h2>${d.name}${d.short !== d.name ? ` · ${d.short}` : ''}</h2><p>${d.age} 岁 · ${d.job} · 对你${trustWord(c.trust)}（${c.trust}）</p></div><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <p class="bio">${d.bio}</p>
    ${s.phase === 'day' && s.intents?.[c.id] && !s.intents[c.id].asking ? `<p class="mini">今天想去${TASKS[s.intents[c.id].task].name}：「${esc(s.intents[c.id].say)}」${s.intents[c.id].by === 'ai' ? '（AI 按人设想的）' : '（按性子推的）'}</p>` : ''}
    ${heard ? `<div class="kv"><h3>${d.gender === 'f' ? '她' : '他'}对你说过的心事</h3><p class="secret">${d.secret}</p></div>` : ''}
    <div class="kv"><h3>性子</h3><div class="traits">${d.traits.map((t) => `<div><b>${TRAITS[t].name}</b>${TRAITS[t].desc}</div>`).join('')}</div></div>
    <div class="kv"><h3>本事</h3><div class="skills">${(Object.keys(SKILLS) as (keyof typeof SKILLS)[]).map((k) => `<div><small>${SKILLS[k]}</small><b>${lvl(c, k)}</b></div>`).join('')}</div></div>
    ${rels.length ? `<div class="kv"><h3>和大家的关系</h3><div class="rels">${rels.join('')}</div></div>` : ''}
    ${ui?.engine ? soulPanel(ui.engine, c) : ''}
    ${talkBtn}
  </section></div>`;
}

function chatSheet(s: GameState, ui: UI, c: CharState) {
  const d = def(c.id);
  const log = s.chat[c.id] ?? [];
  const left = MAX_TALKS - c.talks;
  const thinking = ui.thinking === c.id;
  const bubbles = log.map((m) => `<p class="bubble ${m.from}">${esc(m.text)}</p>`);
  const streamed = ui.engine?.stream?.id === c.id ? ui.engine.stream.text : '';
  if (thinking) bubbles.push(streamed ? `<p class="bubble them">${esc(streamed)}</p>` : `<p class="bubble them wait">${d.short}想了想……</p>`);
  if (!log.length && !thinking) bubbles.push(`<p class="bubble them wait">${esc(opening(s, c))}</p>`);
  const disabled = left <= 0 || thinking || !!ui.thinking;
  const topics = TOPICS.map((t) => `<button data-act="topic" data-id="${c.id}" data-v="${t.id}" ${disabled ? 'disabled' : ''}>${t.label.replace('TA', d.gender === 'f' ? '她' : '他')}</button>`).join('');
  const input = ui.ai
    ? `<form class="say" data-id="${c.id}"><input id="say-${c.id}" name="say" maxlength="120" autocomplete="off" placeholder="${left > 0 ? `想对${d.short}说什么？` : '夜深了'}" ${disabled ? 'disabled' : ''}><button class="btn hot" ${disabled ? 'disabled' : ''}>说</button></form>`
    : '';
  return `<div class="scrim vn chat-vn" data-act="close" role="dialog" aria-modal="true" aria-label="和${d.short}说话">
    <div class="vn-bg night" style="${art('moonplum')}" aria-hidden="true"></div>
    <div class="vn-stage"><figure style="--c:${d.color}">${portrait(c.id, c)}</figure></div>
    <section class="sheet vn-box chat-box" data-stop>
    <div class="sheet-head chat-head"><div><h2 class="vn-title">${d.short}</h2><p>心情${moodWord(c.mood)} · 对你${trustWord(c.trust)}（${c.trust}）</p></div><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <div class="chat" id="chatlog">${bubbles.join('')}</div>
    <div class="topics">${topics}</div>
    ${input}
    <p class="mini ${ui.aiNote ? 'err' : ''}">${ui.aiNote ? esc(ui.aiNote) : left > 0 ? `今晚还能聊 ${left} 句。` : `${d.short}打了个哈欠。明晚再聊吧。`}</p>
  </section></div>`;
}

function opening(s: GameState, c: CharState) {
  const d = def(c.id);
  if (has(c, 'mute')) return `（${d.short}抬头看了你一眼，往旁边挪了挪，给你让出一块烤火的地方。）`;
  if (c.mood < 30) return `（${d.short}抱着膝盖坐在火边，没有看你。）`;
  if (c.trust >= 60) return `（${d.short}朝你点点头，往火里添了根柴。）`;
  return `（${d.short}正盯着火苗出神。）`;
}

function overlay(s: GameState, ui: UI) {
  const ev = eventSheet(s, ui);
  if (ev) return ev;
  if (!ui.sheet) return '';
  const c = s.chars.find((x) => x.id === ui.sheet!.id);
  if (!c) return '';
  if (ui.sheet.kind === 'task' && s.phase === 'day' && c.status === 'active') return taskSheet(s, c);
  if (ui.sheet.kind === 'chat' && s.phase === 'night' && c.status === 'active') return chatSheet(s, ui, c);
  if (ui.sheet.kind === 'person') return personSheet(s, c, ui);
  return '';
}

export function gameScreen(s: GameState, ui: UI) {
  const body = ui.tab === 'people' ? people(s, ui) : ui.tab === 'build' ? works(s) : logView(s, ui);
  return `${hud(s)}<main><div class="wrap">${body}</div></main>${dock(s, ui)}${overlay(s, ui)}`;
}

export function hasOverlay(s: GameState, ui: UI) {
  return !!(ui.outcome || s.pending.length || ui.sheet);
}

// ───────────── 结局 ─────────────

const RESCUE: Record<string, (s: GameState) => string> = {
  road: (s) => `第${cnDay(s.day)}日清晨，山下传来了铲雪车的轰鸣。路，终于通了。`,
  sms: (s) => `阿杰发出的那条短信，救援中心收到了。第${cnDay(s.day)}日，雪地车开上了山，车灯照亮了驿站的门。`,
  lin: (s) => `第${cnDay(s.day)}日，雪地车开上了山。走在救援队最前面的，是林晚。她一路喊着每个人的名字。`,
  radio: (s) => `电台那头的人说话算话。第${cnDay(s.day)}日，雪地车的灯光穿过风雪，停在了驿站门口。`,
  phone: (s) => `第${cnDay(s.day)}日，直升机的螺旋桨声撕开了云层。那部卫星电话，把大家带回了人间。`,
};

export function endingScreen(s: GameState) {
  const wiped = s.ending?.kind === 'wiped';
  const ids = s.chars.map((c) => c.id);
  const saved = ids.filter((id) => isPresentAtEnd(s, id)).length;
  const arcs = ids.filter((id) => s.flags[def(id).arcFlag]).length;
  const story = wiped
    ? `第${cnDay(s.day)}日，驿站的火熄灭了。开春后，护林队在屋里找到了一本日志，最后一页写着每个人的名字。`
    : RESCUE[s.rescueBy]?.(s) ?? RESCUE.road(s);
  const fates = s.chars.map((c) => {
    const f = fate(s, c.id);
    const tag = { good: '<span class="chip good">平安下山</span>', ok: '<span class="chip">平安下山</span>', dead: '<span class="chip bad">长眠于此</span>', left: '<span class="chip warn">下落不明</span>' }[f.kind];
    const d = def(c.id);
    return `<li class="${f.kind === 'dead' || f.kind === 'left' ? 'gone' : ''}" style="--c:${d.color}">${portrait(c.id, c)}<div><div class="p-head"><b>${d.name}</b>${tag}${s.flags[d.arcFlag] ? '<span class="chip">心结已解</span>' : ''}</div><p>${f.text}</p></div></li>`;
  });
  return `<section class="ending"><div class="title-art ending-art ${wiped ? 'wiped' : ''}" aria-hidden="true"></div><div class="wrap">
    <h1>${wiped ? '火熄了' : '救援到了'}</h1>
    <p class="story">${story}</p>
    <div class="tally"><div><small>坚持</small><b>${s.day} 天</b></div><div><small>活着下山</small><b>${saved} / ${ids.length}</b></div><div><small>解开心结</small><b>${arcs} 人</b></div></div>
    <ul class="fates">${fates.join('')}</ul>
    <div class="row"><button class="go" data-act="new">再来一局</button></div>
  </div></section>`;
}
