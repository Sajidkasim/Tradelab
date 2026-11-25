import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PrimusCompass from './components/PrimusCompass';
import {
  PrimusTopoField,
  PrimusLightSeam,
  PrimusSunbeams,
  PrimusMonolith,
} from './components/PrimusAtmosphere';
import DeskPerspectives, { DESK_MEMBERS } from './components/DeskPerspectives';

describe('Primus living optical system components', () => {
  it('renders PrimusCompass reticle with exact dimensions and acid-lime needle', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrimusCompass, { size: 26, interactive: true }),
    );
    expect(html).toContain('width="26"');
    expect(html).toContain('height="26"');
    expect(html).toContain('pt-reticle-mark is-interactive');
    expect(html).toContain('pt-reticle-needle');
    expect(html).toContain('#c8f169');
  });

  it('renders decorative atmosphere layers hidden from assistive technology', () => {
    const topo = renderToStaticMarkup(React.createElement(PrimusTopoField, { variant: 'hero' }));
    const seam = renderToStaticMarkup(React.createElement(PrimusLightSeam));
    const beams = renderToStaticMarkup(React.createElement(PrimusSunbeams));
    expect(topo).toContain('aria-hidden="true"');
    expect(topo).toContain('primus-topo-field is-hero');
    expect(seam).toContain('primus-light-seam-flare');
    expect(beams).toContain('primus-mist-horizon');
  });

  it('renders PrimusMonolith with shape class and trader monogram', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrimusMonolith, { shape: 'bevel', initials: 'SA' }),
    );
    expect(html).toContain('pt-monolith-stage is-bevel');
    expect(html).toContain('pt-monogram');
    expect(html).toContain('SA');
    expect(html).not.toContain('↗');
  });

  it('renders DeskPerspectives with all 5 desk members, default Strategy lens, and live Bullpen badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(DeskPerspectives, { livePeople: ['Sajid'] }),
    );
    for (const member of DESK_MEMBERS) {
      expect(html).toContain(`<h3>${member.name}</h3>`);
    }
    expect(html).toContain('ONE SESSION · FIVE LENSES');
    expect(html).toContain('1M MSS VALIDATED');
    expect(html).toContain('Stack all 5');
    expect(html).toContain('Test your read');
    expect(html).toContain('On the floor');
  });
});
