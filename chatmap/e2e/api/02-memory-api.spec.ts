import { test, expect } from '@playwright/test';

test.describe('Memory API', () => {
  const baseURL = 'http://localhost:3000';
  const testUserId = `test-user-${Date.now()}`;
  let createdMemoryId: string;

  test('should add a memory', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: testUserId,
        content: 'User prefers Italian restaurants and walking',
        type: 'preference',
        metadata: {
          cuisine: 'italian',
          transport: 'walking',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('userId', testUserId);
    expect(body).toHaveProperty('content');
    expect(body).toHaveProperty('type', 'preference');
    expect(body).toHaveProperty('createdAt');
    
    createdMemoryId = body.id;
  });

  test('should search memories by query', async ({ request }) => {
    // First add a memory
    await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: testUserId,
        content: 'User loves pizza and prefers outdoor seating',
        type: 'preference',
        metadata: { food: 'pizza' },
      },
    });

    // Search for it
    const response = await request.get(
      `${baseURL}/api/memory?userId=${testUserId}&query=pizza`
    );

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('memories');
    expect(Array.isArray(body.memories)).toBeTruthy();
    expect(body).toHaveProperty('count');
  });

  test('should list all memories for a user', async ({ request }) => {
    const response = await request.get(`${baseURL}/api/memory?userId=${testUserId}`);

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('memories');
    expect(Array.isArray(body.memories)).toBeTruthy();
    expect(body.memories.length).toBeGreaterThan(0);
  });

  test('should get memory context for insights', async ({ request }) => {
    const response = await request.get(`${baseURL}/api/memory?resource=insights`, {
      headers: {
        'X-User-Id': testUserId,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('preferences');
    expect(body).toHaveProperty('conversationHighlights');
    expect(body).toHaveProperty('locationHistory');
    expect(body).toHaveProperty('frequentLocations');
    expect(body).toHaveProperty('personalizedSuggestions');
    expect(Array.isArray(body.personalizedSuggestions)).toBeTruthy();
  });

  test('should get memory context summary', async ({ request }) => {
    const response = await request.get(`${baseURL}/api/memory/context?userId=${testUserId}`);

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    
    expect(body).toHaveProperty('userId', testUserId);
    expect(body).toHaveProperty('preferences');
    expect(body).toHaveProperty('conversationMemories');
    expect(body).toHaveProperty('locationHistory');
    expect(body).toHaveProperty('frequentLocations');
  });

  test('should delete a specific memory', async ({ request }) => {
    // First create a memory
    const createResponse = await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: testUserId,
        content: 'Temporary memory to delete',
        type: 'conversation',
      },
    });
    const created = await createResponse.json();

    // Delete it
    const deleteResponse = await request.delete(
      `${baseURL}/api/memory?memoryId=${created.id}`
    );

    expect(deleteResponse.ok()).toBeTruthy();
    const body = await deleteResponse.json();
    expect(body.message).toContain('deleted');
  });

  test('should clear all user memories', async ({ request }) => {
    const response = await request.delete(`${baseURL}/api/memory?resource=all`, {
      headers: {
        'X-User-Id': testUserId,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.message).toContain('deleted');
  });

  test('should return error for missing userId', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/memory`, {
      data: {
        content: 'Test memory',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should handle conversation memory type', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: testUserId,
        content: 'User asked about restaurants in downtown',
        type: 'conversation',
        metadata: {
          query: 'restaurants downtown',
          timestamp: new Date().toISOString(),
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.type).toBe('conversation');
  });

  test('should handle location memory type', async ({ request }) => {
    const response = await request.post(`${baseURL}/api/memory`, {
      data: {
        userId: testUserId,
        content: 'User frequently visits this location',
        type: 'location',
        metadata: {
          lat: 51.5074,
          lng: -0.1278,
          name: 'London',
          visitCount: 5,
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.type).toBe('location');
    expect(body.metadata).toHaveProperty('lat');
    expect(body.metadata).toHaveProperty('lng');
  });
});
