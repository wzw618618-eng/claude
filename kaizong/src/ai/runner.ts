// 过季前问 AI：重要的人这一季想做什么、敌宗宗主怎么出手；过季后让 AI 写新心愿和心愿得偿时的感言。
// 答得不合规矩（没挑合法选项、出戏、太长）就丢掉，退回规则。

import type { Pick, Plan } from '../game/season';
import type { WishNews } from '../game/wishes';
import { wishOptions } from '../game/wishes';
import type { World } from '../game/types';
import { P } from '../game/world';
import { asJson, type AiClient } from './client';
import { decidePrompt, reactionPrompt, rivalPrompt, wishPrompt } from './prompts';

const META = /AI|模型|选项|代号|JSON|游戏|玩家|数值|prompt/i;

export function cleanLine(s: unknown, max = 30): string | null {
  if (typeof s !== 'string') return null;
  let t = s.trim().replace(/^["“「]+|["”」]+$/g, '');
  if (!t || META.test(t)) return null;
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('，'));
    t = end > 6 ? cut.slice(0, end + 1).replace(/，$/, '。') : cut + '……';
  }
  return t;
}

/** 并发跑一批请求 */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export interface AskResult { picks: Record<string, Pick>; rivalPicks: Record<string, Pick>; failed: number; error?: string }

export async function askSeason(w: World, plan: Plan, ai: AiClient, onProgress: (done: number, total: number, who: string) => void): Promise<AskResult> {
  const picks: Record<string, Pick> = {};
  const rivalPicks: Record<string, Pick> = {};
  let failed = 0;
  let error: string | undefined;
  const jobs: { kind: 'p' | 'r'; id: string }[] = [...plan.aiWho.map((id) => ({ kind: 'p' as const, id })), ...plan.aiRivals.map((id) => ({ kind: 'r' as const, id }))];
  let done = 0;
  await pool(jobs, 4, async (job) => {
    try {
      if (job.kind === 'p') {
        const p = P(w, job.id)!;
        const opts = plan.options[job.id];
        const q = decidePrompt(w, p, opts, plan.unc);
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await ai.chat({ ...q, maxTokens: 120, temperature: 0.9 });
          const o = asJson(res.text);
          const pick = typeof o?.pick === 'string' ? o.pick.trim() : '';
          if (opts.some((c) => c.id === pick)) { picks[job.id] = { id: pick, why: cleanLine(o?.why) ?? undefined, by: 'ai' }; break; }
          if (attempt === 1) failed++;
        }
      } else {
        const rv = w.rivals.find((x) => x.id === job.id)!;
        const opts = plan.rivalOptions[job.id];
        const q = rivalPrompt(w, rv, opts);
        const res = await ai.chat({ ...q, maxTokens: 120 });
        const o = asJson(res.text);
        const pick = typeof o?.pick === 'string' ? o.pick.trim() : '';
        if (opts.some((c) => c.id === pick)) rivalPicks[job.id] = { id: pick, why: cleanLine(o?.why) ?? undefined, by: 'ai' };
        else failed++;
      }
    } catch (e) {
      failed++;
      error = e instanceof Error ? e.message : String(e);
    }
    done++;
    onProgress(done, jobs.length, job.kind === 'p' ? P(w, job.id)?.name ?? '' : w.rivals.find((x) => x.id === job.id)?.name ?? '');
  });
  return { picks, rivalPicks, failed, error };
}

/** 过季后：新心愿交给 AI 改写；心愿得偿、记在宗主头上的，让他说一句话 */
export async function afterSeason(w: World, ai: AiClient, newWishes: string[], news: WishNews[], limit: number): Promise<number> {
  let n = 0;
  const wishJobs = newWishes.slice(0, Math.max(1, Math.floor(limit / 2)));
  await pool(wishJobs, 4, async (id) => {
    const p = P(w, id);
    if (!p?.alive || !p.wishPending) return;
    const opts = wishOptions(w, p).sort((a, b) => b.weight - a.weight).slice(0, 6);
    try {
      const res = await ai.chat({ ...wishPrompt(w, p, opts), maxTokens: 100 });
      const o = asJson(res.text);
      const i = Number(o?.pick);
      const text = cleanLine(o?.text, 30);
      if (Number.isInteger(i) && opts[i] && text) {
        p.wish = { kind: opts[i].kind, target: opts[i].target, param: opts[i].param, text, since: w.t, by: 'ai' };
        n++;
      }
    } catch { /* 留着规则写的心愿 */ }
    p.wishPending = false;
  });
  for (const x of news.filter((y) => y.credit).slice(0, 3)) {
    try {
      const res = await ai.chat({ ...reactionPrompt(w, x.p, x.wish.text, x.credit!.text), maxTokens: 100 });
      const line = cleanLine(asJson(res.text)?.reply, 36);
      if (!line) continue;
      const item = w.report.find((it) => it.about.includes(x.p.id) && it.text.includes(x.wish.text));
      if (item) item.quote = { who: x.p.id, text: line };
      const life = [...x.p.life].reverse().find((l) => l.text.includes(x.wish.text));
      if (life) life.text += `——"${line}"`;
      n++;
    } catch { /* 没有感言也无妨 */ }
  }
  for (const id of newWishes) { const p = P(w, id); if (p) p.wishPending = false; }
  return n;
}
