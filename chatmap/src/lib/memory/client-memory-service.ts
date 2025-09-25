/**
 * Client-side memory service that communicates with server-side mem0ai via API routes
 * This ensures mem0ai never gets bundled for the client-side
 */

import type {
  ConversationMemory,
  Location,
  LocationFrequency,
  LocationMemory,
  Memory,
  UserPreferences,
} from '@/src/lib/types';

const API_BASE = '/api/memory';

interface ClientMemoryService {
  addLocationMemory(userId: string, memory: LocationMemory): Promise<string>;
  addConversationMemory(
    userId: string,
    query: string,
    response: string,
    context: Record<string, unknown>
  ): Promise<string>;
  addPreferenceMemory(userId: string, preferences: UserPreferences): Promise<string>;
  getRelevantMemories(userId: string, query: string, limit?: number): Promise<Memory[]>;
  getLocationHistory(userId: string, location?: Location): Promise<LocationMemory[]>;
  getUserPreferences(userId: string): Promise<UserPreferences>;
  getConversationContext(userId: string, limit?: number): Promise<ConversationMemory[]>;
  searchMemoriesByLocation(userId: string, location: Location, radius: number): Promise<Memory[]>;
  searchMemoriesByPOIType(userId: string, poiType: string): Promise<Memory[]>;
  getFrequentLocations(userId: string): Promise<LocationFrequency[]>;
  clearUserMemories(userId: string): Promise<void>;
}

class ClientMemoryServiceImpl implements ClientMemoryService {
  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Memory API request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Memory API request failed');
    }

    return data.data;
  }

  async addLocationMemory(userId: string, memory: LocationMemory): Promise<string> {
    return this.makeRequest<string>('/add', 'POST', {
      type: 'location',
      userId,
      memory,
    });
  }

  async addConversationMemory(
    userId: string,
    query: string,
    response: string,
    context: Record<string, unknown>
  ): Promise<string> {
    return this.makeRequest<string>('/add', 'POST', {
      type: 'conversation',
      userId,
      query,
      response,
      context,
    });
  }

  async addPreferenceMemory(userId: string, preferences: UserPreferences): Promise<string> {
    return this.makeRequest<string>('/add', 'POST', {
      type: 'preference',
      userId,
      preferences,
    });
  }

  async getRelevantMemories(userId: string, query: string, limit = 10): Promise<Memory[]> {
    return this.makeRequest<Memory[]>('/search', 'POST', {
      userId,
      query,
      limit,
    });
  }

  async getLocationHistory(userId: string, location?: Location): Promise<LocationMemory[]> {
    const params = new URLSearchParams({ userId });
    if (location) {
      params.append('location', JSON.stringify(location));
    }
    
    return this.makeRequest<LocationMemory[]>(`/location-history?${params}`);
  }

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    return this.makeRequest<UserPreferences>(`/preferences?userId=${userId}`);
  }

  async getConversationContext(userId: string, limit = 20): Promise<ConversationMemory[]> {
    return this.makeRequest<ConversationMemory[]>(`/conversation-context?userId=${userId}&limit=${limit}`);
  }

  async searchMemoriesByLocation(
    userId: string,
    location: Location,
    radius: number
  ): Promise<Memory[]> {
    return this.makeRequest<Memory[]>('/search-by-location', 'POST', {
      userId,
      location,
      radius,
    });
  }

  async searchMemoriesByPOIType(userId: string, poiType: string): Promise<Memory[]> {
    return this.makeRequest<Memory[]>('/search-by-poi-type', 'POST', {
      userId,
      poiType,
    });
  }

  async getFrequentLocations(userId: string): Promise<LocationFrequency[]> {
    return this.makeRequest<LocationFrequency[]>(`/frequent-locations?userId=${userId}`);
  }

  async clearUserMemories(userId: string): Promise<void> {
    await this.makeRequest<void>('/clear', 'DELETE', { userId });
  }
}

let clientMemoryService: ClientMemoryService | null = null;

export function getClientMemoryService(): ClientMemoryService {
  if (!clientMemoryService) {
    clientMemoryService = new ClientMemoryServiceImpl();
  }
  return clientMemoryService;
}

export type { ClientMemoryService };
