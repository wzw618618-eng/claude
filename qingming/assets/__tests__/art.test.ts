import { describe, expect, it } from 'vitest';
import { newWorld } from '../game/core/world.ts';
import { PLACE_ORDER } from '../game/data/world-data.ts';
import { art, portraitKey } from '../ui/art.ts';
import { newUI, screen } from '../ui/view.ts';
describe('美术接入', () => {
  it('角色、新人、地点、结局和宝物均有 WebP 资源', () => {
    const w = newWorld(7);
    const keys: string[] = [...PLACE_ORDER, 'title', 'ending_age', 'ending_dead', 'ending_ascend', 'sword', 'letter'];
    for (const n of Object.values(w.people)) {
      keys.push(portraitKey(n));
      expect(art(portraitKey(n), 'avatar')).toMatch(/^data:image\/webp;base64,UklGR/);
    }
    for (const sect of ['qinglan', 'chixiao', ''] as const) for (const gender of ['m', 'f'] as const) {
      const key = portraitKey({ id: 'newborn_300', sect, gender }); keys.push(key);
      expect(art(key, 'avatar')).toMatch(/^data:image\/webp;base64,UklGR/);
    }
    for (const key of keys) expect(art(key), key).toMatch(/^data:image\/webp;base64,UklGR/);
  });
  it('人物名称转义，已故人物立绘褪色', () => {
    const w = newWorld(7); w.people.shen.name = '"<script>坏</script>'; w.people.shen.alive = false;
    const html = screen({ w, ai: null, souls: [], ui: { ...newUI(), screen: 'game', sheet: { kind: 'person', id: 'shen' } } });
    expect(html).not.toContain('<script>坏');
    expect(html).toContain('character-art gone');
    expect(html).not.toContain('src=""');
  });
});
