import { test, expect } from '@playwright/test';

test.describe('Chat API', () => {
  const baseURL = 'http://localhost:3000';
  const testLocation = {
    lat: 51.5074,
    lng: -0.1278,
    display_name: 'London, UK',
  };

  test('should respond to health check', async ({ request }) => {
    const response = await request.get(`${baseURL}/api/chat`);
    
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.message).toContain('Chat API');
  });

  test('should parse a simple query', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Find restaurants within 15 minutes walk',
        location: testLocation,
        userId: 'test-user-1',
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Validate response structure
    expect(body).toHaveProperty('parsedQuery');
    expect(body.parsedQuery).toHaveProperty('poiType');
    expect(body.parsedQuery).toHaveProperty('timeMinutes');
    expect(body.parsedQuery).toHaveProperty('transport');
    expect(body.parsedQuery).toHaveProperty('location');
    
    // Validate parsed values
    expect(body.parsedQuery.poiType).toBeTruthy();
    expect(body.parsedQuery.timeMinutes).toBeGreaterThan(0);
    expect(['walking', 'driving', 'cycling']).toContain(body.parsedQuery.transport);
  });

  test('should parse query with driving transport', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Find gas stations within 10 minutes by car',
        location: testLocation,
        userId: 'test-user-2',
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.parsedQuery.poiType).toBeTruthy();
    expect(body.parsedQuery.transport).toBe('driving');
  });

  test('should parse query with cycling transport', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Show me parks I can cycle to in 20 minutes',
        location: testLocation,
        userId: 'test-user-3',
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.parsedQuery.poiType).toBeTruthy();
    expect(body.parsedQuery.transport).toBe('cycling');
  });

  test('should generate response', async ({ request }) => {
    const mockQuery = {
      poiType: 'restaurant',
      timeMinutes: 15,
      transport: 'walking',
      location: testLocation,
      searchStrategy: 'time_based',
    };

    const mockPOIs = [
      {
        id: '1',
        name: 'Test Restaurant 1',
        lat: 51.5074,
        lng: -0.1278,
        type: 'restaurant',
        tags: { name: 'Test Restaurant 1' },
      },
      {
        id: '2',
        name: 'Test Restaurant 2',
        lat: 51.5084,
        lng: -0.1288,
        type: 'restaurant',
        tags: { name: 'Test Restaurant 2' },
      },
    ];

    const mockIsochrone = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          },
          properties: {},
        },
      ],
    };

    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'respond',
        query: mockQuery,
        pois: mockPOIs,
        isochroneData: mockIsochrone,
        userId: 'test-user-4',
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Validate response structure
    expect(body).toHaveProperty('response');
    expect(typeof body.response).toBe('string');
    expect(body.response.length).toBeGreaterThan(0);
  });

  test('should return error for missing type', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        message: 'Find restaurants',
        location: testLocation,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid type');
  });

  test('should return error for invalid type', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'invalid',
        message: 'Find restaurants',
        location: testLocation,
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle parse with conversation history', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Show me coffee shops nearby',
        location: testLocation,
        conversationHistory: [
          {
            role: 'user',
            content: 'Find restaurants',
            timestamp: new Date().toISOString(),
          },
        ],
        userId: 'test-user-5',
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.parsedQuery).toBeTruthy();
  });

  test('should return memory context when enabled', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/chat`, {
      data: {
        type: 'parse',
        message: 'Find restaurants',
        location: testLocation,
        userId: 'test-user-6',
        memoryEnabled: true,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Should have memory-related fields
    expect(body).toHaveProperty('memoryContext');
    expect(body).toHaveProperty('preferenceSignals');
  });
});
