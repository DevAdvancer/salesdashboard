jest.mock('crm-shared/utils/linkedin-extension-url', () => jest.requireActual('@/lib/utils/linkedin-extension-url'), { virtual: true });
import fc from 'fast-check';
import { assertCurrentLinkedinProfile } from '@/extensions/linkedin-helper/lib/page-context';

const slug = fc.stringMatching(/^[a-z][a-z0-9-]{0,24}$/);

it('only accepts the canonical profile currently open in the same non-incognito tab', async () => {
  await fc.assert(fc.asyncProperty(slug, slug, fc.boolean(), async (current, requested, incognito) => {
    const getTab = jest.fn(async () => ({ id: 7, url: `https://linkedin.com/in/${current}/?view=profile`, incognito }));
    const checking = assertCurrentLinkedinProfile(7, `https://www.linkedin.com/in/${requested}`, getTab);
    if (current === requested && !incognito) await expect(checking).resolves.toBeUndefined();
    else await expect(checking).rejects.toThrow();
    expect(getTab).toHaveBeenCalledWith(7);
  }));
});

it('accepts equivalent public-profile URL forms for the live tab', async () => {
  await fc.assert(fc.asyncProperty(slug, async value => {
    await expect(assertCurrentLinkedinProfile(7, `https://www.linkedin.com/in/${value}`, async () => ({
      id: 7, url: `https://linkedin.com/in/${value.toUpperCase()}/details/experience/?source=search`, incognito: false,
    }))).resolves.toBeUndefined();
  }));
});

it.each(['https://www.linkedin.com/feed/', 'https://example.com/in/person', 'http://www.linkedin.com/in/person'])
  ('does not authorize a profile operation when the current tab is %s', async url => {
    await expect(assertCurrentLinkedinProfile(7, 'https://www.linkedin.com/in/person', async () => ({ id: 7, url }))).rejects.toThrow();
  });
