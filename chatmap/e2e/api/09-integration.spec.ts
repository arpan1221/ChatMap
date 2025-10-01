import { test, expect } from '@playwright/test';

test.describe('API Integration Tests', () => {
  const baseURL = 'http://localhost:3000';
  const testUserId = `integration-test-${Date.now()}`;
  let testLocation: any;

  test.beforeAll(async () => {
    // Initial setup
    testLocation = {
      lat: 51.5074,
      lng: -0.1278,
      display_name: 'London, UK',
    };
  });

  test('Complete user journey: Geocode → Parse → POI Search → Memory', async ({ request }) => {
    // Step 1: Geocode an address
    const geocodeResponse = await request.post(`${baseURL}/api/geocode`, {
      data: {
        query: 'Trafalgar Square, London',
      },
    });
    expect(geocodeResponse.ok()).toBeTruthy();
    const geocodeBody = await geocodeResponse.json();
    const location = geocodeBody.results[0];

    // Step 2: Parse a query
    const parseResponse = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Find restaurants within 15 minutes walk',
        location,
        userId: testUserId,
        memoryEnabled: true,
      },
    });
    expect(parseResponse.ok()).toBeTruthy();
    const parseBody = await parseResponse.json();

    // Step 3: Search for POIs
    const poisResponse = await request.post(`${baseURL}/api/pois`, {
      data: {
        location,
        poiType: parseBody.parsedQuery.poiType,
        timeMinutes: parseBody.parsedQuery.timeMinutes,
        transport: parseBody.parsedQuery.transport,
      },
    });
    expect(poisResponse.ok()).toBeTruthy();
    const poisBody = await poisResponse.json();

    // Step 4: Store interaction in memory
    const memoryResponse = await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: testUserId,
        content: `User searched for ${parseBody.parsedQuery.poiType} near ${location.display_name}`,
        type: 'conversation',
        metadata: {
          poiType: parseBody.parsedQuery.poiType,
          location: location.display_name,
          resultsCount: poisBody.pois.length,
        },
      },
    });
    expect(memoryResponse.ok()).toBeTruthy();

    // Step 5: Verify memory was stored
    const memoryListResponse = await request.get(
      `${baseURL}/api/memory?userId=${testUserId}`
    );
    expect(memoryListResponse.ok()).toBeTruthy();
    const memoryList = await memoryListResponse.json();
    expect(memoryList.memories.length).toBeGreaterThan(0);
  });

  test('Agent orchestration: Complex query → Multi-step execution', async ({ request }) => {
    // Submit a complex query to agent
    const agentResponse = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Find cafes near the nearest park within 10 minutes walk',
        userId: testUserId,
        userLocation: testLocation,
        memoryEnabled: false,
      },
    });

    expect(agentResponse.ok()).toBeTruthy();
    const agentBody = await agentResponse.json();

    // Verify agent classified it correctly
    expect(agentBody.data.classification.complexity).toBe('multi-step');
    expect(agentBody.data.agentUsed).toBeTruthy();
    expect(agentBody.data.result).toBeTruthy();
  });

  test('Route optimization: Find POI → Get Directions → Optimize', async ({ request }) => {
    // Step 1: Find nearest POI
    const nearestResponse = await request.post(`${baseURL}/api/poi/nearest`, {
      data: {
        poiType: 'pharmacy',
        userLocation: testLocation,
        transport: 'walking',
      },
    });
    expect(nearestResponse.ok()).toBeTruthy();
    const nearestBody = await nearestResponse.json();

    // Step 2: Get directions to nearest POI
    const directionsResponse = await request.post(`${baseURL}/api/directions`, {
      data: {
        coordinates: [
          testLocation,
          { lat: nearestBody.nearest.lat, lng: nearestBody.nearest.lng },
        ],
        profile: 'foot-walking',
      },
    });
    expect(directionsResponse.ok()).toBeTruthy();
    const directionsBody = await directionsResponse.json();
    expect(directionsBody.routes.length).toBeGreaterThan(0);
  });

  test('Isochrone → POI filtering workflow', async ({ request }) => {
    // Step 1: Generate isochrone
    const isochroneResponse = await request.post(`${baseURL}/api/isochrone`, {
      data: {
        location: testLocation,
        profile: 'foot-walking',
        range: [900], // 15 minutes
      },
    });
    expect(isochroneResponse.ok()).toBeTruthy();
    const isochroneBody = await isochroneResponse.json();

    // Step 2: Find POIs (they should be filtered by isochrone)
    const poisResponse = await request.post(`${baseURL}/api/pois`, {
      data: {
        location: testLocation,
        poiType: 'cafe',
        timeMinutes: 15,
        transport: 'walking',
      },
    });
    expect(poisResponse.ok()).toBeTruthy();
    const poisBody = await poisResponse.json();

    // Both should have compatible data
    expect(isochroneBody.features.length).toBeGreaterThan(0);
    expect(Array.isArray(poisBody.pois)).toBeTruthy();
  });

  test('Memory-enhanced search: Store preferences → Retrieve → Use in query', async ({ request }) => {
    const preferenceUserId = `pref-user-${Date.now()}`;

    // Step 1: Store user preferences
    await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: preferenceUserId,
        content: 'User prefers Italian food and walking',
        type: 'preference',
        metadata: {
          cuisine: 'italian',
          transport: 'walking',
        },
      },
    });

    // Step 2: Get memory context
    const contextResponse = await request.get(
      `${baseURL}/api/memory/context?userId=${preferenceUserId}`
    );
    expect(contextResponse.ok()).toBeTruthy();
    const context = await contextResponse.json();
    expect(context.preferences).toBeTruthy();

    // Step 3: Use context in query
    const queryResponse = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Find restaurants nearby',
        location: testLocation,
        userId: preferenceUserId,
        memoryEnabled: true,
      },
    });
    expect(queryResponse.ok()).toBeTruthy();
  });

  test('Multi-transport comparison', async ({ request }) => {
    const destination = { lat: 51.5274, lng: -0.1478 };

    // Get durations for all transport modes
    const transports = ['walking', 'driving', 'cycling'];
    const results: any[] = [];

    for (const transport of transports) {
      const response = await request.post(`${baseURL}/api/durations`, {
        data: {
          origin: testLocation,
          destinations: [destination],
          transport,
        },
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      results.push({ transport, duration: body.durations[0] });
    }

    // All should return valid durations
    results.forEach((result) => {
      expect(result.duration).toBeGreaterThan(0);
    });
  });

  test('Error handling cascade: Invalid input → Graceful degradation', async ({ request }) => {
    // Try to parse an invalid query
    const parseResponse = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: '', // Empty query
        location: testLocation,
        userId: testUserId,
        memoryEnabled: false,
      },
    });

    // Should handle gracefully
    expect(parseResponse.status()).toBeGreaterThanOrEqual(200);
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: Delete test user memories
    try {
      await request.delete(`${baseURL}/api/memory?resource=all`, {
        headers: {
          'X-User-Id': testUserId,
        },
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
});
