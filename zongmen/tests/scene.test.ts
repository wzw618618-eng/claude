import { describe, expect, it } from 'vitest';
import { defaultData } from '../assets/game/data/index';
import { characterHeight, characterModel, lookOf, LOCATION_MODELS, PAL } from '../assets/scene/models';
import { voxelMesh, VoxelModel } from '../assets/scene/voxel';
import { fitOverviewShot, fitPlazaShot, LOCATION_LABEL_HEIGHT, LOCATION_POS, PLAZA_SLOTS, projectToScreen, SHOTS, stepShot } from '../assets/scene/layout';
import { portraitGrid } from '../assets/ui/portrait';
import { esc, relatedClues } from '../assets/ui/view';
import { GameSession } from '../assets/game/game/state';
import { TemplateClient } from '../assets/game/ai/templateResponder';
import type { AssetGuid } from '@forgeax/engine/types';

const data = defaultData();
const GUID = '00000000-0000-0000-0000-000000000000' as unknown as AssetGuid;

describe('体素网格', () => {
  it('只生成朝外的面，带顶点颜色，普通和发光分两个子网格', () => {
    const m = new VoxelModel().box(0, 0, 0, 1, 1, 1, '#ff0000').set(0, 2, 0, '#ffaa00', true);
    const mesh = voxelMesh(m, { scale: 1, material: GUID, glowMaterial: GUID });
    expect(mesh.submeshes).toHaveLength(2);
    expect(mesh.materialSlots.map((s) => s.slotName)).toEqual(['surface', 'glow']);
    // 2x2x2 实心块：24 个外表面；发光块与下面的普通块之间的面两边都保留
    const faces = mesh.submeshes.reduce((n, s) => n + s.indexCount / 6, 0);
    expect(faces).toBe(24 + 6);
    expect(mesh.attributes.color).toBeInstanceOf(Float32Array);
    expect(mesh.aabb).toBeDefined();
  });
  it('所有地点模型都能生成网格', () => {
    for (const [loc, make] of Object.entries(LOCATION_MODELS)) {
      const mesh = voxelMesh(make(), { scale: 0.25, material: GUID, glowMaterial: GUID });
      expect(mesh.submeshes.length, loc).toBeGreaterThan(0);
    }
  });
});

describe('角色外观与特征一致（看外观就能推理）', () => {
  const colors = (id: string) => {
    const m = characterModel(lookOf(data.characters.find((c) => c.id === id)!));
    return new Set([...m.cells.values()].map((v) => v.color));
  };
  it('外袍颜色对应青、白、灰', () => {
    for (const c of data.characters) {
      const robe = c.traits.find((t) => t.startsWith('robe_'))!;
      expect(colors(c.id).has(PAL.robe[robe]), c.name).toBe(true);
    }
  });
  it('个子高的人明显更高', () => {
    const h = (id: string) => characterHeight(lookOf(data.characters.find((c) => c.id === id)!));
    const tall = data.characters.filter((c) => c.traits.includes('tall'));
    const others = data.characters.filter((c) => !c.traits.includes('tall'));
    const minTall = Math.min(...tall.map((c) => h(c.id)));
    const maxOther = Math.max(...others.map((c) => h(c.id) - (c.look.hair === '束发高冠' || c.look.hair === '玉冠束发' ? 2 : 0)));
    expect(minTall).toBeGreaterThan(maxOther - 2);
    for (const t of tall) for (const o of others) expect(h(t.id) - (t.look.hair.includes('冠') ? 2 : 0), `${t.name} vs ${o.name}`).toBeGreaterThanOrEqual(h(o.id) - (o.look.hair.includes('冠') ? 2 : 0));
  });
  it('穿草鞋的人脚上是草黄色，其他人是黑靴', () => {
    for (const c of data.characters) expect(colors(c.id).has(PAL.straw), c.name).toBe(c.traits.includes('straw'));
  });
  it('随身物看得见：玉佩、铜铃、香囊、竹剑', () => {
    const itemColor = { jade: PAL.jade, bell: PAL.bell, sachet: PAL.sachet, bamboo_sword: PAL.bamboo } as Record<string, string>;
    for (const c of data.characters) {
      const item = c.traits.find((t) => t in itemColor)!;
      expect(colors(c.id).has(itemColor[item]), c.name).toBe(true);
    }
  });
  it('头像是正面投影，不是空图', () => {
    for (const c of data.characters) expect(portraitGrid(c.id).pixels.filter(Boolean).length, c.name).toBeGreaterThan(40);
  });
});

describe('镜头与投影', () => {
  it('镜头对准的点投影到屏幕中央', () => {
    const s = projectToScreen(SHOTS.plaza.focus, SHOTS.plaza, 1280, 720)!;
    expect(Math.abs(s.x - 640)).toBeLessThan(1);
    expect(Math.abs(s.y - 360)).toBeLessThan(1);
  });
  it('地图机位让 7 个地点标签都在画面里（横屏和竖屏）', () => {
    for (const [w, h] of [[1280, 720], [390, 844], [844, 390]]) {
      const shot = fitOverviewShot(w, h);
      for (const loc of Object.keys(LOCATION_POS) as Array<keyof typeof LOCATION_POS>) {
        const p = LOCATION_POS[loc];
        const s = projectToScreen([p[0], LOCATION_LABEL_HEIGHT[loc], p[2]], shot, w, h)!;
        expect(s.x > 0 && s.x < w && s.y > 0 && s.y < h, `${loc} @${w}x${h}`).toBe(true);
      }
    }
  });
  it('广场镜头里 5 个站位都在画面里（横屏和竖屏）', () => {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const shot = fitPlazaShot(w, h);
      for (const p of PLAZA_SLOTS) {
        const s = projectToScreen(p, shot, w, h)!;
        expect(s.x > 0 && s.x < w && s.y > 0 && s.y < h * 0.75, `${w}x${h}`).toBe(true);
      }
    }
  });
  it('镜头过渡最终吸附到目标（标签不会无限微动）', () => {
    let cur = SHOTS.overview;
    for (let i = 0; i < 200 && cur !== SHOTS.plaza; i++) cur = stepShot(cur, SHOTS.plaza, 1 / 30);
    expect(cur).toBe(SHOTS.plaza);
  });
});

describe('界面渲染', () => {
  it('转义 AI 说的话', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('档案里列出与这名弟子相关的线索', async () => {
    const g = new GameSession(data, new TemplateClient(), { seed: 20261207 });
    g.start();
    g.finishIntro();
    const id = g.case.disciples[0].id;
    await g.ask(id, `${g.case.time_slot}你在哪里？`);
    expect(relatedClues(g, id)).toContain(g.case.knowledge[id].claim_fact);
  });
});
