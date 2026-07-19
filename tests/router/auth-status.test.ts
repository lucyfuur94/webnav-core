import { describe, it, expect } from 'vitest';
import { classifyAuthLanding } from '../../src/router/auth-status.js';
import { makeState } from '../../src/mapstore/types.js';

function state(id: string, fingerprint: string[]) {
  return makeState({ id, nodeId: 'www.saucedemo.com', semanticName: id, urlPattern: '', role: 'section', fingerprint });
}

describe('classifyAuthLanding', () => {
  it('valid: landed on the site host and the snapshot matches a known map state', () => {
    const states = [state('www.saucedemo.com:inventory', ['heading:Products'])];
    const yml = '- heading "Products" [ref=e1]\n- listitem "Sauce Labs Backpack" [ref=e2]\n'
      + '- button "Add to cart" [ref=e3]\n- link "Cart" [ref=e4]\n- text "Menu"\n'
      + '- text "Filter"\n- text "Sort"\n- text "Footer"';
    const r = classifyAuthLanding('https://www.saucedemo.com/inventory.html', yml, 'www.saucedemo.com', states);
    expect(r).toEqual({ auth: 'valid' });
  });

  // Regression: the extension driver's currentUrl (chrome.tabs.get) can read '' or a
  // stale/mid-navigation host. A matched snapshot is direct proof we're logged in on a
  // real page, so it must win over the foreign/empty-host heuristic — else an authed
  // SPA falsely returns needs-login (the observed progneo agent-run misfire, steps:0).
  it('valid: known state matches even when the URL host is foreign or empty (stale currentUrl)', () => {
    const states = [state('www.saucedemo.com:inventory', ['heading:Products'])];
    const yml = '- heading "Products" [ref=e1]\n- listitem "Sauce Labs Backpack" [ref=e2]\n'
      + '- button "Add to cart" [ref=e3]\n- link "Cart" [ref=e4]\n- text "Menu"\n'
      + '- text "Filter"\n- text "Sort"\n- text "Footer"';
    expect(classifyAuthLanding('https://accounts.google.com/o/oauth2', yml, 'www.saucedemo.com', states)).toEqual({ auth: 'valid' });
    expect(classifyAuthLanding('', yml, 'www.saucedemo.com', states)).toEqual({ auth: 'valid' });
  });

  it('needs-login: foreign-host landing (SSO wall bounced to another domain)', () => {
    const r = classifyAuthLanding('https://login.okta.com/sso/step-up', '- heading "Sign in"', 'www.saucedemo.com', []);
    expect(r.auth).toBe('needs-login');
    expect(r.loginUrl).toBe('https://login.okta.com/sso/step-up');
  });

  it('needs-login: interstitial/bot-wall on the right host', () => {
    const yml = '- heading "Just a moment..." [ref=e1]\n- paragraph "Checking your browser."';
    const r = classifyAuthLanding('https://www.saucedemo.com/', yml, 'www.saucedemo.com', []);
    expect(r.auth).toBe('needs-login');
    expect(r.loginUrl).toBe('https://www.saucedemo.com/');
  });

  it('needs-login: a password field is declared (login-shaped page)', () => {
    const yml = '- textbox "Username" [ref=e1]\n- textbox "Password" [ref=e2]\n- button "Login" [ref=e3]';
    const r = classifyAuthLanding('https://www.saucedemo.com/', yml, 'www.saucedemo.com', []);
    expect(r.auth).toBe('needs-login');
    expect(r.loginUrl).toBe('https://www.saucedemo.com/');
  });

  it('unknown: right host, no map states, no interstitial/password signal', () => {
    const yml = '- heading "Welcome"\n- paragraph "Nothing recognizable here."';
    const r = classifyAuthLanding('https://www.saucedemo.com/', yml, 'www.saucedemo.com', []);
    expect(r).toEqual({ auth: 'unknown' });
  });

  it('unknown: right host with map states but none match (ambiguous/stale map)', () => {
    const states = [state('www.saucedemo.com:inventory', ['heading:Products'])];
    const yml = '- heading "Something Else"';
    const r = classifyAuthLanding('https://www.saucedemo.com/other', yml, 'www.saucedemo.com', states);
    expect(r).toEqual({ auth: 'unknown' });
  });
});
