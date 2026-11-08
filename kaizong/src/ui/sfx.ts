// 音效：用 ZzFX（Frank Force 写的开源小合成器，MIT）现场合成，不用音频文件。
// 浏览器要等玩家点过一下才能出声；没点过或者关了声音就什么都不做。

type Z = typeof import('zzfx');
let lib: Z | null = null;
let loading = false;
let on = true;
try { on = localStorage.getItem('kaizong.sound') !== 'off'; } catch { /* 读不到就开着 */ }

export const soundOn = () => on;
export function setSound(v: boolean) {
  on = v;
  try { localStorage.setItem('kaizong.sound', v ? 'on' : 'off'); } catch { /* 存不下就算了 */ }
}

/** 第一次点击时调用：加载合成器、唤醒音频 */
export function unlockSound() {
  if (lib || loading) { void lib?.ZZFX.audioContext.resume(); return; }
  loading = true;
  import('zzfx').then((m) => { lib = m; m.ZZFX.volume = 0.25; void m.ZZFX.audioContext.resume(); }).catch(() => { /* 没声音也能玩 */ });
}

// ZzFX 参数：音量, 随机, 频率, 起音, 持续, 释放, 波形, 波形曲线, 滑音, 滑音变化, 跳音, 跳音时刻, 重复, 噪声, 调制, 降采样, 延迟, 持续音量, 衰减, 颤音, 滤波
const SOUNDS = {
  click: [0.4, 0, 700, 0.005, 0.01, 0.04, 0, 1.5],
  coin: [0.5, 0.05, 1675, 0, 0.03, 0.18, 1, 1.8, 0, 0, 837, 0.05],
  level: [0.6, 0.05, 880, 0.01, 0.04, 0.25, 0, 1.5, 0, 0, 440, 0.06],
  bell: [0.7, 0, 660, 0.004, 0.03, 0.9, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.18, 0.6],
  build: [0.6, 0.1, 160, 0.005, 0.05, 0.25, 4, 1, -2, 0, 0, 0, 0.08, 0.5],
  fail: [0.8, 0.05, 140, 0.01, 0.15, 0.6, 2, 1.4, -4, 0, 0, 0, 0, 0.6],
  drum: [1, 0.05, 70, 0.005, 0.08, 0.4, 0, 1, -1, 0, 0, 0, 0, 0.3],
  whoosh: [0.4, 0.1, 300, 0.05, 0.1, 0.3, 4, 1, 3, 0, 0, 0, 0, 0.3],
} as const;
type Name = keyof typeof SOUNDS | 'success' | 'chime';

export function sfx(name: Name) {
  if (!on || !lib) return;
  const z = lib.zzfx;
  try {
    if (name === 'success') {
      // 上行三音 + 一声钟
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => z(0.6, 0, f, 0.01, 0.08, 0.35, 0, 1.2), i * 110));
      setTimeout(() => z(...(SOUNDS.bell as unknown as number[])), 460);
      return;
    }
    if (name === 'chime') {
      [784, 988].forEach((f, i) => setTimeout(() => z(0.45, 0, f, 0.005, 0.03, 0.5, 0, 1), i * 90));
      return;
    }
    z(...(SOUNDS[name] as unknown as number[]));
  } catch { /* 出不了声就算了 */ }
}
