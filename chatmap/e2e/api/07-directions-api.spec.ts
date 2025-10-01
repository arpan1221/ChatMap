import { test, expect } from '@playwright/test';

test.describe('Directions & Matrix API', () => {
  const baseURL = 'http://localhost:3000';
  const startLocation = {
    lat: 51.5074,
    lng: -0.1278,
    display_name: 'Start Point',
  };
  const endLocation = {
    lat: 51.5174,
    lng: -0.1378,
    display_name: 'End Point',
  };

  test.describe('GET /api/directions', () => {
    test('should get walking directions', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/directions`, {
        data: {
          coordinates: [startLocation, endLocation],
          profile: 'foot-walking',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('routes');
      expect(Array.isArray(body.routes)).toBeTruthy();
      expect(body.routes.length).toBeGreaterThan(0);
      
      const route = body.routes[0];
      expect(route).toHaveProperty('geometry');
      expect(route).toHaveProperty('distance');
      expect(route).toHaveProperty('duration');
    });

    test('should get driving directions', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/directions`, {
        data: {
          coordinates: [startLocation, endLocation],
          profile: 'driving-car',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body.routes[0]).toHaveProperty('distance');
      expect(body.routes[0]).toHaveProperty('duration');
    });

    test('should include turn-by-turn instructions', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/directions`, {
        data: {
          coordinates: [startLocation, endLocation],
          profile: 'foot-walking',
          instructions: true,
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      const route = body.routes[0];
      expect(route).toHaveProperty('segments');
      if (route.segments && route.segments.length > 0) {
        expect(route.segments[0]).toHaveProperty('steps');
      }
    });

    test('should handle multiple waypoints', async ({ request }) => {
      const waypoint = {
        lat: 51.5124,
        lng: -0.1328,
        display_name: 'Waypoint',
      };

      const response = await request.post(`${baseURL}/api/directions`, {
        data: {
          coordinates: [startLocation, waypoint, endLocation],
          profile: 'foot-walking',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body.routes.length).toBeGreaterThan(0);
    });
  });

  test.describe('POST /api/matrix', () => {
    test('should calculate travel time matrix', async ({ request }) => {
      const locations = [
        { lat: 51.5074, lng: -0.1278 },
        { lat: 51.5174, lng: -0.1378 },
        { lat: 51.5274, lng: -0.1478 },
      ];

      const response = await request.post(`${baseURL}/api/matrix`, {
        data: {
          locations,
          profile: 'foot-walking',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('durations');
      expect(Array.isArray(body.durations)).toBeTruthy();
      expect(body.durations.length).toBe(locations.length);
      
      // Each row should have same length as locations
      body.durations.forEach((row: number[]) => {
        expect(row.length).toBe(locations.length);
      });
    });

    test('should include distance matrix', async ({ request }) => {
      const locations = [
        { lat: 51.5074, lng: -0.1278 },
        { lat: 51.5174, lng: -0.1378 },
      ];

      const response = await request.post(`${baseURL}/api/matrix`, {
        data: {
          locations,
          profile: 'driving-car',
          metrics: ['duration', 'distance'],
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('durations');
      expect(body).toHaveProperty('distances');
    });

    test('should calculate matrix for different profiles', async ({ request }) => {
      const locations = [
        { lat: 51.5074, lng: -0.1278 },
        { lat: 51.5174, lng: -0.1378 },
      ];

      const profiles = ['foot-walking', 'driving-car', 'cycling-regular'];

      for (const profile of profiles) {
        const response = await request.post(`${baseURL}/api/matrix`, {
          data: {
            locations,
            profile,
          },
        });

        expect(response.ok()).toBeTruthy();
      }
    });
  });

  test.describe('POST /api/optimize', () => {
    test('should optimize route order', async ({ request }) => {
      const jobs = [
        { id: 1, location: { lat: 51.5074, lng: -0.1278 }, service: 300 },
        { id: 2, location: { lat: 51.5174, lng: -0.1378 }, service: 300 },
        { id: 3, location: { lat: 51.5274, lng: -0.1478 }, service: 300 },
      ];

      const response = await request.post(`${baseURL}/api/optimize`, {
        data: {
          jobs,
          vehicles: [
            {
              id: 1,
              start: { lat: 51.5074, lng: -0.1278 },
              end: { lat: 51.5074, lng: -0.1278 },
            },
          ],
          profile: 'driving-car',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('routes');
      expect(Array.isArray(body.routes)).toBeTruthy();
    });
  });

  test('should return error for invalid coordinates', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/directions`, {
      data: {
        coordinates: [
          { lat: 999, lng: 0 }, // Invalid
          { lat: 0, lng: 0 },
        ],
        profile: 'foot-walking',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle unreachable destinations gracefully', async ({ request }) => {
    // Try to route to an ocean location
    const response = await request.post(`${baseURL}/api/directions`, {
      data: {
        coordinates: [
          startLocation,
          { lat: 0, lng: 0, display_name: 'Ocean' }, // Middle of Atlantic
        ],
        profile: 'driving-car',
      },
    });

    // Should either succeed with a route or return a meaningful error
    const body = await response.json();
    expect(body).toBeTruthy();
  });
});
