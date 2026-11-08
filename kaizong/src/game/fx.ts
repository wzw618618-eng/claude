// 给画面的提示：规则层算出一件事，顺手丢一条进来；界面每帧取走，变成飘字、气泡、横幅、音效。
// 不存档、不影响规则；测试和模拟里没人取，满了就不再收。

export type Tone = 'good' | 'bad' | 'gold' | 'info';

export type Fx =
  /** 在某处飘一行字：at 是殿堂 id、'main'（主殿）、'gate'（山门）或 'p:人id' */
  | { k: 'float'; at: string; text: string; tone: Tone }
  /** 某人头上冒一句话 */
  | { k: 'say'; who: string; text: string }
  /** 修为长了一阶 */
  | { k: 'level'; who: string; text: string }
  /** 冲关出结果 */
  | { k: 'break'; who: string; ok: boolean }
  /** 殿堂落成或扩建好了 */
  | { k: 'built'; hall: string }
  /** 屏幕正上方的横幅 */
  | { k: 'banner'; text: string; tone: Tone }
  /** 纪事里新添一条 */
  | { k: 'report'; text: string; tone: Tone | 'story'; about: string[]; big?: boolean; quote?: { who: string; text: string } }
  /** 来了新的待裁决 */
  | { k: 'decision'; id: string };

let queue: Fx[] = [];

export function emit(f: Fx) {
  if (queue.length < 300) queue.push(f);
}

export function drainFx(): Fx[] {
  const out = queue;
  queue = [];
  return out;
}
