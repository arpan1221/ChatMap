/**
 * Memory API Routes
 * Manage user memories with vector search and semantic retrieval
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMemoryClient } from '@/src/clients/memory-client';
import type { APIResponse, Memory, MemoryContextSummary } from '@/src/lib/types';
import { z } from 'zod';

export const runtime = 'nodejs';

// ============================================================================
// Validation Schemas
// ============================================================================

const addMemorySchema = z.object({
  userId: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(['location', 'conversation', 'preference', 'system']).optional(),
  metadata: z.record(z.any()).optional(),
});

const searchMemorySchema = z.object({
  userId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
  filters: z
    .object({
      poiType: z.string().optional(),
      transportMode: z.string().optional(),
      timeOfDay: z.string().optional(),
      dayOfWeek: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// POST /api/memory - Add a new memory
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, content, type, metadata } = addMemorySchema.parse(body);

    const memoryClient = getMemoryClient();
    const memory = await memoryClient.addMemory({
      userId,
      content,
      type,
      metadata,
    });

    return NextResponse.json({
      success: true,
      data: memory,
      message: 'Memory added successfully',
      timestamp: new Date().toISOString(),
    } as APIResponse<Memory>);
  } catch (error) {
    console.error('[Memory API] Add error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          message: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add memory',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/memory - Search or list memories
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId') || request.headers.get('X-User-Id');
    const query = searchParams.get('query');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');
    const resource = searchParams.get('resource');

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'userId parameter or X-User-Id header is required',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    const memoryClient = getMemoryClient();

    // Handle insights request - redirect to context endpoint
    if (resource === 'insights') {
      const context = await memoryClient.getMemoryContext(userId);
      
      // Transform context to match frontend expectations
      const insights = {
        preferences: context.preferences,
        conversationHighlights: context.conversationMemories.slice(0, 5), // Limit to recent 5
        locationHistory: context.locationHistory.slice(0, 10), // Limit to recent 10
        frequentLocations: context.frequentLocations,
        personalizedSuggestions: generatePersonalizedSuggestions(context),
      };

      return NextResponse.json({
        success: true,
        data: insights,
        timestamp: new Date().toISOString(),
      } as APIResponse);
    }

    // If query is provided, do semantic search
    if (query) {
      const memories = await memoryClient.searchMemories({
        userId,
        query,
        limit: limit ? parseInt(limit) : undefined,
      });

      return NextResponse.json({
        success: true,
        data: { memories, count: memories.length },
        timestamp: new Date().toISOString(),
      } as APIResponse);
    }

    // Otherwise, get all memories
    const memories = await memoryClient.getMemories(
      userId,
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined
    );

    return NextResponse.json({
      success: true,
      data: { memories, count: memories.length },
      timestamp: new Date().toISOString(),
    } as APIResponse);
  } catch (error) {
    console.error('[Memory API] Get error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memories',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

// Helper function to generate personalized suggestions based on memory context
function generatePersonalizedSuggestions(context: MemoryContextSummary): string[] {
  const suggestions: string[] = [];
  
  // Add suggestions based on preferences
  if (context.preferences?.favoriteTransport && context.preferences.favoriteTransport.length > 0) {
    suggestions.push(`Find places within 15 minutes by ${context.preferences.favoriteTransport[0]}`);
  }
  
  if (context.preferences?.favoritePOITypes && context.preferences.favoritePOITypes.length > 0) {
    const poiType = context.preferences.favoritePOITypes[0];
    suggestions.push(`Show me the nearest ${poiType}`);
  }
  
  // Add suggestions based on frequent locations
  if (context.frequentLocations?.length > 0) {
    const location = context.frequentLocations[0];
    suggestions.push(`Find restaurants near ${location.location.display_name}`);
  }
  
  // Add suggestions based on conversation history
  if (context.conversationMemories?.length > 0) {
    suggestions.push(`Find similar places to what I've searched before`);
  }
  
  // Default suggestions if no context
  if (suggestions.length === 0) {
    suggestions.push(
      "Find restaurants within 15 minutes walk",
      "Show me the nearest coffee shop",
      "Find gas stations near me"
    );
  }
  
  return suggestions.slice(0, 3); // Limit to 3 suggestions
}

// ============================================================================
// DELETE /api/memory - Delete memories
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');
    const memoryId = searchParams.get('memoryId');
    const resource = searchParams.get('resource');

    // Handle resource=all case (from frontend)
    if (resource === 'all') {
      const userIdFromHeader = request.headers.get('X-User-Id');
      if (!userIdFromHeader) {
        return NextResponse.json(
          {
            success: false,
            error: 'X-User-Id header is required for resource=all',
            timestamp: new Date().toISOString(),
          } as APIResponse,
          { status: 400 }
        );
      }
      
      const memoryClient = getMemoryClient();
      await memoryClient.deleteUserMemories(userIdFromHeader);
      return NextResponse.json({
        success: true,
        message: 'All user memories deleted successfully',
        timestamp: new Date().toISOString(),
      } as APIResponse);
    }

    if (!userId && !memoryId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either userId or memoryId parameter is required',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    const memoryClient = getMemoryClient();

    // Delete specific memory
    if (memoryId) {
      await memoryClient.deleteMemory(memoryId);
      return NextResponse.json({
        success: true,
        message: 'Memory deleted successfully',
        timestamp: new Date().toISOString(),
      } as APIResponse);
    }

    // Delete all user memories
    if (userId) {
      await memoryClient.deleteUserMemories(userId);
      return NextResponse.json({
        success: true,
        message: 'All user memories deleted successfully',
        timestamp: new Date().toISOString(),
      } as APIResponse);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Invalid request',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 400 }
    );
  } catch (error) {
    console.error('[Memory API] Delete error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete memory',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT /api/memory - Update a memory
// ============================================================================

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { memoryId, content, metadata } = body;

    if (!memoryId) {
      return NextResponse.json(
        {
          success: false,
          error: 'memoryId is required',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    const memoryClient = getMemoryClient();
    const updatedMemory = await memoryClient.updateMemory({
      memoryId,
      content,
      metadata,
    });

    return NextResponse.json({
      success: true,
      data: updatedMemory,
      message: 'Memory updated successfully',
      timestamp: new Date().toISOString(),
    } as APIResponse<Memory>);
  } catch (error) {
    console.error('[Memory API] Update error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update memory',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}
