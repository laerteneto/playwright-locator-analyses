import type { Locator, Page } from '@playwright/test';

export const SELECTORS = { promo: '.promo-banner' } as const;

export class CartPage {
  readonly checkoutButton: Locator;
  readonly list = this.page.getByTestId('cart-list');

  constructor(private readonly page: Page) {
    this.checkoutButton = page.locator('#app > div:nth-child(2) button.Cart_cta__a9F3k');
  }

  get firstItem(): Locator {
    return this.list.getByRole('listitem').first();
  }

  async checkout() {
    await this.checkoutButton.click();
  }

  async closePromo() {
    await this.page.locator(SELECTORS.promo).click();
  }
}
