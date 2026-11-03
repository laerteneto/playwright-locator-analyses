const { test } = require('@playwright/test');
const { CheckoutPage } = require('@pages/checkout.page');

test('pays through an aliased JS page object', async ({ page }) => {
  await new CheckoutPage(page).pay();
});
