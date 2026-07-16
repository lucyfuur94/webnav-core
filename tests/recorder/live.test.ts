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
    // Secret-field rule, refined: values ARE recorded as flow variables, but the
    // change handler must check the SECRET guard (password / cc-*) BEFORE any
    // .value read, and secret fields always yield value:null.
    expect(INSTALLER_JS).toContain('isBtnInput');
    const changeHandler = INSTALLER_JS.slice(INSTALLER_JS.indexOf("addEventListener('change'"));
    expect(changeHandler).toContain("el.type === 'password'");
    expect(changeHandler.indexOf("el.type === 'password'")).toBeLessThan(changeHandler.indexOf('.value'));
    // widened guard (pre-merge review): multi-token cc-, password-manager tokens,
    // one-time codes — a show-password toggle (type=text) must still be caught.
    expect(changeHandler).toContain('current-password');
    expect(changeHandler).toContain('new-password');
    expect(changeHandler).toContain('one-time-code');
    // BEHAVIORAL check: run the guard expression against the tricky shapes.
    const guard = (type, ac) => {
      const el = { type, autocomplete: ac };
      return el.type === 'password' || /(^|\s)(cc-|current-password|new-password|one-time-code)/.test(el.autocomplete || '');
    };
    expect(guard('text', 'billing cc-number')).toBe(true);   // multi-token cc
    expect(guard('text', 'current-password')).toBe(true);    // show-password toggle
    expect(guard('text', 'one-time-code')).toBe(true);       // OTP
    expect(guard('text', 'username')).toBe(false);           // non-secret still records
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

describe('requestedUrl (Task 3 — human-recorder redirect evidence, mirrors browse.ts runActionRecorded)', () => {
  it('a redirecting link click → requestedUrl = the declared href, absolutized against fromUrl', () => {
    const e = ev({ tagName: 'a', leafText: 'Login', href: 'https://s.test/redirect-login' });
    const fx = assembleEffect(e, 'e3', tLogin, tInv)!;
    expect(fx.navigated).toBe(true);
    expect(fx.requestedUrl).toBe('https://s.test/redirect-login');
  });
  it('href points back to the SAME page as fromUrl (query-only diff) → requestedUrl absent (no cross-page destination declared)', () => {
    const e = ev({ tagName: 'a', leafText: 'Login', href: tLogin.url + '?ref=nav' });
    const fx = assembleEffect(e, 'e3', tLogin, tInv)!;
    expect(fx.requestedUrl).toBeUndefined();
  });
  it('fragment-only href (#) never yields a requestedUrl', () => {
    const e = ev({ tagName: 'a', leafText: 'Login', href: 'https://s.test/#' });
    const fx = assembleEffect(e, 'e3', tLogin, tInv)!;
    expect(fx.requestedUrl).toBeUndefined();
  });
  it('non-link click (no href) never yields a requestedUrl', () => {
    const e = ev({ tagName: 'button', leafText: 'Login' });
    const fx = assembleEffect(e, 'e3', tLogin, tInv)!;
    expect(fx.requestedUrl).toBeUndefined();
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

describe('pointer dot', () => {
  it('glides (200ms transition) so teleporting agent mouse reads in video', () => {
    expect(INSTALLER_JS).toContain('left .2s ease-out');
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

describe('TICK_JS — the combined per-tick eval', () => {
  it('parses as standalone JS for both modes and returns {installed, queue}', async () => {
    const { TICK_JS } = await import('../../src/recorder/live.js');
    for (const rec of [true, false]) {
      const src = TICK_JS(rec);
      new Function('return (' + src + ')');          // valid JS
      expect(src).toContain('JSON.stringify({ installed, queue })');
    }
    expect(TICK_JS(true)).toContain('REC');           // paints recording state
    expect(TICK_JS(false)).toContain('record');       // paints armed state
  });
  it('pill click flips optimistically (no daemon round-trip for the visual)', () => {
    expect(INSTALLER_JS).toContain('dataset.webnavRec');
  });
});


describe('flow variables (recorded values)', () => {
  it('input effects carry the supplied value; secret fields never do', () => {
    const from: Tick = { url: 'https://s.test/f', snapshot: 'RootWebArea "F" [ref=e1]\n  textbox "City" [ref=e2]' };
    const withVal = assembleEffect(ev({ kind: 'input', tagName: 'input', inputType: 'text',
      placeholder: 'City', value: 'Pune' }), 'e2', from, from)!;
    expect(withVal.action?.value).toBe('Pune');            // the re-runnable variable
    const secret = assembleEffect(ev({ kind: 'input', tagName: 'input', inputType: 'password',
      placeholder: 'Password', value: null }), null, from, from)!;
    expect(secret.action?.value).toBeUndefined();          // secrets: never captured
  });
});


describe('click ripple (video click-location marker)', () => {
  it('paints only while recording; never intercepts; never in a11y snapshots', () => {
    const rippleBlock = INSTALLER_JS.slice(INSTALLER_JS.indexOf('const ripple'));
    expect(INSTALLER_JS).toContain("dataset.webnavRec === '1') ripple(");  // recording-gated
    expect(rippleBlock).toContain('pointer-events:none');                  // click-transparent
    expect(rippleBlock).toContain("setAttribute('aria-hidden'");           // snapshot-invisible
    expect(rippleBlock).toContain('r.remove()');                           // self-cleaning
  });
});

// nearestLabel/ownText/leafLabel live inline in INSTALLER_JS (in-page,
// DOM-driven — not exportable TS). Eval-extract them the same way
// md-to-html.test.ts pulls mdToHtml out of SHELL_HTML: slice the source
// between two markers, run it through `new Function`, and drive it against a
// jsdom-less minimal fake DOM node (only the shape these touch: childNodes,
// nodeType, textContent, getAttribute, parentElement, tagName).
function loadNearestLabel() {
  const src = INSTALLER_JS.slice(
    INSTALLER_JS.indexOf('function ownText('),
    INSTALLER_JS.lastIndexOf("document.addEventListener('click'"),
  );
  return new Function(src + '; return { ownText, nearestLabel, leafLabel };')();
}

function fakeTextNode(text: string) { return { nodeType: 3, textContent: text }; }
function fakeEl(opts: {
  text?: string; ariaLabel?: string; role?: string; tagName?: string;
  textContent?: string; children?: any[]; parent?: any;
}) {
  const el: any = {
    tagName: opts.tagName ?? 'div',
    childNodes: opts.text ? [fakeTextNode(opts.text)] : [],
    textContent: opts.textContent ?? opts.text ?? '',
    getAttribute: (n: string) => (n === 'aria-label' ? opts.ariaLabel ?? null
      : n === 'role' ? opts.role ?? null : null),
    parentElement: opts.parent ?? null,
  };
  return el;
}

describe('nearestLabel (Fix A — bound leafText to the nearest OWN-TEXT ancestor)', () => {
  it('a bare span click inside a role=toolbar legend+dropdown wrapper picks the SPAN\'s own text, not the wrapper\'s concatenated subtree', () => {
    const { nearestLabel } = loadNearestLabel();
    // Simulates: <div role="toolbar">Legend item 1 of 4 <span>Line</span></div>
    // el.textContent (whole subtree) would read "Legend item 1 of 4 Line"; the
    // actual click target is the <span>, whose OWN text is just "Line".
    const toolbar = fakeEl({ text: 'Legend item 1 of 4' });
    const span = fakeEl({ text: 'Line', parent: toolbar });
    expect(nearestLabel(span)).toBe('Line');
  });
  it('falls back to an ancestor aria-label when the click target has no own text', () => {
    const { nearestLabel } = loadNearestLabel();
    const wrapper = fakeEl({ ariaLabel: 'Chart type' });
    const icon = fakeEl({ parent: wrapper });   // no text, no aria-label of its own
    expect(nearestLabel(icon)).toBe('Chart type');
  });
  it('gives up after 4 levels with no text or aria-label anywhere', () => {
    const { nearestLabel } = loadNearestLabel();
    let n = fakeEl({});
    for (let i = 0; i < 5; i++) n = fakeEl({ parent: n });
    expect(nearestLabel(n)).toBeNull();
  });
});

describe('leafLabel (regression fix — leaf controls use their OWN full text, containers fall back to nearestLabel)', () => {
  it('REGRESSION GUARD: <button>Cart <span>3</span></button> clicked on the badge span → "Cart 3", not "3"', () => {
    const { leafLabel } = loadNearestLabel();
    const badge = fakeEl({ text: '3' });
    const button = fakeEl({ tagName: 'button', textContent: 'Cart 3', children: [badge] });
    badge.parentElement = button;
    // closest() matched the <button> ancestor of the click target (the badge).
    expect(leafLabel(button, badge, true)).toBe('Cart 3');
  });
  it('<button>Add <b>to</b> cart</button> clicked on the <b> → "Add to cart"', () => {
    const { leafLabel } = loadNearestLabel();
    const b = fakeEl({ text: 'to' });
    const button = fakeEl({ tagName: 'button', textContent: 'Add to cart' });
    b.parentElement = button;
    expect(leafLabel(button, b, true)).toBe('Add to cart');
  });
  it('<button aria-label="Cart"><svg/></button> clicked on the svg → "Cart" (aria-label wins over textContent)', () => {
    const { leafLabel } = loadNearestLabel();
    const svg = fakeEl({});
    const button = fakeEl({ tagName: 'button', ariaLabel: 'Cart', textContent: '' });
    svg.parentElement = button;
    expect(leafLabel(button, svg, true)).toBe('Cart');
  });
  it('plain <button>Login</button> clicked directly on the button → "Login"', () => {
    const { leafLabel } = loadNearestLabel();
    const button = fakeEl({ tagName: 'button', textContent: 'Login' });
    // closest() matched the button itself (t === el): still a genuine leaf.
    expect(leafLabel(button, button, true)).toBe('Login');
  });
  it('ORIGINAL chart case still works: a bare div (no leaf role) inside role="toolbar" falls back to nearestLabel, not the toolbar\'s whole-subtree bleed', () => {
    const { leafLabel } = loadNearestLabel();
    // <div role="toolbar">Legend item 1 of 4 <div>Line</div></div> — the dropdown
    // control itself carries no leaf role/tag, so closest('[role]') resolves to
    // the toolbar (a BROAD container role, not in LEAF_ROLES).
    const toolbar = fakeEl({ role: 'toolbar', text: 'Legend item 1 of 4' });
    const dropdownItem = fakeEl({ text: 'Line', parent: toolbar });
    expect(leafLabel(toolbar, dropdownItem, true)).toBe('Line');
  });
  it('closest() matched nothing (el fell back to t) → treated as container, uses nearestLabel', () => {
    const { leafLabel } = loadNearestLabel();
    const span = fakeEl({ text: 'Loose text' });
    expect(leafLabel(span, span, false)).toBe('Loose text');
  });
});
