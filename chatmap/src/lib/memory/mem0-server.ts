/**
 * Server-side only mem0ai service
 * This file should NEVER be imported on the client-side
 */

import type { Mem0Service } from './mem0-service';

let serverMem0Service: Mem0Service | null = null;

export async function getServerMem0Service(): Promise<Mem0Service> {
  // Ensure this only runs on server-side
  if (typeof window !== 'undefined') {
    throw new Error('Server memory service cannot be used on the client-side');
  }

  if (!serverMem0Service) {
    // Dynamic import to ensure it's only loaded on server-side
    try {
      // Use dynamic import instead of require for better compatibility
      const mem0ServiceModule = await import('./mem0-service');
      if (typeof mem0ServiceModule.getMem0Service === 'function') {
        serverMem0Service = mem0ServiceModule.getMem0Service();
      } else {
        throw new Error('getMem0Service function not found in mem0-service module');
      }
    } catch (error) {
      console.error('Failed to load mem0-service:', error);
      throw new Error(`Failed to initialize memory service: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return serverMem0Service!;
}

// Re-export types for server-side use
export type { Mem0Service } from './mem0-service';
