import { test } from '@playwright/test';
import { SearchPage } from './pages/search.page';

test('searches through a constructor-assigned selector', async ({ page }) => {
  await new SearchPage(page).search('shoes');
});
