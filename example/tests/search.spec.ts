import { expect, test } from '@playwright/test';

const RESULTS = '.search-results';

test('searches for a product', async ({ page }) => {
  await page.goto('/');
  await page.fill('input.mt-4.px-2.rounded-lg', 'sneakers');
  await page.click('button.sc-bdVaJa');
  await expect(page.locator(`${RESULTS} > li`).first()).toBeVisible();
});

test('filters by category', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Category' }).selectOption('Shoes');
  await page.getByText('Only show products with free shipping to anywhere in the country').click();
  await expect(page.locator('ul[data-testid="results"] li:nth-of-type(3)')).toBeVisible();
});

test('opens details through an XPath', async ({ page }) => {
  await page.locator("//div[@class='product-card'][2]/following-sibling::div//a").click();
  // playwright-locator-analyses-ignore
  await page.locator('#legacy-widget-12345').click();
});
