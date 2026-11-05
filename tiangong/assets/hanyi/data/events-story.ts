// 事件包（续）：每个人故事线的第一章、几条故事线的另一种结局，以及人和人之间的故事（恩怨、友情、互相照应）。
// 和 events.ts 里的事件一起注册；每个人完整的「心路」章节见 stories.ts。

import type { Ctx } from '../core/engine';
import type { CharState, GameState } from '../core/types';
import { act, addHealth, addMood, addRel, addTrust, ch, has, isAct, nm, rel } from '../core/world';
import type { Choice, EventDef } from './events';

const C = (s: GameState, id: string) => ch(s, id)!;
const N = nm;
const ok = (c?: CharState) => !!c && c.status === 'active';
const daysIn = (s: GameState, c: CharState) => s.day - c.joinedDay;
const heard = (s: GameState, id: string) => !!s.flags[`heard_${id}`];
const single = (label: string, run: Choice['run']): Choice[] => [{ label, run }];
const moodAll = (s: GameState, n: number, ...ex: string[]) => act(s).filter((c) => !ex.includes(c.id)).forEach((c) => addMood(c, n));

/** 第一章：信任到了一定程度、相处了几天，还没说出心事的时候 */
function opening(id: string, trust: number, minDays: number, extra?: (s: GameState) => boolean) {
  return (s: GameState) => {
    const c = ch(s, id);
    if (!ok(c) || heard(s, id) || c!.trust < trust || daysIn(s, c!) < minDays) return null;
    if (extra && !extra(s)) return null;
    return { actors: [id] };
  };
}
const mark = (ctx: Ctx, flag: string) => { ctx.s.flags[flag] = true; };

export const STORY_EVENTS: EventDef[] = [
  // ───────────── 第一章 ─────────────
  {
    id: 'qin_road',
    slot: 'morning',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('qin', 38, 2),
    title: () => '路口',
    text: () => '天刚蒙蒙亮，你出门解手，看见老秦一个人站在驿站后头的岔路口。雪落了他一肩膀，他也不掸。\n\n那条岔路通往后山，早被雪埋得看不出路的样子了。',
    choices: () => [
      {
        label: '走过去，陪他站一会儿',
        run: (ctx) => {
          const q = C(ctx.s, 'qin');
          addTrust(q, 4); addMood(q, 4); mark(ctx, 'qin_ch1');
          return '你们并排站了很久。老秦先开了口："这条路，八年没人走了。"\n\n说完，他转身回去劈柴，劈得比哪天都狠。';
        },
      },
      {
        label: '"老秦，看什么呢？"',
        run: (ctx) => {
          addTrust(C(ctx.s, 'qin'), 2); mark(ctx, 'qin_ch1');
          return '"看雪。"他头也不回。过了一会儿，又补了一句："山里的雪，埋得住路，埋不住人。"';
        },
      },
    ],
  },
  {
    id: 'lin_phone',
    slot: 'evening',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('lin', 35, 1),
    title: () => '百分之四',
    text: () => '林晚的手机只剩百分之四的电。每天晚上，她都会开机看一眼，再马上关掉。\n\n今晚屏幕亮起来时，你瞥见锁屏上是个扎着羊角辫的小姑娘，正对着镜头吹蜡烛。',
    choices: () => [
      {
        label: '"把电留着吧，等有信号的时候用。"',
        run: (ctx) => {
          addTrust(C(ctx.s, 'lin'), 3); mark(ctx, 'lin_ch1');
          return '林晚点点头，把手机贴在胸口捂了很久，像是怕它也冻着。';
        },
      },
      {
        label: '"多看一会儿吧。"',
        run: (ctx) => {
          const l = C(ctx.s, 'lin');
          addMood(l, 8); addTrust(l, 2); mark(ctx, 'lin_ch1');
          return '她把照片一张张往后翻，翻到最后一张，手指在关机键上停了好几次。\n\n"她这周末过生日，"林晚说，"六岁。"';
        },
      },
    ],
  },
  {
    id: 'jie_sketch',
    slot: 'evening',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('jie', 42, 2),
    title: () => '速写本',
    text: () => '阿杰的速写本从包里滑出来，摊在地上。那一页画满了同一个人的背影：安全帽，扛着钢筋，肩膀很宽。每一张旁边都写着两个字——"不像"，又被划掉了。\n\n阿杰一把抢了回去："随手画的！工地上的人，画着玩。"',
    choices: () => [
      {
        label: '"画得很好。他是谁？"',
        run: (ctx) => {
          addTrust(C(ctx.s, 'jie'), 2); mark(ctx, 'jie_ch1');
          return '"就……一个人呗。"阿杰把本子塞回包里，笑得有点僵。那天晚上，他比平时安静。';
        },
      },
      {
        label: '假装什么也没看见',
        run: (ctx) => {
          const j = C(ctx.s, 'jie');
          addTrust(j, 3); addMood(j, 3); mark(ctx, 'jie_ch1');
          return '阿杰松了口气，又开始嘻嘻哈哈地讲他写生时遇到的怪事。可你注意到，他把包往怀里搂得更紧了。';
        },
      },
    ],
  },
  {
    id: 'ma_brake',
    slot: 'morning',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('ma', 35, 2, (s) => !!s.flags.busFound),
    title: () => '刹车片',
    text: () => '一早，胖叔不见了。你顺着脚印找到客车边上，他正趴在雪里，半个身子钻在车底下。\n\n他爬出来的时候，手里攥着一片磨穿了的刹车片，脸色比雪还白。',
    choices: () => [
      {
        label: '"找到什么能用的了？"',
        run: (ctx) => {
          addTrust(C(ctx.s, 'ma'), 2); mark(ctx, 'ma_ch1');
          return '"没、没什么。"他把刹车片塞进兜里，"看看还有啥能拆的。"回去的路上，他一句话也没说。';
        },
      },
      {
        label: '帮他把车底下的雪刨开（+2 物资）',
        run: (ctx) => {
          ctx.s.res.mat += 2;
          addTrust(C(ctx.s, 'ma'), 4); mark(ctx, 'ma_ch1');
          return '你们俩刨了一早上，拆下来两块好铁皮。胖叔一路上都在念叨："这车跟了我八年……八年啊。"';
        },
      },
    ],
  },
  {
    id: 'su_ledger',
    slot: 'evening',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('su', 26, 2),
    title: () => '一串数字',
    text: () => '苏蔓蹲在火边，用树枝在地上算账。算的不是驿站的口粮——是一串很长的数字，后面跟着一串零。\n\n你走近的时候，她用鞋底把那串数字抹掉了。',
    choices: () => [
      {
        label: '"这是什么？"',
        run: (ctx) => {
          addTrust(C(ctx.s, 'su'), 1); mark(ctx, 'su_ch1');
          return '"一个已经不重要的数字。"她站起来，拍了拍手上的灰，"比起它，我更关心明天谁去砍柴。"';
        },
      },
      {
        label: '蹲下来，跟她一起算驿站的账',
        run: (ctx) => {
          const u = C(ctx.s, 'su');
          addTrust(u, 4); addMood(u, 3); mark(ctx, 'su_ch1');
          return '她算得飞快，你还没报完，她已经得出了结果："按这个吃法，还能撑十一天。"\n\n顿了顿，她第一次正眼看你："你记账的方式，倒是不算太蠢。"';
        },
      },
    ],
  },
  {
    id: 'man_bunny',
    slot: 'evening',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('man', 30, 2),
    title: () => '豆豆',
    text: () => '小满抱着那只脏兮兮的布兔子，缩在角落里跟它说悄悄话。你听见她说："豆豆别怕，妈妈会来接我们的……是我不好，是我没听话。"\n\n她看见你，一下子把兔子藏到了身后。',
    choices: () => [
      {
        label: '蹲下来，问兔子叫什么名字',
        run: (ctx) => {
          addTrust(C(ctx.s, 'man'), 5); mark(ctx, 'man_ch1');
          return '"它叫豆豆，"小满小声说，"妈妈给我买的。"她犹豫了一下，把豆豆递过来，让你摸了摸它的耳朵。';
        },
      },
      {
        label: '给豆豆也倒一碗热水',
        run: (ctx) => {
          const m = C(ctx.s, 'man');
          addMood(m, 8); addTrust(m, 3); mark(ctx, 'man_ch1');
          return '小满愣了一下，然后咯咯笑出了声。她认真地把碗举到豆豆嘴边："豆豆，烫，慢点喝。"';
        },
      },
    ],
  },
  {
    id: 'gesang_names',
    slot: 'morning',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: opening('gesang', 30, 2),
    title: () => '三个名字',
    text: () => '清早，格桑在门外的雪地上写了三个名字，又在每个名字后面插了一根松枝。\n\n她跪在那儿，嘴里念着一段你听不懂的经文。',
    choices: () => [
      {
        label: '"他们是谁？"',
        run: (ctx) => {
          addTrust(C(ctx.s, 'gesang'), 2); mark(ctx, 'gesang_ch1');
          return '"我的队员。"格桑站起来，拍掉膝盖上的雪，拎着斧子去了林子。那一天，她一个人砍回了两个人的柴。';
        },
      },
      {
        label: '也折一根松枝，插在旁边',
        run: (ctx) => {
          const g = C(ctx.s, 'gesang');
          addTrust(g, 5); addMood(g, 5); mark(ctx, 'gesang_ch1');
          return '格桑看了你一眼，什么也没说。等你转身的时候，她用很轻的声音说了一句藏语。后来你才知道，那是"谢谢"。';
        },
      },
    ],
  },

  // ───────────── 故事线的另一种走向 ─────────────
  {
    id: 'qin_path',
    slot: 'evening',
    once: true,
    priority: 6,
    bind: (s) => {
      const q = ch(s, 'qin');
      if (!ok(q) || s.flags.arc_qin || !s.flags.qinSonTold) return null;
      if (s.day - (s.fired.cellar ?? s.day) < 4) return null;
      return { actors: ['qin'] };
    },
    title: () => '后山的岔路',
    text: () => '老秦扛着铁锹出了门。你跟上去，看见他在后山那条岔路口刨开雪，立起一块木牌。\n\n木牌上用刀刻着两个字：秦川。下面一行小字——"往这儿走，能回家。"',
    choices: () => [
      {
        label: '帮他把木牌扶稳',
        run: (ctx) => {
          const q = C(ctx.s, 'qin');
          addMood(q, 20); addTrust(q, 5); mark(ctx, 'arc_qin');
          return '你们一起把木牌埋得结结实实。老秦拍了拍木牌上的雪，像拍一个人的肩膀。\n\n"八年了，"他说，"我总算给他指了条路。"';
        },
      },
      {
        label: '站在一旁，不打扰他',
        run: (ctx) => {
          const q = C(ctx.s, 'qin');
          addMood(q, 15); addTrust(q, 3); mark(ctx, 'arc_qin');
          return '老秦在木牌前站了很久。回来的路上，他走在前面，步子比平时轻。';
        },
      },
    ],
  },
  {
    id: 'lin_birthday',
    slot: 'evening',
    once: true,
    priority: 7,
    bind: (s) => {
      const l = ch(s, 'lin');
      if (!ok(l) || s.flags.arc_lin || !s.flags.lin_stayed || s.res.food < 1) return null;
      return s.day - (s.fired.lin_leave ?? s.day) >= 2 ? { actors: isAct(s, 'man') ? ['lin', 'man'] : ['lin'] } : null;
    },
    title: () => '迟到的生日',
    text: (s) =>
      '林晚翻出最后一点面粉，掺上雪水，在锅底烙了个小小的饼。她用火柴棍在上面插了一圈，数了数——六根。\n\n"今天替朵朵过，"她说，声音有点哑，"等回去了，再给她补一个真的。"' +
      (isAct(s, 'man') ? '\n\n小满凑过来，眼睛亮亮的："我可以帮朵朵吹吗？"' : ''),
    choices: (s) => {
      const cs: Choice[] = [
        {
          label: '大家一起唱生日歌（−1 食物）',
          run: (ctx) => {
            const st = ctx.s, l = C(st, 'lin');
            st.res.food = Math.max(0, st.res.food - 1);
            moodAll(st, 6, 'lin'); addMood(l, 15); addTrust(l, 5); mark(ctx, 'arc_lin');
            return `歌唱得七零八落，${isAct(st, 'ma') ? '胖叔的大嗓门盖过了所有人' : '谁也没唱在调上'}。林晚笑着笑着就哭了，哭完又笑。\n\n那天以后，她再也没有站在门口望着山下。`;
          },
        },
      ];
      if (isAct(s, 'man')) {
        cs.push({
          label: '让小满替朵朵吹蜡烛',
          run: (ctx) => {
            const st = ctx.s;
            addRel(st, 'lin', 'man', 15); addMood(C(st, 'lin'), 12); addMood(C(st, 'man'), 12); mark(ctx, 'arc_lin');
            return '小满鼓起腮帮子，"呼"地一下，火柴全灭了。林晚把她搂进怀里："谢谢你，替朵朵许了愿。"';
          },
        });
      }
      return cs;
    },
  },
  {
    id: 'man_forgive',
    slot: 'evening',
    once: true,
    priority: 6,
    bind: (s) => {
      const m = ch(s, 'man');
      if (!ok(m) || s.flags.arc_man || !heard(s, 'man')) return null;
      const grown = act(s).filter((c) => !has(c, 'child')).sort((a, b) => rel(s, b.id, 'man') - rel(s, a.id, 'man'))[0];
      return grown ? { actors: ['man', grown.id] } : null;
    },
    title: () => '不是你的错',
    text: (_s, ev) =>
      `小满说完那件事以后，一直闷闷不乐，吃饭也只扒两口。\n\n${N(ev.actors[1])}把她抱到膝盖上，指着门外的大雪："你妈妈让你在车里等，是怕你冻着。你跑出来，是因为你害怕。害怕不是错。"`,
    choices: (_s, ev) => [
      {
        label: '"等雪停了，我们一起去找妈妈。"',
        run: (ctx) => {
          const m = C(ctx.s, 'man');
          addMood(m, 20); addTrust(m, 5); addRel(ctx.s, ev.actors[1], 'man', 10); mark(ctx, 'arc_man');
          return '小满点点头，把脸埋进豆豆的肚子里。那天夜里，她睡得很沉，再也没有说梦话。';
        },
      },
      {
        label: '让她哭一会儿',
        run: (ctx) => {
          addMood(C(ctx.s, 'man'), 15); mark(ctx, 'arc_man');
          return `小满哭得很大声，哭完了，抽抽噎噎地问："那……妈妈不会生我的气吧？"\n\n"不会，"${N(ev.actors[1])}说，"她只会高兴你还好好的。"`;
        },
      },
    ],
  },
  {
    id: 'jie_father',
    slot: 'evening',
    once: true,
    priority: 6,
    bind: (s) => {
      const j = ch(s, 'jie');
      if (!ok(j) || s.flags.arc_jie || !s.fired.jie_signal || s.day - s.fired.jie_signal < 2) return null;
      return heard(s, 'jie') || s.flags.jie_ch1 ? { actors: ['jie'] } : null;
    },
    title: () => '像了',
    text: () => '阿杰把速写本上那一页又翻了出来。这一回，他没有画背影。\n\n画上的男人正对着你，皱着眉，嘴角却往上翘着——像是在骂人，又像是在笑。旁边写着两个字："像了。"',
    choices: () =>
      single('"等出去了，拿给他看。"', (ctx) => {
        const j = C(ctx.s, 'jie');
        addMood(j, 15); addTrust(j, 5); mark(ctx, 'arc_jie');
        return '阿杰把那页小心地撕下来，夹进了手机壳里。"嗯，"他说，"当面给他。"';
      }),
  },

  // ───────────── 人和人之间 ─────────────
  {
    id: 'feud_ma_su',
    slot: 'evening',
    once: true,
    chance: 0.5,
    priority: 4,
    bind: (s) => (ok(ch(s, 'ma')) && ok(ch(s, 'su')) && s.day >= 4 && rel(s, 'ma', 'su') <= 5 ? { actors: ['ma', 'su'] } : null),
    title: () => '旧账',
    text: () => '晚饭时，苏蔓把碗一放："开了二十年车，连雪天该不该上山都看不出来？要不是某些人逞能，我们现在已经在县城吃火锅了。"\n\n胖叔"啪"地把勺子拍在锅沿上，脸涨得通红。',
    choices: (s) => {
      const cs: Choice[] = [
        {
          label: '"苏蔓，这话过分了。"',
          run: (ctx) => {
            const st = ctx.s;
            addTrust(C(st, 'su'), -3); addTrust(C(st, 'ma'), 3); addRel(st, 'ma', 'su', -5);
            return '苏蔓冷哼一声，没再说话。胖叔闷头刷锅，刷了很久。';
          },
        },
        {
          label: '"胖叔，别往心里去。"',
          run: (ctx) => {
            const st = ctx.s;
            addTrust(C(st, 'ma'), -2); addTrust(C(st, 'su'), 2); addRel(st, 'ma', 'su', -8);
            return '胖叔张了张嘴，最后什么也没说，摔门出去抱柴了。';
          },
        },
      ];
      if (s.flags.busFound) {
        cs.push({
          label: '让他们俩明天一起去客车上拆东西',
          hint: '成功率约 50%',
          run: (ctx) => {
            const st = ctx.s;
            if (ctx.rng.chance(0.5)) {
              addRel(st, 'ma', 'su', 16); st.res.mat += 3;
              return '两个人在客车里吵了一上午，下午却抬着一块整铁皮回来了。苏蔓的手冻破了，是胖叔掏出手绢给她裹上的。（+3 物资）';
            }
            addRel(st, 'ma', 'su', -6);
            return '两个人一路没说话，回来时一个走左边，一个走右边。';
          },
        });
      }
      return cs;
    },
  },
  {
    id: 'peace_ma_su',
    slot: 'evening',
    once: true,
    priority: 5,
    bind: (s) => {
      if (!ok(ch(s, 'ma')) || !ok(ch(s, 'su')) || !s.fired.feud_ma_su || s.day - s.fired.feud_ma_su < 3) return null;
      return s.flags.arc_ma || rel(s, 'ma', 'su') >= 5 ? { actors: ['ma', 'su'] } : null;
    },
    title: () => '一块腊肉',
    text: (s) =>
      s.flags.arc_ma
        ? '胖叔说出保养的事以后，苏蔓一直没吭声。\n\n今晚分饭时，她把自己碗里那块最大的腊肉夹到了胖叔碗里："那天的话，我收回。换了我，也会想省那几百块钱。"她顿了顿，"我就是在省钱的时候，把一整家公司省没的。"'
        : '分饭的时候，苏蔓把自己碗里那块最大的腊肉夹到了胖叔碗里，眼睛却看着别处："那天的话……我收回。"',
    choices: () =>
      single('"吃吧，都是一家人。"', (ctx) => {
        const st = ctx.s;
        addRel(st, 'ma', 'su', 25); addMood(C(st, 'ma'), 8); addMood(C(st, 'su'), 8);
        return '胖叔愣了半天，把腊肉切成两半，一半夹回苏蔓碗里："一人一半。"\n\n那天晚上，屋里的火好像比平时暖。';
      }),
  },
  {
    id: 'qin_gesang',
    slot: 'evening',
    once: true,
    priority: 5,
    bind: (s) => {
      if (!ok(ch(s, 'qin')) || !ok(ch(s, 'gesang')) || s.day < 4) return null;
      return heard(s, 'qin') || heard(s, 'gesang') || rel(s, 'qin', 'gesang') >= 20 ? { actors: ['qin', 'gesang'] } : null;
    },
    title: () => '同一座山',
    text: () => '夜深了，大家都睡了，只有老秦和格桑还坐在火边。\n\n"八年前，"老秦突然开口，"我儿子从这儿出发，去找几个迷路的驴友。"格桑转过头看着他。\n\n"后来呢？"\n\n"后来，山把他留下了。"',
    choices: () => [
      {
        label: '装作睡着，让他们说下去',
        run: (ctx) => {
          const st = ctx.s;
          addRel(st, 'qin', 'gesang', 20); addMood(C(st, 'qin'), 10); addMood(C(st, 'gesang'), 10); mark(ctx, 'bond_qin_gesang');
          return '那一夜，两个人说了很多话。格桑说起她的三个队员，老秦说起秦川小时候怎么偷他的烟。\n\n快天亮的时候，你听见老秦说："山上的人，迟早会被找到的。你信我。"格桑"嗯"了一声，声音有点哑。';
        },
      },
      {
        label: '起来往火里添柴，陪他们坐一会儿',
        run: (ctx) => {
          const st = ctx.s;
          addRel(st, 'qin', 'gesang', 15); addTrust(C(st, 'qin'), 3); addTrust(C(st, 'gesang'), 3);
          addMood(C(st, 'qin'), 6); addMood(C(st, 'gesang'), 6); mark(ctx, 'bond_qin_gesang');
          return '你什么也没问，只是往火里添了根柴。三个人看着火，谁也没再说话，可谁也没去睡。';
        },
      },
    ],
  },
  {
    id: 'bunny_ear',
    slot: 'evening',
    once: true,
    chance: 0.6,
    priority: 5,
    bind: (s) => {
      const w = ch(s, 'wu'), m = ch(s, 'man');
      if (!ok(w) || !ok(m) || daysIn(s, m!) < 3 || daysIn(s, w!) < 2) return null;
      return rel(s, 'wu', 'man') >= 10 || s.fired.wu_carving ? { actors: ['wu', 'man'] } : null;
    },
    title: () => '豆豆的耳朵',
    text: () => '搬柴的时候，豆豆的一只耳朵被钉子挂住，"刺啦"一声扯开了。小满哭得停不下来。\n\n吴铁走过来，蹲下，伸出一只粗糙的大手。小满犹豫了一下，把豆豆放了上去。',
    choices: () =>
      single('看他缝', (ctx) => {
        const st = ctx.s;
        addRel(st, 'wu', 'man', 20); addMood(C(st, 'man'), 15); addMood(C(st, 'wu'), 6); addTrust(C(st, 'wu'), 3); mark(ctx, 'bunny_sewn');
        return '吴铁从工具箱里翻出一根针，就着火光，一针一针地缝。他的手指那么粗，针脚却又细又密。\n\n缝好以后，他把豆豆还给小满，用手指轻轻点了点兔子的鼻子。小满抱着豆豆，第一次扑进了他怀里。';
      }),
  },
  {
    id: 'ma_candy',
    slot: 'evening',
    once: true,
    chance: 0.5,
    priority: 4,
    bind: (s) => {
      const m = ch(s, 'man');
      if (!ok(ch(s, 'ma')) || !ok(m) || rel(s, 'ma', 'man') < 0) return null;
      return m!.mood < 50 || daysIn(s, m!) >= 4 ? { actors: ['ma', 'man'] } : null;
    },
    title: () => '一颗水果糖',
    text: () => '小满这两天没精神，饭也吃不下。\n\n胖叔在兜里摸了半天，摸出一颗皱巴巴的水果糖，糖纸都磨毛了："我儿子小时候最爱这个。我一直揣着，想着见了他给他……先给你吧。"',
    choices: () => [
      {
        label: '"胖叔，你儿子多大了？"',
        run: (ctx) => {
          const st = ctx.s;
          addMood(C(st, 'ma'), 8); addTrust(C(st, 'ma'), 3); addRel(st, 'ma', 'man', 12); addMood(C(st, 'man'), 10);
          return '"二十三了，在深圳打工，三年没回家了。"胖叔挠挠头，"等出去了，我给他打个电话。"\n\n小满把糖含在嘴里，含了一整个晚上都舍不得嚼。';
        },
      },
      {
        label: '让小满说谢谢',
        run: (ctx) => {
          const st = ctx.s;
          addMood(C(st, 'man'), 10); addRel(st, 'ma', 'man', 10);
          return '小满小声说了句"谢谢胖叔"。胖叔乐得嘴都合不拢，一晚上给她讲了八个笑话，没一个好笑的。';
        },
      },
    ],
  },
  {
    id: 'lin_gesang_leg',
    slot: 'evening',
    once: true,
    priority: 4,
    bind: (s) => {
      const g = ch(s, 'gesang');
      return ok(ch(s, 'lin')) && ok(g) && (g!.injured > 0 || daysIn(s, g!) <= 3) ? { actors: ['lin', 'gesang'] } : null;
    },
    title: () => '换药',
    text: () => '格桑腿上的伤口又渗血了。林晚拿着纱布走过去，格桑把腿一缩："不用。我自己能行。"\n\n"你自己能行，"林晚蹲下来，"那你告诉我，你上一次换药是什么时候？"',
    choices: () => [
      {
        label: '让林晚坚持给她换药',
        run: (ctx) => {
          const st = ctx.s, g = C(st, 'gesang');
          addHealth(g, 12); g.injured = Math.max(0, g.injured - 1); addMood(g, -2); addRel(st, 'lin', 'gesang', 6);
          return '格桑咬着牙让林晚把纱布拆开。伤口比她说的深得多。换完药，她别过脸，说了句："……手法不错。"';
        },
      },
      {
        label: '让格桑自己换，林晚在旁边教',
        run: (ctx) => {
          const st = ctx.s, g = C(st, 'gesang');
          addHealth(g, 6); addTrust(g, 3); addRel(st, 'lin', 'gesang', 12);
          return '林晚把纱布递过去，在旁边一句一句地教。格桑换得笨手笨脚，但一声没吭。\n\n末了，她抬起头："你是个好护士。"林晚笑了："你是个倔病人。"';
        },
      },
    ],
  },
  {
    id: 'jie_su_scold',
    slot: 'evening',
    once: true,
    chance: 0.5,
    priority: 4,
    bind: (s) => {
      const j = ch(s, 'jie');
      if (!ok(j) || !ok(ch(s, 'su')) || s.day < 4 || rel(s, 'jie', 'su') >= 25) return null;
      return ['explore', 'scavenge', 'hunt'].includes(j!.task) ? { actors: ['jie', 'su'] } : null;
    },
    title: () => '你以为你是谁',
    text: () => '阿杰天黑透了才从外面回来，冻得嘴唇发紫，还在嘻嘻哈哈地说路上看见了一只狐狸。\n\n苏蔓"啪"地合上本子："你以为你是谁？死在外面，谁去给你收尸？谁去跟你爸妈交代？"\n\n屋里一下子安静了。阿杰的笑僵在脸上。',
    choices: () => [
      {
        label: '"她说得对。下次天黑前必须回来。"',
        run: (ctx) => {
          const st = ctx.s, j = C(st, 'jie');
          addMood(j, -5); addTrust(j, -2); addTrust(C(st, 'su'), 3); addRel(st, 'jie', 'su', 4);
          return '阿杰低着头"哦"了一声。可第二天，他是第一个回来的。';
        },
      },
      {
        label: '"苏蔓，他已经知道了。"',
        run: (ctx) => {
          const st = ctx.s;
          addTrust(C(st, 'jie'), 3); addTrust(C(st, 'su'), -2); addRel(st, 'jie', 'su', -4);
          return '苏蔓看了你一眼，没再说下去。阿杰缩在火边，半天没吭声。';
        },
      },
      {
        label: '"她是担心你。"',
        run: (ctx) => {
          addRel(ctx.s, 'jie', 'su', 12);
          return '阿杰愣住了，转头去看苏蔓。苏蔓别过脸："谁担心他了。"\n\n可她把自己的毯子扔了过去，正好盖在阿杰身上。';
        },
      },
    ],
  },
];

/** 人和人之间的故事：在「人心」页列出来（发生过的显示标题，没发生的只显示人数） */
export const PAIR_STORIES: { id: string; a: string; b: string; title: string; kind: '恩怨' | '友情' | '照应' }[] = [
  { id: 'jie_portrait', a: 'jie', b: 'qin', title: '一张画像', kind: '照应' },
  { id: 'qin_gesang', a: 'qin', b: 'gesang', title: '同一座山', kind: '照应' },
  { id: 'feud_ma_su', a: 'ma', b: 'su', title: '旧账', kind: '恩怨' },
  { id: 'peace_ma_su', a: 'ma', b: 'su', title: '一块腊肉', kind: '照应' },
  { id: 'lin_bond', a: 'lin', b: 'man', title: '梦话', kind: '照应' },
  { id: 'bunny_ear', a: 'wu', b: 'man', title: '豆豆的耳朵', kind: '友情' },
  { id: 'ma_candy', a: 'ma', b: 'man', title: '一颗水果糖', kind: '友情' },
  { id: 'lin_gesang_leg', a: 'lin', b: 'gesang', title: '换药', kind: '照应' },
  { id: 'jie_su_scold', a: 'jie', b: 'su', title: '你以为你是谁', kind: '恩怨' },
];
