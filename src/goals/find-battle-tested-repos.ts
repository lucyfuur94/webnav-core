import type { Goal } from '../mapstore/types.js';

export const FIND_BATTLE_TESTED_REPOS: Goal = {
  name: 'find-battle-tested-repos',
  visit: ['detail'],
  surface: {
    detail: ['stars', 'forks', 'open_issues', 'open_prs', 'commits',
             'tags', 'last_commit', 'license'],
  },
  candidateLimit: 10,
};
