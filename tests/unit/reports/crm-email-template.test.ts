import { renderCrmEmail } from '@/lib/utils/crm-email-template';

const base = { title: 'SALES-US Target Report [2026-11]', crmUrl: 'https://crm.silverspaceinc.tech' };

test('CRM report uses readable inline brand colors while retaining amounts and branch splits', () => {
  const html = renderCrmEmail({ ...base, html: '<table><tr><th>Branch</th><th>Achieved</th></tr><tr><td>NCR Split</td><td style="text-align:right;color:#1eaa52;">$1,200</td></tr></table>' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.body.style.backgroundColor).toBe('rgb(0, 0, 0)');
  expect(doc.body.style.color).toBe('rgb(255, 255, 255)');
  expect(doc.querySelector('th')!.style.backgroundColor).toBe('rgb(24, 24, 27)');
  expect(doc.querySelector('th')!.style.color).toBe('rgb(158, 158, 160)');
  expect(doc.body.textContent).toContain('CRM HUB');
  expect(doc.body.textContent).toContain('SALES INTELLIGENCE');
  expect(doc.body.textContent).toContain('NCR Split');
  const amount = [...doc.querySelectorAll('td')].find(cell => cell.textContent === '$1,200')!;
  expect(amount.style.textAlign).toBe('right');
  expect(amount.style.color).toBe('rgb(30, 170, 82)');
});

test('full support HTML has one document and preserves message, links, images and signature markup', () => {
  const signature = '<table style="background:#1a1a1a;"><tr><td style="color:#ffffff;">Regards, Agent<img src="cid:logo" alt="Logo"></td></tr></table>';
  const body = `<p>Appointment details</p><a href="https://example.com/meeting">Join meeting</a>${signature}`;
  const html = renderCrmEmail({ ...base, html: `<html><head><title>Old</title></head><body>${body}</body></html>`, preserveContentStyles: true });
  expect(html.match(/<html\b/g)).toHaveLength(1);
  expect(html.match(/<body\b/g)).toHaveLength(1);
  expect(html).toContain(body);
  expect(html).toContain('href="https://example.com/meeting"');
});

test('subject and CRM link are escaped; table markup and self-closing separators remain valid', () => {
  const html = renderCrmEmail({ title: '<img src=x> & "Report"', crmUrl: 'https://crm.test/?a=1&b="2"', html: '<p>Target assigned</p><hr/>' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('h1')?.textContent).toBe('<img src=x> & "Report"');
  expect(doc.querySelector('h1 img')).toBeNull();
  expect(doc.querySelector('hr')!.style.borderTopWidth).toBe('1px');
  expect(doc.querySelector('hr')?.hasAttribute('/')).toBe(false);
});
