// 第 2 阶段的临时界面：只把世界的状态打出来，确认引擎、灵魂和 AI 通路接得上。第 3 阶段换成正式界面。

import { CHANNEL, type ToEngine, type ToHost } from '../world/protocol.ts';
import { linkProvider } from '../souls/host.ts';
import { createOfflineProvider } from '../souls/providers.ts';
import { placeName, realmText } from '../game/core/world.ts';

export function mountPlaceholder(host: { uiRoot: HTMLElement; port: MessagePort }) {
  const doc = host.uiRoot.ownerDocument;
  const box = doc.createElement('pre');
  box.style.cssText = 'margin:0;padding:16px;font:14px/1.6 system-ui,sans-serif;white-space:pre-wrap;color:#e8e4da;background:#16181d;min-height:100%';
  box.textContent = '青冥录 · 连接中……';
  host.uiRoot.append(box);
  const send = (m: ToEngine, transfer: Transferable[] = []) => host.port.postMessage(m, transfer);
  const onMessage = (ev: MessageEvent<ToHost>) => {
    const m = ev.data;
    if (!m || m.channel !== CHANNEL || m.kind !== 'state') return;
    const w = m.world;
    const here = Object.values(w.people).filter((n) => n.alive && n.place === w.me.place);
    box.textContent = [
      `青冥录（界面制作中）  第${w.year}年 · ${w.me.name} · ${realmText(w.me)} · 在${placeName(w.me.place)}`,
      `AI：${m.ai.provider}${m.ai.thinking ? ` · ${w.people[m.ai.thinking]?.name}正在想` : ''}`,
      '',
      ...here.map((n) => `${n.name} ${realmText(n)}：${n.plan.asking ? '（正在想今年做什么）' : n.plan.why}${n.plan.by === 'ai' ? '（自己拿的主意）' : ''}`),
      '',
      ...w.news.slice(-6).map((x) => `${x.y}年 ${x.text}`),
    ].join('\n');
  };
  host.port.addEventListener('message', onMessage);
  host.port.start();
  const link = linkProvider(createOfflineProvider());
  send({ channel: CHANNEL, kind: 'intelligence', providerId: link.providerId, label: '离线' }, [link.port]);
  send({ channel: CHANNEL, kind: 'hello' });
  return {
    dispose() {
      host.port.removeEventListener('message', onMessage);
      void link.close();
      box.remove();
    },
  };
}
