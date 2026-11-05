// 界面：纯函数，把游戏状态画成 HTML 字符串。交互由 main.ts 用 data-act 统一处理。

import { CharState, GameState, TaskId } from '../hanyi/core/types';
import {
  act, cnDay, def, eats, has, heatNeed, insulation, lvl, moodWord, nm, rel, relWord, ta, trustWord,
} from '../hanyi/core/world';
import { CHARS, CHAR_ORDER } from '../hanyi/data/characters';
import { BUILDINGS, BUILD_ORDER, LAST_DAY, SKILLS, TASKS, TASK_ORDER, TRAITS } from '../hanyi/data/rules';
import { fate, isPresentAtEnd } from '../hanyi/systems/camp';
import { currentEvent } from '../hanyi/systems/story';
import {
  blocked, buildOut, cookSave, cookScore, huntOut, injuryRisk, preview, scavOut, taskMood, woodOut,
} from '../hanyi/systems/work';
import { canSit, knownTaste, MAX_TALKS, satWith, seats, TOPICS } from '../hanyi/ai/dialogue';
import { todayText } from '../hanyi/data/situations';
import {
  ACH_BONUS, ACHS, albumCount, FATE_WORD, fateKinds, type Meta, nextPerk, PERKS, perkOpen, type RunResult, scoreRun,
  WINTER_NAME, winterDesc, winterOpen, WINTERS,
} from '../hanyi/meta';
import { memoriesOf } from '../hanyi/ai/memory';
import { PAIR_STORIES } from '../hanyi/data/events-story';
import { progress, STORIES } from '../hanyi/data/stories';
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
  tab: 'people' | 'build' | 'heart' | 'log';
  sheet: null | { kind: 'task' | 'person' | 'chat' | 'info' | 'end'; id: string };
  outcome: null | { title: string; text: string };
  confirmReset: boolean;
  thinking: string | null;
  aiNote: string | null;
  reportOpen: boolean;
  ai: boolean;
  hasSave: boolean;
  /** 已经看过的教学提示 */
  tips?: string[];
  /** 声音开着没有 */
  sound?: boolean;
  /** 上次打开「人心」页时，大家的故事一共走到了第几章（有新章节时菜单上亮红点） */
  heartSeen?: number;
  engine?: EngineView;
  /** 局外成长：薪火、图鉴、成就（存在宿主那里） */
  meta?: Meta;
  /** 标题页：正在挑寒冬和行囊 / 正在看图鉴 */
  setup?: boolean;
  album?: boolean;
  pick?: { winter: number; perk: string };
  /** 刚结束那一局的成绩单 */
  lastRun?: RunResult;
}

export const esc = (t: unknown) =>
  String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 心情决定表情：好 / 平常 / 低落 */
const moodTier = (c?: CharState) => (!c || c.status !== 'active' ? 1 : c.mood >= 60 ? 0 : c.mood >= 30 ? 1 : 2);
/** 人物形象（手绘像素画），样式类由 art.css 提供 */
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
  const m = ui.meta;
  const body = m && ui.album ? albumView(m) : m && ui.setup ? setupView(ui, m) : titleBody(ui);
  return `<section class="title">
  <div class="title-art" aria-hidden="true"></div>
  <canvas class="snowfx title-snow" data-snow="title" data-n="70" aria-hidden="true"></canvas>
  ${soundBtn(ui, 'title-snd')}
  <div class="wrap ${m && (ui.album || ui.setup) ? 'menu' : ''}">${body}</div>
</section>`;
}

function titleBody(ui: UI) {
  const m = ui.meta;
  const veteran = !!m && m.runs > 0;
  const start = veteran ? 'setup' : 'new';
  return `
    <h1>寒驿<span>二十个冬夜</span></h1>
    <p class="story">寒潮来得毫无征兆。客车在山道上抛锚，五个陌生人躲进了半山腰一座废弃的驿站。广播里最后一条消息说：大雪封山，道路至少二十天才能打通。<br><br>你成了那个拿主意的人。</p>
    <div class="cast" aria-label="驿站里的人">${CHAR_ORDER.map((id) => (CHARS[id].starter || (m && metChar(m, id))
      ? `<figure>${portrait(id)}<figcaption>${CHARS[id].short}</figcaption></figure>`
      : '<figure class="unknown"><i class="pt pt-unknown-0" aria-hidden="true"></i><figcaption>？</figcaption></figure>')).join('')}</div>
    ${veteran ? metaStrip(m!) : ''}
    <div class="row">
      ${ui.hasSave ? `<button class="go" data-act="continue">继续</button><button class="btn ghost" data-act="${start}">新的一局</button>` : `<button class="go" data-act="${start}">${veteran ? '再推开一次门' : '推开驿站的门'}</button>`}
      ${veteran ? '<button class="btn ghost" data-act="album">图鉴</button>' : ''}
    </div>
    <p class="mini">白天给每个人派活：砍柴取暖、打猎果腹、搜寻物资、营建驿站。夜里围着火，和他们说说话。信任，会让他们说出藏在心里的事。${ui.ai ? '<br>夜谈由 Claude 即兴扮演每个角色，你可以说任何话。' : ''}</p>
    <p class="art-credit">画：清 · 袁耀，雪山中的客栈与旅人（1745），大都会艺术博物馆藏</p>`;
}

const metChar = (m: Meta, id: string) => m.fates.some((f) => f.startsWith(id + ':'));

/** 下一样行囊还差多少薪火 */
function nextBar(m: Meta) {
  const n = nextPerk(m);
  if (!n) return '<p class="next-perk">行囊全部解锁了。试试更冷的寒冬。</p>';
  const prev = PERKS.filter((p) => p.need <= m.ember).reduce((t, p) => Math.max(t, p.need), 0);
  const pct = Math.round(((m.ember - prev) / (n.need - prev)) * 100);
  return `<div class="next-perk"><p>再攒 <b>${n.need - m.ember}</b> 薪火，解锁「${n.name}」：${n.desc}</p><div class="bar-track"><i style="width:${pct}%"></i></div></div>`;
}

function metaStrip(m: Meta) {
  const a = albumCount(m);
  return `<div class="meta-strip">
    <div><small>薪火</small><b>${m.ember}</b></div>
    <div><small>最好成绩</small><b>${m.best}</b></div>
    <div><small>最冷通关</small><b>${m.cleared ? `${m.cleared} 级` : '—'}</b></div>
    <div><small>图鉴</small><b>${a.pct}%</b></div>
  </div>${nextBar(m)}`;
}

function setupView(ui: UI, m: Meta) {
  const pick = ui.pick ?? { winter: 1, perk: '' };
  const wins = WINTERS.map((w) => {
    const open = winterOpen(m, w);
    return `<button class="win ${pick.winter === w ? 'on' : ''}" data-act="winter" data-v="${w}" ${open ? '' : 'disabled'} aria-pressed="${pick.winter === w}"><b>${w}</b><small>${open ? WINTER_NAME[w] : '未解锁'}</small></button>`;
  }).join('');
  const perks = PERKS.map((p) => {
    const open = perkOpen(m, p.id);
    return `<button class="perk ${pick.perk === p.id ? 'on' : ''} ${open ? '' : 'locked'}" data-act="perk" data-v="${p.id}" ${open ? '' : 'disabled'} aria-pressed="${pick.perk === p.id}"><b>${p.name}</b><small>${open ? p.desc : `薪火 ${p.need} 解锁 · ${p.desc}`}</small></button>`;
  }).join('');
  return `<p class="setup-h">出发之前</p>
    <h2 class="sec">寒冬 · 越冷得分越高</h2>
    <div class="winters">${wins}</div>
    <p class="mini">${winterDesc(pick.winter)}${winterOpen(m, pick.winter + 1) || pick.winter >= WINTERS.length ? '' : ` 在这一级获救，就能解锁 ${pick.winter + 1} 级。`}</p>
    <h2 class="sec">行囊 · 带一样东西上路</h2>
    <div class="perks">${perks}</div>
    ${nextBar(m)}
    <div class="row"><button class="go" data-act="new">出发</button><button class="btn ghost" data-act="back">返回</button></div>`;
}

function albumView(m: Meta) {
  const a = albumCount(m);
  const fates = CHAR_ORDER.map((id) => {
    const d = CHARS[id];
    const met = metChar(m, id);
    const chips = fateKinds(id).map((k) => (m.fates.includes(`${id}:${k}`) ? `<span class="chip ${k === 'good' ? 'good' : k === 'dead' ? 'bad' : k === 'left' ? 'warn' : ''}">${FATE_WORD[k]}</span>` : '<span class="chip unseen">？？？</span>')).join('');
    const ch = STORIES[id] ?? [];
    const got = m.chapters[id] ?? 0;
    const path = ch.map((c, i) => (i < got ? `<span class="got">${esc(c.title)}</span>` : '<span>？？？</span>')).join(' → ');
    return `<li style="--c:${d.color}">${met ? portrait(id) : '<i class="pt pt-unknown-0" aria-hidden="true"></i>'}<div><b>${met ? d.short : '？'}</b><div class="chips">${chips}</div><p class="path">心路：${path}</p></div></li>`;
  }).join('');
  const achs = ACHS.map((x) => `<li class="${m.ach.includes(x.id) ? 'got' : ''}"><b>${x.name}</b><small>${x.desc}</small></li>`).join('');
  return `<p class="setup-h">图鉴 · ${a.pct}%</p>
    <div class="album-parts">${a.parts.map((p) => `<div><small>${p.label}</small><b>${p.have}/${p.all}</b></div>`).join('')}</div>
    <p class="mini">玩了 ${m.runs} 局，获救 ${m.wins} 局。每个新成就额外 +${ACH_BONUS} 薪火。</p>
    <h2 class="sec">每个人的结局和心路</h2>
    <ul class="album-fates">${fates}</ul>
    <h2 class="sec">成就</h2>
    <ul class="achs">${achs}</ul>
    <div class="row"><button class="btn ghost" data-act="back">返回</button></div>`;
}

/** 标题页上的局外操作（两个宿主共用）；处理了返回 true */
export function metaAct(ui: UI, a: string, v: string) {
  const m = ui.meta;
  if (!m) return false;
  ui.pick ??= m.last ? { ...m.last } : { winter: 1, perk: '' };
  if (a === 'setup') { Object.assign(ui, { screen: 'title', setup: true, album: false }); if (!winterOpen(m, ui.pick.winter)) ui.pick.winter = 1; return true; }
  if (a === 'album') { Object.assign(ui, { screen: 'title', album: true, setup: false }); return true; }
  if (a === 'back') { Object.assign(ui, { setup: false, album: false }); return true; }
  if (a === 'winter') { if (winterOpen(m, Number(v))) ui.pick.winter = Number(v); return true; }
  if (a === 'perk') { if (perkOpen(m, v)) ui.pick.perk = ui.pick.perk === v ? '' : v; return true; }
  return false;
}

/** 这一局的成绩单：分数、评级、薪火、解锁、新成就、图鉴新增 */
function runCard(s: GameState, ui: UI) {
  const r = ui.lastRun;
  const sc = r?.score ?? scoreRun(s);
  const m = ui.meta;
  return `<section class="run">
    <div class="run-head"><div class="grade g-${sc.grade}">${sc.grade}</div><div><b>${sc.total}</b><small>分${r?.best ? ' · 新纪录！' : ''}${s.winter && s.winter > 1 ? ` · 寒冬 ${s.winter} 级` : ''}</small></div></div>
    <ul class="run-lines">${sc.lines.map((l) => `<li><span>${esc(l.label)}</span><b>+${l.pts}</b></li>`).join('')}</ul>
    ${r ? `<p class="run-ember">薪火 <b>+${r.gained}</b>${m ? `，一共 ${m.ember}` : ''}</p>` : ''}
    ${r?.ach.length ? `<ul class="run-new">${r.ach.map((a) => `<li class="ach">成就「${a.name}」<small>${a.desc} +${ACH_BONUS} 薪火</small></li>`).join('')}</ul>` : ''}
    ${r?.unlocks.length ? `<ul class="run-new">${r.unlocks.map((u) => `<li class="unlock">解锁了${esc(u)}</li>`).join('')}</ul>` : ''}
    ${r?.fresh.length ? `<p class="mini">图鉴新增 ${r.fresh.length} 条：${r.fresh.slice(0, 4).map(esc).join('、')}${r.fresh.length > 4 ? '……' : ''}</p>` : ''}
    ${m ? nextBar(m) : ''}
  </section>`;
}

// ───────────── 日头 ─────────────

const WEATHER = { clear: '晴', snow: '小雪', blizzard: '暴风雪' };
const temp = (t: number) => `${t < 0 ? '−' : ''}${Math.abs(t)}℃`;

const SNOW = { clear: { n: 6, wind: 0 }, snow: { n: 45, wind: 0.4 }, blizzard: { n: 120, wind: 2.2 } };
const snowCanvas = (key: string, s: GameState, k = 1) => {
  const w = SNOW[s.weather.kind];
  return `<canvas class="snowfx" data-snow="${key}" data-n="${Math.round(w.n * k)}" data-wind="${w.wind}" aria-hidden="true"></canvas>`;
};

/** 过场大字卡上的字：第几日、天气 */
export function dayCard(s: GameState) {
  const left = LAST_DAY - s.day;
  return { title: `第${cnDay(s.day)}日`, sub: `${WEATHER[s.weather.kind]} ${temp(s.temp)}${s.rescueBy === 'road' && left > 0 && left <= 3 ? ` · 离开路还有${cnDay(left)}天` : ''}` };
}

function soundBtn(ui: UI, cls = '') {
  if (ui.sound === undefined) return '';
  return `<button class="snd ${cls}" data-act="sound" aria-pressed="${ui.sound}" aria-label="${ui.sound ? '关掉声音' : '打开声音'}">${icon(ui.sound ? 'sound' : 'mute')}</button>`;
}

function hud(s: GameState, ui: UI) {
  const f = forecast(s);
  const day = s.phase === 'day';
  const cap = (k: 'food' | 'wood' | 'mat' | 'med', label: string, inc: number, out: number) => {
    const v = s.res[k];
    const net = inc - out;
    const short = day && out > 0 && v + inc < out;
    const delta = day && (inc || out) ? `<i class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${net > 0 ? '+' : ''}${net}</i>` : '';
    // 照每天的消耗，家底还够几天
    const use = k === 'food' ? f.eat : k === 'wood' ? f.burn : 0;
    const days = use ? Math.floor(v / use) : -1;
    const left = days >= 0 ? `<em class="${days <= 2 ? 'low' : ''}">够${days}天</em>` : '';
    return `<button class="cap ${short || (days >= 0 && days <= 1) ? 'short' : ''}" data-act="info" data-v="${k}" data-res="${k}" aria-label="${label} ${v}${days >= 0 ? `，够${days}天` : ''}，点开看说明">${icon(k)}<b>${v}</b>${delta}<small>${label}${left}</small></button>`;
  };
  const rescue = s.rescueBy !== 'road' ? `救援约 ${Math.max(0, s.rescueDay - s.day)} 日后到` : `撑到开路 · 约${cnDay(LAST_DAY)}日`;
  return `<header class="hud" data-phase="${s.phase}"><div class="hud-art" aria-hidden="true"></div>${snowCanvas('hud', s)}<div class="wrap">
  <div class="hud-top">
    <div class="hud-day"><b>第${cnDay(s.day)}日${soundBtn(ui)}</b><span>${PHASE_WORD[s.phase]} · ${rescue}${s.winter && s.winter > 1 ? ` · 寒冬${s.winter}级` : ''}</span></div>
    <button class="hud-sky" data-act="info" data-v="heat" aria-label="天气和保暖，点开看说明"><strong class="${s.weather.kind === 'blizzard' ? 'storm' : ''}">${icon(`w_${s.weather.kind}`)}${WEATHER[s.weather.kind]} ${temp(s.temp)}</strong><span>保暖 ${insulation(s)} 级 · 每日烧柴 ${f.burn} 捆</span></button>
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
    return `<article class="card gone" data-id="${c.id}" style="--c:${d.color}">
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
    const sat = satWith(s).includes(c.id);
    const free = canSit(s, c.id);
    if (wants) {
      bubble = '<span class="say-bubble want">有话想说</span>';
      say = `<div class="card-say"><p>${esc(want.reason)}。${free ? '' : '今晚没等到你，会寒心。'}</p></div>`;
    }
    const small = !free ? '今晚顾不上了' : sat ? (left ? `还能说 ${left} 句` : '夜深了') : wants ? '没人陪，会寒心' : '今晚陪他坐坐';
    action = `<button class="task-btn talk ${free && left ? '' : 'done'} ${wants && free ? 'want' : ''}" data-act="chat" data-id="${c.id}">${icon('talk')}<b>${sat ? '接着聊' : wants ? '听听' + (d.gender === 'f' ? '她' : '他') + '说' : '坐过去'}</b><small>${small.replace('他', d.gender === 'f' ? '她' : '他')}</small></button>`;
  } else {
    action = `<div class="task-btn static">${icon(`t_${c.task}`)}<b>${TASKS[c.task].name}</b><small>今天的活</small></div>`;
  }
  return `<article class="card" data-id="${c.id}" style="--c:${d.color}">
  <button class="card-face" data-act="person" data-id="${c.id}" aria-label="查看${d.short}">
    ${portrait(c.id, c)}
    <span class="card-tags">${tags(c)}</span>
    ${bubble}
  </button>
  <div class="card-body">
    <div class="card-name"><b>${d.short}</b><span>${d.age} · ${d.job}</span></div>
    <button class="card-bars" data-act="info" data-v="body" aria-label="健康 ${c.health}，体力 ${c.stamina}，心情${moodWord(c.mood)}，点开看说明">${bar('h', '健康', c.health)}${bar('s', '体力', c.stamina)}${bar('m', '心情', c.mood, moodWord(c.mood))}</button>
    ${say}
    ${action}
  </div>
</article>`;
}

/** 驿站场景：一幅会动的像素剖面图，由 fx.ts 每帧画进 canvas（scene.ts）。点画里的人和点卡片一样。 */
function scenePanel(s: GameState) {
  const A = act(s);
  const what = s.phase === 'day'
    ? A.map((c) => `${nm(c.id)}${TASKS[blocked(s, c, c.task) ? 'rest' : c.task].name}`).join('，')
    : `${A.map((c) => nm(c.id)).join('、')}围坐在火边`;
  const hint = s.phase === 'day' ? '点画里的人给他派活' : s.phase === 'night' ? '点火边的人和他说说话' : '点画里的人看看他';
  return `<div class="scene-box" data-phase="${s.phase}"><canvas class="scene" data-scene role="img" aria-label="驿站里：${esc(what)}。${hint}。"></canvas><p class="scene-hint">${hint}</p></div>`;
}

/** 围炉：火边的闲话；每句旁边是说话人的脸 */
function campfire(s: GameState, ui: UI) {
  const A = act(s);
  const lines = s.ambient.length ? s.ambient : ['火噼啪地响着。'];
  const faces = (line: string) => A.filter((c) => line.includes(nm(c.id))).slice(0, 2).map((c) => portrait(c.id, c, 'mini')).join('');
  return `<section class="campfire" data-phase="${s.phase}"><div class="campfire-art" aria-hidden="true"></div>
  <div class="lines">${lines.map((l) => `<p class="${l.includes('\n') ? 'talkline' : ''}"><span class="faces">${faces(l)}</span><span class="text">${esc(l)}</span></p>`).join('')}</div>
  <p class="ai">${nightRule(s)}${ui.engine ? ` 天工引擎 · 由「${esc(ui.engine.provider)}」来演。` : ui.ai ? ' 夜谈由 Claude 即兴扮演。' : ''}</p>
</section>`;
}

/** 今晚能陪几个人 */
function nightRule(s: GameState) {
  const n = seats(s), used = satWith(s).length;
  return used >= n ? '今晚顾不上别人了。' : `今晚还能陪 ${n - used} 个人坐坐${n > 1 ? '（火塘砌好了，多陪一个）' : ''}，每人说两句。`;
}

/** 今日情况：一件让今天和昨天不一样的事 */
function todayCard(s: GameState) {
  const t = todayText(s);
  return t ? `<section class="note today"><h3>${icon('warn')}${esc(t.title)}</h3><p>${esc(t.text)}</p></section>` : '';
}

/** 收成和发生的事：先给三条要紧的，坏消息在前 */
function reportCard(s: GameState, ui: UI, title: string) {
  if (!s.report.length) return '';
  const rank = { bad: 0, story: 1, good: 2, info: 3 } as const;
  const lines = s.report.slice().sort((a, b) => rank[a.tone] - rank[b.tone]);
  const show = ui.reportOpen ? lines : lines.slice(0, 3);
  const more = lines.length > 3 ? `<button data-act="report">${ui.reportOpen ? '收起' : `全部 ${lines.length} 条`}</button>` : '';
  return `<section class="note"><h3>${title}${more}</h3><ul>${show.map((l) => `<li class="${l.tone}">${esc(l.text)}</li>`).join('')}</ul></section>`;
}

function people(s: GameState, ui: UI) {
  const parts: string[] = [scenePanel(s)];
  const A = act(s);
  if (s.phase === 'day') {
    parts.push(todayCard(s));
    if (s.day > 1) parts.push(reportCard(s, ui, '昨夜'));
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
    parts.push(reportCard(s, ui, `第${cnDay(s.day)}日 · 收工`));
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
  const settings = `<section class="note settings"><h3>设置</h3><div class="row">${ui.sound !== undefined ? `<button class="btn" data-act="sound">${icon(ui.sound ? 'sound' : 'mute')}${ui.sound ? '声音：开' : '声音：关'}</button>` : ''}<button class="btn" data-act="tip-reset">重新看一遍教学</button></div></section>`;
  return `${settings}${ui.engine ? aiSettings(ui.engine) : ''}<section class="log">${secs.join('')}</section>
  <section class="note credits"><h3>素材</h3><p class="mini">画作均来自大都会艺术博物馆开放获取（公有领域，CC0）：袁耀、刘松年、马远、马麟、刘世儒、姚彦卿、Xu Jing 以及几位佚名宋元画家笔下的雪景和梅花。画作缩成了像素画；人物的像素像是这个游戏自己画的。人物、驿站场景、图标和音乐都是这个游戏自己画、自己合成的。完整清单见仓库里的 CREDITS.md。</p></section>
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
  let risky = false;
  if (s.phase === 'day') {
    label = '结束今天'; a = 'end-day';
    const idle = A.filter((c) => (blocked(s, c, c.task) ? 'rest' : c.task) === 'rest').length;
    hint = idle ? `${idle} 人在休息` : '大家都有活干';
    const r = risks(s).filter((x) => x.level !== 'info');
    if (r.length) {
      risky = true;
      a = 'end-check';
      hint = `${icon('warn')}${r[0].short}${r.length > 1 ? ` 等 ${r.length} 件` : ''}`;
    }
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
    `<button role="tab" aria-selected="${ui.tab === id}" data-act="tab" data-v="${id}">${icon(ic)}<span>${label}</span>${badge ? `<i class="badge" aria-label="${id === 'build' ? '有可开工的工程' : '有新的故事'}"></i>` : ''}</button>`;
  return `<nav class="dock" aria-label="菜单"><div class="wrap">
  <div class="dock-tabs" role="tablist">${tab('people', '众人', 'nav_people')}${tab('build', '营建', 'nav_build', canBuild)}${tab('heart', '人心', 'heart', storyTotal(s) > (ui.heartSeen ?? 0))}${tab('log', '日志', 'nav_log')}</div>
  <button class="go ${risky ? 'risky' : ''}" data-act="${a}" ${busy ? 'disabled' : ''}><b>${label}</b><small>${hint}</small></button>
</div></nav>`;
}

// ───────────── 浮层 ─────────────

function eventSheet(s: GameState, ui: UI) {
  if (ui.outcome) {
    return `<div class="scrim vn" role="dialog" aria-modal="true" aria-label="${esc(ui.outcome.title)}">
      <div class="vn-bg" style="${art(lastArt)}" aria-hidden="true"></div>${snowCanvas('vn', s, 0.7)}
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
    <div class="vn-bg" style="${art(lastArt)}" aria-hidden="true"></div>${snowCanvas('vn', s, 0.7)}
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
    <div class="kv"><h3>心路</h3>${pathList(s, c.id)}</div>
    ${memoryList(s, c.id)}
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
  const free = canSit(s, c.id);
  const disabled = !free || left <= 0 || thinking || !!ui.thinking;
  // 上次这样聊时他的反应：摸清了脾气，就知道该怎么聊
  const MARK = { like: ['like', '♥'], meh: ['', ''], dislike: ['dislike', '✕'] } as const;
  const topics = TOPICS.map((t) => {
    const k = knownTaste(s, c.id, t.id);
    const [cls, mk] = k ? MARK[k] : ['', ''];
    return `<button class="${cls}" data-act="topic" data-id="${c.id}" data-v="${t.id}" ${disabled ? 'disabled' : ''}>${t.label.replace('TA', d.gender === 'f' ? '她' : '他')}${mk ? `<i aria-label="${cls === 'like' ? '上次很受用' : '上次不吃这套'}">${mk}</i>` : ''}</button>`;
  }).join('');
  const input = ui.ai
    ? `<form class="say" data-id="${c.id}"><input id="say-${c.id}" name="say" maxlength="120" autocomplete="off" placeholder="${left > 0 ? `想对${d.short}说什么？` : '夜深了'}" ${disabled ? 'disabled' : ''}><button class="btn hot" ${disabled ? 'disabled' : ''}>说</button></form>`
    : '';
  return `<div class="scrim vn chat-vn" data-act="close" role="dialog" aria-modal="true" aria-label="和${d.short}说话">
    <div class="vn-bg night" style="${art('moonplum')}" aria-hidden="true"></div>${snowCanvas('chat', s, 0.5)}
    <div class="vn-stage"><figure style="--c:${d.color}">${portrait(c.id, c)}</figure></div>
    <section class="sheet vn-box chat-box" data-stop>
    <div class="sheet-head chat-head"><div><h2 class="vn-title">${d.short}</h2><p>心情${moodWord(c.mood)} · 对你${trustWord(c.trust)}（${c.trust}）</p></div><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <div class="chat" id="chatlog">${bubbles.join('')}</div>
    <div class="topics">${topics}</div>
    ${input}
    <p class="mini ${ui.aiNote ? 'err' : ''}">${ui.aiNote ? esc(ui.aiNote) : !free ? `今晚你陪着${satWith(s).map(nm).join('、')}，顾不上${d.short}了。` : left > 0 ? `今晚还能说 ${left} 句。♥ 是${d.short}吃这一套，✕ 是不吃。` : `${d.short}打了个哈欠。明晚再聊吧。`}</p>
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
  if (ui.sheet.kind === 'info') return infoSheet(s, ui.sheet.id);
  if (ui.sheet.kind === 'end') return s.phase === 'day' ? endSheet(s) : '';
  const c = s.chars.find((x) => x.id === ui.sheet!.id);
  if (!c) return '';
  if (ui.sheet.kind === 'task' && s.phase === 'day' && c.status === 'active') return taskSheet(s, c);
  if (ui.sheet.kind === 'chat' && s.phase === 'night' && c.status === 'active') return chatSheet(s, ui, c);
  if (ui.sheet.kind === 'person') return personSheet(s, c, ui);
  return '';
}

// ───────────── 人心：关系图、他们之间的事、各人的心路 ─────────────

/** 大家的故事一共走到了第几章 */
export function storyTotal(s: GameState) {
  return s.chars.reduce((n, c) => n + progress(s, c.id).reached, 0);
}

function pathList(s: GameState, id: string) {
  const p = progress(s, id);
  const next = p.done.indexOf(false);
  return `<ol class="path">${p.chapters.map((c, i) => {
    if (p.done[i]) return `<li class="done"><b>${c.title}</b></li>`;
    if (i === next) return `<li class="next"><b>？？？</b><small>${c.hint}</small></li>`;
    return '<li class="later"><b>？？？</b></li>';
  }).join('')}</ol>`;
}

function memoryList(s: GameState, id: string) {
  const list = memoriesOf(s, id).slice().reverse().slice(0, 6);
  if (!list.length) return '';
  const who = def(id).gender === 'f' ? '她' : '他';
  return `<div class="kv"><h3>${who}记得的事</h3><ul class="memories">${list.map((m) => `<li class="${m.tone ?? ''}"><small>第${cnDay(m.day)}日</small>${esc(m.text)}</li>`).join('')}</ul></div>`;
}

function tieMap(s: GameState) {
  const cs = s.chars;
  const n = cs.length;
  const pos = cs.map((c, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { c, x: 50 + Math.cos(a) * 38, y: 40 + Math.sin(a) * 30 };
  });
  const lines: string[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = pos[i], B = pos[j];
    if (A.c.status !== 'active' || B.c.status !== 'active') continue;
    const r = rel(s, A.c.id, B.c.id);
    if (Math.abs(r) < 12) continue;
    const w = (1.2 + Math.abs(r) / 28).toFixed(1);
    const o = (0.35 + Math.abs(r) / 160).toFixed(2);
    lines.push(`<line x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" class="${r > 0 ? 'good' : 'bad'}" stroke-width="${w}" stroke-opacity="${o}"${Math.abs(r) < 30 ? ' stroke-dasharray="3 3"' : ''}/>`);
  }
  const nodes = pos.map(({ c, x, y }) => `<button class="tie-node ${c.status !== 'active' ? 'gone' : ''}" style="left:${x.toFixed(1)}%;top:${((y / 80) * 100).toFixed(1)}%;--c:${def(c.id).color}" data-act="person" data-id="${c.id}" aria-label="${def(c.id).short}">${portrait(c.id, c, 'mini')}<span>${def(c.id).short}</span></button>`).join('');
  return `<div class="tie-map"><svg viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>${nodes}</div>`;
}

function heartView(s: GameState) {
  const A = act(s);
  const pairs: [string, string, number][] = [];
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) pairs.push([A[i].id, A[j].id, rel(s, A[i].id, A[j].id)]);
  pairs.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
  const strong = pairs.filter((p) => Math.abs(p[2]) >= 12).slice(0, 6);
  const happened = PAIR_STORIES.filter((p) => s.fired[p.id]).sort((a, b) => s.fired[a.id] - s.fired[b.id]);
  const present = (p: (typeof PAIR_STORIES)[number]) => s.chars.some((c) => c.id === p.a) && s.chars.some((c) => c.id === p.b);
  const waiting = PAIR_STORIES.filter((p) => !s.fired[p.id] && present(p)).length;
  const cards = s.chars.map((c) => {
    const d = def(c.id);
    const p = progress(s, c.id);
    const tag = c.status === 'dead' ? '<span class="chip bad">已离世</span>' : c.status === 'left' ? '<span class="chip warn">已离开</span>' : s.flags[d.arcFlag] ? '<span class="chip good">心结已解</span>' : '';
    return `<article class="path-card ${c.status !== 'active' ? 'gone' : ''}" style="--c:${d.color}">
      <button class="path-face" data-act="person" data-id="${c.id}" aria-label="查看${d.short}">${portrait(c.id, c, 'mini')}</button>
      <div><div class="path-head"><b>${d.short}</b><span>${p.reached} / ${p.chapters.length} 章</span>${tag}</div>${pathList(s, c.id)}</div>
    </article>`;
  });
  return `<section class="note ties"><h3>人和人之间</h3>
    ${tieMap(s)}
    <p class="legend"><span><i class="good"></i>要好</span><span><i class="bad"></i>不和</span><span>线越粗，交情（或者积怨）越深</span></p>
    ${strong.length ? `<ul class="tie-list">${strong.map(([a, b, r]) => `<li><b>${nm(a)}</b><span class="${r > 0 ? 'good' : 'bad'}">${relWord(r)}</span><b>${nm(b)}</b></li>`).join('')}</ul>` : '<p class="mini">大家还不太熟。一起干活、围着火说话，关系会慢慢变。</p>'}
  </section>
  <section class="note"><h3>他们之间的事</h3>
    ${happened.length ? `<ul class="pair-list">${happened.map((p) => `<li><small>第${cnDay(s.fired[p.id])}日</small><b>${p.title}</b><span>${nm(p.a)}、${nm(p.b)}</span><em class="${p.kind === '恩怨' ? 'bad' : 'good'}">${p.kind}</em></li>`).join('')}</ul>` : ''}
    <p class="mini">${waiting ? `还有 ${waiting} 段故事没有发生。关系、信任和每个人的处境，会让它们在某个傍晚找上门。` : happened.length ? '眼下能发生的，都发生过了。' : '还没有。'}</p>
  </section>
  <h2 class="sec">各人的心路</h2>
  <section class="paths">${cards.join('')}</section>`;
}

// ───────────── 结束今天之前：看看有什么风险 ─────────────

export interface Risk { level: 'bad' | 'warn' | 'info'; short: string; text: string }

const OUT_TASKS: TaskId[] = ['wood', 'hunt', 'scavenge', 'explore', 'guard'];
const names = (cs: CharState[]) => cs.map((c) => nm(c.id)).join('、');

/** 照现在的安排结束今天，会出什么问题（和 systems/ 里的结算规则对应） */
export function risks(s: GameState): Risk[] {
  if (s.phase !== 'day') return [];
  const A = act(s);
  if (!A.length) return [];
  const f = forecast(s);
  const eff = (c: CharState): TaskId => (blocked(s, c, c.task) ? 'rest' : c.task);
  const out: Risk[] = [];
  if (s.res.food + f.food < f.eat) {
    out.push({ level: 'bad', short: '口粮不够', text: `口粮不够分：要吃 ${f.eat} 份，家里有 ${s.res.food} 份，今天打猎约 +${f.food}。每个人都会掉健康和心情，连着挨饿更伤身。` });
  }
  if (s.res.wood + f.wood < f.burn) {
    out.push({ level: 'bad', short: '柴火不够', text: `柴火不够烧：今晚要烧 ${f.burn} 捆，家里有 ${s.res.wood} 捆，今天砍柴约 +${f.wood}。屋里会冷，所有人掉健康，还容易发烧。` });
  }
  const carers = A.filter((c) => eff(c) === 'care');
  const sick = A.filter((c) => c.sick > 0);
  if (sick.length && !carers.length) {
    out.push({ level: 'bad', short: `${nm(sick[0].id)}没人照料`, text: `${names(sick)}在发烧，没人照料：每天健康 −8，有人照料只掉 3。` });
  }
  const hurt = A.filter((c) => c.injured > 0 && !c.sick && eff(c) !== 'rest');
  if (hurt.length && !carers.length) {
    out.push({ level: 'warn', short: `${nm(hurt[0].id)}带伤干活`, text: `${names(hurt)}有伤还在干活，又没人照料：每天健康 −3。让${hurt.length > 1 ? '他们' : ta(hurt[0].id)}歇着，或者派人去照料。` });
  }
  const frail = A.filter((c) => c.health < 30 && OUT_TASKS.includes(eff(c)));
  if (frail.length) {
    out.push({ level: 'bad', short: `${nm(frail[0].id)}身子太虚`, text: `${names(frail)}健康不到 30，还要外出或守夜。再出点事就可能挺不过去。` });
  }
  const tired = A.filter((c) => c.stamina < 30 && eff(c) !== 'rest' && !frail.includes(c));
  if (tired.length) {
    out.push({ level: 'warn', short: `${nm(tired[0].id)}太累了`, text: `${names(tired)}体力不到 30 还要干活：产出打七折，外出更容易受伤。` });
  }
  const blue = A.filter((c) => c.mood < 15);
  if (blue.length && !A.some((c) => eff(c) === 'comfort')) {
    out.push({ level: 'warn', short: `${nm(blue[0].id)}快撑不住了`, text: `${names(blue)}心情很差，快撑不住了。派人去「安抚」，或者夜里陪${blue.length > 1 ? '他们' : ta(blue[0].id)}说说话。` });
  }
  const idle = A.filter((c) => c.task === 'build' && !s.project);
  if (idle.length) {
    out.push({ level: 'warn', short: '营建还没开工', text: `${names(idle)}被派去营建，可还没选工程，只能闲着。先去「营建」页开工。` });
  }
  const t = s.today;
  if (t?.id === 'wolves' && !A.some((c) => eff(c) === 'guard')) {
    out.push({ level: 'bad', short: '狼要来了，没人守夜', text: '门外有狼的脚印，今晚狼群多半会来。没人守夜，会被叼走好几份粮食，还可能有人被咬伤。' });
  }
  if (t?.id === 'feud') {
    const [a, b] = t.actors.map((id) => A.find((c) => c.id === id));
    if (a && b && eff(a) === eff(b) && eff(a) !== 'rest') out.push({ level: 'warn', short: `${nm(a.id)}和${nm(b.id)}在一起干活`, text: `${nm(a.id)}和${nm(b.id)}今天正在气头上，又被派去一起${TASKS[eff(a)].name}，准要吵翻。` });
  }
  if (t?.id === 'fever') {
    const c = A.find((x) => x.id === t.actors[0]);
    if (c && !c.sick && eff(c) !== 'rest' && !carers.length) out.push({ level: 'warn', short: `${nm(c.id)}要发烧`, text: `${nm(c.id)}有发烧的前兆，今天还在干活，又没人照料，晚上就会病倒。` });
  }
  if (s.policy.ration === 'half') out.push({ level: 'info', short: '口粮减半', text: '口粮减半：每人每天健康 −2、心情 −4。' });
  if (s.policy.heat === 'save') out.push({ level: 'info', short: '省着烧', text: '省着烧柴：每天少烧 1 捆，但屋里偏冷，大家每天掉一点健康，也更容易发烧。' });
  if (s.day >= 3 && t?.id !== 'wolves' && !A.some((c) => c.task === 'guard' && !blocked(s, c, 'guard'))) {
    out.push({ level: 'info', short: '没人守夜', text: '今晚没人守夜：狼群摸过来会叼走粮食，也可能有人偷东西。' });
  }
  return out;
}

function endSheet(s: GameState) {
  const list = risks(s);
  return `<div class="scrim" data-act="close"><section class="sheet end-sheet" role="dialog" aria-modal="true" aria-label="结束今天之前" data-stop>
    <div class="sheet-head"><div><h2>就这么结束今天？</h2><p>天黑之前，安排还能改。</p></div><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <ul class="risks">${list.map((r) => `<li class="${r.level}">${icon(r.level === 'info' ? 'talk' : 'warn')}<p>${esc(r.text)}</p></li>`).join('')}</ul>
    <div class="row end-row"><button class="btn" data-act="close">再安排一下</button><button class="btn hot" data-act="end-day">就这样，结束今天</button></div>
  </section></div>`;
}

// ───────────── 点开数字看说明 ─────────────

function infoSheet(s: GameState, topic: string) {
  const f = forecast(s);
  const A = act(s);
  const day = s.phase === 'day';
  const who = (t: TaskId) => {
    const n = A.filter((c) => (blocked(s, c, c.task) ? 'rest' : c.task) === t).map((c) => nm(c.id));
    return n.length ? n.join('、') : '没人';
  };
  const ill = A.filter((c) => c.sick || c.injured);
  const pages: Record<string, { icon: string; title: string; body: string[]; today?: string }> = {
    food: {
      icon: 'food', title: `食物 · ${s.res.food} 份`,
      body: [
        '每人每天吃 1 份，大胃口的吃 2 份。有人掌勺能省下几份，还能让大家心情好。',
        '不够分的时候，每个人都会掉健康和心情；连着挨饿两天，伤身更重。',
        '从哪来：狩猎（附近的猎物会越打越少）、探路时偶尔撞上、有些事情。',
      ],
      today: `今天：${who('hunt')}去狩猎，约 +${f.food}；要吃 ${f.eat} 份${f.save ? `（掌勺省下 ${f.save} 份）` : ''}。`,
    },
    wood: {
      icon: 'wood', title: `柴火 · ${s.res.wood} 捆`,
      body: [
        '每天要烧多少看气温：越冷烧得越多。封窗和砌火塘，各让每天少烧 1 捆。',
        '柴不够，屋里就冷：所有人掉健康，还容易发烧。选「省着烧」每天少烧 1 捆，但屋里偏冷。',
      ],
      today: `今天：${who('wood')}去砍柴，约 +${f.wood}；夜里要烧 ${f.burn} 捆。`,
    },
    mat: {
      icon: 'mat', title: `物资 · ${s.res.mat} 件`,
      body: ['用来营建：封窗、熏肉架、火塘、医务角、瞭望台……开工时一次付清。', '从哪来：搜寻（偶尔还能翻出药），探路时也可能捡到。'],
      today: `今天：${who('scavenge')}去搜寻，约 +${f.mat}。`,
    },
    med: {
      icon: 'med', title: `药品 · ${s.res.med} 盒`,
      body: ['有人「照料」病人和伤员时会用上，有药好得更快。', '从哪来：搜寻和探路时偶尔带回来。'],
      today: ill.length ? `现在有伤病的：${names(ill)}；在照料的：${who('care')}。` : '现在没人生病受伤。',
    },
    heat: {
      icon: `w_${s.weather.kind}`, title: `天气 · ${WEATHER[s.weather.kind]} ${temp(s.temp)}`,
      body: [
        '气温会一天天往下掉，月中最冷，之后慢慢回暖。',
        '暴风雪天，外出的活产出减半，更容易受伤，探路也更容易迷路。',
        `保暖 ${insulation(s)} 级：封窗堵缝 +1，砌火塘 +1。每一级让每天少烧 1 捆柴。`,
      ],
      today: `照现在的天气和保暖，每天要烧 ${f.burn} 捆柴。`,
    },
    body: {
      icon: 'heart', title: '健康 · 体力 · 心情 · 信任',
      body: [
        '<b>健康</b>降到 0，人就没了。挨饿、受冻、生病、受伤都会掉；吃饱、暖和、没病没伤时每天回 3，休息回得更多。',
        '<b>体力</b>干活会累，夜里有火能睡回 18（没火只回 10，守夜的只回 5）。低于 30 干活打七折，外出更容易受伤。',
        '<b>心情</b>困得越久越压抑。低于 25 干活打折，太低会崩溃，甚至有人想走。掌勺、安抚、火塘、要好的朋友都能让人好受些。',
        '<b>信任</b>是对你的信任。采纳他们想干的活、夜里聊天都能涨。信任够了，他们会说出心里的事。',
      ],
    },
  };
  const p = pages[topic] ?? pages.body;
  return `<div class="scrim" data-act="close"><section class="sheet info-sheet" role="dialog" aria-modal="true" aria-label="${esc(p.title.replace(/<[^>]+>/g, ''))}" data-stop>
    <div class="sheet-head"><span class="info-ico">${icon(p.icon)}</span><div><h2>${p.title}</h2></div><button class="x" data-act="close" aria-label="关闭">×</button></div>
    ${p.body.map((t) => `<p>${t}</p>`).join('')}
    ${p.today && (day || topic === 'med' || topic === 'heat') ? `<p class="today">${esc(p.today)}</p>` : ''}
  </section></div>`;
}

// ───────────── 教学：第一天一步步带着玩，之后在第一次遇到的时候提一句 ─────────────

interface Tip { id: string; target: string; title: string; text: string; when: (s: GameState) => boolean }
const DAY1 = (s: GameState) => s.phase === 'day' && s.day === 1;

export const TIPS: Tip[] = [
  { id: 'people', when: DAY1, target: '.scene-box', title: '驿站里的人', text: '这就是你们落脚的驿站，画里和下面卡片上的，是和你一起困在这里的人。每个人在画里干着你派的活；点画里的人就能给他派活。' },
  { id: 'assign', when: DAY1, target: '.adopt-all .btn, .card .task-btn', title: '派活', text: '点卡片下面的按钮给每个人派活，也可以一键「按大家的意思派活」。照他们的意思派，信任会涨。' },
  { id: 'res', when: DAY1, target: '.caps', title: '家底', text: '柴火保暖，食物果腹，物资用来营建，药品治病。数字旁边是今天预计的增减。点任何一个数字，都有说明。' },
  { id: 'end', when: DAY1, target: '.dock .go', title: '结束今天', text: '派完活点这里。白天会结算收成；要是安排有风险，会先提醒你。' },
  { id: 'night', when: (s) => s.phase === 'night', target: '.scene-box', title: '围炉夜话', text: '每晚你只顾得上一个人。挑一个坐过去，说两句。每个人吃的那一套不一样：有人要人陪，有人要听实话，有人想笑一笑。聊对了信任涨得快，聊错了反而寒心。有话想说的人没等到你，也会寒心。' },
  { id: 'today', when: (s) => s.phase === 'day' && !!s.today, target: '.note.today', title: '今日情况', text: '每天早上都会出点状况。照着它调整派活：鹿群下山就多派人打猎，看见狼的脚印就留人守夜。' },
  {
    id: 'heart', target: ".dock-tabs [data-v='heart']", title: '人心',
    when: (s) => storyTotal(s) >= 2,
    text: '有人的故事往前走了一步。「人心」页能看到大家之间的关系、他们之间发生过的事，和每个人的心路走到了哪一章。',
  },
  {
    id: 'build', target: ".dock-tabs [data-v='build']", title: '营建',
    when: (s) => s.phase === 'day' && s.day >= 2 && !s.project && BUILD_ORDER.some((id) => canAfford(s, id)),
    text: '材料够了。去「营建」挑个工程开工，再派人去「营建」推进。封窗堵缝能让每天少烧一捆柴。',
  },
];

export function currentTip(s: GameState, ui: UI) {
  if (ui.screen !== 'game' || s.phase === 'ending' || ui.tab !== 'people' || hasOverlay(s, ui)) return null;
  const seen = ui.tips ?? [];
  return TIPS.find((t) => !seen.includes(t.id) && t.when(s)) ?? null;
}

function coach(s: GameState, ui: UI) {
  const t = currentTip(s, ui);
  if (!t) return '';
  const day1 = TIPS.filter((x) => x.when === DAY1);
  const k = day1.indexOf(t);
  const last = k < 0 || k === day1.length - 1;
  return `<aside class="coach" data-tip="${t.id}" data-target="${t.target}" role="note">
    <h3>${t.title}${k >= 0 ? `<small>${k + 1} / ${day1.length}</small>` : ''}</h3><p>${t.text}</p>
    <div class="row"><button class="btn hot" data-act="tip" data-v="${t.id}">${last ? '知道了' : '下一步'}</button>${k >= 0 && !last ? '<button class="btn ghost" data-act="tip-skip">跳过教学</button>' : ''}</div>
  </aside>`;
}

export function gameScreen(s: GameState, ui: UI) {
  const body = ui.tab === 'people' ? people(s, ui) : ui.tab === 'build' ? works(s) : ui.tab === 'heart' ? heartView(s) : logView(s, ui);
  return `${hud(s, ui)}<main><div class="wrap">${body}</div></main>${coach(s, ui)}${dock(s, ui)}${overlay(s, ui)}`;
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

export function endingScreen(s: GameState, ui?: UI) {
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
    ${ui ? runCard(s, ui) : ''}
    <ul class="fates">${fates.join('')}</ul>
    <div class="row"><button class="go" data-act="${ui?.meta ? 'setup' : 'new'}">再来一局</button></div>
  </div></section>`;
}
