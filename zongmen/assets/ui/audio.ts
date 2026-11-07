// 声音：全部用 Web Audio 现场合成，不用任何外部素材（来源记在 docs/ASSETS.md）。
// 雨声底噪、开场钟声、翻书声、矛盾成立的鼓点、雷声、结局的五声音阶拨弦。
// 浏览器要求用户先点一下才能出声，所以在第一次点击时 unlock。

export interface Sound {
  unlock(): void;
  setVolume(v: number): void;
  rain(on: boolean): void;
  bell(): void;
  page(): void;
  sting(): void;
  thunder(): void;
  ending(success: boolean): void;
  dispose(): void;
}

export function createSound(win: (Window & typeof globalThis) | null | undefined): Sound {
  const AC = (win as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } | null | undefined);
  const Ctor = AC?.AudioContext ?? AC?.webkitAudioContext;
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let volume = 0.6;
  let rainNodes: { src: AudioBufferSourceNode; gain: GainNode } | undefined;
  let wantRain = false;
  let noise: AudioBuffer | undefined;

  const ready = () => !!ctx && !!master && ctx.state !== 'closed';
  const noiseBuffer = () => {
    if (noise || !ctx) return noise;
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    return noise;
  };

  /** 一段带包络的噪声 */
  const burst = (dur: number, peak: number, filter: BiquadFilterType, freq: number, q = 0.7, delay = 0) => {
    if (!ready()) return;
    const t = ctx!.currentTime + delay;
    const src = ctx!.createBufferSource();
    src.buffer = noiseBuffer()!;
    const f = ctx!.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  };

  /** 一个衰减的音（拨弦、钟） */
  const tone = (freq: number, dur: number, peak: number, type: OscillatorType, delay = 0, bend = 0) => {
    if (!ready()) return;
    const t = ctx!.currentTime + delay;
    const o = ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq * (1 + bend), t);
    if (bend) o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  };

  const startRain = () => {
    if (!ready() || rainNodes) return;
    const src = ctx!.createBufferSource();
    src.buffer = noiseBuffer()!;
    src.loop = true;
    const hp = ctx!.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const gain = ctx!.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.09, ctx!.currentTime + 2);
    src.connect(hp).connect(lp).connect(gain).connect(master!);
    src.start();
    rainNodes = { src, gain };
  };
  const stopRain = () => {
    if (!rainNodes || !ctx) return;
    const { src, gain } = rainNodes;
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    src.stop(ctx.currentTime + 1.1);
    rainNodes = undefined;
  };

  return {
    unlock() {
      if (ctx || !Ctor) {
        if (ctx?.state === 'suspended') void ctx.resume();
        return;
      }
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
        if (wantRain) startRain();
      } catch {
        ctx = undefined;
      }
    },
    setVolume(v) {
      volume = v;
      if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },
    rain(on) {
      wantRain = on;
      if (on) startRain();
      else stopRain();
    },
    bell() {
      // 寺钟：基音加几个不谐和的泛音，长衰减
      for (const [r, a, d] of [[1, 0.35, 4.5], [2, 0.12, 3], [2.76, 0.1, 2.4], [5.4, 0.05, 1.2]] as const) tone(98 * r, d, a, 'sine');
    },
    page() {
      burst(0.14, 0.18, 'highpass', 2500);
      burst(0.1, 0.1, 'bandpass', 4200, 1.2, 0.06);
    },
    sting() {
      // 一声闷鼓 + 两个挨得很近的低音
      tone(90, 0.5, 0.5, 'sine', 0, 0.6);
      burst(0.3, 0.3, 'lowpass', 160);
      tone(110, 0.9, 0.12, 'triangle', 0.05);
      tone(116.5, 0.9, 0.12, 'triangle', 0.05);
    },
    thunder() {
      burst(2.8, 0.35, 'lowpass', 140, 0.5);
      burst(1.2, 0.18, 'lowpass', 400, 0.5, 0.15);
    },
    ending(success) {
      // 拨弦：成功用宫调五声音阶上行，失败用羽调下行、慢一些
      const notes = success ? [293.7, 329.6, 370, 440, 493.9, 587.3, 493.9, 587.3] : [440, 392, 329.6, 293.7, 261.6, 220];
      const step = success ? 0.32 : 0.55;
      notes.forEach((f, i) => {
        tone(f, 1.6, 0.16, 'triangle', i * step, 0.02);
        tone(f * 2, 0.6, 0.04, 'sine', i * step);
      });
    },
    dispose() {
      stopRain();
      void ctx?.close();
      ctx = undefined;
    },
  };
}
