import { test, expect, openSchedule, axeViolations } from './fixtures';

/** A one-page PDF with a line of text, small enough to write by hand. */
function tinyPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 18 Tf 30 350 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 30 350 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

test.describe('Work page', () => {
  test('a name in the briefing opens that work’s page, and Back returns', async ({ page }) => {
    await openSchedule(page);
    const link = page.getByRole('link', { name: /WeBWorK set 5/ });
    await expect(link.first()).toBeVisible();
    await link.first().click();

    await expect(page.getByRole('heading', { name: 'WeBWorK set 5', level: 1 })).toBeVisible();
    expect(page.url()).toMatch(/\/work\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('button', { name: 'Add the brief as a PDF' })).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
  });

  test('the editor links through to the page', async ({ page }) => {
    await openSchedule(page);
    await page.getByRole('button', { name: /^WeBWorK set 5 / }).first().click();
    await page.getByRole('link', { name: /Brief and guide/ }).click();
    await expect(page.getByRole('heading', { name: 'WeBWorK set 5', level: 1 })).toBeVisible();
  });

  test('a PDF can be attached, read, searched and given a guide that is only saved when kept', async ({ page }) => {
    await openSchedule(page);
    await page.getByRole('link', { name: /WeBWorK set 5/ }).first().click();
    await expect(page.getByRole('heading', { name: 'WeBWorK set 5', level: 1 })).toBeVisible();

    await page.getByLabel('Choose a PDF').setInputFiles({
      name: 'Problem_set_5.pdf',
      mimeType: 'application/pdf',
      buffer: tinyPdf('Question 1 limits'),
    });

    // The viewer draws the page; search says which pages hold a word.
    await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Problem set 5' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Find in this PDF' }).fill('limits');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByText(/On page 1\./)).toBeVisible();

    // The guide is a proposal until kept.
    await page.getByRole('button', { name: 'Make a guide' }).click();
    await expect(page.getByText('Not saved yet')).toBeVisible();
    await expect(page.getByText('Factor the numerator and cancel the common term before substituting.')).toBeVisible();
    await page.getByRole('button', { name: 'Keep this guide' }).click();
    await expect(page.getByText('Not saved yet')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save as text' })).toBeVisible();

    // The page with a PDF and a guide on it meets WCAG AA.
    expect(await axeViolations(page)).toEqual([]);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

    // Removing a file asks first, and takes its guide with it.
    await page.getByRole('button', { name: 'Remove this file' }).click();
    await expect(page.getByText('Remove this file and its guide?')).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add the brief as a PDF' })).toBeVisible();
  });

  test('anything but a PDF is refused', async ({ page }) => {
    await openSchedule(page);
    await page.getByRole('link', { name: /WeBWorK set 5/ }).first().click();
    await page.getByLabel('Choose a PDF').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'Only PDF files can be attached.' })).toBeVisible();
  });

  test('a link that names nothing real opens Today', async ({ page }) => {
    await page.goto('/work/not-a-real-id!');
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  });
});
