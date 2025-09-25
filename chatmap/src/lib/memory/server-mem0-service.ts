/**
 * Server-only wrapper for Mem0Service
 * This ensures the memory service is only loaded on the server-side
 */

import type { Mem0Service } from './mem0-service';

let serverMem0Service: Mem0Service | null = null;

export function getServerMem0Service(): Mem0Service {
  if (typeof window !== 'undefined') {
    throw new Error('Memory service can only be used on the server-side');
  }

  if (!serverMem0Service) {
    // Dynamic import to ensure it's only loaded on server-side
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMem0Service } = require('./mem0-service');
    serverMem0Service = getMem0Service();
  }

  return serverMem0Service!;
}
