import { describe, it, expect } from 'vitest';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import {
  INSTALLER_JS, DRAIN_JS, descriptorRole, descriptorName, resolveEvent, type LiveEvent,
  fromTickFor, chooseToTick, assembleEffect, type Tick,
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
  it('installer is idempotent (DOM flag) and never reads a typed value', () => {
    // The guard must live on the DOM, not window: playwright-cli evals run in fresh
    // JS worlds, so a window flag re-installs a listener EVERY tick (live-run bug).
    expect(INSTALLER_JS).toContain('dataset.webnavInstalled');
    expect(INSTALLER_JS).not.toContain('window.__webnav_installed');
    expect(INSTALLER_JS).toContain('sessionStorage');        // nav-surviving queue
    // Secret-field rule, refined: EXACTLY ONE sanctioned .value read — the
    // submit/button/reset input's static LABEL (its accessible name; never typed
    // data), guarded by isBtnInput. The change handler (typed fields) has none.
    expect(INSTALLER_JS.match(/\.value\b/g) ?? []).toHaveLength(1);
    expect(INSTALLER_JS).toContain('isBtnInput');
    const changeHandler = INSTALLER_JS.slice(INSTALLER_JS.indexOf("addEventListener('change'"));
    expect(changeHandler).not.toMatch(/\.value\b/);
  });
  it('recording badge: click-transparent, snapshot-invisible, self-healing', () => {
    expect(INSTALLER_JS).toContain('__webnav_rec_badge');
    expect(INSTALLER_JS).toContain('pointer-events:none');   // never intercepts user clicks
    expect(INSTALLER_JS).toContain("aria-hidden");           // never appears in a11y snapshots
    // badge ensure must run BEFORE the idempotence early-return, so the every-tick
    // eval re-creates it if an SPA re-render wiped it.
    expect(INSTALLER_JS.indexOf('__webnav_rec_badge')).toBeLessThan(INSTALLER_JS.indexOf("return 'already'"));
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

const LOGIN_SNAP = ['RootWebArea "Login" [ref=e1]', '  textbox "Username" [ref=e2]',
  '  button "Login" [ref=e3]'].join('\n');
const INV_SNAP = ['RootWebArea "Products" [ref=e1]', '  button "Open Menu" [ref=e2]'].join('\n');
const tLogin: Tick = { url: 'https://s.test/', snapshot: LOGIN_SNAP };
const tInv: Tick = { url: 'https://s.test/inventory.html', snapshot: INV_SNAP };

describe('tick pairing', () => {
  it('fromTickFor picks the latest same-page tick', () => {
    expect(fromTickFor(ev({ url: 'https://s.test/?q=1' }), [tLogin, tInv], 1)).toBe(0); // query ≠ nav
    expect(fromTickFor(ev({ url: 'https://nowhere.test/' }), [tLogin, tInv], 1)).toBe(-1);
  });
  it('chooseToTick waits for the lookahead tick, then attributes a late landing', () => {
    expect(chooseToTick(0, [tLogin], false)).toBe(-1);              // no lookahead yet
    expect(chooseToTick(0, [tLogin, tInv], false)).toBe(1);         // nav landed at next tick → it's ours
    expect(chooseToTick(0, [tLogin, tInv], true)).toBe(0);          // a later click owns the landing
    expect(chooseToTick(0, [tLogin, tLogin], false)).toBe(0);       // stable → same tick
  });
});

describe('assembleEffect', () => {
  it('navigated click with resolved ref → full action + recovered fp + navigated true', () => {
    const e = ev({ tagName: 'button', leafText: 'Login' });
    const fx = assembleEffect(e, 'e3', tLogin, tInv)!;
    expect(fx.navigated).toBe(true);
    expect(fx.action?.ref).toBe('e3');
    expect(fx.action?.elementFp?.role).toBe('button');
    expect(fx.action?.elementFp?.name).toBe('Login');
    expect(fx.diff).toBeTruthy();
  });
  it('navigated click UNRESOLVED → emits with action:null (draft link-scan fallback)', () => {
    const fx = assembleEffect(ev({ tagName: 'div' }), null, tLogin, tInv)!;
    expect(fx.action).toBeNull();
    expect(fx.navigated).toBe(true);
  });
  it('same-page click unresolved → null (dropped noise)', () => {
    expect(assembleEffect(ev({ tagName: 'div' }), null, tLogin, tLogin)).toBeNull();
  });
  it('input event always emits, with the FIELD identity and never a value', () => {
    const e = ev({ kind: 'input', tagName: 'input', inputType: 'text', placeholder: 'Username' });
    const fx = assembleEffect(e, null, tLogin, tLogin)!;
    expect(fx.action?.role).toBe('textbox');
    expect(fx.action?.name).toBe('Username');
    expect(JSON.stringify(fx)).not.toContain('secret');
  });
});

describe('field clicks never navigate (live finding: "nav: First Name")', () => {
  it('a click on a textbox paired with a landing tick stays navigated:false', () => {
    const e = ev({ kind: 'click', tagName: 'input', inputType: 'text', placeholder: 'First Name' });
    const from: Tick = { url: 'https://s.test/form', snapshot: 'RootWebArea "Form" [ref=e1]\n  textbox "First Name" [ref=e2]' };
    const to: Tick = { url: 'https://s.test/next', snapshot: 'RootWebArea "Next" [ref=e1]' };
    const fx = assembleEffect(e, 'e2', from, to)!;
    expect(fx.navigated).toBe(false);
    expect(fx.action?.role).toBe('textbox');
  });
});

describe('armed-mode overlay', () => {
  it('installer adds a clickable toggle that pushes kind:toggle (only pointer-events-enabled element)', () => {
    expect(INSTALLER_JS).toContain("kind: 'toggle'");
    expect(INSTALLER_JS).toContain('pointer-events:auto');
  });
  it('pill is top-center and doubles as the stop button; new tabs are kept in-tab', () => {
    expect(INSTALLER_JS).toContain('left:50%');                    // top-center pill
    expect(INSTALLER_JS).toContain("setAttribute('target', '_self')");  // _blank stays in-tab
    expect(INSTALLER_JS).toContain('window.open =');               // window.open redirected inline
  });
  it('MODE_JS recolors for both modes', async () => {
    const { MODE_JS } = await import('../../src/recorder/live.js');
    expect(MODE_JS(true)).toContain('REC');
    expect(MODE_JS(true)).toContain('stop');   // recording pill carries the stop affordance
    expect(MODE_JS(false)).toContain('record');
    new Function('return (' + MODE_JS(true) + ')')();   // parses as JS
  });
});

describe('storage-denied pages never produce junk (false window-closed)', () => {
  it('DRAIN_JS and push are try/catch-safe in-page', () => {
    // about:blank (opaque origin) THROWS on sessionStorage access while the window
    // is alive; unguarded, the loop closed the armed window ~1s after opening.
    expect(DRAIN_JS).toContain('catch');
    expect(INSTALLER_JS.split('const push')[1].split('};')[0]).toContain('catch');
  });
});
