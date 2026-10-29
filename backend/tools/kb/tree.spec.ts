import { describe, expect, it } from 'vitest';
import { addNode, link, start } from './edits.js';
import { renderTree } from './tree.js';

function sample() {
  let g = start({ title: 'Acme', text: 'A made-up company.' });
  g = addNode(g, { under: 'summary', id: 'ceo', label: 'CEO', title: 'Jane Doe', text: 'Runs the place since long ago and likes tests.' });
  g = addNode(g, { under: 'summary', id: 'risks', label: 'risks', title: 'Risks', text: 'Few.' });
  g = addNode(g, { under: 'ceo', id: 'bio', label: 'background', title: 'Bio', text: 'Born somewhere.' });
  return link(g, 'risks', 'bio', 'see also');
}

describe('renderTree', () => {
  it('prints an indented tree from summary with extra edges at the end', () => {
    const out = renderTree(sample(), { full: false }).split('\n');
    expect(out[0]).toBe('Acme [summary]');
    expect(out).toContain('── CEO → Jane Doe [ceo]');
    expect(out).toContain('    ── background → Bio [bio]');
    expect(out).toContain('── risks → Risks [risks]');
    expect(out[out.length - 1]).toBe('↪ risks → bio (see also)');
    expect(out.join('\n')).not.toContain('made-up');
  });
  it('shows wrapped text under titles with full', () => {
    const out = renderTree(sample(), { full: true });
    expect(out).toContain('A made-up company.');
    expect(out).toContain('Runs the place');
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(100);
  });
  it('shows asOf', () => {
    const g = sample();
    g.nodes[1].asOf = 'Q2 FY2027';
    expect(renderTree(g, { full: false })).toContain('(Q2 FY2027)');
  });
});
