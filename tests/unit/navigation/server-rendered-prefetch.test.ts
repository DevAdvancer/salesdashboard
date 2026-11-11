import { NAV_ITEMS, SERVER_RENDERED_NAV_HREFS } from '@/components/navigation-config';

it('lists only real sidebar links, so each server-rendered page loads its data only when opened', () => {
  const hrefs = new Set(NAV_ITEMS.map(item => item.href));
  for (const href of SERVER_RENDERED_NAV_HREFS) expect(hrefs.has(href)).toBe(true);
  expect([...SERVER_RENDERED_NAV_HREFS].sort()).toEqual(['/compliance-dashboard', '/resume', '/resume-marketing', '/team-report']);
});
