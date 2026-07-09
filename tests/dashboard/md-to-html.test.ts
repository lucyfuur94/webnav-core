import { describe, it, expect } from 'vitest';
import { SHELL_HTML } from '../../src/dashboard/shell.js';

// mdToHtml lives inline in the dashboard's <script> (not exported) — extract its
// source text out of SHELL_HTML and eval it via new Function, same technique
// live.test.ts uses to parse-check inline recorder JS.
function loadMdToHtml() {
  const src = SHELL_HTML.slice(
    SHELL_HTML.indexOf('function esc('),
    SHELL_HTML.indexOf('// --- Review sub-tab'),
  );
  return new Function(src + '; return mdToHtml;')();
}

describe('mdToHtml — pipe-table support (Review sub-tab renders raw "| a | b |" otherwise)', () => {
  const mdToHtml = loadMdToHtml();

  it('renders a pipe table as a real <table>, not a literal <div>| ... |</div>', () => {
    const html = mdToHtml('| # | State |\n|---|---|\n| 1 | loaded |');
    expect(html).toContain('<table');
    expect(html).toContain('<th>#</th>');
    expect(html).toContain('<th>State</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<td>loaded</td>');
    expect(html).not.toContain('<div>| #');
  });

  it('a heading followed by a table renders both correctly (table does not break surrounding markdown)', () => {
    const html = mdToHtml('### Frames\n\n| # | State |\n|---|---|\n| 1 | loaded |\n| 2 | idle |\n\nDone.');
    expect(html).toContain('<h5');
    expect(html).toContain('Frames');
    expect(html).toContain('<table');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<td>idle</td>');
    expect(html).toContain('<div>Done.</div>');
    // exactly one table emitted, closed before the trailing paragraph
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html.indexOf('</table>')).toBeLessThan(html.indexOf('<div>Done.</div>'));
  });
});
