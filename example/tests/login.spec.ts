import { expect, test } from '@playwright/test';
import { LoginPage } from '../pages/login.page';

test.describe('Login', () => {
  test('signs in with valid credentials', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('ana@example.com', 's3cr3t');
    await expect(page.getByTestId('user-menu')).toBeVisible();
  });

  test('shows an error for a wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login('ana@example.com', 'wrong');
    await expect(page.getByRole('alert')).toContainText('Invalid password');
  });
});
