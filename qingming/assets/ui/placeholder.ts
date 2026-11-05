// 临时界面：把世界的状态打出来，确认引擎、灵魂和 AI 通路接得上。第 3 阶段换成正式界面。
// 现在多了一行 AI 设置（由谁来演、DeepSeek 密钥、用量档）和一行账：花了多少、花在谁身上。
// 密钥只存在本机浏览器里，只交给 Host 这一侧的提供方，游戏世界那一侧看不到。

import { CHANNEL, type ToEngine, type ToHost } from '../world/protocol.ts';
import { type HostLink, linkProvider } from '../souls/host.ts';
import { type AiConfig, type AiKind, loadConfig, providerFor, saveConfig } from '../souls/config.ts';
import { createMeter, totalsText } from '../souls/meter.ts';
import { MODES, type Mode } from '../game/mind/bond.ts';
import { placeName, realmText } from '../game/core/world.ts';
import { heardText } from '../game/ai/souls.ts';

const storageOf = (win: Window | null) => {
  try { return win?.localStorage ?? null; } catch { return null; }
};

export function mountPlaceholder(host: { uiRoot: HTMLElement; port: MessagePort }) {
  const doc = host.uiRoot.ownerDocument;
  const win = doc.defaultView as (Window & { claude?: any }) | null;
  const storage = storageOf(win);
  let cfg: AiConfig = loadConfig(storage);
  const meter = createMeter(storage);
  let sample: unknown = null;
  let link: HostLink | null = null;
  let last: Extract<ToHost, { kind: 'state' }> | null = null;

  const wrap = doc.createElement('div');
  wrap.style.cssText = 'min-height:100%;background:#16181d;color:#e8e4da;font:14px/1.6 system-ui,sans-serif';
  const bar = doc.createElement('form');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:10px 16px;border-bottom:1px solid #333';
  bar.innerHTML = `
    <label>AI <select name="kind"><option value="offline">离线</option><option value="deepseek">DeepSeek</option><option value="claude">Claude</option></select></label>
    <label>密钥 <input name="key" type="password" autocomplete="off" placeholder="sk-…" style="width:13em"></label>
    <label>模型 <input name="model" autocomplete="off" style="width:9em"></label>
    <label>用量 <select name="mode">${(Object.keys(MODES) as Mode[]).map((m) => `<option value="${m}">${MODES[m].name}</option>`).join('')}</select></label>
    <button type="submit">保存</button>`;
  const spend = doc.createElement('div');
  spend.style.cssText = 'padding:4px 16px;color:#a9b4a0;font-size:13px;white-space:pre-wrap';
  const box = doc.createElement('pre');
  box.style.cssText = 'margin:0;padding:16px;font:inherit;white-space:pre-wrap';
  box.textContent = '青冥录 · 连接中……';
  wrap.append(bar, spend, box);
  host.uiRoot.append(wrap);

  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => bar.elements.namedItem(name) as T;
  const fill = () => {
    field<HTMLSelectElement>('kind').value = cfg.kind;
    field<HTMLInputElement>('key').value = cfg.apiKey;
    field<HTMLInputElement>('model').value = cfg.model;
    field<HTMLSelectElement>('mode').value = cfg.mode;
  };
  fill();

  const send = (m: ToEngine, transfer: Transferable[] = []) => host.port.postMessage(m, transfer);

  const renderSpend = () => {
    const souls = meter.bySoul().slice(0, 4).map(([id, t]) => {
      const pid = id.replace(/^qingming\./, '');
      return `${last?.world.people[pid]?.name ?? pid} ${t.calls} 次`;
    });
    const ai = last?.ai;
    spend.textContent = [
      `本局：${totalsText(meter.game)}${souls.length ? `　花在：${souls.join('、')}` : ''}`,
      `这台设备一共：${totalsText(meter.all)}`,
      ai ? `今年 NPC 自己用了 ${ai.used}/${ai.cap} 次 AI（你自己说的话不算）` : '',
    ].filter(Boolean).join('\n');
  };
  const offMeter = meter.onChange(renderSpend);

  const connect = async () => {
    const old = link;
    const { provider, label } = providerFor(cfg, { meter, sample });
    link = linkProvider(provider);
    send({ channel: CHANNEL, kind: 'intelligence', providerId: link.providerId, label, mode: cfg.mode }, [link.port]);
    if (old) await old.close();
  };

  bar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next: AiConfig = {
      kind: field<HTMLSelectElement>('kind').value as AiKind,
      apiKey: field<HTMLInputElement>('key').value.trim(),
      model: field<HTMLInputElement>('model').value.trim() || cfg.model,
      mode: field<HTMLSelectElement>('mode').value as Mode,
    };
    const relink = next.kind !== cfg.kind || next.apiKey !== cfg.apiKey || next.model !== cfg.model;
    cfg = next;
    saveConfig(storage, cfg);
    if (relink) void connect();
    else send({ channel: CHANNEL, kind: 'budget', mode: cfg.mode });
  });

  const onMessage = (ev: MessageEvent<ToHost>) => {
    const m = ev.data;
    if (!m || m.channel !== CHANNEL || m.kind !== 'state') return;
    if (last && m.world.seed !== last.world.seed) meter.resetGame();
    last = m;
    const w = m.world;
    const tiers = m.ai.tiers;
    const here = Object.values(w.people).filter((n) => n.alive && n.place === w.me.place);
    const close = Object.values(w.people).filter((n) => n.alive && n.mind.heart);
    box.textContent = [
      `青冥录（界面制作中）  第${w.year}年 · ${w.me.name} · ${realmText(w.me)} · 在${placeName(w.me.place)}`,
      `AI：${m.ai.provider} · 用量${MODES[m.ai.mode].name}${m.ai.thinking ? ` · ${w.people[m.ai.thinking]?.name}正在想` : ''}${m.ai.note ? ` · ${m.ai.note}` : ''}`,
      '',
      ...here.map((n) => `${n.name} ${realmText(n)}［${tiers[n.id] ?? '陌路'}］：${n.plan.asking ? '（正在想今年做什么）' : n.plan.why}${n.plan.by === 'ai' ? '（自己拿的主意）' : ''}`),
      ...(close.length ? ['', '心里的你：', ...close.map((n) => `  ${n.name}［${tiers[n.id]}］：「${n.mind.heart}」`)] : []),
      ...((w.heard ?? []).length ? ['', '听见的话：', ...w.heard.slice(-2).map((h) => `  第${h.y}年 ${placeName(h.at)}\n${heardText(w, h).replace(/^/gm, '    ')}`)] : []),
      '',
      ...w.news.slice(-6).map((x) => `${x.y}年 ${x.text}`),
    ].join('\n');
    renderSpend();
  };
  host.port.addEventListener('message', onMessage);
  host.port.start();

  void connect();
  send({ channel: CHANNEL, kind: 'hello' });

  // 在 claude.ai 里打开时，可以让 Claude 来演
  try {
    win?.claude?.use?.('sample')?.then((fn: unknown) => {
      sample = fn;
      if (cfg.kind === 'claude') void connect();
    }, () => undefined);
  } catch { /* 不在 claude.ai 里 */ }

  return {
    dispose() {
      host.port.removeEventListener('message', onMessage);
      offMeter();
      void link?.close();
      wrap.remove();
    },
  };
}
