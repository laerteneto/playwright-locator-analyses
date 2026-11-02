import { expect, test } from '@playwright/test';

const html = `
  <header><button class="css-1x2y3z">Accept cookies</button></header>
  <ul class="results"><li>Apple</li><li>Banana</li><li>Cherry</li></ul>
  <form><label>Email <input name="email"></label><button type="button" data-testid="submit">Send</button></form>
`;

test.beforeEach(async ({ page }) => {
  await page.setContent(html);
});

test('submits the form with robust locators', async ({ page }) => {
  await page.getByLabel('Email').fill('ana@example.com');
  await page.getByTestId('submit').click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('reads a result by position', async ({ page }) => {
  await page.locator('.css-1x2y3z').click();
  await expect(page.locator('ul.results > li:nth-child(2)')).toHaveText('Banana');
});

// Fails on the first attempt on purpose and passes on retry,
// so the reporter must mark it as flaky.
test('is flaky on the first attempt', async ({ page }, testInfo) => {
  const expected = testInfo.retry === 0 ? 'Not cherry' : 'Cherry';
  await expect(page.locator('//html/body/ul/li[3]')).toHaveText(expected, { timeout: 500 });
});
