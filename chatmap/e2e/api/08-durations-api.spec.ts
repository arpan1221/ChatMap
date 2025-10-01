import { test, expect } from '@playwright/test';

test.describe('Durations API', () => {
  const baseURL = 'http://localhost:3000';
  const testLocation = {
    lat: 51.5074,
    lng: -0.1278,
    display_name: 'London, UK',
  };

  test('should get duration for walking transport', async ({ request }) => {
    const destinations = [
      { lat: 51.5174, lng: -0.1378 },
      { lat: 51.5074, lng: -0.1178 },
    ];

    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations,
        transport: 'walking',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('durations');
    expect(Array.isArray(body.durations)).toBeTruthy();
    expect(body.durations.length).toBe(destinations.length);
    
    // Each duration should be a number in minutes
    body.durations.forEach((duration: number) => {
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThan(0);
    });
  });

  test('should get duration for driving transport', async ({ request }) => {
    const destinations = [
      { lat: 51.5174, lng: -0.1378 },
    ];

    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations,
        transport: 'driving',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.durations.length).toBe(1);
    expect(body.durations[0]).toBeGreaterThan(0);
  });

  test('should get duration for cycling transport', async ({ request }) => {
    const destinations = [
      { lat: 51.5174, lng: -0.1378 },
    ];

    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations,
        transport: 'cycling',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.durations[0]).toBeGreaterThan(0);
  });

  test('should handle multiple destinations', async ({ request }) => {
    const destinations = [
      { lat: 51.5074, lng: -0.1178 },
      { lat: 51.5174, lng: -0.1378 },
      { lat: 51.5274, lng: -0.1478 },
      { lat: 51.5374, lng: -0.1578 },
    ];

    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations,
        transport: 'walking',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.durations.length).toBe(destinations.length);
  });

  test('should return distances if requested', async ({ request }) => {
    const destinations = [
      { lat: 51.5174, lng: -0.1378 },
    ];

    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations,
        transport: 'walking',
        includeDistances: true,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('durations');
    if (body.distances) {
      expect(body.distances.length).toBe(destinations.length);
      expect(body.distances[0]).toBeGreaterThan(0);
    }
  });

  test('should return error for invalid transport', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations: [{ lat: 51.5174, lng: -0.1378 }],
        transport: 'invalid',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should return error for missing origin', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        destinations: [{ lat: 51.5174, lng: -0.1378 }],
        transport: 'walking',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should return error for empty destinations', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations: [],
        transport: 'walking',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle destinations at same location', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations: [testLocation], // Same as origin
        transport: 'walking',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Duration should be very small (close to 0)
    expect(body.durations[0]).toBeLessThan(1);
  });

  test('should compare durations across transport modes', async ({ request }) => {
    const destination = { lat: 51.5274, lng: -0.1478 };

    // Get walking duration
    const walkingResponse = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations: [destination],
        transport: 'walking',
      },
    });

    // Get driving duration
    const drivingResponse = await request.post(`${baseURL}/api/durations`, {
      data: {
        origin: testLocation,
        destinations: [destination],
        transport: 'driving',
      },
    });

    expect(walkingResponse.ok()).toBeTruthy();
    expect(drivingResponse.ok()).toBeTruthy();

    const walkingBody = await walkingResponse.json();
    const drivingBody = await drivingResponse.json();

    // Driving should generally be faster than walking
    expect(walkingBody.durations[0]).toBeGreaterThan(0);
    expect(drivingBody.durations[0]).toBeGreaterThan(0);
  });
});
