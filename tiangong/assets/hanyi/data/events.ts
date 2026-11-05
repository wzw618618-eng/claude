// 事件包：角色的个人故事线、相遇、冲突、意外。
// 每个事件 = 触发条件（bind）+ 文本 + 选项；选项的 run 改变状态并返回结果文字。

import { Ctx } from '../core/engine';
import { CharState, GameState, PendingEvent, Vars } from '../core/types';
import {
  act, addHealth, addMood, addRel, addSkill, addTrust, bestTalker, ch, def, has, isAct, nm,
  pct, persuade, persuadeBy, rel, ta,
} from '../core/world';
import { SKILLS } from '../data/rules';
import { setRescue } from '../systems/camp';
import { recruit } from '../systems/work';
import { Rng } from '../core/rng';
import { SkillKey } from '../core/types';
import { STORY_EVENTS } from './events-story';

export interface Choice {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: (ctx: Ctx, ev: PendingEvent) => string;
}

export interface EventDef {
  id: string;
  title: (s: GameState, ev: PendingEvent) => string;
  text: (s: GameState, ev: PendingEvent) => string;
  choices: (s: GameState, ev: PendingEvent) => Choice[];
  slot?: 'evening' | 'morning';
  once?: boolean;
  cooldown?: number;
  chance?: number;
  priority?: number;
  bind?: (s: GameState, rng: Rng) => { actors: string[]; vars?: Vars } | null;
}

const C = (s: GameState, id: string) => ch(s, id)!;
const N = nm;
const others = (s: GameState, ...ex: string[]) => act(s).filter((c) => !ex.includes(c.id));
const adults = (s: GameState, ...ex: string[]) => others(s, ...ex).filter((c) => !has(c, 'child'));
const ok = (c?: CharState) => !!c && c.status === 'active';
const fine = (c?: CharState) => ok(c) && c!.injured === 0 && c!.sick === 0;
const moodAll = (s: GameState, n: number, ...ex: string[]) => others(s, ...ex).forEach((c) => addMood(c, n));
const trustAll = (s: GameState, n: number, ...ex: string[]) => others(s, ...ex).forEach((c) => addTrust(c, n));
const single = (label: string, run: Choice['run']): Choice[] => [{ label, run }];

function leave(ctx: Ctx, id: string, food: number, note: string) {
  const c = C(ctx.s, id);
  c.status = 'left';
  c.endDay = ctx.s.day;
  c.endNote = note;
  ctx.s.res.food = Math.max(0, ctx.s.res.food - food);
}

const list: EventDef[] = [
  // ───────────── 相遇 ─────────────
  {
    id: 'find_bus',
    title: () => '抛锚的客车',
    text: (s, ev) =>
      `${N(ev.actors[0])}在山道拐弯处找到了那辆客车，车身被雪埋了一半。车里还有座椅、铁皮和一个工具箱。` +
      (isAct(s, 'ma') ? '胖叔听说后，蹲在火边半天没吭声，然后抬头说："车上那台电台……也许还能修。"' : '驾驶台上的电台看起来还完好。'),
    choices: (s) => [
      {
        label: '拆下能用的一切（+6 物资）',
        hint: '电台多半保不住',
        run: (ctx) => {
          ctx.s.res.mat += 6;
          ctx.s.flags.busStripped = true;
          if (isAct(s, 'ma')) addMood(C(s, 'ma'), -6);
          return '大家把客车拆得只剩一副骨架。电台在拆的时候摔坏了。' + (isAct(s, 'ma') ? '胖叔捡起碎掉的面板，看了很久。' : '');
        },
      },
      {
        label: '先把电台拆回来（+2 物资，解锁「修电台」）',
        run: (ctx) => {
          ctx.s.res.mat += 2;
          ctx.s.flags.radioUnlocked = true;
          if (isAct(s, 'ma')) { addMood(C(s, 'ma'), 10); addTrust(C(s, 'ma'), 4); }
          return '电台和一些零碎被带了回来。' + (isAct(s, 'ma') ? '胖叔把电台抱在怀里，像抱着一个婴儿。' : '') + '去「营建」里可以开工修它。';
        },
      },
    ],
  },
  {
    id: 'find_man',
    title: () => '桥边的轿车',
    text: (_s, ev) =>
      `${N(ev.actors[0])}在断桥边发现了一辆侧翻的轿车。车里蜷着一个小女孩，怀里抱着一只布兔子，嘴唇冻得发紫。\n\n"妈妈让我在这里等，"她说，"妈妈去找人了。"`,
    choices: () => [
      {
        label: '把她背回驿站',
        run: (ctx) => {
          const s = ctx.s;
          recruit(s, 'man', { health: 70 });
          if (isAct(s, 'lin')) { addMood(C(s, 'lin'), 8); addRel(s, 'lin', 'man', 15); }
          moodAll(s, 3, 'man');
          return '她叫小满，九岁。一路上她都没哭，进了驿站，闻到热汤的味道，才"哇"地哭出声来。';
        },
      },
      {
        label: '在车里再找找线索',
        hint: '可能有用，也可能出事',
        run: (ctx, ev) => {
          const s = ctx.s;
          recruit(s, 'man', { health: 70 });
          s.res.med += 1;
          s.flags.manNote = true;
          moodAll(s, 3, 'man');
          let t = '后座上压着一张便条："小满，待在车里别动，妈妈去找人。"还有半板儿童退烧药。';
          const x = C(s, ev.actors[0]);
          if (ctx.rng.chance(0.2)) {
            x.injured = 2; addHealth(x, -12);
            t += `${N(x.id)}爬出车厢时被碎玻璃划伤了手。`;
          }
          return t + '小满攥着那张便条，一直没松手。';
        },
      },
    ],
  },
  {
    id: 'find_gesang',
    title: () => '雪坳里的红衣人',
    text: (_s, ev) =>
      `${N(ev.actors[0])}在一处雪坳里看见了一抹红色——是个人，半截身子埋在雪里，左腿伤得不轻，但还有气。\n\n她醒过来，第一句话是："其他人呢？"`,
    choices: (s) => [
      {
        label: '用 1 盒药稳住她的伤',
        disabled: s.res.med < 1,
        hint: s.res.med < 1 ? '没有药了' : undefined,
        run: (ctx) => {
          ctx.s.res.med -= 1;
          recruit(ctx.s, 'gesang', { health: 60, injured: 3, stamina: 40 });
          return '她叫格桑，是带队进山的向导。雪崩那天，她的三名队员和她失散了。她咬着牙让人给她正了骨，一声没吭。';
        },
      },
      {
        label: '先抬回去再说',
        run: (ctx) => {
          recruit(ctx.s, 'gesang', { health: 38, injured: 5, stamina: 30 });
          return '她叫格桑，是带队进山的向导。一路上她疼得昏过去两次，醒来就问队员的下落。';
        },
      },
    ],
  },
  {
    id: 'find_wu',
    title: () => '道班里的人',
    text: (_s, ev) =>
      `${N(ev.actors[0])}摸到了山腰的道班。屋里有个男人守着一炉快灭的火，墙上挂满了工具。他看见来人，只是点了点头，一句话也没说。`,
    choices: (s) => [
      {
        label: '请他来驿站一起过冬',
        run: (ctx) => {
          recruit(ctx.s, 'wu', { health: 85 });
          ctx.s.res.mat += 3;
          return '他想了很久，起身收拾了一包工具，跟着走了出来。他叫吴铁——名字是写在工具箱上的。（+3 物资）';
        },
      },
      {
        label: '用 3 份食物换他的工具（+5 物资）',
        disabled: s.res.food < 3,
        run: (ctx) => {
          ctx.s.res.food -= 3;
          ctx.s.res.mat += 5;
          return '他收下食物，把一箱工具推了过来，然后关上了门。';
        },
      },
    ],
  },

  // ───────────── 老秦 ─────────────
  {
    id: 'cellar',
    slot: 'evening',
    once: true,
    priority: 8,
    bind: (s) => {
      const q = ch(s, 'qin');
      return ok(q) && (s.flags.heard_qin || q!.trust >= 70) ? { actors: ['qin'] } : null;
    },
    title: () => '护林站的地窖',
    text: () =>
      '夜里，老秦把你叫到一边，用脖子上那把钥匙打开了柴房底下的地窖。\n\n"这是我当年给秦川囤的，"他说，"他说过，山里的屋子要留着粮，留给迷路的人。"\n\n地窖里有腊肉、干菜和一小箱药。',
    choices: () => [
      {
        label: '"秦川是个好人。"',
        run: (ctx) => {
          const s = ctx.s, q = C(s, 'qin');
          s.res.food += 8; s.res.med += 2; s.res.wood += 3;
          addMood(q, 12); addTrust(q, 6);
          s.flags.qinSonTold = true;
          return '老秦没说话，只是用袖子擦了擦眼睛。（+8 食物、+2 药品、+3 柴火）';
        },
      },
      {
        label: '把东西搬上去，什么也不问',
        run: (ctx) => {
          const s = ctx.s, q = C(s, 'qin');
          s.res.food += 8; s.res.med += 2; s.res.wood += 3;
          addTrust(q, 4);
          s.flags.qinSonTold = true;
          return '老秦点点头。有些事，不问也是一种尊重。（+8 食物、+2 药品、+3 柴火）';
        },
      },
    ],
  },
  {
    id: 'jie_portrait',
    slot: 'evening',
    once: true,
    priority: 7,
    bind: (s) =>
      isAct(s, 'qin') && isAct(s, 'jie') && s.flags.qinSonTold && rel(s, 'jie', 'qin') >= 10 && s.day - (s.fired.cellar ?? s.day) >= 2
        ? { actors: ['jie', 'qin'] }
        : null,
    title: () => '一张画像',
    text: () =>
      '阿杰熬了好几个晚上，凭着老秦零零碎碎的描述，画出了一个年轻人：方脸，浓眉，笑起来有颗虎牙。\n\n他把画递给老秦："叔，你看像不像？"',
    choices: () =>
      single('静静看着', (ctx) => {
        const s = ctx.s;
        addMood(C(s, 'qin'), 30); addTrust(C(s, 'qin'), 5);
        addMood(C(s, 'jie'), 10);
        addRel(s, 'jie', 'qin', 20);
        s.flags.arc_qin = true;
        return '老秦盯着那张画看了很久很久。"……像，"他说，"真像。"\n\n那天夜里，大家第一次听见老秦笑出声来。';
      }),
  },

  // ───────────── 阿杰 ─────────────
  {
    id: 'jie_signal',
    slot: 'morning',
    once: true,
    priority: 6,
    chance: 0.35,
    bind: (s) => (s.day >= 5 && fine(ch(s, 'jie')) ? { actors: ['jie'] } : null),
    title: () => '山脊上的一格信号',
    text: () =>
      '阿杰清早爬上了后山的山脊，回来时脸冻得通红，手里攥着手机："有信号！就一格！"\n\n可电量只剩 3%，大概只够发出一条短信。他的屏幕上，是几十条没读的消息，全是他爸发来的。',
    choices: (s) => [
      {
        label: '让他给爸爸报个平安',
        run: (ctx) => {
          const j = C(ctx.s, 'jie');
          addMood(j, 20); addTrust(j, 6);
          ctx.s.flags.arc_jie = true;
          return '阿杰打了很久的字，删掉，又重新打。最后只发出去四个字："爸，我没事。"\n\n屏幕黑掉之前，他看见对面显示"正在输入……"';
        },
      },
      {
        label: '发给救援热线，报告驿站的位置',
        hint: '救援会提前',
        run: (ctx) => {
          const s = ctx.s, j = C(s, 'jie');
          addMood(j, -6);
          if (ctx.rng.chance(0.7)) {
            setRescue(s, s.day + 8, 'sms');
            moodAll(s, 8, 'jie');
            return '阿杰咬着嘴唇，把驿站的位置、人数和伤情一条条打了进去。发送成功的那一刻，屏幕灭了。\n\n大家欢呼起来。阿杰却一个人在门口站了很久。';
          }
          moodAll(s, -3, 'jie');
          return '阿杰把位置一条条打了进去。进度条走到一半，信号断了，屏幕跟着黑了下去。没人知道那条短信发出去没有。';
        },
      },
      {
        label: '让他自己决定',
        hint: '看他有多信任你',
        run: (ctx) => {
          const s = ctx.s, j = C(s, 'jie');
          if (j.trust >= 55) {
            setRescue(s, s.day + 8, 'sms');
            addMood(j, 8);
            moodAll(s, 8, 'jie');
            s.flags.arc_jie = true;
            return '阿杰想了想："我爸会理解的。"\n\n他把位置发给了救援热线，最后加了一句："麻烦转告周建国，他儿子还活着。"';
          }
          addMood(j, 15);
          s.flags.arc_jie = true;
          return '阿杰犹豫了很久，最后还是点开了和爸爸的对话框。"爸，我没事。"他抬起头，有点心虚地看着大家："对不起啊……我就是，想让他知道。"';
        },
      },
    ],
  },

  // ───────────── 林晚 ─────────────
  {
    id: 'lin_bond',
    slot: 'evening',
    once: true,
    priority: 7,
    bind: (s) => (isAct(s, 'lin') && isAct(s, 'man') && rel(s, 'lin', 'man') >= 35 ? { actors: ['lin', 'man'] } : null),
    title: () => '梦话',
    text: () => '半夜，小满在睡梦里抓住林晚的手，迷迷糊糊地喊了一声"妈妈"。\n\n林晚僵住了，然后轻轻把她搂进怀里。',
    choices: () =>
      single('往火里添一把柴', (ctx) => {
        const s = ctx.s;
        s.res.wood = Math.max(0, s.res.wood - 1);
        addMood(C(s, 'lin'), 15); addMood(C(s, 'man'), 15);
        addRel(s, 'lin', 'man', 10);
        s.flags.lin_bond = true;
        s.flags.arc_man = true;
        return '那一夜火烧得很旺。第二天，林晚第一次没有站在门口望着山下。';
      }),
  },
  {
    id: 'lin_leave',
    slot: 'morning',
    once: true,
    priority: 9,
    bind: (s, rng) => {
      const l = ch(s, 'lin');
      if (!fine(l) || s.day < 6) return null;
      if (s.day >= 9 || rng.chance(0.35)) return { actors: ['lin'] };
      return null;
    },
    title: () => '林晚要走',
    text: (s) =>
      '天还没亮，林晚已经打好了背包。\n\n"我算过了，顺着公路往下，四十公里，三天能到，"她的声音在发抖，"今天是朵朵的生日。我答应过她的。"' +
      (s.flags.lin_bond && isAct(s, 'man') ? '\n\n小满拽着她的衣角，不肯撒手。' : ''),
    choices: (s) => {
      const l = C(s, 'lin');
      const bond = s.flags.lin_bond ? 0.3 : 0;
      const heard = s.flags.heard_lin ? 0.1 : 0;
      const p1 = Math.min(0.95, persuade(l, 0.15) + bond + heard);
      const bt = bestTalker(s, ['lin']);
      const p2 = bt ? Math.min(0.95, persuadeBy(s, bt, l, 0.1) + bond) : 0;
      const g = ch(s, 'gesang');
      const stay = (ctx: Ctx, who: string) => {
        addMood(l, -8); addTrust(l, 6);
        ctx.s.flags.lin_stayed = true;
        return `${who}林晚抱着背包坐了很久，最后把它放回了墙角。"……你说得对。我要是死在路上，朵朵就真的没有妈妈了。"`;
      };
      const go = (ctx: Ctx, p: number, food: number, note: string) => {
        const okTrip = ctx.rng.chance(p);
        leave(ctx, 'lin', food, note);
        if (okTrip) {
          ctx.s.flags.back_lin = true;
          ctx.s.flags.arc_lin = true;
          setRescue(ctx.s, ctx.s.day + 7, 'lin');
        } else ctx.s.flags.lost_lin = true;
      };
      const cs: Choice[] = [
        {
          label: '亲自劝她留下',
          hint: `成功率约 ${pct(p1)}`,
          run: (ctx) => {
            if (ctx.rng.chance(p1)) return stay(ctx, '');
            go(ctx, 0.3 + l.health / 400, 2, 'alone');
            return '"对不起。"她只留下这一句，推开门走进了风雪里。';
          },
        },
      ];
      if (bt) {
        cs.push({
          label: `请${N(bt.id)}去劝`,
          hint: `成功率约 ${pct(p2)}`,
          run: (ctx) => {
            if (ctx.rng.chance(p2)) { addRel(ctx.s, bt.id, 'lin', 8); return stay(ctx, `${N(bt.id)}陪她在门口说了很久的话。`); }
            go(ctx, 0.3 + l.health / 400, 2, 'alone');
            return `${N(bt.id)}没能拦住她。"对不起。"她推开门，走进了风雪里。`;
          },
        });
      }
      cs.push({
        label: '给她备足干粮，让她走（−4 食物、−1 药品）',
        disabled: s.res.food < 4,
        run: (ctx) => {
          ctx.s.res.med = Math.max(0, ctx.s.res.med - 1);
          go(ctx, 0.45 + l.health / 400, 4, 'supplied');
          return '你把干粮和药塞进她的背包，又帮她系紧了鞋带。她回头看了一眼驿站，然后一步一步走下了山道。';
        },
      });
      if (fine(g)) {
        cs.push({
          label: '让格桑护送她下山（−5 食物）',
          hint: '格桑会一起离开',
          disabled: s.res.food < 5,
          run: (ctx) => {
            const okTrip = ctx.rng.chance(0.85);
            leave(ctx, 'lin', 5, 'guided');
            leave(ctx, 'gesang', 0, 'guide');
            if (okTrip) {
              ctx.s.flags.back_lin = true; ctx.s.flags.back_gesang = true; ctx.s.flags.arc_lin = true;
              setRescue(ctx.s, ctx.s.day + 6, 'lin');
            } else { ctx.s.flags.lost_lin = true; ctx.s.flags.lost_gesang = true; }
            return '格桑检查了一遍绳索和冰镐："跟紧我，听我的。"两个人的身影很快消失在白茫茫的山道上。';
          },
        });
      }
      return cs;
    },
  },

  // ───────────── 胖叔 ─────────────
  {
    id: 'ma_confess',
    slot: 'evening',
    once: true,
    priority: 6,
    bind: (s) => {
      const m = ch(s, 'ma');
      return ok(m) && s.flags.busFound && (s.flags.heard_ma || m!.trust >= 65 || s.day >= 11) ? { actors: ['ma'] } : null;
    },
    title: () => '胖叔的心事',
    text: () =>
      '胖叔喝了半碗热水，突然把碗一放："我有件事，憋了好些天了。"\n\n他低着头说：车上个月就该保养，他想着跑完这趟再说，省那几百块钱……"是我害了大家。"',
    choices: (s) => [
      {
        label: '"车坏是天灾。你把大家照顾得很好。"',
        run: (ctx) => {
          const m = C(ctx.s, 'ma');
          addMood(m, 15); addTrust(m, 6);
          ctx.s.flags.arc_ma = true;
          if (isAct(s, 'su')) addTrust(C(s, 'su'), -3);
          return '胖叔眼圈红了，用力抹了把脸："那……那我明天多做两个菜！"';
        },
      },
      {
        label: '"说出来就好。这话，你得跟大家讲。"',
        run: (ctx) => {
          const st = ctx.s, m = C(st, 'ma');
          addMood(m, 6); addTrust(m, 4);
          st.flags.arc_ma = true;
          let t = '胖叔站起来，当着所有人的面把话说了。屋里安静了很久。';
          if (isAct(st, 'su')) { addRel(st, 'ma', 'su', -12); t += '苏蔓冷笑一声，转过身去。'; }
          if (isAct(st, 'lin')) { addRel(st, 'ma', 'lin', 10); t += '林晚走过去，拍了拍他的背。'; }
          if (isAct(st, 'jie')) { addRel(st, 'ma', 'jie', 8); t += '阿杰说："胖叔，你做的汤是我喝过最好喝的。这个不算抵消，但是算加分。"'; }
          for (const c of others(st, 'ma')) if (has(c, 'kind')) addRel(st, 'ma', c.id, 5);
          return t;
        },
      },
      {
        label: '沉默',
        run: (ctx) => {
          addMood(C(ctx.s, 'ma'), -6);
          return '胖叔等了一会儿，叹了口气，没再说下去。';
        },
      },
    ],
  },
  {
    id: 'radio_done',
    title: () => '电台响了',
    text: (s) =>
      `${isAct(s, 'ma') ? '胖叔' : '大家'}把最后一根线接上，拧开旋钮。一阵刺啦刺啦的杂音之后，传来一个人声：\n\n"……这里是县应急指挥中心，收到请回答……"\n\n屋里爆发出一阵欢呼。对方说，路一抢通，救援的雪地车就上山。`,
    choices: () =>
      single('抱在一起', (ctx) => {
        moodAll(ctx.s, 20);
        if (isAct(ctx.s, 'ma')) { ctx.s.flags.arc_ma = true; addMood(C(ctx.s, 'ma'), 10); }
        return '那天晚上，胖叔把剩下的腊肉全下了锅。"吃！"他说，"再熬几天，咱们熬得过去！"';
      }),
  },

  // ───────────── 苏蔓 ─────────────
  {
    id: 'su_challenge',
    slot: 'evening',
    cooldown: 8,
    chance: 0.35,
    priority: 4,
    bind: (s) => {
      const u = ch(s, 'su');
      if (!ok(u) || u!.trust >= 30 || s.day < 4 || s.flags.suDeputy) return null;
      const avg = act(s).reduce((t, c) => t + c.mood, 0) / act(s).length;
      return avg < 50 ? { actors: ['su'] } : null;
    },
    title: () => '苏蔓发难',
    text: () =>
      '晚饭时，苏蔓当着所有人的面放下碗："我直说了。这几天的分配毫无章法，再这样下去，我们撑不过半个月。我建议，以后由我来安排。"\n\n屋里所有人都看向了你。',
    choices: (s) => {
      const os = others(s, 'su');
      const avgTrust = os.length ? os.reduce((t, c) => t + c.trust, 0) / os.length : 50;
      const p = Math.min(0.9, 0.2 + avgTrust / 120);
      const u = C(s, 'su');
      return [
        {
          label: '据理力争',
          hint: `成功率约 ${pct(p)}（看大家信不信你）`,
          run: (ctx) => {
            if (ctx.rng.chance(p)) {
              addTrust(u, 8); addMood(u, -4); trustAll(ctx.s, 3, 'su');
              return '你把每一笔账摊开讲清楚。苏蔓听完，沉默了一会儿："……好吧，是我急了。"';
            }
            trustAll(ctx.s, -4, 'su'); addMood(u, 5);
            return '你说得磕磕绊绊，有人低下了头。苏蔓没再说什么，可她的话已经留在了每个人心里。';
          },
        },
        {
          label: '请她当副手，一起商量',
          hint: '她的「主心骨」效果会更强',
          run: (ctx) => {
            addTrust(u, 15); addMood(u, 10);
            ctx.s.flags.suDeputy = true;
            trustAll(ctx.s, -1, 'su');
            return '苏蔓愣了一下，然后点头："可以。但我要看所有的账。"那天夜里，她拿着树枝在地上算到了半夜。';
          },
        },
        {
          label: '"那你来试试看。"',
          run: (ctx) => {
            addMood(u, 12); addTrust(u, 5);
            moodAll(ctx.s, -4, 'su');
            return '苏蔓真的接手盘算了两天，很快发现这比她想的难得多。她再没提过这件事，只是看你的眼神变了。';
          },
        },
      ];
    },
  },
  {
    id: 'su_phone',
    slot: 'evening',
    cooldown: 5,
    priority: 6,
    bind: (s, rng) => {
      const u = ch(s, 'su');
      if (!ok(u) || s.day < 7 || s.flags.phoneUnlocked) return null;
      if (s.flags.heard_su || u!.trust >= 60) return { actors: ['su'], vars: { open: true } };
      if (s.flags.suPhoneSeen || !rng.chance(0.3)) return null;
      const w = adults(s, 'su');
      if (!w.length) return null;
      return { actors: ['su', rng.pick(w).id], vars: { open: false } };
    },
    title: () => '卫星电话',
    text: (s, ev) =>
      ev.vars.open
        ? '苏蔓把你叫到门外，从包里掏出一样东西——一部卫星电话。\n\n"电池没电了。我一直没说，因为我……不想被找到。"她把电话塞进你手里，"现在我想了。"'
        : `${N(ev.actors[1])}悄悄告诉你：夜里看见苏蔓一个人对着一部卫星电话发呆。\n\n那东西要是能用，大家早就得救了。`,
    choices: (s, ev) => {
      const u = C(s, 'su');
      if (ev.vars.open) {
        return single('接过电话（解锁「卫星电话供电」）', (ctx) => {
          ctx.s.flags.phoneUnlocked = true;
          ctx.s.flags.arc_su = true;
          addMood(u, 12); addTrust(u, 8);
          return '"给它做个供电装置就能用，"苏蔓说，"客车电瓶，铜线，再加一点运气。"去「营建」里可以开工。';
        });
      }
      const w = ev.actors[1];
      const p = persuade(u, 0.15);
      return [
        {
          label: '当众揭穿她',
          run: (ctx) => {
            const st = ctx.s;
            st.flags.phoneUnlocked = true;
            st.flags.suPhoneSeen = true;
            addMood(u, -20); addTrust(u, -20);
            for (const c of others(st, 'su')) { addRel(st, 'su', c.id, -12); addMood(c, 3); }
            return '"你藏着它？！"屋里炸开了锅。苏蔓脸色铁青，把电话摔在桌上："拿去！反正也没电！"（解锁「卫星电话供电」）';
          },
        },
        {
          label: '私下找她谈谈',
          hint: `成功率约 ${pct(p)}`,
          run: (ctx) => {
            const st = ctx.s;
            st.flags.suPhoneSeen = true;
            if (ctx.rng.chance(p)) {
              st.flags.phoneUnlocked = true;
              st.flags.arc_su = true;
              addMood(u, 10); addTrust(u, 10);
              return '苏蔓沉默了很久，说出了公司暴雷、几个亿的债务，和她来这座山的真正原因。\n\n"……拿去吧。"她把电话交给你，"我好像，又有点想活了。"（解锁「卫星电话供电」）';
            }
            addTrust(u, -5);
            return '"你看错了。"她把包的拉链拉上，再没理你。也许等她更信任你的时候，她会自己开口。';
          },
        },
        {
          label: '替她保密',
          run: (ctx) => {
            ctx.s.flags.suPhoneSeen = true;
            addTrust(u, 6);
            addRel(ctx.s, w, 'su', -5);
            return `你让${N(w)}先别声张。有些事，得等她自己开口。`;
          },
        },
      ];
    },
  },
  {
    id: 'phone_done',
    title: () => '电话通了',
    text: (s) =>
      `卫星电话的屏幕亮了。${isAct(s, 'su') ? '苏蔓' : '你'}深吸一口气，拨通了救援号码，用最简洁的话报告了位置、人数和伤情。\n\n挂断后，${isAct(s, 'su') ? '她' : '你'}把电话放下，手一直在抖。"他们知道我们在这儿了，"${isAct(s, 'su') ? '她说' : '你对大家说'}，"路一通就来。"`,
    choices: () =>
      single('长长地出一口气', (ctx) => {
        moodAll(ctx.s, 20);
        if (isAct(ctx.s, 'su')) { addMood(C(ctx.s, 'su'), 10); ctx.s.flags.arc_su = true; }
        return '屋里没人说话，然后不知道是谁先笑了出来，接着所有人都笑了。';
      }),
  },

  // ───────────── 小满 ─────────────
  {
    id: 'man_fever',
    slot: 'evening',
    once: true,
    chance: 0.2,
    priority: 5,
    bind: (s) => {
      const m = ch(s, 'man');
      return ok(m) && m!.sick === 0 && s.day - m!.joinedDay >= 2 ? { actors: ['man'] } : null;
    },
    title: () => '小满发烧了',
    text: (s) => `小满烧得滚烫，迷迷糊糊地喊着妈妈。${isAct(s, 'lin') ? '林晚摸了摸她的额头，脸色变了。' : ''}`,
    choices: (s) => {
      const m = C(s, 'man');
      const doc = act(s).filter((c) => c.id !== 'man').sort((a, b) => b.skills.med - a.skills.med)[0];
      const p = doc ? Math.min(0.9, 0.3 + doc.skills.med * 0.11) : 0.2;
      const cs: Choice[] = [
        {
          label: '用 2 盒药',
          disabled: s.res.med < 2,
          hint: s.res.med < 2 ? '药不够' : undefined,
          run: (ctx) => {
            ctx.s.res.med -= 2; addMood(m, 5);
            return '药喂下去，到后半夜，小满的烧退了。她醒过来第一句话是："豆豆没事吧？"';
          },
        },
      ];
      if (doc) {
        cs.push({
          label: `让${N(doc.id)}想想办法`,
          hint: `成功率约 ${pct(p)}`,
          run: (ctx) => {
            if (ctx.rng.chance(p)) {
              addRel(ctx.s, doc.id, 'man', 12);
              return `${N(doc.id)}用雪水给她擦身子降温，守了一整夜。天亮时，烧退了。`;
            }
            m.sick = 4; addHealth(m, -10);
            return `${N(doc.id)}守了一夜，烧还是没退下来。`;
          },
        });
      }
      cs.push({
        label: '让她硬扛过去',
        run: (ctx) => {
          m.sick = 4; addHealth(m, -15);
          for (const c of others(ctx.s, 'man')) if (has(c, 'kind')) addMood(c, -6);
          return '小满烧了整整一夜，一直在说胡话。';
        },
      });
      return cs;
    },
  },

  // ───────────── 格桑 ─────────────
  {
    id: 'gesang_story',
    slot: 'evening',
    once: true,
    priority: 6,
    bind: (s) => {
      const g = ch(s, 'gesang');
      return ok(g) && (s.flags.heard_gesang || g!.trust >= 70) ? { actors: ['gesang'] } : null;
    },
    title: () => '格桑的队伍',
    text: () =>
      '格桑一直盯着火苗。\n\n"雪崩前一天，向导组长让我撤，"她说，"我看了天，觉得还有两天的窗口，坚持往上走。……三个人。一个刚毕业，一个下个月结婚。"',
    choices: () => [
      {
        label: '"山上的事，谁也算不准。"',
        run: (ctx) => {
          const g = C(ctx.s, 'gesang');
          addMood(g, 15); addTrust(g, 5);
          ctx.s.flags.arc_gesang = true;
          return '格桑没说话。可那天夜里，她第一次睡了个整觉。';
        },
      },
      {
        label: '"那就替他们，把活着的人带出去。"',
        run: (ctx) => {
          const g = C(ctx.s, 'gesang');
          addMood(g, 8); addTrust(g, 8); addSkill(g, 'wild', 0.5);
          ctx.s.flags.arc_gesang = true;
          return '格桑抬起头，看了你很久："……好。"';
        },
      },
    ],
  },

  // ───────────── 吴铁 ─────────────
  {
    id: 'wu_carving',
    slot: 'morning',
    once: true,
    chance: 0.4,
    priority: 4,
    bind: (s) => {
      const w = ch(s, 'wu');
      return ok(w) && s.day - w!.joinedDay >= 4 ? { actors: ['wu'] } : null;
    },
    title: () => '木雕',
    text: (s) =>
      '一早醒来，每个人的枕边都多了一个小木雕。' +
      (isAct(s, 'qin') ? '老秦的是一只松鼠，' : '') +
      (isAct(s, 'jie') ? '阿杰的是一支画笔，' : '') +
      (isAct(s, 'ma') ? '胖叔的是一口小锅，' : '') +
      (isAct(s, 'man') ? '小满的是一只兔子，和豆豆一模一样，' : '') +
      '你的是一盏马灯。\n\n吴铁坐在角落里，假装什么也不知道。',
    choices: () =>
      single('把木雕摆在火边', (ctx) => {
        const st = ctx.s;
        moodAll(st, 8);
        addTrust(C(st, 'wu'), 5);
        for (const c of others(st, 'wu')) addRel(st, 'wu', c.id, 6);
        return '那一排小木雕在火光里晃着影子。好像屋里一下子多了好些人。';
      }),
  },
  {
    id: 'wu_speaks',
    slot: 'evening',
    once: true,
    priority: 6,
    bind: (s) => {
      const w = ch(s, 'wu');
      if (!ok(w)) return null;
      const asker = isAct(s, 'man') ? 'man' : isAct(s, 'jie') ? 'jie' : null;
      const trigger = s.flags.heard_wu || w!.trust >= 75 || (asker === 'man' && rel(s, 'wu', 'man') >= 40);
      return trigger ? { actors: asker ? ['wu', asker] : ['wu'] } : null;
    },
    title: () => '吴铁开口',
    text: (_s, ev) => {
      const asker = ev.actors[1];
      return (
        (asker ? `${N(asker)}问吴铁，为什么从来不说话。` : '你问吴铁，为什么从来不说话。') +
        '屋里一下安静了。\n\n吴铁张了张嘴，声音沙哑得像一扇生锈的铁门："……十年前……铲雪车……是我开的。老李……没出来。"'
      );
    },
    choices: (_s, ev) => [
      {
        label: '"那不是你的错。"',
        run: (ctx) => {
          const w = C(ctx.s, 'wu');
          addMood(w, 20); addTrust(w, 8);
          ctx.s.flags.arc_wu = true;
          return '吴铁低下头，肩膀抖了很久。后来他又说了一句话，声音很轻："……谢谢。"';
        },
      },
      {
        label: '"老李一定希望你好好活着。"',
        run: (ctx) => {
          const w = C(ctx.s, 'wu');
          addMood(w, 20); addTrust(w, 8);
          if (ev.actors[1]) addRel(ctx.s, 'wu', ev.actors[1], 10);
          ctx.s.flags.arc_wu = true;
          return '吴铁看着火，过了很久，点了点头。第二天一早，大家听见他在门外哼着一支很老的歌。';
        },
      },
    ],
  },

  // ───────────── 人际 ─────────────
  {
    id: 'quarrel',
    slot: 'evening',
    cooldown: 3,
    chance: 0.55,
    priority: 3,
    bind: (s) => {
      const A = act(s).filter((c) => !has(c, 'child'));
      let best: [string, string, number] | null = null;
      for (let i = 0; i < A.length; i++) {
        for (let j = i + 1; j < A.length; j++) {
          const a = A[i], b = A[j];
          let r = rel(s, a.id, b.id);
          if ((has(a, 'hothead') && a.mood < 40) || (has(b, 'hothead') && b.mood < 40)) r -= 15;
          if (a.hungerDays || b.hungerDays) r -= 8;
          if (r <= -25 && (!best || r < best[2])) best = [a.id, b.id, r];
        }
      }
      return best ? { actors: [best[0], best[1]] } : null;
    },
    title: () => '争吵',
    text: (s, ev) => {
      const [a, b] = ev.actors;
      let why = '起因是一件小事，可越吵越凶，眼看就要动手。';
      if ([a, b].includes('ma') && [a, b].includes('su')) why = '苏蔓又提起了客车抛锚的事，胖叔一下子炸了。';
      else if (C(s, a).hungerDays || C(s, b).hungerDays) why = '为了谁多吃了一口。饿着肚子的人，脾气都大。';
      else if (s.temp <= -20) why = '为了今天该谁去砍柴。外面冷得能冻掉手指。';
      return `${N(a)}和${N(b)}吵起来了。${why}`;
    },
    choices: (s, ev) => {
      const [a, b] = ev.actors.map((id) => C(s, id));
      const m = bestTalker(s, [a.id, b.id]);
      const pm = m ? Math.min(0.9, 0.3 + m.skills.talk * 0.12) : 0;
      const pf = Math.min(0.9, 0.25 + (a.trust + b.trust) / 300);
      const side = (w: CharState, l: CharState) => (ctx: Ctx) => {
        addRel(ctx.s, w.id, l.id, -5);
        addTrust(w, 5); addMood(w, 5);
        addTrust(l, -7); addMood(l, -8);
        return `你站在了${N(w.id)}这边。${N(l.id)}什么也没说，摔门出去，在雪地里站了很久。`;
      };
      const cs: Choice[] = [
        { label: `站在${N(a.id)}这边`, run: side(a, b) },
        { label: `站在${N(b.id)}这边`, run: side(b, a) },
      ];
      if (m) {
        cs.push({
          label: `请${N(m.id)}来调解`,
          hint: `成功率约 ${pct(pm)}`,
          run: (ctx) => {
            if (ctx.rng.chance(pm)) {
              addRel(ctx.s, a.id, b.id, 22); addMood(a, 5); addMood(b, 5);
              addRel(ctx.s, m.id, a.id, 4); addRel(ctx.s, m.id, b.id, 4);
              return `${N(m.id)}把两个人拉到火边，三言两语就把火气压了下去。临睡前，${N(a.id)}和${N(b.id)}竟然一起去抱了柴。`;
            }
            addRel(ctx.s, a.id, b.id, -5);
            return `${N(m.id)}劝了半天，两个人谁也不服谁，最后各自背对着睡了。`;
          },
        });
      }
      cs.push({
        label: '各打五十大板',
        hint: `成功率约 ${pct(pf)}`,
        run: (ctx) => {
          if (ctx.rng.chance(pf)) {
            addRel(ctx.s, a.id, b.id, 14);
            return '"在这儿，我们只有彼此。"你说完，两个人都低下了头。';
          }
          addTrust(a, -3); addTrust(b, -3);
          return '两个人都觉得你偏心另一个。';
        },
      });
      return cs;
    },
  },
  {
    id: 'breakdown',
    slot: 'evening',
    cooldown: 3,
    priority: 5,
    bind: (s) => {
      const x = act(s).filter((c) => c.mood < 12 && c.restDays === 0).sort((a, b) => a.mood - b.mood)[0];
      return x ? { actors: [x.id] } : null;
    },
    title: (_s, ev) => `${N(ev.actors[0])}撑不住了`,
    text: (_s, ev) => {
      const x = ev.actors[0];
      return `${N(x)}突然把手里的东西一摔，蹲到墙角，抱着头，谁叫也不应。\n\n"${def(x).lines.greet.low[0]}"`;
    },
    choices: (s, ev) => {
      const x = C(s, ev.actors[0]);
      const p = persuade(x, 0.3);
      const f = others(s, x.id).sort((a, b) => rel(s, b.id, x.id) - rel(s, a.id, x.id))[0];
      const cs: Choice[] = [
        {
          label: `坐下来陪${ta(x.id)}`,
          hint: `成功率约 ${pct(p)}`,
          run: (ctx) => {
            if (ctx.rng.chance(p)) { addMood(x, 25); addTrust(x, 5); return `你在${N(x.id)}旁边坐了很久，什么也没说。后来${ta(x.id)}开口了，说了很多很多。`; }
            addMood(x, 6);
            return `${N(x.id)}一直没有抬头。但至少，${ta(x.id)}知道有人在。`;
          },
        },
      ];
      if (f && rel(s, f.id, x.id) >= 25) {
        cs.push({
          label: `请${N(f.id)}陪${ta(x.id)}`,
          hint: '成功率约 75%',
          run: (ctx) => {
            if (ctx.rng.chance(0.75)) { addMood(x, 20); addRel(ctx.s, f.id, x.id, 6); return `${N(f.id)}挨着${N(x.id)}坐下，递过去一碗热水。${N(x.id)}接过去，哭出了声。`; }
            addMood(x, 5);
            return `${N(f.id)}陪了一晚上，${N(x.id)}还是没缓过来。`;
          },
        });
      }
      cs.push({
        label: `让${ta(x.id)}歇两天`,
        run: () => { x.restDays = 2; addMood(x, 12); return `${N(x.id)}裹着毯子缩在火边。这两天，${ta(x.id)}什么活也干不了了。`; },
      });
      return cs;
    },
  },
  {
    id: 'friends',
    slot: 'evening',
    cooldown: 3,
    priority: 2,
    bind: (s) => {
      const A = act(s);
      for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
        const a = A[i].id, b = A[j].id;
        if (rel(s, a, b) >= 60 && !s.flags[`bff_${a}_${b}`]) return { actors: [a, b] };
      }
      return null;
    },
    title: () => '过命的交情',
    text: (_s, ev) => {
      const [a, b] = ev.actors;
      return `夜里只剩${N(a)}和${N(b)}还醒着。${N(a)}说起了从没对人说过的事，${N(b)}也是。\n\n火光把两个人的影子投在墙上，挨得很近。`;
    },
    choices: (_s, ev) =>
      single('不去打扰', (ctx) => {
        const [a, b] = ev.actors;
        ctx.s.flags[`bff_${a}_${b}`] = true;
        addMood(C(ctx.s, a), 6); addMood(C(ctx.s, b), 6);
        return `从那天起，${N(a)}和${N(b)}成了真正的朋友。`;
      }),
  },
  {
    id: 'mentor',
    slot: 'evening',
    cooldown: 4,
    chance: 0.5,
    priority: 2,
    bind: (s, rng) => {
      const A = act(s);
      const keys: SkillKey[] = ['wild', 'craft', 'med', 'str', 'talk'];
      const opts: { actors: string[]; vars: Vars }[] = [];
      for (const t of A) for (const l of A) {
        if (t === l || rel(s, t.id, l.id) < 30) continue;
        for (const k of keys) if (t.skills[k] >= l.skills[k] + 2 && l.skills[k] < 4.5) opts.push({ actors: [t.id, l.id], vars: { k } });
      }
      return opts.length ? rng.pick(opts) : null;
    },
    title: () => '手艺',
    text: (_s, ev) => {
      const [t, l] = ev.actors;
      return `${N(t)}开始教${N(l)}${SKILLS[ev.vars.k as SkillKey]}上的门道。${N(l)}学得很认真。`;
    },
    choices: (_s, ev) =>
      single('看着他们', (ctx) => {
        const [t, l] = ev.actors;
        const k = ev.vars.k as SkillKey;
        addSkill(C(ctx.s, l), k, 0.7);
        addRel(ctx.s, t, l, 5);
        return `${N(l)}的${SKILLS[k]}长进了不少。`;
      }),
  },

  // ───────────── 夜里的麻烦 ─────────────
  {
    id: 'wolves',
    title: () => '狼',
    text: (_s, ev) => String(ev.vars.text),
    choices: (s) => [
      {
        label: '用 2 件物资加固围栏',
        disabled: s.res.mat < 2 || !!s.flags.fence,
        hint: s.flags.fence ? '已经加固过了' : undefined,
        run: (ctx) => { ctx.s.res.mat -= 2; ctx.s.flags.fence = true; return '新的围栏扎得又密又高。狼群再来，就没那么容易了。'; },
      },
      { label: '清点损失', run: () => '你把剩下的东西重新码好。夜还很长。' },
    ],
  },
  {
    id: 'theft',
    title: (_s, ev) => (ev.vars.caught ? '抓到偷吃的' : '粮食少了'),
    text: (_s, ev) =>
      ev.vars.caught
        ? `半夜，守夜的${N(String(ev.vars.guard))}看见${N(ev.actors[0])}在偷偷翻粮袋。${ta(ev.actors[0])}手里攥着两块干粮，不敢抬头。`
        : `早上清点，粮袋里少了 ${ev.vars.n} 份食物。夜里没人守着，谁都有可能。`,
    choices: (s, ev) => {
      const x = C(s, ev.actors[0]);
      if (ev.vars.caught) {
        return [
          {
            label: `原谅${ta(x.id)}`,
            run: (ctx) => { addMood(x, 8); addTrust(x, 10); trustAll(ctx.s, -2, x.id); return `${N(x.id)}的眼泪一下子掉了下来。有人小声嘀咕"凭什么"，但没人再说什么。`; },
          },
          {
            label: '当众批评',
            run: (ctx) => { addMood(x, -15); addTrust(x, -10); moodAll(ctx.s, 2, x.id); for (const c of others(ctx.s, x.id)) addRel(ctx.s, c.id, x.id, -5); return `${N(x.id)}低着头站在屋子中间。从那以后，${ta(x.id)}吃饭总是坐在最边上。`; },
          },
          {
            label: `罚${ta(x.id)}今晚守夜`,
            run: () => { x.task = 'guard'; addMood(x, -6); return `${N(x.id)}一声不吭地接过了守夜的位置。`; },
          },
        ];
      }
      return [
        {
          label: '追查',
          hint: '成功率约 45%',
          run: (ctx) => {
            if (ctx.rng.chance(0.45)) {
              addTrust(x, -5); addMood(x, -6);
              for (const c of others(ctx.s, x.id)) addRel(ctx.s, c.id, x.id, -6);
              return `嘴角的饼渣出卖了${ta(x.id)}——是${N(x.id)}。`;
            }
            trustAll(ctx.s, -2);
            return '问了一圈，谁也不承认。屋里的气氛变得很怪，每个人都在偷偷打量别人。';
          },
        },
        { label: '不追究', run: () => '你什么也没说。也许有人比你想的更饿。' },
        {
          label: '以后把粮食锁起来（−1 物资）',
          disabled: s.res.mat < 1,
          run: (ctx) => { ctx.s.res.mat -= 1; ctx.s.flags.foodLocked = true; return '你用铁丝和木板做了个粮箱，钥匙挂在了自己身上。'; },
        },
      ];
    },
  },
  {
    id: 'leave_try',
    title: (_s, ev) => (ev.vars.caught ? `${N(ev.actors[0])}想走` : `${N(ev.actors[0])}不见了`),
    text: (_s, ev) => {
      const x = ev.actors[0];
      return ev.vars.caught
        ? `半夜，${N(String(ev.vars.guard))}在门口拦住了背着包的${N(x)}。\n\n"别拦我，"${ta(x)}说，"待在这儿也是等死。"`
        : `天亮时，${N(x)}的铺位空了，粮袋里少了 2 份食物。门外的脚印朝山下去了，很快被新雪盖住。`;
    },
    choices: (s, ev) => {
      const x = C(s, ev.actors[0]);
      if (!ev.vars.caught) return single('……', () => `大家沉默地吃完了早饭。没人提${N(x.id)}的名字。`);
      const p = persuade(x, 0.35);
      return [
        {
          label: '好好谈谈',
          hint: `成功率约 ${pct(p)}`,
          run: (ctx) => {
            if (ctx.rng.chance(p)) { addMood(x, 22); addTrust(x, 6); x.lowMoodDays = 0; return `你和${N(x.id)}在门口说了很久。最后，${ta(x.id)}把包放了下来。`; }
            leave(ctx, x.id, 2, 'night');
            moodAll(ctx.s, -5);
            return `${N(x.id)}推开你，走进了夜色里。`;
          },
        },
        {
          label: `让${ta(x.id)}走（带上 2 份食物）`,
          run: (ctx) => { leave(ctx, x.id, 2, 'night'); moodAll(ctx.s, -5); return `${N(x.id)}背着包走进了风雪。门在${ta(x.id)}身后关上了。`; },
        },
      ];
    },
  },
  {
    id: 'death',
    title: (_s, ev) => `${def(ev.actors[0]).name}走了`,
    text: (s, ev) => {
      const x = ev.actors[0];
      const f = others(s).sort((a, b) => rel(s, b.id, x) - rel(s, a.id, x))[0];
      return `${N(x)}没能挺过去。大家围着${ta(x)}，谁也没有说话。` + (f && rel(s, f.id, x) >= 30 ? `\n\n${N(f.id)}握着${ta(x)}的手，一直没有松开。` : '');
    },
    choices: (s, ev) => [
      {
        label: `为${ta(ev.actors[0])}立一块木牌（−1 柴火）`,
        disabled: s.res.wood < 1,
        run: (ctx) => {
          ctx.s.res.wood -= 1;
          moodAll(ctx.s, 4); trustAll(ctx.s, 2);
          return `木牌上刻着${def(ev.actors[0]).name}的名字，立在驿站背风的一侧。`;
        },
      },
      {
        label: `把${ta(ev.actors[0])}留下的东西分给大家（+2 食物、+1 物资）`,
        run: (ctx) => {
          ctx.s.res.food += 2; ctx.s.res.mat += 1;
          for (const c of act(ctx.s)) addMood(c, has(c, 'kind') ? -6 : -2);
          return '活着的人，还得活下去。';
        },
      },
    ],
  },
  {
    id: 'blizzard',
    title: () => '暴风雪',
    text: () => '风从半夜开始变了声，像有人在屋外哭。到天亮时，门已经推不开了。\n\n暴风雪来了。外出的人收获减半，也更容易出事。',
    choices: (s) => [
      {
        label: '用 2 件物资加固门窗',
        disabled: s.res.mat < 2,
        run: () => { s.res.mat -= 2; return '大家把能用的木板全钉上了窗。风还在吼，但屋里稳住了。'; },
      },
      {
        label: '赌一把',
        run: (ctx) => {
          if (ctx.rng.chance(0.5)) {
            ctx.s.res.wood = Math.max(0, ctx.s.res.wood - 3);
            moodAll(ctx.s, -4);
            return '半夜，屋顶被掀开了一角，雪灌进来，打湿了 3 捆柴。';
          }
          return '屋顶吱吱呀呀响了一夜，但总算撑住了。';
        },
      },
    ],
  },
  {
    id: 'stranger',
    slot: 'evening',
    cooldown: 6,
    chance: 0.18,
    priority: 3,
    bind: (s, rng) => (s.day >= 4 ? { actors: [], vars: { offer: rng.int(0, 2) } } : null),
    title: () => '过路的猎户',
    text: (_s, ev) => {
      const o = OFFERS[Number(ev.vars.offer)];
      return `一个背着老式猎枪的老猎户敲开了门，帽檐上全是冰碴。他想换点东西：${o.text}`;
    },
    choices: (s, ev) => {
      const o = OFFERS[Number(ev.vars.offer)];
      return [
        {
          label: '成交',
          disabled: s.res[o.give[0]] < o.give[1],
          run: (ctx) => {
            ctx.s.res[o.give[0]] -= o.give[1];
            ctx.s.res[o.get[0]] += o.get[1];
            return '老猎户把东西放下，点点头，消失在了雪里。';
          },
        },
        {
          label: '请他喝碗热汤，不换了',
          run: (ctx) => {
            for (const c of act(ctx.s)) addMood(c, has(c, 'kind') ? 4 : 2);
            const left = ctx.s.rescueDay - ctx.s.day;
            return `老猎户捧着碗暖了暖手。临走时他说："山下在抢路，听说最快也得${left}天才能上来。"`;
          },
        },
      ];
    },
  },
];

const OFFERS: { text: string; give: ['food' | 'wood' | 'mat' | 'med', number]; get: ['food' | 'wood' | 'mat' | 'med', number] }[] = [
  { text: '用 2 盒药，换 4 份食物。', give: ['food', 4], get: ['med', 2] },
  { text: '用 3 份腊肉，换 5 捆柴。', give: ['wood', 5], get: ['food', 3] },
  { text: '用 3 件铁器零件，换 3 份食物。', give: ['food', 3], get: ['mat', 3] },
];

const all = [...list, ...STORY_EVENTS];
export const EVENTS: Record<string, EventDef> = Object.fromEntries(all.map((e) => [e.id, e]));
export const SCHEDULED = all.filter((e) => e.slot);
