import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const ALLOWED_CATEGORIES = [
  'github-live', 'web-live', 'botwalled',
] as const;
export type Category = (typeof ALLOWED_CATEGORIES)[number];

export interface BenchTask {
  id: string;
  category: Category;
  prompt: string;
  gold_answer: string;
}

/** Parse + validate the benchmark task set from YAML text. Throws on any
 *  structural problem so a malformed set can't silently skew a run. */
export function parseTasks(text: string): BenchTask[] {
  const doc: any = parse(text);
  const raw: any[] = doc?.tasks;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('bench task set has no tasks');
  }
  const seen = new Set<string>();
  const tasks: BenchTask[] = [];
  for (const t of raw) {
    for (const field of ['id', 'category', 'prompt', 'gold_answer'] as const) {
      if (typeof t?.[field] !== 'string' || t[field].trim() === '') {
        throw new Error(`task ${JSON.stringify(t?.id ?? '?')} missing required field: ${field}`);
      }
    }
    if (!ALLOWED_CATEGORIES.includes(t.category)) {
      throw new Error(`task ${t.id}: unknown category '${t.category}'`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    seen.add(t.id);
    tasks.push({ id: t.id, category: t.category, prompt: t.prompt.trim(), gold_answer: t.gold_answer.trim() });
  }
  return tasks;
}

/** Load + validate the task set from a YAML file path. */
export function loadTasks(path = 'bench/tasks.yml'): BenchTask[] {
  return parseTasks(readFileSync(path, 'utf8'));
}
