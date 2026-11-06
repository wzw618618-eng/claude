// 声音：全部用 Web Audio 现场合成，没有音频文件。
// - 配乐：像古琴一样的拨弦（Karplus-Strong），五声音阶，稀稀落落地弹；地方不同，音域和疏密不同；
// - 环境声随地方变：青岚宗山风和远钟、赤霄门风里的金铁声、云渡坊的人声、听泉谷的溪水、
//   玄冥洞府低沉的回响和滴水、黑松林的夜风和鸮啼、柳溪村的鸟鸣；
// - 按键、找上门、破境、秘密、过年的提示音。
// 浏览器要求先有一次点击才能出声，所以第一次点击时才真正创建 AudioContext。

import type { PlaceId } from '../game/core/types.ts';

export type Cue = 'tap' | 'page' | 'pick' | 'confirm' | 'deny' | 'event' | 'good' | 'bad' | 'secret' | 'year' | 'clash';

export interface SoundScene {
  phase: 'title' | 'year' | 'ending';
  place: PlaceId | null;
}

export interface Sound {
  readonly muted: boolean;
  unlock(): void;
  play(cue: Cue): void;
  scene(sc: SoundScene): void;
  setMuted(m: boolean): void;
  dispose(): void;
}

/** 界面操作对应的声音 */
export const CUE_FOR_ACT: Record<string, Cue> = {
  continue: 'confirm', 'go-title': 'page', tab: 'page', sheet: 'page', close: 'page', ok: 'tap',
  person: 'tap', chat: 'tap', place: 'tap', move: 'confirm', main: 'pick', buy: 'tap', sell: 'tap', use: 'tap',
  choose: 'tap', offer: 'tap', social: 'tap', end: 'tap', 'end-yes': 'confirm', 'end-no': 'tap', retreat: 'confirm',
  news: 'tap', 'ai-kind': 'tap', mode: 'tap', tip: 'tap', 'tip-skip': 'page', 'tip-reset': 'tap', sound: 'tap',
};

// 五声音阶（宫商角徵羽），用 MIDI 音高表示
const SCALE: Record<string, number[]> = {
  title: [50, 55, 57, 62, 64, 67, 69],
  bright: [62, 64, 67, 69, 72, 74, 76],
  calm: [55, 57, 60, 62, 64, 67, 69],
  dark: [43, 45, 48, 50, 52, 55, 57],
  ending: [45, 50, 52, 55, 57, 62],
};
const MOOD: Record<PlaceId, keyof typeof SCALE> = {
  qinglan: 'bright', chixiao: 'calm', market: 'calm', vein: 'bright', cave: 'dark', forest: 'dark', village: 'bright',
};
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function createSound(win: Window | null, opts: { muted?: boolean } = {}): Sound {
  type AC = AudioContext;
  const Ctor = (win as any)?.AudioContext ?? (win as any)?.webkitAudioContext;
  let ctx: AC | null = null;
  let muted = !!opts.muted;
  let master!: GainNode;
  let music!: GainNode;
  let air!: GainNode;
  let airFilter!: BiquadFilterNode;
  let water!: GainNode;
  let waterFilter!: BiquadFilterNode;
  let rumble!: GainNode;
  let noise!: AudioBuffer;
  let current: SoundScene = { phase: 'title', place: null };
  const plucks = new Map<number, AudioBuffer>();
  const timers = new Set<number>();
  let disposed = false;

  const later = (ms: number, fn: () => void) => {
    if (!win) return;
    const id = win.setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };

  /** 一路循环的噪声，经过滤波器和音量 */
  function loop(c: AC, rate: number, type: BiquadFilterType, freq: number, q = 0.7) {
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return [g, f] as const;
  }

  function build(c: AC) {
    master = c.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(c.destination);

    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // 配乐：干声 + 一路带衰减的回声，像在山谷里
    music = c.createGain();
    music.gain.value = 0.55;
    const echo = c.createDelay(1.5);
    echo.delayTime.value = 0.42;
    const fb = c.createGain();
    fb.gain.value = 0.34;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2000;
    music.connect(master);
    music.connect(echo);
    echo.connect(tone);
    tone.connect(fb);
    fb.connect(echo);
    tone.connect(master);

    [air, airFilter] = loop(c, 1, 'bandpass', 600, 0.6);
    [water, waterFilter] = loop(c, 1, 'bandpass', 1500, 1.4);
    [rumble] = loop(c, 0.4, 'lowpass', 140, 0.5);

    breeze();
    ripple();
    life();
    melody();
  }

  /** 拨弦音色：Karplus-Strong，按音高缓存 */
  function pluckBuffer(c: AC, midi: number) {
    const hit = plucks.get(midi);
    if (hit) return hit;
    const sr = c.sampleRate;
    const len = Math.floor(sr * (midi < 50 ? 3.4 : 2.6));
    const buf = c.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    const n = Math.max(2, Math.round(sr / hz(midi)));
    const decay = midi < 50 ? 0.998 : midi > 70 ? 0.993 : 0.996;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5;
      y[i] = prev;
    }
    for (let i = n; i < len; i++) y[i] = decay * 0.5 * (y[i - n] + y[i - n + 1]);
    plucks.set(midi, buf);
    return buf;
  }

  function pluck(midi: number, vol = 0.3, delay = 0, dest?: AudioNode, bend = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(ctx, midi);
    // 古琴的吟猱：按住的音轻轻往上滑一点
    if (bend) {
      src.playbackRate.setValueAtTime(1, t + 0.25);
      src.playbackRate.linearRampToValueAtTime(2 ** (bend / 12), t + 0.9);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + 1.8, 0.6);
    const pan = ctx.createStereoPanner?.();
    if (pan) {
      pan.pan.value = (Math.random() - 0.5) * 0.6;
      src.connect(g).connect(pan).connect(dest ?? music);
    } else src.connect(g).connect(dest ?? music);
    src.start(t);
    src.stop(t + 3.8);
  }

  /** 一个正弦音：钟、鸟、鸮、滴水 */
  function sine(f0: number, f1: number, vol: number, len: number, delay = 0, type: OscillatorType = 'sine') {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, len / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** 短促的木头声：按钮 */
  function tock(freq: number, vol: number, len = 0.06) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /** 一小段噪声：翻纸 */
  function burst(freq: number, vol: number, len: number, type: BiquadFilterType = 'bandpass') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(flt).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, len + 0.05);
  }

  /** 低沉的鼓：有人找上门 */
  function drum(vol = 0.35) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.75);
  }

  /** 金石相击：比斗、赤霄门远处的练武声 */
  function clang(vol = 0.12) {
    [1, 2.76, 5.4].forEach((k, i) => sine(820 * k, 800 * k, vol / (i + 1), 0.6 - i * 0.12, 0, 'triangle'));
  }

  /** 远处的钟：青岚宗 */
  function bell(vol = 0.12) {
    [1, 2.0, 2.98, 4.1].forEach((k, i) => sine(98 * k, 97 * k, vol / (i + 1.5), 5 - i, 0));
  }

  const place = () => (current.phase === 'year' ? current.place : null);

  /** 山风：时大时小 */
  function breeze() {
    if (ctx) {
      const t = ctx.currentTime;
      const p = place();
      const base = current.phase === 'title' ? 0.05 : current.phase === 'ending' ? 0.025 : p === 'qinglan' ? 0.05 : p === 'forest' ? 0.06 : p === 'chixiao' ? 0.045 : p === 'cave' ? 0.02 : p === 'market' ? 0.015 : 0.03;
      air.gain.setTargetAtTime(base * (0.5 + Math.random()), t, 1.3);
      airFilter.frequency.setTargetAtTime((p === 'forest' ? 280 : p === 'qinglan' ? 900 : 500) + Math.random() * 400, t, 1.6);
    }
    later(1700 + Math.random() * 2600, breeze);
  }

  /** 流水和人声都是快速起伏的带通噪声；洞府是低沉的回响 */
  function ripple() {
    if (ctx) {
      const t = ctx.currentTime;
      const p = place();
      const lv = p === 'vein' ? 0.05 : p === 'village' ? 0.012 : p === 'market' ? 0.03 : 0;
      water.gain.setTargetAtTime(lv * (0.6 + Math.random() * 0.8), t, 0.12);
      waterFilter.frequency.setTargetAtTime(p === 'market' ? 380 + Math.random() * 500 : 1100 + Math.random() * 1600, t, 0.08);
      waterFilter.Q.setTargetAtTime(p === 'market' ? 2.5 : 1.4, t, 0.2);
      rumble.gain.setTargetAtTime(p === 'cave' ? 0.09 : 0, t, 0.8);
    }
    later(p2ms(), ripple);
  }
  const p2ms = () => (place() === 'market' ? 160 + Math.random() * 200 : 90 + Math.random() * 120);

  /** 各地零星的声音：钟、金铁、鸟鸣、滴水、鸮啼、算盘 */
  function life() {
    let wait = 2500;
    if (ctx) {
      const p = place();
      const r = Math.random();
      if (p === 'qinglan' && r < 0.18) bell(0.1);
      else if (p === 'chixiao' && r < 0.35) { clang(0.05); if (Math.random() < 0.5) later(180 + Math.random() * 200, () => clang(0.04)); }
      else if (p === 'village' && r < 0.6) { const f = 2600 + Math.random() * 1600; sine(f, f * 1.25, 0.04, 0.09); sine(f * 1.1, f * 0.9, 0.035, 0.08, 0.13); }
      else if (p === 'vein' && r < 0.3) { const f = 3000 + Math.random() * 1200; sine(f, f * 1.3, 0.03, 0.07); }
      else if (p === 'cave' && r < 0.55) { const f = 1400 + Math.random() * 900; sine(f, f * 0.45, 0.07, 0.12); sine(f * 0.9, f * 0.4, 0.025, 0.12, 0.45); }
      else if (p === 'forest' && r < 0.2) { sine(380, 340, 0.05, 0.35); sine(370, 330, 0.045, 0.5, 0.55); }
      else if (p === 'market' && r < 0.5) { tock(1200 + Math.random() * 600, 0.03, 0.03); tock(1400, 0.025, 0.03); }
      wait = 1500 + Math.random() * 3500;
    }
    later(wait, life);
  }

  function melody() {
    let wait = 3000;
    if (ctx) {
      const key = current.phase === 'title' ? 'title' : current.phase === 'ending' ? 'ending' : MOOD[current.place ?? 'village'];
      const notes = SCALE[key];
      const quiet = key === 'dark' || key === 'ending';
      const r = Math.random();
      const a = notes[Math.floor(Math.random() * notes.length)];
      if (r < 0.55) pluck(a, quiet ? 0.2 : 0.16, 0, undefined, Math.random() < 0.25 ? 1 : 0);
      else if (r < 0.88) {
        const i = notes.indexOf(a);
        const b = notes[Math.min(notes.length - 1, i + 1 + Math.floor(Math.random() * 2))];
        pluck(a, 0.15);
        pluck(b, 0.12, 0.45 + Math.random() * 0.25);
      } else {
        // 泛音：轻轻一点，高八度
        pluck(a + 12, 0.08);
      }
      wait = (quiet ? 3400 : 2400) + Math.random() * (quiet ? 4000 : 2800);
    }
    later(wait, melody);
  }

  function ensure() {
    if (!Ctor || disposed) return false;
    if (!ctx) {
      try {
        ctx = new Ctor() as AC;
        build(ctx);
      } catch {
        ctx = null;
        return false;
      }
    }
    if (ctx.state === 'suspended' && !muted && !win?.document.hidden) void ctx.resume().catch(() => undefined);
    return true;
  }

  const onVisible = () => {
    if (!ctx) return;
    if (win?.document.hidden || muted) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  };
  win?.document.addEventListener('visibilitychange', onVisible);

  return {
    get muted() { return muted; },
    unlock() { ensure(); },
    play(cue) {
      if (muted || !ensure() || !ctx) return;
      switch (cue) {
        case 'tap': tock(820, 0.08); break;
        case 'page': burst(2200, 0.05, 0.07); break;
        case 'deny': tock(220, 0.12, 0.09); break;
        case 'pick': pluck(69, 0.24, 0, master); break;
        case 'confirm': pluck(62, 0.24, 0, master); pluck(69, 0.22, 0.12, master); break;
        case 'event': drum(0.3); pluck(45, 0.28, 0.06, master); break;
        case 'good': [62, 67, 69, 74].forEach((m, i) => pluck(m, 0.2, i * 0.12, master)); break;
        case 'bad': pluck(50, 0.26, 0, master); pluck(45, 0.24, 0.3, master, -1); break;
        case 'secret': [69, 76, 81, 86].forEach((m, i) => pluck(m, 0.16, i * 0.09, master)); break;
        case 'year': bell(0.16); pluck(55, 0.2, 0.2, master); pluck(62, 0.18, 0.5, master); break;
        case 'clash': clang(0.14); later(140, () => clang(0.1)); break;
      }
    },
    scene(sc) {
      current = sc;
    },
    setMuted(m) {
      muted = m;
      if (!ctx) {
        if (!m) ensure();
        return;
      }
      master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.05);
      if (m) later(200, () => { if (muted) void ctx?.suspend().catch(() => undefined); });
      else void ctx.resume().catch(() => undefined);
    },
    dispose() {
      disposed = true;
      for (const id of timers) win?.clearTimeout(id);
      timers.clear();
      win?.document.removeEventListener('visibilitychange', onVisible);
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
