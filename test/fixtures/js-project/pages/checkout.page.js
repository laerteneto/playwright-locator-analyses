class CheckoutPage {
  constructor(page) {
    this.payButton = page.locator('.css-1x2y3z');
  }

  async pay() {
    await this.payButton.click();
  }
}

module.exports = { CheckoutPage };
