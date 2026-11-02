import { expect, test } from '@playwright/test';

test.describe('Profile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/profile');
    await page.locator('.css-1x2y3z').click(); // dismiss the cookie banner
  });

  test('updates the name', async ({ page }) => {
    await page.getByTestId('profile-name').fill('Ana');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved!');
  });

  test('changes the avatar', async ({ page }) => {
    await page.getByTestId('avatar-upload').setInputFiles('avatar.png');
    await expect(page.getByAltText('Avatar')).toBeVisible();
  });
});
