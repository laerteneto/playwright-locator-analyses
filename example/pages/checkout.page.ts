import type { Locator, Page } from '@playwright/test';

export class CheckoutPage {
  readonly couponInput: Locator;
  readonly applyButton: Locator;
  readonly total: Locator;

  constructor(private readonly page: Page) {
    this.couponInput = page.locator('#coupon-input-8f3k2a');
    this.applyButton = page.locator('div.CheckoutForm_actions__x7Ka2 > button:nth-child(2)');
    this.total = page.locator('//html/body/div[1]/main/section[2]/div/span[3]');
  }

  get items(): Locator {
    return this.page.locator('.cart-item');
  }

  itemRow(name: string): Locator {
    return this.page.getByRole('row', { name });
  }

  async applyCoupon(code: string) {
    await this.couponInput.fill(code);
    await this.applyButton.click();
  }
}
