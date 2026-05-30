import type { Goal } from '../mapstore/types.js';

export const FIND_BATTLE_TESTED_REPOS: Goal = {
  name: 'find-battle-tested-repos',
  visit: ['detail'],
  surface: {
    detail: ['stars', 'last_commit', 'open_issues', 'closed_issues',
             'latest_release', 'license', 'has_ci'],
  },
  candidateLimit: 10,
};
