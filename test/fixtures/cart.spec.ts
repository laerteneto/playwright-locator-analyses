import { expect, test } from '@playwright/test';
import { CartPage } from './pages/cart.page';

test.describe('Cart', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('xpath=/html/body/div[3]/button').click();
  });

  test('checkout via page object', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.checkout();
  });

  test('robust test', async ({ page }) => {
    await page.getByRole('button', { name: 'Buy' }).click();
  });

  test.describe('nested', () => {
    test('uses getter and constant', async ({ page }) => {
      const cart = new CartPage(page);
      await expect(cart.firstItem).toBeVisible();
      await cart.closePromo();
      await page.click('.btn-legacy'); // playwright-locator-analyses-ignore
    });
  });
});

test('outside describe has no hook', async ({ page }) => {
  await page.getByTestId('ok').click();
});
