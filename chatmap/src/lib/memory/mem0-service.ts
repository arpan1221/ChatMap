import { MemoryClient, type Memory as Mem0Record, type Messages as Mem0Message } from 'mem0ai';
import { v4 as uuidv4 } from 'uuid';

import type {
  ConversationMemory,
  Location,
  LocationFrequency,
  LocationMemory,
  Memory,
  MemorySearchFilters,
  POI,
  TransportMode,
  UserPreferences,
} from '@/src/lib/types';

// Mem0ai Configuration
const MEM0_LOCAL = process.env.MEM0_LOCAL === 'true' || process.env.NODE_ENV === 'development';

// Ollama Configuration
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-text:latest';
const OLLAMA_LLM_MODEL = process.env.OLLAMA_LLM_MODEL || 'llama3.2:3b';

// Qdrant Configuration
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY; // Optional for local Qdrant

const DEFAULT_LIMIT = 10;

export interface Mem0Service {
  createUserSession(userId: string): Promise<string>;
  getUserSession(userId: string): Promise<string>;

  addLocationMemory(userId: string, memory: LocationMemory): Promise<string>;
  addConversationMemory(
    userId: string,
    query: string,
    response: string,
    context: Record<string, any>,
  ): Promise<string>;
  addPreferenceMemory(userId: string, preferences: UserPreferences): Promise<string>;

  getRelevantMemories(userId: string, query: string, limit?: number): Promise<Memory[]>;
  getLocationHistory(userId: string, location?: Location): Promise<LocationMemory[]>;
  getUserPreferences(userId: string): Promise<UserPreferences>;
  getConversationContext(userId: string, limit?: number): Promise<ConversationMemory[]>;

  searchMemoriesByLocation(
    userId: string,
    location: Location,
    radius: number,
  ): Promise<Memory[]>;
  searchMemoriesByPOIType(userId: string, poiType: string): Promise<Memory[]>;
  getFrequentLocations(userId: string): Promise<LocationFrequency[]>;
  clearUserMemories(userId: string): Promise<void>;
}

interface StoredMemory extends Memory {
  metadata: Record<string, any>;
}

class LocalMemoryStore {
  private store = new Map<string, StoredMemory[]>();

  upsert(memory: StoredMemory) {
    const list = this.store.get(memory.userId) ?? [];
    const existingIndex = list.findIndex((item) => item.id === memory.id);
    if (existingIndex >= 0) {
      list[existingIndex] = memory;
    } else {
      list.push(memory);
    }
    this.store.set(memory.userId, list);
  }

  list(userId: string): StoredMemory[] {
    return this.store.get(userId) ?? [];
  }

  filter(userId: string, predicate: (memory: StoredMemory) => boolean): StoredMemory[] {
    return this.list(userId).filter(predicate);
  }

  clear(userId: string) {
    this.store.delete(userId);
  }
}

class Mem0ServiceImpl implements Mem0Service {
  private client: MemoryClient | null = null;
  private sessions = new Map<string, string>();
  private localStore: LocalMemoryStore | null = null;

  constructor() {
    if (MEM0_LOCAL) {
      // In local mode, use the local store instead of the cloud API
      // This avoids the need for API keys and works entirely offline
      console.log('Running mem0ai in local mode - using local storage');
      this.localStore = new LocalMemoryStore();
    } else {
      // Use cloud API when not in local mode
      try {
        this.client = new MemoryClient({
          apiKey: process.env.MEM0_API_KEY || 'local-development',
        });
      } catch (error) {
        console.warn('Failed to create MemoryClient, falling back to local store:', error);
        this.localStore = new LocalMemoryStore();
      }
    }
  }

  async createUserSession(userId: string): Promise<string> {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId)!;
    }

    const sessionId = uuidv4();
    this.sessions.set(userId, sessionId);
    return sessionId;
  }

  async getUserSession(userId: string): Promise<string> {
    if (!this.sessions.has(userId)) {
      return this.createUserSession(userId);
    }

    return this.sessions.get(userId)!;
  }

  async addLocationMemory(userId: string, memory: LocationMemory): Promise<string> {
    const sessionId = await this.getUserSession(userId);
    const timestamp = this.normalizeTimestamp(memory.timestamp);
    const metadata = {
      type: 'location',
      query: memory.query,
      location: memory.location,
      poisFound: memory.poisFound,
      selectedPOI: memory.selectedPOI,
      satisfaction: memory.satisfaction,
      context: memory.context,
      timestamp,
    };

    const content = this.buildLocationSummary(memory);

    const recordId = await this.recordMemory({
      sessionId,
      userId,
      type: 'location',
      content,
      metadata,
      sourceMessages: this.createConversationMessages(memory.query, content),
    });

    return recordId;
  }

  async addConversationMemory(
    userId: string,
    query: string,
    response: string,
    context: Record<string, any>,
  ): Promise<string> {
    const sessionId = await this.getUserSession(userId);
    const timestamp = new Date().toISOString();

    const metadata = {
      type: 'conversation',
      query,
      response,
      timestamp,
      context,
      extractedPreferences: context?.extractedPreferences,
    };

    const summary = this.buildConversationSummary(query, response, context);

    return this.recordMemory({
      sessionId,
      userId,
      type: 'conversation',
      content: summary,
      metadata,
      sourceMessages: this.createConversationMessages(query, response),
    });
  }

  async addPreferenceMemory(userId: string, preferences: UserPreferences): Promise<string> {
    const sessionId = await this.getUserSession(userId);
    const timestamp = new Date().toISOString();

    const metadata = {
      type: 'preference',
      timestamp,
      preferences,
    };

    const summary = this.buildPreferenceSummary(preferences);

    return this.recordMemory({
      sessionId,
      userId,
      type: 'preference',
      content: summary,
      metadata,
      sourceMessages: this.createPreferenceMessages(summary, preferences),
    });
  }

  async getRelevantMemories(userId: string, query: string, limit = DEFAULT_LIMIT): Promise<Memory[]> {
    const sessionId = await this.getUserSession(userId);

    // In local mode, only use local store
    if (MEM0_LOCAL) {
      if (this.localStore) {
        return this.localStore
          .filter(sessionId, (memory) =>
            memory.content.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, limit);
      }
      return [];
    }

    // In cloud mode, try client first, then fallback to local store
    if (this.client) {
      try {
        const results = await this.client.search(query, {
          user_id: sessionId,
          top_k: limit,
          filters: { userId },
        });

        return results
          .slice(0, limit)
          .map((record) => this.normalizeMem0Record(record, userId));
      } catch (error) {
        console.error('[Mem0] Failed to search memories:', error);
        // fallback to local store
      }
    }

    if (this.localStore) {
      return this.localStore
        .filter(sessionId, (memory) =>
          memory.content.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, limit);
    }

    return [];
  }

  async getLocationHistory(userId: string, location?: Location): Promise<LocationMemory[]> {
    const sessionId = await this.getUserSession(userId);

    const memories = await this.fetchByType(sessionId, userId, 'location');

    const filtered = location
      ? memories.filter((memory) => {
          const storedLocation = (memory.metadata?.location as Location | undefined) ?? null;
          if (!storedLocation) return false;

          const sameName = storedLocation.display_name === location.display_name;
          const sameCoords =
            this.roundCoord(storedLocation.lat) === this.roundCoord(location.lat) &&
            this.roundCoord(storedLocation.lng) === this.roundCoord(location.lng);

          return sameName || sameCoords;
        })
      : memories;

    return filtered.map((memory) => this.mapToLocationMemory(memory));
  }

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const sessionId = await this.getUserSession(userId);
    const preferenceMemories = await this.fetchByType(sessionId, userId, 'preference');

    return preferenceMemories.reduce<UserPreferences>((acc, memory) => {
      const prefs = (memory.metadata?.preferences ?? {}) as UserPreferences;
      return this.mergePreferences(acc, prefs);
    }, {});
  }

  async getConversationContext(userId: string, limit = DEFAULT_LIMIT): Promise<ConversationMemory[]> {
    const sessionId = await this.getUserSession(userId);
    const conversationMemories = await this.fetchByType(sessionId, userId, 'conversation');

    return conversationMemories
      .slice(-limit)
      .map((memory) => this.mapToConversationMemory(memory));
  }

  async searchMemoriesByLocation(
    userId: string,
    location: Location,
    radius: number,
  ): Promise<Memory[]> {
    const sessionId = await this.getUserSession(userId);
    const query = `${location.display_name} within ${radius}m`;

    // In local mode, only use local store
    if (MEM0_LOCAL) {
      if (this.localStore) {
        return this.localStore.filter(sessionId, (memory) => {
          if (memory.metadata?.type !== 'location') return false;
          const storedLocation = memory.metadata?.location as Location | undefined;
          if (!storedLocation) return false;

          return storedLocation.display_name === location.display_name;
        });
      }
      return [];
    }

    // In cloud mode, try client first, then fallback to local store
    if (this.client) {
      try {
        const results = await this.client.search(query, {
          user_id: sessionId,
          filters: {
            type: 'location',
            userId,
          },
        });

        return results.map((record) => this.normalizeMem0Record(record, userId));
      } catch (error) {
        console.error('[Mem0] Failed to search memories by location:', error);
        // fallback to local store
      }
    }

    if (this.localStore) {
      return this.localStore.filter(sessionId, (memory) => {
        if (memory.metadata?.type !== 'location') return false;
        const storedLocation = memory.metadata?.location as Location | undefined;
        if (!storedLocation) return false;

        return storedLocation.display_name === location.display_name;
      });
    }

    return [];
  }

  async searchMemoriesByPOIType(userId: string, poiType: string): Promise<Memory[]> {
    const sessionId = await this.getUserSession(userId);

    // In local mode, only use local store
    if (MEM0_LOCAL) {
      if (this.localStore) {
        return this.localStore.filter(
          sessionId,
          (memory) => memory.metadata?.type === 'location' && memory.content.includes(poiType),
        );
      }
      return [];
    }

    // In cloud mode, try client first, then fallback to local store
    if (this.client) {
      try {
        const results = await this.client.search(`${poiType} places`, {
          user_id: sessionId,
          filters: {
            type: 'location',
            poiType,
            userId,
          },
        });

        return results.map((record) => this.normalizeMem0Record(record, userId));
      } catch (error) {
        console.error('[Mem0] Failed to search memories by POI type:', error);
        // fallback to local store
      }
    }

    if (this.localStore) {
      return this.localStore.filter(
        sessionId,
        (memory) => memory.metadata?.type === 'location' && memory.content.includes(poiType),
      );
    }

    return [];
  }

  async getFrequentLocations(userId: string): Promise<LocationFrequency[]> {
    const sessionId = await this.getUserSession(userId);
    const locationMemories = await this.fetchByType(sessionId, userId, 'location');

    const frequencyMap = new Map<string, { memory: StoredMemory; count: number }>();

    locationMemories.forEach((memory) => {
      const storedLocation = memory.metadata?.location as Location | undefined;
      if (!storedLocation) return;

      const key = `${this.roundCoord(storedLocation.lat)}:${this.roundCoord(storedLocation.lng)}`;
      const entry = frequencyMap.get(key);

      if (entry) {
        entry.count += 1;
        if (new Date(memory.createdAt) > new Date(entry.memory.createdAt)) {
          entry.memory = memory;
        }
      } else {
        frequencyMap.set(key, { memory, count: 1 });
      }
    });

    return Array.from(frequencyMap.values()).map(({ memory, count }) => {
      const storedLocation = memory.metadata?.location as Location;
      return {
        location: storedLocation,
        count,
        lastVisited: memory.metadata?.timestamp ?? memory.createdAt,
        poiTypes: memory.metadata?.poisFound?.map((poi: POI) => poi.type) ?? [],
        timeOfDay: memory.metadata?.context ? [memory.metadata.context.timeOfDay] : [],
      } satisfies LocationFrequency;
    });
  }

  private async recordMemory(options: {
    sessionId: string;
    userId: string;
    type: string;
    content: string;
    metadata: Record<string, any>;
    sourceMessages: Mem0Message[];
  }): Promise<string> {
    const { sessionId, userId, type, content, metadata, sourceMessages } = options;
    const timestamp = metadata.timestamp ?? new Date().toISOString();

    // In local mode, only use local store
    if (MEM0_LOCAL) {
      // Skip client and go directly to local store
    } else if (this.client) {
      try {
        const result = await this.client.add(sourceMessages, {
          user_id: sessionId,
          metadata: {
            ...metadata,
            userId,
            sessionId,
            type,
            timestamp,
          },
          filters: {
            userId,
          },
        });

        const record = result[0];
        const normalized = this.normalizeMem0Record(record, userId, metadata);
        return normalized.id;
      } catch (error) {
        console.error('[Mem0] Failed to record memory via API:', error);
        if (!this.localStore) {
          this.localStore = new LocalMemoryStore();
        }
      }
    }

    const fallbackRecord: StoredMemory = {
      id: uuidv4(),
      userId: sessionId,
      type,
      content,
      createdAt: timestamp,
      metadata: {
        ...metadata,
        userId,
        sessionId,
        type,
        timestamp,
      },
    };

    this.localStore!.upsert(fallbackRecord);
    return fallbackRecord.id;
  }

  private async fetchByType(sessionId: string, userId: string, type: string): Promise<StoredMemory[]> {
    // In local mode, only use local store
    if (MEM0_LOCAL) {
      if (this.localStore) {
        return this.localStore.filter(sessionId, (memory) => memory.metadata?.type === type);
      }
      return [];
    }

    // In cloud mode, try client first, then fallback to local store
    if (this.client) {
      try {
        const results = await this.client.search(type, {
          user_id: sessionId,
          filters: { type, userId },
          top_k: 50,
        });
        return results.map((record) => this.normalizeMem0Record(record, userId));
      } catch (error) {
        console.error(`[Mem0] Failed to fetch memories of type ${type}:`, error);
        // fallback to local store if available
      }
    }

    if (this.localStore) {
      return this.localStore.filter(sessionId, (memory) => memory.metadata?.type === type);
    }

    return [];
  }

  private normalizeMem0Record(
    record: Mem0Record,
    userId: string,
    metadataOverride?: Record<string, any>,
  ): StoredMemory {
    const createdAt = this.normalizeTimestamp(record.created_at ?? record.metadata?.timestamp);
    const updatedAt = this.normalizeTimestamp(record.updated_at);
    const metadata = {
      ...(record.metadata ?? {}),
      ...metadataOverride,
      userId,
      sessionId: record.metadata?.sessionId ?? undefined,
    };

    return {
      id: record.id,
      userId: record.user_id ?? userId,
      type: metadata.type ?? record.memory_type ?? 'general',
      content: record.memory ?? this.joinMessageContent(record.messages),
      score: record.score ?? undefined,
      metadata,
      createdAt,
      updatedAt,
    };
  }

  private mapToLocationMemory(memory: StoredMemory): LocationMemory {
    const timestamp = this.normalizeTimestamp(memory.metadata?.timestamp ?? memory.createdAt);
    const rawLocation = memory.metadata?.location as Location | undefined;
    const sanitizedLocation = rawLocation
      ? {
          ...rawLocation,
          lat: this.roundCoord(rawLocation.lat),
          lng: this.roundCoord(rawLocation.lng),
        }
      : rawLocation;

    return {
      id: memory.id,
      userId: memory.metadata?.userId ?? memory.userId,
      location: sanitizedLocation as Location,
      query: memory.metadata?.query ?? memory.content,
      poisFound: (memory.metadata?.poisFound as POI[]) ?? [],
      selectedPOI: memory.metadata?.selectedPOI as POI | undefined,
      satisfaction: memory.metadata?.satisfaction,
      timestamp,
      context: memory.metadata?.context ?? {
        timeOfDay: 'unknown',
        dayOfWeek: 'unknown',
      },
    } satisfies LocationMemory;
  }

  private mapToConversationMemory(memory: StoredMemory): ConversationMemory {
    return {
      id: memory.id,
      userId: memory.metadata?.userId ?? memory.userId,
      query: memory.metadata?.query ?? '',
      response: memory.metadata?.response ?? memory.content,
      timestamp: this.normalizeTimestamp(memory.metadata?.timestamp ?? memory.createdAt),
      context: memory.metadata?.context ?? {},
      relatedPOIs: memory.metadata?.relatedPOIs ?? [],
      extractedPreferences: memory.metadata?.extractedPreferences ?? {},
    } satisfies ConversationMemory;
  }

  private mergePreferences(base: UserPreferences, update: UserPreferences): UserPreferences {
    const merged: UserPreferences = { ...base };

    if (update.favoriteTransport?.length) {
      merged.favoriteTransport = Array.from(
        new Set([...(base.favoriteTransport ?? []), ...update.favoriteTransport]),
      ) as TransportMode[];
    }

    if (update.favoritePOITypes?.length) {
      merged.favoritePOITypes = Array.from(
        new Set([...(base.favoritePOITypes ?? []), ...update.favoritePOITypes]),
      );
    }

    if (update.favoriteCuisines?.length) {
      merged.favoriteCuisines = Array.from(
        new Set([...(base.favoriteCuisines ?? []), ...update.favoriteCuisines]),
      );
    }

    if (update.timePreferences) {
      merged.timePreferences = {
        ...(base.timePreferences ?? {}),
        ...update.timePreferences,
      };
    }

    if (update.dietaryRestrictions?.length) {
      merged.dietaryRestrictions = Array.from(
        new Set([...(base.dietaryRestrictions ?? []), ...update.dietaryRestrictions]),
      );
    }

    if (update.budgetPreference) {
      merged.budgetPreference = update.budgetPreference;
    }

    if (update.accessibilityNeeds?.length) {
      merged.accessibilityNeeds = Array.from(
        new Set([...(base.accessibilityNeeds ?? []), ...update.accessibilityNeeds]),
      );
    }

    if (update.ambiencePreferences?.length) {
      merged.ambiencePreferences = Array.from(
        new Set([...(base.ambiencePreferences ?? []), ...update.ambiencePreferences]),
      );
    }

    if (update.parkingPreference) {
      merged.parkingPreference = update.parkingPreference;
    }

    if (update.visitFrequency) {
      merged.visitFrequency = {
        ...(base.visitFrequency ?? {}),
        ...update.visitFrequency,
      };
    }

    return merged;
  }

  private createConversationMessages(query: string, response: string): Mem0Message[] {
    return [
      { role: 'user', content: query },
      { role: 'assistant', content: response },
    ];
  }

  private createPreferenceMessages(summary: string, preferences: UserPreferences): Mem0Message[] {
    return [
      { role: 'user', content: 'Updated user preferences' },
      { role: 'assistant', content: `${summary}\n${JSON.stringify(preferences)}` },
    ];
  }

  private buildLocationSummary(memory: LocationMemory): string {
    const poiSummary = memory.poisFound
      .map((poi) => poi.name || poi.id)
      .slice(0, 5)
      .join(', ');

    const parts = [
      `Location query: ${memory.query}`,
      `Area: ${memory.location.display_name}`,
      `Results: ${memory.poisFound.length} places${poiSummary ? ` (${poiSummary})` : ''}`,
    ];

    if (memory.selectedPOI) {
      parts.push(`Selected: ${memory.selectedPOI.name}`);
    }

    if (memory.satisfaction) {
      parts.push(`Satisfaction: ${memory.satisfaction}/5`);
    }

    if (memory.context?.timeOfDay) {
      parts.push(`Time of day: ${memory.context.timeOfDay}`);
    }

    if (memory.context?.activity) {
      parts.push(`Activity: ${memory.context.activity}`);
    }

    return parts.join(' | ');
  }

  private buildConversationSummary(
    query: string,
    response: string,
    context: Record<string, any>,
  ): string {
    const preferenceHighlights: string[] = [];

    const extracted = context?.extractedPreferences as UserPreferences | undefined;
    if (extracted?.favoriteTransport?.length) {
      preferenceHighlights.push(`Transport: ${extracted.favoriteTransport.join(', ')}`);
    }
    if (extracted?.favoritePOITypes?.length) {
      preferenceHighlights.push(`POI types: ${extracted.favoritePOITypes.join(', ')}`);
    }
    if (extracted?.dietaryRestrictions?.length) {
      preferenceHighlights.push(`Dietary: ${extracted.dietaryRestrictions.join(', ')}`);
    }

    return [
      `User asked: ${query}`,
      `Assistant responded: ${response.slice(0, 200)}${response.length > 200 ? '…' : ''}`,
      preferenceHighlights.length ? `Preference signals: ${preferenceHighlights.join('; ')}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
  }

  private buildPreferenceSummary(preferences: UserPreferences): string {
    const parts: string[] = [];

    if (preferences.favoritePOITypes?.length) {
      parts.push(`Prefers ${preferences.favoritePOITypes.join(', ')}`);
    }
    if (preferences.favoriteCuisines?.length) {
      parts.push(`Cuisines: ${preferences.favoriteCuisines.join(', ')}`);
    }
    if (preferences.favoriteTransport?.length) {
      parts.push(`Transport: ${preferences.favoriteTransport.join(', ')}`);
    }
    if (preferences.budgetPreference) {
      parts.push(`Budget: ${preferences.budgetPreference}`);
    }
    if (preferences.dietaryRestrictions?.length) {
      parts.push(`Dietary: ${preferences.dietaryRestrictions.join(', ')}`);
    }
    if (preferences.accessibilityNeeds?.length) {
      parts.push(`Accessibility: ${preferences.accessibilityNeeds.join(', ')}`);
    }

    if (parts.length === 0) {
      parts.push('General preference update');
    }

    return parts.join(' | ');
  }

  private joinMessageContent(messages?: Mem0Record['messages']): string {
    if (!messages || messages.length === 0) {
      return '';
    }

    return messages
      .map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`)
      .join('\n');
  }

  async clearUserMemories(userId: string): Promise<void> {
    const sessionId = await this.getUserSession(userId);

    // In local mode, only use local store
    if (MEM0_LOCAL) {
      if (this.localStore) {
        this.localStore.clear(sessionId);
      }
      return;
    }

    // In cloud mode, try client first, then fallback to local store
    if (this.client) {
      try {
        await this.client.deleteUsers({ user_id: sessionId });
      } catch (error) {
        console.error('[Mem0] Failed to clear memories via API:', error);
        // fallback to local store
      }
    }

    if (this.localStore) {
      this.localStore.clear(sessionId);
    }
  }

  private normalizeTimestamp(value: unknown): string {
    if (!value) {
      return new Date().toISOString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
      return value;
    }

    return new Date().toISOString();
  }

  private roundCoord(value: number): number {
    return Math.round(value * 1e4) / 1e4;
  }
}

let serviceInstance: Mem0Service | null = null;

export function getMem0Service(): Mem0Service {
  if (!serviceInstance) {
    serviceInstance = new Mem0ServiceImpl();
  }
  return serviceInstance;
}

export type { StoredMemory };
