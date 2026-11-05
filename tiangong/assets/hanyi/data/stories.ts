// 每个人的「心路」：三四章，从第一次露出心事，到说出口，再到解开心结。
// 章节只是把事件和标记串起来看，触发还是靠 events.ts / events-story.ts 里的事件和夜里的谈话。

import type { GameState } from '../core/types';
import { CHARS } from './characters';

export interface Chapter {
  title: string;
  /** 还没走到这一章时给的提示 */
  hint: string;
  done: (s: GameState) => boolean;
}

const f = (k: string) => (s: GameState) => !!s.flags[k];
const fired = (k: string) => (s: GameState) => !!s.fired[k];
const heard = (id: string) => f(`heard_${id}`);
const trustHint = (id: string, what = '夜里问起过去') => `${what}（信任 ${CHARS[id].secretTrust}）`;

export const STORIES: Record<string, Chapter[]> = {
  qin: [
    { title: '路口', hint: '和他多处几天，清早留意他去了哪儿', done: f('qin_ch1') },
    { title: '秦川', hint: trustHint('qin'), done: heard('qin') },
    { title: '地窖', hint: '说出心事以后，他也许会带你去看点东西', done: f('qinSonTold') },
    { title: '回家的路', hint: '有人能替他记住儿子的样子；或者，等他自己走到那条路上', done: f('arc_qin') },
  ],
  lin: [
    { title: '百分之四', hint: '和她熟一些，夜里留意她的手机', done: f('lin_ch1') },
    { title: '生日', hint: trustHint('lin'), done: heard('lin') },
    { title: '要走', hint: '她心里一直在盘算一件事', done: fired('lin_leave') },
    { title: '交代', hint: '无论走还是留，都要让她对女儿有个交代', done: f('arc_lin') },
  ],
  jie: [
    { title: '速写本', hint: '和他熟一些，留意他总抱着的那个包', done: f('jie_ch1') },
    { title: '未读消息', hint: trustHint('jie'), done: heard('jie') },
    { title: '一格信号', hint: '后山的山脊上，也许有信号', done: fired('jie_signal') },
    { title: '像了', hint: '他还欠一个人一张画', done: f('arc_jie') },
  ],
  ma: [
    { title: '刹车片', hint: '找到客车以后，留意他一早去了哪儿', done: f('ma_ch1') },
    { title: '保养', hint: trustHint('ma'), done: heard('ma') },
    { title: '坦白', hint: '他憋着一件事，迟早要说出来', done: fired('ma_confess') },
    { title: '放下', hint: '让他相信，大家不怪他', done: f('arc_ma') },
  ],
  su: [
    { title: '一串数字', hint: '她谁也不信。先让她信你一点', done: f('su_ch1') },
    { title: '不想被找到', hint: trustHint('su'), done: heard('su') },
    { title: '交出电话', hint: '她的包里藏着一样东西', done: f('arc_su') },
    { title: '电话通了', hint: '给那样东西接上电', done: fired('phone_done') },
  ],
  man: [
    { title: '豆豆', hint: '陪她几天，听听她跟兔子说什么', done: f('man_ch1') },
    { title: '没听话', hint: trustHint('man'), done: heard('man') },
    { title: '不是你的错', hint: '得有人抱抱她，告诉她那不是她的错', done: f('arc_man') },
    { title: '豆豆的耳朵', hint: '豆豆的耳朵快掉了，也许有一双巧手能补好', done: f('bunny_sewn') },
  ],
  gesang: [
    { title: '三个名字', hint: '和她熟一些，清早留意门外的雪地', done: f('gesang_ch1') },
    { title: '雪崩', hint: trustHint('gesang'), done: heard('gesang') },
    { title: '格桑的队伍', hint: '等她自己开口', done: f('arc_gesang') },
    { title: '同一座山', hint: '驿站里还有一个，在这座山上失去过亲人的人', done: f('bond_qin_gesang') },
  ],
  wu: [
    { title: '木雕', hint: '他来了几天以后，看看枕头边', done: fired('wu_carving') },
    { title: '十年前', hint: trustHint('wu', '夜里陪他坐坐'), done: heard('wu') },
    { title: '开口', hint: '也许一个孩子的问题，能让他开口', done: f('arc_wu') },
    { title: '针脚', hint: '小满的布兔子', done: f('bunny_sewn') },
  ],
};

/** 走到了第几章：已经完成的章节数（后面的章完成了，前面没触发的也算走过） */
export function progress(s: GameState, id: string) {
  const ch = STORIES[id] ?? [];
  let last = -1;
  ch.forEach((c, i) => { if (c.done(s)) last = i; });
  return { chapters: ch, reached: last + 1, done: ch.map((c, i) => c.done(s) || i < last) };
}
