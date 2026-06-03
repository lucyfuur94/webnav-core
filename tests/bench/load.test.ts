import { describe, it, expect } from 'vitest';
import { parseTasks, ALLOWED_CATEGORIES } from '../../bench/load.js';

const VALID = `
tasks:
  - id: a1
    category: github-live
    prompt: find a live thing
    gold_answer: the live thing is X
  - id: a2
    category: web-live
    prompt: what is Y right now
    gold_answer: Y is currently Z
`;

describe('parseTasks', () => {
  it('parses a valid task set', () => {
    const tasks = parseTasks(VALID);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ id: 'a1', category: 'github-live',
      prompt: 'find a live thing', gold_answer: 'the live thing is X' });
  });

  it('rejects a task missing a required field', () => {
    const bad = `
tasks:
  - id: a1
    category: github-live
    prompt: no gold here
`;
    expect(() => parseTasks(bad)).toThrow(/gold_answer/);
  });

  it('rejects duplicate ids', () => {
    const dup = `
tasks:
  - id: dupe
    category: web-live
    prompt: p
    gold_answer: g
  - id: dupe
    category: web-live
    prompt: p2
    gold_answer: g2
`;
    expect(() => parseTasks(dup)).toThrow(/duplicate/i);
  });

  it('rejects an unknown category', () => {
    const badcat = `
tasks:
  - id: a1
    category: synthesis-hard
    prompt: p
    gold_answer: g
`;
    expect(() => parseTasks(badcat)).toThrow(/category/);
  });

  it('rejects an empty / taskless file', () => {
    expect(() => parseTasks('tasks: []')).toThrow(/no tasks/i);
  });

  it('exposes exactly the live-benchmark categories', () => {
    expect([...ALLOWED_CATEGORIES].sort()).toEqual(['botwalled', 'github-live', 'web-live']);
  });
});
