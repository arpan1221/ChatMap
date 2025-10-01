import { test, expect } from '@playwright/test';

test.describe('Agent API', () => {
  const baseURL = 'http://localhost:3000';
  const testLocation = {
    lat: 51.5074,
    lng: -0.1278,
    display_name: 'London, UK',
  };
  const testUserId = `test-agent-user-${Date.now()}`;

  test('should respond to health check', async ({ request }) => {
    const response = await request.get(`${baseURL}/api/agent`);
    
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.message).toContain('Agent API');
  });

  test('should classify and execute simple query', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Find restaurants within 15 minutes walk',
        userId: testUserId,
        userLocation: testLocation,
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Should have orchestrator response structure
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('classification');
    expect(body.data).toHaveProperty('agentUsed');
    expect(body.data).toHaveProperty('result');
  });

  test('should include classification metadata', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Show me the nearest coffee shop',
        userId: testUserId,
        userLocation: testLocation,
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.data.classification).toHaveProperty('intent');
    expect(body.data.classification).toHaveProperty('complexity');
    expect(body.data.classification).toHaveProperty('confidence');
    expect(body.data.classification).toHaveProperty('entities');
  });

  test('should handle memory-enabled queries', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Find Italian restaurants nearby',
        userId: testUserId,
        userLocation: testLocation,
        memoryEnabled: true,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Should succeed even with memory enabled
    expect(body.success).toBeTruthy();
  });

  test('should include conversation history', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Show me cafes',
        userId: testUserId,
        userLocation: testLocation,
        conversationHistory: {
          messages: [
            {
              role: 'user',
              content: 'Find restaurants',
              timestamp: new Date().toISOString(),
            },
            {
              role: 'assistant',
              content: 'Found 5 restaurants nearby',
              timestamp: new Date().toISOString(),
            },
          ],
        },
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('should return error for missing query', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        userId: testUserId,
        userLocation: testLocation,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test('should return error for missing userId', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Find restaurants',
        userLocation: testLocation,
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle complex multi-step queries', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Find cafes near the nearest park within 10 minutes walk',
        userId: testUserId,
        userLocation: testLocation,
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    // Should mark as multi-step
    expect(body.data.classification.complexity).toBe('multi-step');
  });

  test('should include execution metadata', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: 'Find restaurants',
        userId: testUserId,
        userLocation: testLocation,
        memoryEnabled: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body.data).toHaveProperty('executionTimeMs');
    expect(typeof body.data.executionTimeMs).toBe('number');
    expect(body.data.executionTimeMs).toBeGreaterThan(0);
  });

  test('should handle different query intents', async ({ request }) => {
    const queries = [
      'Find the nearest pharmacy',
      'Show me gas stations within 5 minutes drive',
      'Where are restaurants I can walk to in 10 minutes',
    ];

    for (const query of queries) {
      const response = await request.post(`${baseURL}/api/agent`, {
        data: {
          query,
          userId: testUserId,
          userLocation: testLocation,
          memoryEnabled: false,
        },
      });

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body.success).toBeTruthy();
    }
  });

  test('should provide helpful error messages', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/agent`, {
      data: {
        query: '', // Empty query
        userId: testUserId,
        userLocation: testLocation,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });
});
