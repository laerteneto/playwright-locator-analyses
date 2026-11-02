import { expect, test } from '@playwright/test';
import { CheckoutPage } from '../pages/checkout.page';

test.describe('Checkout', () => {
  test('applies a discount coupon', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.applyCoupon('BLACKFRIDAY');
    await expect(checkout.total).toHaveText('$90.00');
  });

  test('removes an item from the cart', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.items.nth(1).getByRole('button', { name: 'Remove' }).click();
    await expect(checkout.items).toHaveCount(1);
  });

  test('shows the product row', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await expect(checkout.itemRow('T-shirt')).toBeVisible();
  });
});
