// 灵魂客户端：实现天工引擎 NPC 层约定的 NpcClientPort（引擎官方的 @forgeax/npc-client 尚未发布）。
//
// 引擎侧：每个角色是一个挂着 NpcBrain 组件的实体（soulId / affordanceRef / enabled / lod）。
// npcPlugin 每帧扫描这些实体，签名变化时调用 sync，之后每帧 tick。
// 这里负责：记住每个灵魂「能做什么」（affordances）、「此刻有多重要」（认知 LOD），
// 并按 LOD 决定多久重新感知一次世界——聚光的角色每帧都在看，在场的角色隔一会儿看一眼，离场的角色不再感知。

import {
  createNpcClientAdapter,
  type NpcBrainBinding,
  type NpcClientAdapter,
  type NpcClientAdapterOptions,
  type NpcClientPort,
} from '@forgeax/engine/npc';

export type LodName = 'spotlight' | 'ambient' | 'offstage';

/** 灵魂「能做什么」：今年能选的事、谈话里能提的事、能说出口的秘密；交情深了，还有自己会做的事（主动开口、年底回想……） */
export interface Affordance {
  readonly id: string;
  readonly kind: 'plan' | 'offer' | 'reveal' | 'soul';
  readonly label: string;
}

/** 一次感知：角色眼中的自己、心里的事、和别人的关系、刚发生的事 */
export interface Perception {
  readonly year: number;
  readonly place: string;
  readonly body: string;
  readonly heart: string;
  readonly ties: string;
  readonly recent: readonly string[];
  /** 和主角的交情：陌路、相识、相熟、知己/宿敌 */
  readonly bond: string;
  /** 年底凝成的「心里的你」 */
  readonly impression?: string;
}

/** 每档认知 LOD 多少秒重新感知一次 */
export const SAMPLE_PERIOD: Record<LodName, number> = { spotlight: 0, ambient: 2, offstage: Number.POSITIVE_INFINITY };

interface SoulEntry {
  affordances: Affordance[];
  lod: LodName;
  perception?: Perception;
  age: number;
  samples: number;
}

export interface SoulView {
  readonly soulId: string;
  readonly lod: LodName;
  readonly affordances: readonly Affordance[];
  readonly perception?: Perception;
  readonly samples: number;
  readonly age: number;
}

export class SoulClient implements NpcClientPort<Affordance, Perception> {
  private readonly souls = new Map<string, SoulEntry>();

  private entry(id: string) {
    let e = this.souls.get(id);
    if (!e) {
      e = { affordances: [], lod: 'offstage', age: 0, samples: 0 };
      this.souls.set(id, e);
    }
    return e;
  }

  /** sync 开始前调用：这次没出现的灵魂一律离场 */
  beginSync(present: readonly string[]) {
    for (const [id, e] of this.souls) if (!present.includes(id)) e.lod = 'offstage';
  }

  declareAffordances(npcId: string, affordances: Affordance[]) {
    this.entry(npcId).affordances = affordances;
  }

  setLod(npcId: string, level: LodName, snapshot?: Perception) {
    const e = this.entry(npcId);
    e.lod = level;
    if (snapshot) {
      e.perception = snapshot;
      e.age = 0;
      e.samples++;
    }
  }

  tick(dt: number, sampler: (npcId: string) => Perception | undefined) {
    for (const [id, e] of this.souls) {
      e.age += dt;
      if (e.age < SAMPLE_PERIOD[e.lod]) continue;
      const p = sampler(id);
      if (!p) continue;
      e.perception = p;
      e.age = 0;
      e.samples++;
    }
  }

  get(soulId: string): SoulView | undefined {
    const e = this.souls.get(soulId);
    return e && { soulId, lod: e.lod, affordances: e.affordances, perception: e.perception, samples: e.samples, age: e.age };
  }

  view(): SoulView[] {
    return [...this.souls.keys()].map((id) => this.get(id)!);
  }

  forget() {
    this.souls.clear();
  }
}

/** 包一层官方 createNpcClientAdapter：补上「未出现即离场」 */
export function createSoulAdapter(
  client: SoulClient,
  options: NpcClientAdapterOptions<Affordance, Perception>,
): NpcClientAdapter {
  const inner = createNpcClientAdapter(client, options);
  return {
    sync(bindings: readonly NpcBrainBinding[], world) {
      client.beginSync(bindings.filter((b) => b.enabled && b.soulId).map((b) => b.soulId));
      return inner.sync(bindings, world);
    },
    tick: inner.tick,
  };
}

export const SOUL_PREFIX = 'qingming.';
export const soulIdOf = (npcId: string) => `${SOUL_PREFIX}${npcId}`;
export const npcIdOf = (soulId: string) => (soulId.startsWith(SOUL_PREFIX) ? soulId.slice(SOUL_PREFIX.length) : soulId);
