/**
 * Memory service exports
 * Provides clean imports for both client and server-side memory operations
 */

// Client-side exports (safe for browser)
export { getClientMemoryService } from './client-memory-service';
export { useMemory } from './use-memory';
export type { ClientMemoryService } from './client-memory-service';
export type { UseMemoryReturn } from './use-memory';

// Server-side exports (Node.js only)
export { getServerMem0Service } from './mem0-server';
export type { Mem0Service } from './mem0-service';

// Re-export types that are safe for both client and server
export type {
  ConversationMemory,
  Location,
  LocationFrequency,
  LocationMemory,
  Memory,
  UserPreferences,
} from '@/src/lib/types';
