import { describe, expect, it } from 'vitest';
import { createMeter, type AiConfig } from '../src/ai/config';
import { newWorld, randomStart } from '../src/game/setup';
import { gameView, titleView, type Tab, type Ui } from '../src/ui/views';

const config: AiConfig = { kind: 'deepseek', apiKey: 'test-secret-not-to-render', mode: 'normal' };
const freshUi = (): Ui => ({ screen: 'title', tab: 'report', modal: null, setup: randomStart(7), busy: null, toast: null, sort: 'rank', chats: {}, streaming: null, testPick: {}, showHistory: false, hasSave: false, team: {}, drawer: null, speed: 1, letter: null, hold: false, pauseOn: 'big' });

describe('UI regression', () => {
  it('renders title settings with real configuration without exposing the key', () => {
    const ui = freshUi();
    ui.modal = { kind: 'settings' };
    const html = titleView(ui, config, createMeter());
    expect(html).toContain('已填（重新填写可替换）');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain(config.apiKey);
  });
  it.each<Tab>(['report', 'people', 'staff', 'recruit', 'sect', 'world'])('renders %s with escaped player names and actionable overview', tab => {
    const w = newWorld({ ...randomStart(7), sectName: '<img onerror=alert(1)>' });
    const ui = freshUi(); ui.screen = 'game'; ui.tab = tab;
    const html = gameView(w, ui, config, createMeter());
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('aria-labelledby="dw-title"');
    expect(html).toContain(`aria-current="page" data-act="tab" data-id="${tab}"`);
    expect(html).toContain('data-act="tab" data-id="staff"');
    expect(html).not.toContain(config.apiKey);
  });
});
