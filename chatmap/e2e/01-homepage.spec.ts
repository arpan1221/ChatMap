import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await page.goto('/');
    
    // Check if the page title contains ChatMap
    await expect(page).toHaveTitle(/ChatMap/i);
    
    // Check for main heading (use first to avoid strict mode violation)
    await expect(page.getByRole('heading', { name: /ChatMap/i }).first()).toBeVisible();
  });

  test('should display the map component', async ({ page }) => {
    await page.goto('/');
    
    // Wait for map to load (Leaflet container)
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    
    // Check if map is visible
    const map = page.locator('.leaflet-container');
    await expect(map).toBeVisible();
  });

  test('should display welcome message in chat', async ({ page }) => {
    await page.goto('/');
    
    // Check for welcome message
    await expect(page.getByText(/Welcome to ChatMap/i)).toBeVisible();
    
    // Check for example queries (use first to avoid strict mode violation)
    await expect(page.getByText(/Find coffee shops/i).first()).toBeVisible();
  });

  test('should have Get Location button', async ({ page }) => {
    await page.goto('/');
    
    // Check for Get Location button
    const getLocationBtn = page.getByRole('button', { name: /Get Location/i });
    await expect(getLocationBtn).toBeVisible();
  });

  test('should show memory indicator when enabled', async ({ page }) => {
    await page.goto('/');
    
    // Check for memory on indicator
    const memoryIndicator = page.getByText(/Memory on/i).or(page.getByText(/Memory active/i));
    await expect(memoryIndicator.first()).toBeVisible();
  });

  test('should display example query buttons', async ({ page }) => {
    await page.goto('/');
    
    // Check for example buttons
    const exampleButtons = page.getByRole('button', { name: /Find coffee shops within 15 minutes walk/i });
    await expect(exampleButtons.first()).toBeVisible();
  });

  test('should have functional search input', async ({ page }) => {
    await page.goto('/');
    
    // Find the search input (use first to avoid strict mode violation)
    const searchInput = page.getByPlaceholder(/Ask me to find places/i).first();
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();
    
    // Type into search
    await searchInput.fill('test query');
    await expect(searchInput).toHaveValue('test query');
  });

  test('should be responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    // Check if page loads on mobile (use first to avoid strict mode violation)
    await expect(page.getByRole('heading', { name: /ChatMap/i }).first()).toBeVisible();
    
    // Check if map is still visible
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    const map = page.locator('.leaflet-container');
    await expect(map).toBeVisible();
  });
});
