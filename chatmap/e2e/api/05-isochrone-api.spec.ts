import { test, expect } from '@playwright/test';

test.describe('Isochrone API', () => {
  const baseURL = 'http://localhost:3000';
  const testLocation = {
    lat: 51.5074,
    lng: -0.1278,
    display_name: 'London, UK',
  };

  test('should generate walking isochrone', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'foot-walking',
        range: [900], // 15 minutes in seconds
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('type', 'FeatureCollection');
    expect(body).toHaveProperty('features');
    expect(Array.isArray(body.features)).toBeTruthy();
    expect(body.features.length).toBeGreaterThan(0);
    
    const firstFeature = body.features[0];
    expect(firstFeature).toHaveProperty('type', 'Feature');
    expect(firstFeature).toHaveProperty('geometry');
    expect(firstFeature.geometry).toHaveProperty('type', 'Polygon');
    expect(firstFeature.geometry).toHaveProperty('coordinates');
  });

  test('should generate driving isochrone', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'driving-car',
        range: [600], // 10 minutes in seconds
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);
  });

  test('should generate cycling isochrone', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'cycling-regular',
        range: [1200], // 20 minutes in seconds
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);
  });

  test('should handle multiple time ranges', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'foot-walking',
        range: [300, 600, 900], // 5, 10, 15 minutes
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Should have multiple isochrones
    expect(body.features.length).toBeGreaterThanOrEqual(1);
  });

  test('should include properties in features', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'foot-walking',
        range: [900],
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    const firstFeature = body.features[0];
    expect(firstFeature).toHaveProperty('properties');
  });

  test('should return error for invalid profile', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'invalid-profile',
        range: [900],
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should return error for missing location', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        profile: 'foot-walking',
        range: [900],
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should return error for invalid coordinates', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: {
          lat: 999, // Invalid latitude
          lng: 0,
          display_name: 'Invalid',
        },
        profile: 'foot-walking',
        range: [900],
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle different time ranges', async ({ request }) => {
    const timeRanges = [300, 600, 900, 1800]; // 5, 10, 15, 30 minutes

    for (const range of timeRanges) {
      const response = await request.post(`${baseURL}/api/isochrone`, {
        data: {
          location: testLocation,
          profile: 'foot-walking',
          range: [range],
        },
      });

      expect(response.ok()).toBeTruthy();
    }
  });

  test('should generate larger isochrone for driving than walking', async ({ request }) => {
    // Get walking isochrone
    const walkingResponse = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'foot-walking',
        range: [900],
      },
    });

    // Get driving isochrone
    const drivingResponse = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'driving-car',
        range: [900],
      },
    });

    expect(walkingResponse.ok()).toBeTruthy();
    expect(drivingResponse.ok()).toBeTruthy();

    const walkingBody = await walkingResponse.json();
    const drivingBody = await drivingResponse.json();

    // Both should have valid geometries
    expect(walkingBody.features[0].geometry.coordinates).toBeTruthy();
    expect(drivingBody.features[0].geometry.coordinates).toBeTruthy();
  });
});
