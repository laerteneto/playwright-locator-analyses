const { test } = require('@playwright/test');
const { LoginPage } = require('./pages/login.page');

test('logs in through a JS page object', async ({ page }) => {
  const login = new LoginPage(page);
  await login.login('ana@example.com');
});
