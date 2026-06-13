import { describe, it, expect } from 'vitest';
import { CONSUMER_COMMANDS } from '../../src/cli-spec.js';

describe('consumer command groups', () => {
  it('every consumer command has a group', () => {
    for (const c of CONSUMER_COMMANDS) {
      expect(['find', 'read', 'navigate']).toContain((c as any).group);
    }
  });

  it('the core verbs land in the expected groups', () => {
    const byName = Object.fromEntries(CONSUMER_COMMANDS.map((c) => [c.name, (c as any).group]));
    expect(byName['read']).toBe('read');
    expect(byName['search']).toBe('read');
    expect(byName['walk']).toBe('navigate');
    expect(byName['eval']).toBe('navigate');
    expect(byName['network']).toBe('navigate');
  });
});
