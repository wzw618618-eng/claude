// 临时界面：先验证场景能画出来。完整界面随后替换。

import { SHOTS } from '../scene/layout';
import { STAGE_CHANNEL } from '../scene/refs';

export async function createGameUi(opts: { uiRoot: HTMLElement; port?: MessagePort }) {
  const doc = opts.uiRoot.ownerDocument;
  const el = doc.createElement('div');
  el.textContent = '宗门内奸';
  el.style.cssText = 'position:absolute;left:16px;top:12px;color:#ffd27a;font:20px sans-serif';
  opts.uiRoot.appendChild(el);
  const send = (m: object) => opts.port?.postMessage({ channel: STAGE_CHANNEL, ...m });
  opts.port?.start?.();
  send({ kind: 'cast', ids: ['lin_qingzhu', 'su_xiaoyu', 'bai_zhi', 'zhao_tiezhu', 'qian_duoduo'] });
  send({ kind: 'shot', shot: SHOTS.plaza, instant: true });
  return { dispose: () => el.remove() };
}
