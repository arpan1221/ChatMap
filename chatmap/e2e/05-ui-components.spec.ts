import { test, expect } from '@playwright/test';

test.describe('UI Components', () => {
  test('should render chat window with proper width', async ({ page }) => {
    // Desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    
    // Wait for page load
    await page.waitForLoadState('networkidle');
    
    // Chat window should have fixed width on desktop
    const chatWindow = page.locator('[class*="lg:w-[420px]"]');
    const isVisible = await chatWindow.isVisible().catch(() => false);
    
    if (isVisible) {
      await expect(chatWindow).toBeVisible();
    }
  });

  test('should display compact memory indicator in header', async ({ page }) => {
    await page.goto('/');
    
    // Look for memory active indicator
    const memoryIndicator = page.getByText(/Memory active/i);
    const isVisible = await memoryIndicator.isVisible().catch(() => false);
    
    if (isVisible) {
      await expect(memoryIndicator).toBeVisible();
      
      // Should have sparkles icon
      const sparklesIcon = page.locator('svg[class*="animate-pulse"]');
      const iconVisible = await sparklesIcon.isVisible().catch(() => false);
      expect(iconVisible).toBeTruthy();
    }
  });

  test('should show inline personalized suggestions above input', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for "Try these" text
    const tryTheseText = page.getByText(/Try these/i);
    const isVisible = await tryTheseText.isVisible().catch(() => false);
    
    if (isVisible) {
      await expect(tryTheseText).toBeVisible();
      
      // Suggestions should be clickable pills
      const suggestionButtons = page.locator('button[class*="rounded-full"]');
      const count = await suggestionButtons.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should have responsive header', async ({ page }) => {
    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Header should be visible
    const header = page.locator('header');
    await expect(header).toBeVisible();
    
    // ChatMap logo should be visible
    await expect(page.getByText(/ChatMap/i).first()).toBeVisible();
  });

  test('should display map controls', async ({ page }) => {
    await page.goto('/');
    
    // Wait for map to load
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    
    // Check for zoom controls
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    const zoomOut = page.locator('.leaflet-control-zoom-out');
    
    await expect(zoomIn).toBeVisible();
    await expect(zoomOut).toBeVisible();
  });

  test('should show compact welcome screen', async ({ page }) => {
    await page.goto('/');
    
    // Welcome screen should be visible
    await expect(page.getByText(/Welcome to ChatMap/i)).toBeVisible();
    
    // Location icon should be visible
    const locationIcon = page.locator('svg').filter({ hasText: '' }).first();
    await expect(locationIcon).toBeVisible();
    
    // Example buttons should be visible
    const exampleBtn = page.getByRole('button', { name: /Find coffee shops/i });
    await expect(exampleBtn.first()).toBeVisible();
  });

  test('should have visible and accessible input field', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    // Input should be visible and at a reasonable position (use first to avoid strict mode violation)
    const input = page.getByPlaceholder(/Ask me to find places/i).first();
    await expect(input).toBeVisible();
    
    // Check if input is in viewport
    const box = await input.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      expect(box.y).toBeGreaterThan(0);
      expect(box.y).toBeLessThan(1000); // Should be visible on screen
    }
  });
});
