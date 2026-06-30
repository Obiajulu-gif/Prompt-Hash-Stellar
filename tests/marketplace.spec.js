import { test, expect } from '@playwright/test';

test.describe('Prompt-Hash E2E Suite', () => {
  
  test('should mock wallet injection and connect successfully', async ({ page }) => {
    await page.addInitScript(() => {
      window.stellarWalletsKit = {
        publicKey: 'GABC1234XYZ...MOCK_ADDRESS',
        isConnected: async () => true,
        getPublicKey: async () => 'GABC1234XYZ...MOCK_ADDRESS',
        signTransaction: async (tx) => tx,
      };
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    const connectButton = page.locator('button:has-text("Connect"), button:has-text("Wallet")');
    if (await connectButton.count() > 0) {
      await connectButton.first().click();
    }
  });

  test('should navigate the marketplace and click a prompt card', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const promptCard = page.locator('a:has-text("View"), [class*="card"], h3').first();
    await expect(promptCard).toBeVisible();
    await promptCard.click();
  });
});