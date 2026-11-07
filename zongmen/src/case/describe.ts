// 把案件打印成人能读的文字：命令行调试、人工抽查用。

import type { GameData } from '../data/types';
import { buildSystemPrompt } from '../ai/prompt';
import type { CaseData } from './generator';

export function describeCase(c: CaseData, data: GameData, opts: { cards?: boolean; prompts?: boolean } = {}): string {
  const name = (id: string) => data.characters.find((x) => x.id === id)!.name;
  const loc = (id: string) => data.locations.find((x) => x.id === id)!.name;
  const trait = data.traits.find((t) => t.id === c.trait)!;
  const roleName = { culprit: '内奸', secret: '有秘密', witness: '目击者' } as const;
  const lines: string[] = [];
  lines.push(`== 案件 种子 ${c.seed}（版本 ${c.version}，第 ${c.attempt + 1} 次生成${c.tutorial ? '，新手局' : ''}）==`);
  lines.push(`时辰：${c.time_slot}　被盗：${c.stolen_item.name}　伪证模式：${c.pattern}`);
  lines.push(`内奸：${name(c.culprit)}　动机：${c.motive}　失言：${c.slip_detail.text}`);
  lines.push(`特征线索：${trait.name}　嫌疑人：${c.disciples.filter((d) => d.id === c.culprit || d.co_suspect).map((d) => name(d.id)).join('、')}`);
  lines.push('');
  lines.push('弟子　　　身份　　真实位置　　说法');
  for (const d of c.disciples) {
    lines.push(
      `${name(d.id).padEnd(4, '　')}　${roleName[d.role].padEnd(3, '　')}${d.co_suspect ? '＊' : '　'}　${loc(d.true_location).padEnd(4, '　')}　${loc(d.claim_location)}（${d.claim_story.doing}）`,
    );
  }
  lines.push('');
  lines.push(`事实 ${c.facts.length} 条：`);
  for (const f of c.facts) {
    const where = f.found_at ? `勘察${loc(f.found_at)}` : `${name(f.holder!)}${f.visibility === 'hidden' ? '·隐瞒' : f.visibility === 'slip' ? '·失言' : ''}`;
    const mark = c.conviction_set.includes(f.id) ? '★' : '　';
    lines.push(`${mark}[${f.id}] ${f.kind.padEnd(12)} ${where.padEnd(8, '　')} ${f.text}`);
  }
  lines.push('');
  lines.push('矛盾对：');
  for (const x of c.contradictions) lines.push(`  ${x.evidence} 打破 ${x.claim}（${name(x.target)}的说法）`);
  lines.push(`定罪证据集（★）：${c.conviction_set.join('、')}`);

  if (opts.cards) {
    lines.push('');
    for (const d of c.disciples) {
      const card = c.knowledge[d.id];
      lines.push(`-- 知识卡：${name(d.id)}（${roleName[d.role]}）--`);
      for (const f of card.facts) {
        const fact = c.facts.find((x) => x.id === f.id)!;
        lines.push(`  [${f.id}]（${f.visibility === 'public' ? '公开' : f.visibility === 'hidden' ? '隐瞒' : '失言'}）${fact.quote ?? fact.text}`);
      }
      lines.push(`  说法${card.claim_is_lie ? '（谎话）' : '（实话）'}：${d.claim_story.doing}；${d.claim_story.detail}`);
      if (card.culprit) lines.push(`  真相：在藏经阁；动机：${card.culprit.motive}；失言细节：${card.culprit.slip.text}`);
      if (card.secret) lines.push(`  秘密：${card.secret.summary}`);
    }
  }
  if (opts.prompts) {
    for (const d of c.disciples) {
      lines.push('');
      lines.push(`-- 系统提示词：${name(d.id)} --`);
      lines.push(buildSystemPrompt(data, c, d.id));
    }
  }
  return lines.join('\n');
}
