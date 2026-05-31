import { describe, it, expect } from 'vitest';
import { classifyReadiness } from '../../src/router/readiness.js';

describe('classifyReadiness', () => {
  it('detects a Cloudflare interstitial (escalate, never evade)', () => {
    const yml = '- heading "Just a moment..." [ref=e1]\n- paragraph "Verify you are human by completing the action below."';
    expect(classifyReadiness(yml)).toBe('interstitial');
  });
  it('detects "checking your browser" interstitial even when sparse', () => {
    expect(classifyReadiness('- paragraph "Checking your browser before accessing the site."')).toBe('interstitial');
  });
  it('flags a sparse/nav-only shell as loading (wait & retry)', () => {
    const yml = '- link "Home" [ref=e1]\n- link "About" [ref=e2]';
    expect(classifyReadiness(yml)).toBe('loading');
  });
  it('flags an empty snapshot as loading', () => {
    expect(classifyReadiness('')).toBe('loading');
  });
  it('classifies a real content page as ready', () => {
    const yml = Array.from({length: 12}, (_, i) =>
      `- paragraph "Class ${i}: 6:00 AM CrossFit session with details about the workout" [ref=e${i}]`).join('\n');
    expect(classifyReadiness(yml)).toBe('ready');
  });
  it('does not misclassify a content page that merely contains the word human', () => {
    const yml = Array.from({length: 12}, (_, i) =>
      `- paragraph "Human resources article number ${i} about workplace policy and benefits" [ref=e${i}]`).join('\n');
    expect(classifyReadiness(yml)).toBe('ready'); // "human" alone isn't the bot-wall phrase
  });
});
