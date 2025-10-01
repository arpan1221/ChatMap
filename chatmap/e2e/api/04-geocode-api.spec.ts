import { test, expect } from '@playwright/test';

test.describe('Geocode API', () => {
  const baseURL = 'http://localhost:3000';

  test('should geocode a city name', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'London, UK',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBeTruthy();
    expect(body.results.length).toBeGreaterThan(0);
    
    const firstResult = body.results[0];
    expect(firstResult).toHaveProperty('lat');
    expect(firstResult).toHaveProperty('lng');
    expect(firstResult).toHaveProperty('display_name');
    expect(typeof firstResult.lat).toBe('number');
    expect(typeof firstResult.lng).toBe('number');
  });

  test('should geocode a full address', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: '10 Downing Street, London',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].display_name).toContain('London');
  });

  test('should geocode a landmark', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'Big Ben, London',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.results.length).toBeGreaterThan(0);
  });

  test('should handle postal codes', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'SW1A 1AA, UK',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.results.length).toBeGreaterThan(0);
  });

  test('should return multiple results for ambiguous queries', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'Springfield',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Springfield exists in many countries/states
    expect(body.results.length).toBeGreaterThanOrEqual(1);
  });

  test('should return error for empty query', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: '',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle non-existent locations gracefully', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'XYZ Nonexistent Place 12345',
      },
    });

    const body = await response.json();
    
    // Should return empty results, not error
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBeTruthy();
  });

  test('should include detailed address components', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'Trafalgar Square, London',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    const firstResult = body.results[0];
    expect(firstResult).toHaveProperty('display_name');
    // Display name should have detailed information
    expect(firstResult.display_name.length).toBeGreaterThan(10);
  });

  test('should handle international characters', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'München, Deutschland',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.results.length).toBeGreaterThan(0);
  });

  test('should return coordinates within valid range', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'New York, USA',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    const firstResult = body.results[0];
    // Latitude should be between -90 and 90
    expect(firstResult.lat).toBeGreaterThanOrEqual(-90);
    expect(firstResult.lat).toBeLessThanOrEqual(90);
    // Longitude should be between -180 and 180
    expect(firstResult.lng).toBeGreaterThanOrEqual(-180);
    expect(firstResult.lng).toBeLessThanOrEqual(180);
  });
});
