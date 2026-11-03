class LoginPage {
  constructor(page) {
    this.page = page;
    this.submitButton = page.locator('form > div:nth-child(3) > button');
    this.emailInput = '#email';
  }

  async login(email) {
    await this.page.fill(this.emailInput, email);
    await this.submitButton.click();
  }
}

module.exports = { LoginPage };
