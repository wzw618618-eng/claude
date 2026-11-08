// 山门场景：画面一直在动。弟子按自己的差事站到各个殿堂边上，换了差事就走过去；
// 有话说时头上冒气泡；殿堂产出、发月例时飘字；盖房子时脚手架和进度条一点点长；冲关时洞口放光。
// DOM 只建一次，之后每帧只改位置和几个数字，避免整块重画。

import { workOn, workProgress } from '../game/build';
import { atBottleneck, need, realmText } from '../game/cult';
import { HALLS } from '../game/data/world';
import type { Fx } from '../game/fx';
import { tripProgress } from '../game/missions';
import type { HallId, Person, World } from '../game/types';
import { daysLeft, me, members, nowDay } from '../game/world';
import { backdrop, clouds, hallArt, plotArt, scaffoldArt, SPOT, VH, VW } from './art';
import { avatar } from './avatar';
import { esc } from './util';

type Spot = keyof typeof SPOT;
interface Tok { el: HTMLElement; x: number; y: number; tx: number; ty: number; hidden: boolean; key: string; jx: number; jy: number; nextJ: number; walkUntil: number }

const TOKEN = 46;
/** 一处站人的位置：围着殿堂排开 */
const SLOTS: [number, number][] = [[-74, 4], [74, 4], [-112, 24], [112, 24], [-64, 44], [64, 44], [-104, 62], [104, 62], [-148, 42], [148, 42]];

const BADGE: Record<string, [string, string]> = {
  cultivate: ['修', 'jade'], diligent: ['勤', 'gold'], slack: ['懒', 'gray'], spar: ['斗', 'red'], befriend: ['友', 'pink'], woo: ['情', 'pink'],
  challenge: ['挑', 'red'], help: ['帮', 'jade'], adventure: ['游', 'blue'], mentor: ['教', 'jade'], seclude: ['关', 'gold'],
};

export class Scene {
  private root: HTMLElement;
  private inner!: HTMLElement;
  private bgKey = '';
  private halls = new Map<string, { el: HTMLElement; key: string }>();
  private toks = new Map<string, Tok>();
  private fxLayer!: HTMLElement;
  private weather!: HTMLElement;
  private expLayer!: HTMLElement;
  scale = 1;
  private ox = 0;
  private oy = 0;
  /** 第一帧画完以后，新出现的人都从山门走上来 */
  private warm = false;
  /** 等着冒出来的话：旁边已经有人在说话就先等一等，免得叠在一起 */
  private says: { who: string; text: string; at: number }[] = [];
  private talking = new Map<string, number>();
  /** 同一处刚飘过字，下一条往上错开 */
  private floatAt = new Map<string, { t: number; n: number }>();

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  private build() {
    this.root.innerHTML = `<div class="scene-bg"></div><div class="scene-inner"><div class="halls-layer"></div><div class="toks-layer"></div><div class="exp-layer"></div><div class="fx-layer"></div></div><div class="weather"></div><div class="clouds-layer">${clouds()}</div>`;
    this.inner = this.root.querySelector('.scene-inner')!;
    this.fxLayer = this.root.querySelector('.fx-layer')!;
    this.weather = this.root.querySelector('.weather')!;
    this.expLayer = this.root.querySelector('.exp-layer')!;
    this.bgKey = '';
    this.halls.clear();
    this.toks.clear();
    this.warm = false;
  }

  /** 场景还挂在页面上吗（整页重画后要重建） */
  attached() { return this.root.isConnected; }

  /** 按容器大小缩放：整张设计图都放得下（contain），多出来的边由背景补上 */
  layout() {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    if (!W || !H) return;
    const s = Math.min(W / VW, H / VH);
    this.scale = s;
    this.ox = (W - VW * s) / 2;
    this.oy = (H - VH * s) / 2;
    this.inner.style.transform = `translate(${this.ox}px,${this.oy}px) scale(${s})`;
    const bg = this.root.querySelector('.scene-bg') as HTMLElement;
    // 背景画的是 2560×1216，设计区在其中 (640,320) 处
    bg.style.transform = `translate(${this.ox - 640 * s}px,${this.oy - 320 * s}px) scale(${s})`;
    // 手机上小人不能太小：屏幕上至少 30 像素
    this.root.style.setProperty('--tk', String(Math.max(1, 30 / (TOKEN * s))));
    this.root.style.setProperty('--ui', String(1 / s));
  }

  /** 每帧：同步殿堂、人、在外的队伍 */
  sync(w: World, t: number) {
    const season = w.t % 4;
    const bgKey = `${season}|${w.sect.name}`;
    if (bgKey !== this.bgKey) {
      this.bgKey = bgKey;
      (this.root.querySelector('.scene-bg') as HTMLElement).innerHTML = backdrop(season, w.sect.name);
      this.weather.className = `weather s${season}`;
      this.weather.innerHTML = Array.from({ length: season === 1 ? 10 : 22 }, (_, i) => `<i style="left:${(i * 47) % 100}%;animation-delay:${(-i * 1.37) % 9}s;animation-duration:${7 + (i % 5) * 1.6}s"></i>`).join('');
    }
    this.syncHalls(w, season);
    this.syncPeople(w, t);
    this.syncExpeditions(w);
    this.flushSays(t);
    this.warm = true;
  }

  /** 把等着的话一条条放出来：附近有人在说话就先等，等太久就算了 */
  private flushSays(t: number) {
    for (const [id, until] of this.talking) if (t > until) this.talking.delete(id);
    this.says = this.says.filter((x) => t - x.at < 9000);
    for (const x of [...this.says]) {
      if (this.talking.size >= 3) break;
      const tok = this.toks.get(x.who);
      if (!tok || tok.hidden) { this.says.splice(this.says.indexOf(x), 1); continue; }
      const crowded = [...this.talking.keys()].some((id) => { const o = this.toks.get(id); return o && Math.abs(o.x - tok.x) < 240 && Math.abs(o.y - tok.y) < 90; });
      if (crowded) continue;
      this.says.splice(this.says.indexOf(x), 1);
      tok.el.querySelector('.bubble')?.remove();
      const b = document.createElement('span');
      b.className = `bubble${tok.x < 260 ? ' b-left' : tok.x > 1030 ? ' b-right' : ''}`;
      b.textContent = x.text;
      tok.el.appendChild(b);
      this.talking.set(x.who, t + 5000);
      setTimeout(() => b.remove(), 5200);
    }
  }

  private hallEl(id: string, x: number, y: number, cls: string, act: string) {
    let h = this.halls.get(id);
    if (!h) {
      const el = document.createElement('button');
      el.className = `hall-el ${cls}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.zIndex = String(Math.round(y) - 40);
      el.dataset.act = act;
      el.dataset.id = id;
      this.root.querySelector('.halls-layer')!.appendChild(el);
      h = { el, key: '' };
      this.halls.set(id, h);
    }
    return h;
  }

  private syncHalls(w: World, season: number) {
    const fixed: [string, Spot, string, string][] = [['main', 'main', '宗主殿', 'open-master'], ['cave', 'cave', '闭关洞府', 'tab-seclude'], ['gate', 'gate', '山门', 'tab-recruit']];
    for (const [id, spot, name, act] of fixed) {
      const [x, y] = SPOT[spot];
      const h = this.hallEl(id, x, y, `fixed ${id}`, act);
      const glow = id === 'cave' && (everyoneBreaking(w) || (w.masterPlan.act === 'seclude' && atBottleneck(me(w))));
      const key = `${season}|${glow}|${w.sect.name}`;
      if (h.key !== key) {
        h.key = key;
        h.el.innerHTML = `<svg class="hall-art" viewBox="-110 -130 220 150" width="220" height="150">${hallArt(id as 'main', 1, season, w.sect.name)}</svg><span class="hall-label">${name}</span>`;
        h.el.classList.toggle('glow', glow);
        h.el.setAttribute('aria-label', name);
      }
    }
    for (const d of HALLS) {
      const [x, y] = SPOT[d.id];
      const lv = w.sect.halls[d.id];
      const job = workOn(w, d.id);
      const h = this.hallEl(d.id, x, y, 'h-std', 'hall');
      const key = `${lv}|${job ? job.to : 0}|${season}`;
      if (h.key !== key) {
        h.key = key;
        const art = job ? `<g class="rising">${hallArt(d.id, Math.max(1, job.to), season)}</g>${scaffoldArt()}` : lv > 0 ? hallArt(d.id, lv, season) : plotArt();
        h.el.innerHTML = `<svg class="hall-art" viewBox="-110 -130 220 150" width="220" height="150">${art}</svg>
          <span class="hall-label">${esc(d.name)}${lv > 0 ? `<small>${'★'.repeat(lv - 1)}</small>` : job ? '' : '<small>空地</small>'}</span>
          ${job ? '<span class="hall-prog"><i></i><em></em></span>' : ''}`;
        h.el.classList.toggle('empty', lv === 0 && !job);
        h.el.classList.toggle('building', !!job);
        h.el.setAttribute('aria-label', `${d.name}${lv ? '' : job ? '（在建）' : '（空地）'}`);
      }
      if (job) {
        const p = workProgress(w, job);
        const bar = h.el.querySelector('.hall-prog i') as HTMLElement | null;
        if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`;
        const em = h.el.querySelector('.hall-prog em');
        if (em) em.textContent = `${job.to === 1 ? '建造' : '扩建'} · 还有 ${daysLeft(w, job.done)} 日`;
        const rise = h.el.querySelector('.rising') as SVGGElement | null;
        if (rise) rise.style.clipPath = `inset(${((1 - p) * 100).toFixed(1)}% 0 0 0)`;
      }
    }
  }

  /** 这个人该站在哪：殿堂、洞府、闲处，或者不在山上 */
  private place(w: World, p: Person): Spot | null {
    if (p.id === w.me) {
      const a = w.masterPlan.act;
      if (a === 'roam' || a === 'visit') return null;
      if (a === 'seclude') return 'cave';
      if (a === 'teach') return w.sect.halls.teach ? 'teach' : 'main';
      if (a === 'craft') return w.sect.halls.alchemy ? 'alchemy' : 'main';
      return 'main';
    }
    if (p.breaking || p.job === 'seclude') return 'cave';
    if (p.job === 'travel') return null;
    if (p.job === 'none') return 'idle';
    return p.job as HallId;
  }

  private syncPeople(w: World, t: number) {
    const seen = new Set<string>();
    const count = new Map<string, number>();
    const ppl = [me(w), ...members(w)].filter(Boolean);
    const cands = w.candidates.map((c) => w.people[c.id]).filter(Boolean).slice(0, 6);
    for (const p of [...ppl, ...cands]) {
      const guest = p.sect !== 'me';
      const spot: Spot | null = guest ? (w.sect.halls.recruit ? 'recruit' : 'gate') : this.place(w, p);
      const n = count.get(spot ?? '-') ?? 0;
      count.set(spot ?? '-', n + 1);
      seen.add(p.id);
      let tok = this.toks.get(p.id);
      const [gx, gy] = SPOT.gate;
      if (!tok) {
        const el = document.createElement('button');
        el.className = 'tok';
        el.dataset.act = guest ? 'tab' : 'person';
        el.dataset.id = guest ? 'recruit' : p.id;
        this.root.querySelector('.toks-layer')!.appendChild(el);
        // 新来的人从山门走上来；开局时已经在山上的人直接站好
        const walkIn = this.warm || guest;
        tok = { el, x: walkIn ? gx : NaN, y: gy + 30, tx: 0, ty: 0, hidden: false, key: '', jx: 0, jy: 0, nextJ: 0, walkUntil: 0 };
        this.toks.set(p.id, tok);
      }
      // 样子：身份、心情、怨气变了才重画头像
      const badge = guest ? ['客', 'gray'] : p.id === w.me ? null : p.breaking ? ['关', 'gold'] : p.job === 'none' ? ['闲', 'red'] : p.grudge >= 50 ? ['怨', 'red'] : atBottleneck(p) ? ['圆', 'gold'] : p.hp < 40 ? ['伤', 'red'] : BADGE[p.lastAct ?? ''] ?? null;
      const moodB = p.mood >= 70 ? 2 : p.mood < 30 ? 0 : 1;
      const key = `${p.rank}|${moodB}|${p.grudge >= 50}|${badge?.[0] ?? ''}|${p.starred ? 1 : 0}|${p.realm}|${p.name}|${guest}`;
      if (tok.key !== key) {
        tok.key = key;
        const bubble = tok.el.querySelector('.bubble');
        tok.el.innerHTML = `<span class="tok-body${p.id === w.me ? ' master' : ''}${guest ? ' guest' : ''}">${avatar(p, TOKEN)}</span>${badge ? `<i class="tok-badge ${badge[1]}">${badge[0]}</i>` : ''}${p.starred ? '<i class="tok-star">★</i>' : ''}<span class="tok-name">${esc(p.name)}</span>${guest ? '' : '<span class="tok-bar"><i></i></span>'}`;
        if (bubble) tok.el.appendChild(bubble);
        tok.el.title = guest ? `${p.name}（候选人）` : `${p.name} · ${realmText(p)}`;
        tok.el.classList.toggle('breaking', !!p.breaking);
      }
      const bar = tok.el.querySelector('.tok-bar i') as HTMLElement | null;
      if (bar) bar.style.width = `${Math.min(100, (p.exp / need(p)) * 100).toFixed(0)}%`;
      tok.el.classList.toggle('stuck', !guest && atBottleneck(p) && !p.breaking);
      // 位置
      if (!spot) {
        // 不在山上：走到山门外就不见了
        if (Number.isNaN(tok.x)) { tok.x = gx; tok.hidden = true; }
        tok.tx = gx; tok.ty = gy + 40;
        if (Math.hypot(tok.x - tok.tx, tok.y - tok.ty) < 4) tok.hidden = true;
        this.move(tok, t, true);
        continue;
      }
      const [x, y] = this.slot(spot, n);
      if (Number.isNaN(tok.x)) { tok.x = x; tok.y = y; }
      // 从外面回来：从山门出现，再走回去
      if (tok.hidden) { tok.hidden = false; tok.x = gx; tok.y = gy + 30; }
      // 站着时也会挪两步，看着是活的
      if (t > tok.nextJ) { tok.nextJ = t + 2500 + Math.random() * 4000; tok.jx = (Math.random() - 0.5) * 18; tok.jy = (Math.random() - 0.5) * 8; }
      tok.tx = x + tok.jx; tok.ty = y + tok.jy;
      this.move(tok, t, false);
    }
    for (const [id, tok] of this.toks) if (!seen.has(id)) { tok.el.remove(); this.toks.delete(id); }
  }

  private slot(spot: Spot, n: number): [number, number] {
    const [x, y] = SPOT[spot];
    if (spot === 'main') { const s = [[-70, 28], [70, 28], [-110, 20], [110, 20]][n % 4]; return [x + s[0], y + s[1] + Math.floor(n / 4) * 20]; }
    if (spot === 'idle') return [x + (n % 4) * 34 - 50, y + Math.floor(n / 4) * 34];
    if (spot === 'gate') return [x - 96 - (n % 3) * 36, y - 34 + Math.floor(n / 3) * 22];
    if (spot === 'cave') { const s = [[64, 6], [96, 18], [128, 30], [62, 40], [96, 52], [30, 30]][n % 6]; return [x + s[0], y + s[1] + Math.floor(n / 6) * 30]; }
    const s = SLOTS[n % SLOTS.length];
    return [x + s[0], y + s[1] + Math.floor(n / SLOTS.length) * 26];
  }

  /** 朝目标走：每帧走一小步，走路时上下颠 */
  private move(tok: Tok, t: number, leaving: boolean) {
    const dx = tok.tx - tok.x, dy = tok.ty - tok.y;
    const d = Math.hypot(dx, dy);
    const speed = 2.2;
    if (d > speed) { tok.x += (dx / d) * speed; tok.y += (dy / d) * speed; if (d > 12) tok.walkUntil = t + 120; }
    else { tok.x = tok.tx; tok.y = tok.ty; }
    tok.el.classList.toggle('walk', t < tok.walkUntil);
    tok.el.classList.toggle('flip', dx < -1 && d > 12);
    tok.el.classList.toggle('gone', tok.hidden || (leaving && d < 20));
    tok.el.style.transform = `translate(${tok.x.toFixed(1)}px,${tok.y.toFixed(1)}px)`;
    tok.el.style.zIndex = String(Math.round(tok.y));
  }

  /** 在外的队伍：山门边一排小牌子，写着去哪、还有几天 */
  private syncExpeditions(w: World) {
    const exps = w.expeditions;
    const key = exps.map((e) => `${e.mission.id}:${e.team.join(',')}`).join('|');
    if (this.expLayer.dataset.key !== key) {
      this.expLayer.dataset.key = key;
      this.expLayer.innerHTML = exps.map((e, i) => {
        const team = e.team.map((id) => w.people[id]).filter(Boolean);
        return `<button class="exp-chip" data-act="tab" data-id="mission" style="left:${SPOT.gate[0] + 92}px;top:${SPOT.gate[1] - 40 - i * 34}px"><span class="exp-faces">${team.map((p) => avatar(p, 22)).join('')}</span><b>${esc(e.mission.title)}</b><em></em><span class="exp-bar"><i></i></span></button>`;
      }).join('');
    }
    this.expLayer.querySelectorAll<HTMLElement>('.exp-chip').forEach((el, i) => {
      const e = exps[i];
      if (!e) return;
      (el.querySelector('em') as HTMLElement).textContent = `${daysLeft(w, e.back)}日`;
      (el.querySelector('.exp-bar i') as HTMLElement).style.width = `${(tripProgress(w, e) * 100).toFixed(0)}%`;
    });
  }

  /** 某处在画面里的坐标 */
  private at(where: string): [number, number] | null {
    if (where.startsWith('p:')) { const t = this.toks.get(where.slice(2)); return t && !t.hidden ? [t.x, t.y - 30] : null; }
    const s = SPOT[where as Spot];
    return s ? [s[0], s[1] - 70] : null;
  }

  private spawn(cls: string, x: number, y: number, html: string, ms: number) {
    const el = document.createElement('div');
    el.className = `fx ${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = html;
    this.fxLayer.appendChild(el);
    if (this.fxLayer.childElementCount > 40) this.fxLayer.firstElementChild?.remove();
    setTimeout(() => el.remove(), ms);
    return el;
  }

  /** 规则层丢过来的提示，变成画面上的东西。返回要不要放音效 */
  fx(f: Fx, w: World): string | null {
    switch (f.k) {
      case 'float': {
        const p = this.at(f.at);
        if (!p) return null;
        const now = performance.now();
        const prev = this.floatAt.get(f.at);
        const n = prev && now - prev.t < 1400 ? prev.n + 1 : 0;
        this.floatAt.set(f.at, { t: now, n });
        this.spawn(`float ${f.tone}`, p[0] + (Math.random() - 0.5) * 20, p[1] - n * 26, esc(f.text), 2600);
        return f.tone === 'good' && f.text.includes('灵石') ? 'coin' : null;
      }
      case 'say': {
        if (!this.says.some((x) => x.who === f.who)) this.says.push({ who: f.who, text: f.text, at: performance.now() });
        if (this.says.length > 8) this.says.shift();
        return null;
      }
      case 'level': {
        const tok = this.toks.get(f.who);
        if (!tok || tok.hidden) return null;
        this.spawn('ring', tok.x, tok.y - 20, '', 1200);
        this.spawn('float gold', tok.x, tok.y - 52, esc(f.text), 2400);
        return 'level';
      }
      case 'break': {
        const tok = this.toks.get(f.who);
        const [x, y] = tok && !tok.hidden ? [tok.x, tok.y] : SPOT.cave;
        if (f.ok) { this.spawn('beam', x, y, '', 2600); this.spawn('ring big', x, y - 20, '', 1600); this.flash('gold'); }
        else { this.spawn('shock', x, y - 20, '', 1200); this.shake(); }
        return f.ok ? 'success' : 'fail';
      }
      case 'built': {
        const s = SPOT[f.hall as Spot];
        if (!s) return null;
        this.spawn('dust', s[0], s[1] - 10, '', 1400);
        this.spawn('ring big', s[0], s[1] - 40, '', 1400);
        return 'build';
      }
      default: return null;
    }
    void w;
  }

  private flash(tone: string) {
    const el = document.createElement('div');
    el.className = `flash ${tone}`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  private shake() {
    this.root.classList.remove('shake');
    void this.root.offsetWidth;
    this.root.classList.add('shake');
  }

  /** 某个人现在在画面上的屏幕坐标（新手指引箭头用） */
  screenPos(where: string): [number, number] | null {
    const p = this.at(where);
    return p ? [this.ox + p[0] * this.scale, this.oy + (p[1] + 70) * this.scale] : null;
  }
}

function everyoneBreaking(w: World) { return members(w).some((p) => p.breaking); }

/** 现在离天亮还早不早：给界面一个 0–1 的季内进度 */
export const seasonProgress = (w: World) => (nowDay(w) % 90) / 90;
