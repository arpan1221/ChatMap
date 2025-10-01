/**
 * Memory Context API
 * Get comprehensive memory context for a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMemoryClient } from '@/src/clients/memory-client';
import type { APIResponse, MemoryContextSummary } from '@/src/lib/types';

export const runtime = 'nodejs';

/**
 * GET /api/memory/context?userId=xxx
 * Get memory context summary for a user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'userId parameter is required',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    const memoryClient = getMemoryClient();
    const context = await memoryClient.getMemoryContext(userId);

    return NextResponse.json({
      success: true,
      data: context,
      timestamp: new Date().toISOString(),
    } as APIResponse<MemoryContextSummary>);
  } catch (error) {
    console.error('[Memory Context API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memory context',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}
