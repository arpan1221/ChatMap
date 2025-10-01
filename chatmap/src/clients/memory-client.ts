/**
 * Memory Client - Comprehensive mem0-style implementation
 * Uses Qdrant for vector storage + Ollama for embeddings
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { getOllamaClient } from './ollama-client';
import { Config } from '@/src/lib/config';
import { withRetry } from '@/src/lib/retry';
import type { 
  Memory, 
  UserPreferences, 
  ConversationMemory, 
  LocationMemory,
  MemoryContextSummary,
  MemorySearchFilters,
  Location
} from '@/src/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface MemoryAddRequest {
  userId: string;
  content: string;
  type?: 'location' | 'conversation' | 'preference' | 'system';
  metadata?: Record<string, any>;
}

export interface MemorySearchRequest {
  userId: string;
  query: string;
  limit?: number;
  filters?: MemorySearchFilters;
  scoreThreshold?: number;
}

export interface MemoryUpdateRequest {
  memoryId: string;
  content?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// Memory Client
// ============================================================================

export class MemoryClient {
  private qdrant: QdrantClient;
  private ollama;
  private collectionName = 'chatmap_memories';
  private embedModel = 'nomic-embed-text';
  private vectorSize = 768; // nomic-embed-text dimension

  constructor() {
    const config = Config.memory;
    this.qdrant = new QdrantClient({
      url: config.qdrantUrl,
      apiKey: config.qdrantApiKey,
    });
    this.ollama = getOllamaClient();
  }

  /**
   * Initialize the Qdrant collection
   */
  async initialize(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.qdrant.getCollections();
      const exists = collections.collections.some(
        (col) => col.name === this.collectionName
      );

      if (!exists) {
        console.log(`[MemoryClient] Creating collection: ${this.collectionName}`);
        await this.qdrant.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        // Create payload indexes for efficient filtering
        await Promise.all([
          this.qdrant.createPayloadIndex(this.collectionName, {
            field_name: 'userId',
            field_schema: 'keyword',
          }),
          this.qdrant.createPayloadIndex(this.collectionName, {
            field_name: 'type',
            field_schema: 'keyword',
          }),
          this.qdrant.createPayloadIndex(this.collectionName, {
            field_name: 'createdAt',
            field_schema: 'datetime',
          }),
        ]);

        console.log(`[MemoryClient] Collection created successfully`);
      }
    } catch (error) {
      console.error('[MemoryClient] Initialization error:', error);
      throw new Error(`Failed to initialize memory client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for text using Ollama
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await withRetry(
        async () => {
          const result = await fetch(`${Config.ollama.endpoint}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.embedModel,
              prompt: text,
            }),
          });

          if (!result.ok) {
            throw new Error(`Embedding API error: ${result.statusText}`);
          }

          return result.json();
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 5000,
          backoffMultiplier: 2,
        }
      );

      return response.embedding;
    } catch (error) {
      console.error('[MemoryClient] Embedding generation error:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add a memory to the vector store
   */
  async addMemory(request: MemoryAddRequest): Promise<Memory> {
    try {
      // Ensure collection is initialized
      await this.initialize();

      // Generate embedding
      const embedding = await this.generateEmbedding(request.content);

      // Create memory object
      // Use crypto.randomUUID() for proper UUID format that Qdrant accepts
      const { randomUUID } = await import('crypto');
      const memory: Memory = {
        id: randomUUID(),
        userId: request.userId,
        type: request.type || 'conversation',
        content: request.content,
        metadata: request.metadata || {},
        createdAt: new Date().toISOString(),
      };

      // Store in Qdrant
      // Qdrant accepts UUIDs with hyphens or positive integers
      // Use the UUID directly (with hyphens)
      await this.qdrant.upsert(this.collectionName, {
        points: [
          {
            id: memory.id,
            vector: embedding,
            payload: {
              userId: memory.userId,
              type: memory.type,
              content: memory.content,
              metadata: memory.metadata,
              createdAt: memory.createdAt,
            },
          },
        ],
        wait: true,
      });

      console.log(`[MemoryClient] Memory added: ${memory.id}`);
      return memory;
    } catch (error) {
      console.error('[MemoryClient] Add memory error:', error);
      throw new Error(`Failed to add memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search memories using semantic similarity
   */
  async searchMemories(request: MemorySearchRequest): Promise<Memory[]> {
    try {
      // Ensure collection is initialized
      await this.initialize();

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(request.query);

      // Build filter conditions
      const filter: any = {
        must: [
          {
            key: 'userId',
            match: { value: request.userId },
          },
        ],
      };

      // Add optional filters
      if (request.filters?.poiType) {
        filter.must.push({
          key: 'metadata.poiType',
          match: { value: request.filters.poiType },
        });
      }

      if (request.filters?.transportMode) {
        filter.must.push({
          key: 'metadata.transportMode',
          match: { value: request.filters.transportMode },
        });
      }

      // Search in Qdrant
      const searchResults = await this.qdrant.search(this.collectionName, {
        vector: queryEmbedding,
        limit: request.limit || 10,
        filter,
        score_threshold: request.scoreThreshold || 0.5,
        with_payload: true,
      });

      // Convert results to Memory objects
      const memories: Memory[] = searchResults.map((result: any) => ({
        id: result.id,
        userId: result.payload.userId,
        type: result.payload.type,
        content: result.payload.content,
        score: result.score,
        metadata: result.payload.metadata,
        createdAt: result.payload.createdAt,
      }));

      console.log(`[MemoryClient] Found ${memories.length} memories for query: "${request.query}"`);
      return memories;
    } catch (error) {
      console.error('[MemoryClient] Search memories error:', error);
      throw new Error(`Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all memories for a user
   */
  async getMemories(userId: string, limit = 50, offset = 0): Promise<Memory[]> {
    try {
      // Ensure collection is initialized
      await this.initialize();

      // Scroll through memories
      const scrollResult = await this.qdrant.scroll(this.collectionName, {
        filter: {
          must: [
            {
              key: 'userId',
              match: { value: userId },
            },
          ],
        },
        limit,
        offset,
        with_payload: true,
        with_vector: false,
      });

      const memories: Memory[] = scrollResult.points.map((point: any) => ({
        id: point.id,
        userId: point.payload.userId,
        type: point.payload.type,
        content: point.payload.content,
        metadata: point.payload.metadata,
        createdAt: point.payload.createdAt,
      }));

      return memories;
    } catch (error) {
      console.error('[MemoryClient] Get memories error:', error);
      throw new Error(`Failed to get memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a specific memory
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    try {
      await this.qdrant.delete(this.collectionName, {
        points: [memoryId],
      });

      console.log(`[MemoryClient] Memory deleted: ${memoryId}`);
      return true;
    } catch (error) {
      console.error('[MemoryClient] Delete memory error:', error);
      throw new Error(`Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete all memories for a user
   */
  async deleteUserMemories(userId: string): Promise<number> {
    try {
      const result = await this.qdrant.delete(this.collectionName, {
        filter: {
          must: [
            {
              key: 'userId',
              match: { value: userId },
            },
          ],
        },
      });

      console.log(`[MemoryClient] Deleted memories for user: ${userId}`);
      return 1; // Qdrant doesn't return count, return success indicator
    } catch (error) {
      console.error('[MemoryClient] Delete user memories error:', error);
      throw new Error(`Failed to delete user memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update a memory
   */
  async updateMemory(request: MemoryUpdateRequest): Promise<Memory> {
    try {
      // Get existing memory
      const existingPoints = await this.qdrant.retrieve(this.collectionName, {
        ids: [request.memoryId],
        with_payload: true,
      });

      if (existingPoints.length === 0) {
        throw new Error(`Memory not found: ${request.memoryId}`);
      }

      const existing: any = existingPoints[0];
      const updatedContent = request.content || existing.payload.content;
      const updatedMetadata = request.metadata
        ? { ...existing.payload.metadata, ...request.metadata }
        : existing.payload.metadata;

      // Generate new embedding if content changed
      let embedding = existing.vector;
      if (request.content && request.content !== existing.payload.content) {
        embedding = await this.generateEmbedding(updatedContent);
      }

      // Update in Qdrant
      await this.qdrant.upsert(this.collectionName, {
        points: [
          {
            id: request.memoryId,
            vector: embedding,
            payload: {
              ...existing.payload,
              content: updatedContent,
              metadata: updatedMetadata,
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      });

      const updatedMemory: Memory = {
        id: request.memoryId,
        userId: existing.payload.userId,
        type: existing.payload.type,
        content: updatedContent,
        metadata: updatedMetadata,
        createdAt: existing.payload.createdAt,
        updatedAt: new Date().toISOString(),
      };

      console.log(`[MemoryClient] Memory updated: ${request.memoryId}`);
      return updatedMemory;
    } catch (error) {
      console.error('[MemoryClient] Update memory error:', error);
      throw new Error(`Failed to update memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get memory context summary for a user
   * Aggregates preferences, frequent locations, and recent conversations
   */
  async getMemoryContext(userId: string): Promise<MemoryContextSummary> {
    try {
      const memories = await this.getMemories(userId, 100);

      // Extract preferences from memory
      const preferenceMemories = memories.filter((m) => m.type === 'preference');
      const conversationMemories = memories.filter((m) => m.type === 'conversation');
      const locationMemories = memories.filter((m) => m.type === 'location');

      // Aggregate preferences
      const preferences: UserPreferences = {
        favoriteTransport: [],
        favoritePOITypes: [],
        favoriteCuisines: [],
      };

      preferenceMemories.forEach((mem) => {
        if (mem.metadata?.transport) {
          preferences.favoriteTransport?.push(mem.metadata.transport);
        }
        if (mem.metadata?.poiType) {
          preferences.favoritePOITypes?.push(mem.metadata.poiType);
        }
        if (mem.metadata?.cuisine) {
          preferences.favoriteCuisines?.push(mem.metadata.cuisine);
        }
      });

      // Get recent conversations
      const recentConversations: ConversationMemory[] = conversationMemories
        .slice(0, 10)
        .map((mem) => ({
          id: mem.id,
          userId: mem.userId,
          query: mem.metadata?.query || mem.content,
          response: mem.metadata?.response || '',
          timestamp: mem.createdAt,
          context: mem.metadata,
        }));

      // Get location history
      const locationHistory: LocationMemory[] = locationMemories.slice(0, 20).map((mem) => ({
        id: mem.id,
        userId: mem.userId,
        location: mem.metadata?.location || { lat: 0, lng: 0, display_name: 'Unknown' },
        query: mem.metadata?.query || mem.content,
        poisFound: mem.metadata?.poisFound || [],
        timestamp: mem.createdAt,
        context: mem.metadata?.context || {
          timeOfDay: 'unknown',
          dayOfWeek: 'unknown',
        },
      }));

      return {
        userId,
        preferences,
        conversationMemories: recentConversations,
        locationHistory,
        relevantMemories: memories.slice(0, 50),
        frequentLocations: [],
      };
    } catch (error) {
      console.error('[MemoryClient] Get memory context error:', error);
      throw new Error(`Failed to get memory context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let memoryClient: MemoryClient | null = null;

export function getMemoryClient(): MemoryClient {
  if (!memoryClient) {
    memoryClient = new MemoryClient();
  }
  return memoryClient;
}

export async function initializeMemoryClient(): Promise<void> {
  const client = getMemoryClient();
  await client.initialize();
}
