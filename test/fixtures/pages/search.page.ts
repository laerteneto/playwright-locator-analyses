import type { Page } from '@playwright/test';

export class SearchPage {
  readonly queryInput: string;

  constructor(private readonly page: Page) {
    this.queryInput = 'input.search-box';
  }

  async search(text: string) {
    await this.page.locator(this.queryInput).fill(text);
  }
}
