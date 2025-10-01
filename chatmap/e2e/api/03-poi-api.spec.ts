import { test, expect } from '@playwright/test';

test.describe('POI API', () => {
  const baseURL = 'http://localhost:3000';
  const testLocation = {
    lat: 51.5074,
    lng: -0.1278,
    display_name: 'London, UK',
  };

  test.describe('GET /api/pois - Find POIs within time', () => {
    test('should find POIs within walking distance', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/pois`, {
        data: {
          location: testLocation,
          poiType: 'restaurant',
          timeMinutes: 15,
          transport: 'walking',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('pois');
      expect(Array.isArray(body.pois)).toBeTruthy();
      expect(body).toHaveProperty('isochrone');
      expect(body).toHaveProperty('transport', 'walking');
      expect(body).toHaveProperty('timeMinutes', 15);
    });

    test('should find POIs within driving distance', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/pois`, {
        data: {
          location: testLocation,
          poiType: 'gas_station',
          timeMinutes: 10,
          transport: 'driving',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body.transport).toBe('driving');
      expect(body.timeMinutes).toBe(10);
    });

    test('should return error for invalid transport mode', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/pois`, {
        data: {
          location: testLocation,
          poiType: 'restaurant',
          timeMinutes: 15,
          transport: 'invalid',
        },
      });

      expect(response.status()).toBe(400);
    });

    test('should handle different POI types', async ({ request }) => {
      const poiTypes = ['cafe', 'pharmacy', 'bank', 'park'];

      for (const poiType of poiTypes) {
        const response = await request.post(`${baseURL}/api/pois`, {
          data: {
            location: testLocation,
            poiType,
            timeMinutes: 15,
            transport: 'walking',
          },
        });

        expect(response.ok()).toBeTruthy();
      }
    });
  });

  test.describe('POST /api/poi/nearest - Find nearest POI', () => {
    test('should find nearest cafe', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/poi/nearest`, {
        data: {
          poiType: 'cafe',
          userLocation: testLocation,
          transport: 'walking',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('nearest');
      expect(body.nearest).toHaveProperty('name');
      expect(body.nearest).toHaveProperty('lat');
      expect(body.nearest).toHaveProperty('lng');
      expect(body).toHaveProperty('alternatives');
      expect(Array.isArray(body.alternatives)).toBeTruthy();
    });

    test('should include distance information', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/poi/nearest`, {
        data: {
          poiType: 'pharmacy',
          userLocation: testLocation,
          transport: 'walking',
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body.nearest).toHaveProperty('distance');
      expect(typeof body.nearest.distance).toBe('number');
    });
  });

  test.describe('POST /api/poi/near-poi - Find POIs near another POI', () => {
    test('should find cafes near nearest park', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/poi/near-poi`, {
        data: {
          primaryPOIType: 'cafe',
          secondaryPOIType: 'park',
          userLocation: testLocation,
          transport: 'walking',
          maxTimeFromSecondary: 10,
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('anchorPOI');
      expect(body).toHaveProperty('primaryPOIs');
      expect(Array.isArray(body.primaryPOIs)).toBeTruthy();
      expect(body).toHaveProperty('transport');
    });

    test('should include distance from anchor', async ({ request }) => {
      const response = await request.post(`${baseURL}/api/poi/near-poi`, {
        data: {
          primaryPOIType: 'restaurant',
          secondaryPOIType: 'subway_entrance',
          userLocation: testLocation,
          transport: 'walking',
          maxTimeFromSecondary: 5,
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      if (body.primaryPOIs.length > 0) {
        expect(body.primaryPOIs[0]).toHaveProperty('distanceFromAnchor');
      }
    });
  });

  test.describe('POST /api/poi/enroute - Find POI enroute', () => {
    test('should find gas station enroute to destination', async ({ request }) => {
      const destination = {
        lat: 51.5174,
        lng: -0.1378,
        display_name: 'Destination',
      };

      const response = await request.post(`${baseURL}/api/poi/enroute`, {
        data: {
          poiType: 'gas_station',
          userLocation: testLocation,
          destination,
          transport: 'driving',
          maxDetourMinutes: 5,
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      expect(body).toHaveProperty('pois');
      expect(body).toHaveProperty('directRoute');
      expect(body).toHaveProperty('transport', 'driving');
    });

    test('should respect max detour time', async ({ request }) => {
      const destination = {
        lat: 51.5174,
        lng: -0.1378,
        display_name: 'Destination',
      };

      const response = await request.post(`${baseURL}/api/poi/enroute`, {
        data: {
          poiType: 'cafe',
          userLocation: testLocation,
          destination,
          transport: 'walking',
          maxDetourMinutes: 3,
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      
      // All POIs should have detour time within limit
      body.pois.forEach((poi: any) => {
        if (poi.detourMinutes !== undefined) {
          expect(poi.detourMinutes).toBeLessThanOrEqual(3);
        }
      });
    });
  });

  test('should handle no results gracefully', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/pois`, {
      data: {
        location: testLocation,
        poiType: 'nonexistent_type_xyz',
        timeMinutes: 1,
        transport: 'walking',
      },
    });

    // Should still return a valid response structure
    const body = await response.json();
    expect(body).toHaveProperty('pois');
    expect(Array.isArray(body.pois)).toBeTruthy();
  });
});
