import { describe, expect, it } from 'vitest';
import { ME } from '../game/core/world.ts';
import { moveTo } from '../game/player.ts';
import type { ToHost } from '../world/protocol.ts';
import { WorldSession } from '../world/session.ts';
import { esc, type Model, newUI, screen, sealText, type UI } from '../ui/view.ts';

type State = Extract<ToHost, { kind: 'state' }>;

/** 一个真的世界会话发出来的状态，配上界面状态 */
function model(seed = 7, tweak: (s: WorldSession) => void = () => undefined, ui: Partial<UI> = {}): Model & { s: WorldSession } {
  let last: State | null = null;
  const s = new WorldSession((m) => { if (m.kind === 'state') last = m; }, seed, { name: '林舟' });
  tweak(s);
  s.publish();
  const st = last as unknown as State;
  return { s, w: st.world, ai: st.ai, souls: st.souls, ui: { ...newUI(), screen: 'game', hasSave: true, ...ui } };
}

const arrive = (s: WorldSession, place: 'village' | 'market' | 'qinglan') => { moveTo(s.w, place); s.w.pending = []; };

/** controller.ts 认得的动作 */
const KNOWN = new Set(['continue', 'go-title', 'tab', 'sheet', 'close', 'ok', 'person', 'chat', 'place', 'move', 'main', 'buy', 'use', 'choose', 'offer', 'social', 'end', 'end-yes', 'end-no', 'retreat', 'news', 'ai-kind', 'mode']);
const acts = (html: string) => [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);

describe('正式界面', () => {
  it('开局：起名、选性别和灵根；有存档时可以接着玩', () => {
    const m = model(1, () => undefined, { screen: 'title', hasSave: false });
    const html = screen(m);
    expect(html).toContain('青冥录');
    expect(html).toContain('data-form="new"');
    expect(html).toContain('天灵根');
    expect(html).not.toContain('接着走下去');
    expect(screen({ ...m, ui: { ...m.ui, hasSave: true } })).toContain('接着走下去');
  });

  it('年初还没动身：舆图上七个地方，点了能看谁在那里、能去那里', () => {
    const m = model(2);
    const html = screen(m);
    expect(html).toContain('今年去哪');
    expect(html.match(/class="spot/g)).toHaveLength(7);
    expect(html).toContain('第1年');
    const place = screen({ ...m, ui: { ...m.ui, sheet: { kind: 'place', id: 'village' } } });
    expect(place).toContain('就留在柳溪村');
    expect(place).toContain('花婆婆');
  });

  it('到了地方：主事、此地的人、过年；坊市里能买丹药', () => {
    const m = model(3, (s) => arrive(s, 'village'));
    const html = screen(m);
    expect(html).toContain('今年的主事');
    expect(html).toContain('data-act="main"');
    expect(html).toContain('花婆婆');
    expect(html).toContain('data-act="end"');
    const market = screen(model(3, (s) => arrive(s, 'market')));
    expect(market).toContain('破境丹');
    expect(market).toContain('data-act="buy"');
  });

  it('过年前提醒：主事没做时先问一句', () => {
    const m = model(4, (s) => arrive(s, 'village'), { confirmEnd: true });
    const html = screen(m);
    expect(html).toContain('今年的主事还没做');
    expect(html).toContain('data-act="end-yes"');
  });

  it('找上门：弹出来，AI 替来人说的话和选项；结果纸条先于下一件', () => {
    const m = model(5, (s) => {
      arrive(s, 'village');
      s.w.pending = [{ id: 'duel:aman', kind: 'duel', who: 'aman', vars: { say: '（摩拳擦掌）来，过两招！' } }];
    });
    const html = screen(m);
    expect(html).toContain('阿蛮：「（摩拳擦掌）来，过两招！」');
    expect(html).toContain('data-act="choose"');
    const both = screen({ ...m, ui: { ...m.ui, outcome: '你赢了。' } });
    expect(both).toContain('你赢了。');
    expect(both).not.toContain('data-act="choose"');
  });

  it('人物：交情、心里的你、灵魂能做的事；在身边才能打交道', () => {
    const m = model(6, (s) => {
      arrive(s, 'village');
      const hua = s.w.people.hua;
      hua.mind.bond = 30;
      hua.mind.heart = '你这孩子嘴笨心实。';
      hua.mind.heartY = 1;
      s.w.knows.push('secret:wen');
    }, { sheet: { kind: 'person', id: 'hua' } });
    // 让灵魂客户端拿到能做的事（正常由引擎的 npcPlugin 同步）
    m.s.souls.declareAffordances('qingming.hua', m.s.affordances('qingming.hua'));
    const html = screen({ ...m, souls: m.s.souls.view() });
    expect(html).toContain('相熟');
    expect(html).toContain('「你这孩子嘴笨心实。」');
    expect(html).toContain('见面主动开口');
    expect(html).toContain('data-act="social"');
    expect(html).toContain('说出一个秘密');
    const far = screen({ ...m, ui: { ...m.ui, sheet: { kind: 'person', id: 'wen' } } });
    expect(far).not.toContain('data-act="social"');
    expect(far).toContain('去那里才能');
  });

  it('对话：AI 的话一律转义；正在想时显示边写边出的字；不能说时输入框关着', () => {
    const m = model(8, (s) => {
      arrive(s, 'village');
      s.w.chat.hua = [{ y: 1, from: 'me', text: '婆婆好' }, { y: 1, from: 'them', text: '<img src=x onerror=alert(1)>坐。' }];
    }, { sheet: { kind: 'chat', id: 'hua' } });
    const html = screen(m);
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<img[^>]*onerror/)).toBeNull();
    expect(html).toContain('&#60;img');
    expect(html).toContain('data-form="talk"');
    const live = screen({ ...m, ai: { ...m.ai!, thinking: 'hua' }, ui: { ...m.ui, stream: { id: 'hua', text: '娃儿来' } } });
    expect(live).toContain('娃儿来');
    expect(live).toMatch(/<input name="text"[^>]*disabled/);
    const away = screen({ ...m, ui: { ...m.ui, sheet: { kind: 'chat', id: 'wen' } } });
    expect(away).toMatch(/<input name="text"[^>]*disabled/);
  });

  it('设置：密钥从不画进页面，只说已保存；用量三档和交情表都在', () => {
    const m = model(9, () => undefined, { sheet: { kind: 'settings' }, settings: { kind: 'deepseek', hasKey: true, model: 'deepseek-flash', mode: 'normal', claude: false } });
    const html = screen(m);
    expect(html).toContain('已保存（不显示）');
    expect(html).not.toMatch(/name="key"[^>]*value=/);
    expect(html).toContain('尽兴');
    expect(html).toContain('刻骨');
  });

  it('江湖、自身、人物几页都画得出来', () => {
    for (const tab of ['map', 'people', 'news', 'self'] as const) {
      const html = screen(model(10, (s) => arrive(s, 'qinglan'), { tab }));
      expect(html).toContain('class="dock"');
      expect(html.length).toBeGreaterThan(500);
    }
    const heard = screen(model(10, (s) => {
      arrive(s, 'qinglan');
      s.w.heard.push({ y: 1, at: 'qinglan', a: 'lu', b: 'tang', lines: [{ who: 'lu', text: '小棠，过来。' }, { who: 'tang', text: '师兄！' }] });
    }, { tab: 'news', newsFilter: 'heard' }));
    expect(heard).toContain('陆沉舟：小棠，过来。');
  });

  it('结局：小传和他们心里的你', () => {
    const html = screen(model(11, (s) => {
      s.w.phase = 'ending';
      s.w.ending = { kind: 'age', y: 60 };
      s.w.me.alive = false;
      s.w.people.hua.mind.heart = '这娃儿，没白疼。';
    }));
    expect(html).toContain('坐化');
    expect(html).toContain('这娃儿，没白疼。');
    expect(html).toContain('data-act="go-title"');
  });

  it('每个按钮的动作控制器都认得', () => {
    const htmls = [
      screen(model(12, () => undefined, { screen: 'title' })),
      screen(model(12)),
      screen(model(12, (s) => arrive(s, 'village'))),
      screen(model(12, (s) => arrive(s, 'market'), { sheet: { kind: 'person', id: 'liu' } })),
      screen(model(12, (s) => arrive(s, 'village'), { sheet: { kind: 'chat', id: 'hua' } })),
      screen(model(12, () => undefined, { sheet: { kind: 'settings' } })),
      screen(model(12, () => undefined, { sheet: { kind: 'retreat' } })),
      screen(model(12, (s) => arrive(s, 'village'), { sheet: { kind: 'gift', id: 'hua' } })),
      screen(model(12, () => undefined, { sheet: { kind: 'year', from: 1, to: 1 } })),
      ...(['map', 'people', 'news', 'self'] as const).map((tab) => screen(model(12, (s) => arrive(s, 'village'), { tab }))),
    ];
    for (const a of htmls.flatMap(acts)) expect(KNOWN, a).toContain(a);
  });

  it('印章：两个字的名字照写，三个字取后两个', () => {
    expect(sealText('温玄')).toBe('温玄');
    expect(sealText('沈清禾')).toBe('清禾');
    expect(sealText('花婆婆')).toBe('花婆');
    expect(esc('<a href="x">')).toBe('&#60;a href=&#34;x&#34;&#62;');
    expect(ME).toBe('me');
  });
});
