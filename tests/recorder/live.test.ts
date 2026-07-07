import { describe, it, expect } from 'vitest';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import {
  INSTALLER_JS, DRAIN_JS, descriptorRole, descriptorName, resolveEvent, type LiveEvent,
} from '../../src/recorder/live.js';

const ev = (over: Partial<LiveEvent>): LiveEvent => ({
  seq: 1, kind: 'click', url: 'https://s.test/', tagName: 'button',
  role: null, ariaLabel: null, leafText: null, href: null, placeholder: null,
  nameAttr: null, inputType: null, ...over,
});

const SNAP = [
  'RootWebArea "Shop" [ref=e1]',
  '  button "Login" [ref=e2]',
  '  link "About" [ref=e3]',
  '    /url: https://s.test/about',
  '  link "About" [ref=e4]',
  '    /url: https://other.test/about',
  '  button "Add to cart" [ref=e5]',
  '  button "Add to cart" [ref=e6]',
  '  textbox "Username" [ref=e7]',
].join('\n');

describe('injected JS constants', () => {
  it('installer is idempotent and never reads .value', () => {
    expect(INSTALLER_JS).toContain('__webnav_installed');   // double-inject guard
    expect(INSTALLER_JS).not.toMatch(/\.value\b/);           // secret-field rule
    expect(INSTALLER_JS).toContain('sessionStorage');        // nav-surviving queue
  });
  it('drain reads and clears the queue', () => {
    expect(DRAIN_JS).toContain('__webnav_evq');
    expect(DRAIN_JS).toContain('removeItem');
  });
});

describe('descriptor derivation', () => {
  it('maps tags to roles; explicit role wins', () => {
    expect(descriptorRole(ev({ tagName: 'a' }))).toBe('link');
    expect(descriptorRole(ev({ tagName: 'div', role: 'button' }))).toBe('button');
    expect(descriptorRole(ev({ tagName: 'input', inputType: 'submit' }))).toBe('button');
    expect(descriptorRole(ev({ tagName: 'input', inputType: 'text' }))).toBe('textbox');
    expect(descriptorRole(ev({ tagName: 'div' }))).toBeNull();  // non-interactive, no role → null
  });
  it('name precedence: ariaLabel > leafText > placeholder > nameAttr', () => {
    expect(descriptorName(ev({ ariaLabel: 'X', leafText: 'Y' }))).toBe('X');
    expect(descriptorName(ev({ leafText: 'Y', placeholder: 'Z' }))).toBe('Y');
    expect(descriptorName(ev({ placeholder: 'Z' }))).toBe('Z');
    expect(descriptorName(ev({}))).toBeNull();
  });
});

describe('resolveEvent', () => {
  const nodes = parseSnapshot(SNAP);
  it('unique role+name → ref', () => {
    expect(resolveEvent(ev({ tagName: 'button', leafText: 'Login' }), nodes)).toEqual({ ref: 'e2' });
  });
  it('href disambiguates identical links', () => {
    expect(resolveEvent(ev({ tagName: 'a', leafText: 'About', href: 'https://other.test/about' }), nodes))
      .toEqual({ ref: 'e4' });
  });
  it('ambiguous with no href → candidates for the probe', () => {
    expect(resolveEvent(ev({ tagName: 'button', leafText: 'Add to cart' }), nodes))
      .toEqual({ candidates: ['e5', 'e6'] });
  });
  it('no role or no name or no match → null', () => {
    expect(resolveEvent(ev({ tagName: 'div', leafText: 'Login' }), nodes)).toBeNull();
    expect(resolveEvent(ev({ tagName: 'button' }), nodes)).toBeNull();
    expect(resolveEvent(ev({ tagName: 'button', leafText: 'Nope' }), nodes)).toBeNull();
  });
});
