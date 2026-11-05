// 声音：全部用 Web Audio 现场合成，没有音频文件。
// - 风雪：滤过的白噪声，阵风时大时小，暴风雪时最响；
// - 柴火：夜里低低的火声，加上随机的噼啪；
// - 配乐：像古琴一样的拨弦（Karplus-Strong 算法），五声音阶，稀稀落落地弹，白天高一些，夜里低一些；
// - 按键和事件提示音。
// 浏览器要求先有一次点击才能出声，所以第一次点击时才真正创建 AudioContext。

export type Cue =
  | 'tap' | 'pick' | 'page' | 'confirm' | 'deny'
  | 'event' | 'good' | 'secret' | 'talk' | 'dawn' | 'dusk' | 'night';

export interface SoundScene {
  phase: 'title' | 'day' | 'evening' | 'night' | 'ending';
  weather: 'clear' | 'snow' | 'blizzard';
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
  new: 'confirm', continue: 'confirm', 'reset-yes': 'confirm',
  pick: 'tap', set: 'pick', adopt: 'pick', 'adopt-all': 'pick',
  person: 'tap', chat: 'tap', topic: 'tap', close: 'page', tab: 'page', info: 'tap',
  choose: 'tap', ok: 'tap', 'end-check': 'tap', 'end-day': 'confirm', night: 'confirm', sleep: 'confirm',
  policy: 'tap', build: 'pick', cancel: 'tap', report: 'page', tip: 'tap', 'tip-skip': 'page', sound: 'tap',
};

// 五声音阶（C D E G A），用 MIDI 音高表示
const SCALE = {
  day: [60, 62, 64, 67, 69, 72, 74, 76],
  evening: [57, 60, 62, 64, 67, 69, 72],
  night: [45, 48, 50, 52, 55, 57, 60, 62],
  title: [57, 60, 62, 64, 67, 69],
  ending: [52, 55, 57, 60, 62, 64, 67],
};
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function createSound(win: Window | null, opts: { muted?: boolean } = {}): Sound {
  type AC = AudioContext;
  const Ctor = (win as any)?.AudioContext ?? (win as any)?.webkitAudioContext;
  let ctx: AC | null = null;
  let muted = !!opts.muted;
  let master!: GainNode;
  let music!: GainNode;
  let wind!: GainNode;
  let windFilter!: BiquadFilterNode;
  let fire!: GainNode;
  let noise!: AudioBuffer;
  let current: SoundScene = { phase: 'title', weather: 'snow' };
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

  function build(c: AC) {
    master = c.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(c.destination);

    // 白噪声
    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // 配乐：干声 + 一路带衰减的回声，听起来像在空屋子里
    music = c.createGain();
    music.gain.value = 0.55;
    const echo = c.createDelay(1);
    echo.delayTime.value = 0.32;
    const fb = c.createGain();
    fb.gain.value = 0.36;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    music.connect(master);
    music.connect(echo);
    echo.connect(tone);
    tone.connect(fb);
    fb.connect(echo);
    tone.connect(master);

    // 风
    const w = c.createBufferSource();
    w.buffer = noise;
    w.loop = true;
    windFilter = c.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.7;
    wind = c.createGain();
    wind.gain.value = 0;
    w.connect(windFilter);
    windFilter.connect(wind);
    wind.connect(master);
    w.start();

    // 火：低频的呼呼声
    const f = c.createBufferSource();
    f.buffer = noise;
    f.loop = true;
    f.playbackRate.value = 0.5;
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    fire = c.createGain();
    fire.gain.value = 0;
    f.connect(low);
    low.connect(fire);
    fire.connect(master);
    f.start();

    gust();
    crackle();
    melody();
  }

  /** 拨弦音色：Karplus-Strong，按音高缓存 */
  function pluckBuffer(c: AC, midi: number) {
    const hit = plucks.get(midi);
    if (hit) return hit;
    const sr = c.sampleRate;
    const len = Math.floor(sr * (midi < 50 ? 3.2 : 2.4));
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

  function pluck(midi: number, vol = 0.3, delay = 0, dest?: AudioNode) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(ctx, midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + 1.6, 0.5);
    const pan = ctx.createStereoPanner?.();
    if (pan) {
      pan.pan.value = (Math.random() - 0.5) * 0.6;
      src.connect(g).connect(pan).connect(dest ?? music);
    } else src.connect(g).connect(dest ?? music);
    src.start(t);
    src.stop(t + 3.5);
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

  /** 一小段噪声：翻纸、噼啪 */
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

  /** 低沉的鼓：有事发生 */
  function drum(vol = 0.35) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.65);
  }

  const windLevel = () => {
    const base = { clear: 0.018, snow: 0.045, blizzard: 0.12 }[current.weather];
    return current.phase === 'title' ? 0.05 : current.phase === 'ending' ? 0.02 : current.phase === 'night' ? base * 1.25 : base;
  };

  function gust() {
    if (ctx) {
      const t = ctx.currentTime;
      const lv = windLevel() * (0.55 + Math.random() * 0.9);
      wind.gain.setTargetAtTime(lv, t, 1.2);
      windFilter.frequency.setTargetAtTime(320 + Math.random() * (current.weather === 'blizzard' ? 900 : 500), t, 1.5);
    }
    later(1800 + Math.random() * 2600, gust);
  }

  function crackle() {
    if (ctx && current.phase === 'night') burst(1800 + Math.random() * 2500, 0.05 + Math.random() * 0.12, 0.02 + Math.random() * 0.05, 'highpass');
    later(current.phase === 'night' ? 70 + Math.random() * 420 : 600, crackle);
  }

  function melody() {
    let wait = 3000;
    if (ctx) {
      const notes = SCALE[current.phase];
      const quiet = current.phase === 'night' || current.phase === 'ending';
      const r = Math.random();
      const a = notes[Math.floor(Math.random() * notes.length)];
      if (r < 0.62) pluck(a, quiet ? 0.2 : 0.17);
      else if (r < 0.9) {
        const i = notes.indexOf(a);
        const b = notes[Math.min(notes.length - 1, i + 1 + Math.floor(Math.random() * 2))];
        pluck(a, 0.16);
        pluck(b, 0.13, 0.42 + Math.random() * 0.2);
      }
      wait = (quiet ? 3200 : 2300) + Math.random() * (quiet ? 3800 : 2600);
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

  function applyScene() {
    if (!ctx) return;
    const t = ctx.currentTime;
    fire.gain.setTargetAtTime(current.phase === 'night' ? 0.05 : 0, t, 0.8);
    wind.gain.setTargetAtTime(windLevel(), t, 1);
  }

  return {
    get muted() { return muted; },
    unlock() { ensure(); },
    play(cue) {
      if (muted || !ensure() || !ctx) return;
      switch (cue) {
        case 'tap': tock(820, 0.09); break;
        case 'page': burst(2200, 0.05, 0.07); break;
        case 'deny': tock(220, 0.12, 0.09); break;
        case 'pick': pluck(72, 0.28, 0, master); break;
        case 'confirm': pluck(67, 0.26, 0, master); pluck(72, 0.24, 0.1, master); break;
        case 'event': drum(0.32); pluck(45, 0.3, 0.05, master); break;
        case 'good': pluck(72, 0.22, 0, master); pluck(76, 0.2, 0.12, master); pluck(79, 0.2, 0.24, master); break;
        case 'secret': [69, 76, 81, 84].forEach((m, i) => pluck(m, 0.2, i * 0.09, master)); break;
        case 'talk': pluck(SCALE.evening[Math.floor(Math.random() * 5) + 2], 0.14, 0, master); break;
        case 'dawn': [60, 67, 72, 76].forEach((m, i) => pluck(m, 0.2, i * 0.16, master)); break;
        case 'dusk': pluck(69, 0.2, 0, master); pluck(64, 0.2, 0.22, master); break;
        case 'night': pluck(45, 0.3, 0, master); pluck(52, 0.22, 0.3, master); break;
      }
    },
    scene(sc) {
      const changed = sc.phase !== current.phase || sc.weather !== current.weather;
      current = sc;
      if (changed) applyScene();
    },
    setMuted(m) {
      muted = m;
      if (!ctx) {
        if (!m) ensure();
        return;
      }
      master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
      if (m) later(200, () => { if (muted) void ctx?.suspend().catch(() => undefined); });
      else {
        void ctx.resume().catch(() => undefined);
        applyScene();
      }
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
