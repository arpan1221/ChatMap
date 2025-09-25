export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { getServerMem0Service } from '@/src/lib/memory/mem0-server';
import type {
  ConversationMemory,
  Location,
  LocationFrequency,
  LocationMemory,
  Memory,
  UserPreferences,
} from '@/src/lib/types';

const DEFAULT_HISTORY_LIMIT = 20;

function resolveUserId(request: NextRequest, override?: string | null): string {
  if (override && override.trim().length > 0) {
    return override.trim();
  }

  const headerUserId =
    request.headers.get('x-user-id') ||
    request.headers.get('x-chatmap-user') ||
    request.headers.get('x-client-id');

  return headerUserId && headerUserId.trim().length > 0 ? headerUserId.trim() : 'anonymous-user';
}

function determineTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return 'late night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function deriveSuggestions(
  preferences: UserPreferences,
  locationHistory: LocationMemory[],
  frequentLocations: LocationFrequency[],
  conversationMemories: ConversationMemory[],
  limit = 6,
): string[] {
  const suggestions = new Set<string>();

  preferences.favoritePOITypes?.forEach((type) => {
    if (type) {
      suggestions.add(`Explore more ${type} spots nearby`);
    }
  });

  preferences.favoriteCuisines?.forEach((cuisine) => {
    if (cuisine) {
      suggestions.add(`Find ${cuisine} restaurants in the area`);
    }
  });

  preferences.favoriteTransport?.forEach((transport) => {
    if (transport) {
      suggestions.add(`Discover places accessible by ${transport}`);
    }
  });

  frequentLocations.slice(0, 3).forEach((freq) => {
    suggestions.add(`Return to ${freq.location.display_name}`);
  });

  conversationMemories.slice(0, 2).forEach((conv) => {
    if (conv.query.toLowerCase().includes('near')) {
      suggestions.add(`Find more places like what you searched for`);
    }
  });

  return Array.from(suggestions).slice(0, limit);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const resource = searchParams.get('resource');
    const userId = resolveUserId(request, searchParams.get('userId'));

    if (!resource) {
      return NextResponse.json(
        { success: false, error: 'Resource parameter is required' },
        { status: 400 }
      );
    }

    let mem0Service;
    try {
      mem0Service = await getServerMem0Service();
    } catch (error) {
      console.error('Failed to initialize mem0 service:', error);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Memory service initialization failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }

    switch (resource) {
      case 'insights': {
        try {
          const [preferences, locationHistory, frequentLocations, conversationMemories] = await Promise.all([
            mem0Service.getUserPreferences(userId),
            mem0Service.getLocationHistory(userId),
            mem0Service.getFrequentLocations(userId),
            mem0Service.getConversationContext(userId, DEFAULT_HISTORY_LIMIT),
          ]);

          const personalizedSuggestions = deriveSuggestions(
            preferences,
            locationHistory,
            frequentLocations,
            conversationMemories,
          );

          return NextResponse.json({
            success: true,
            data: {
              preferences,
              locationHistory,
              frequentLocations,
              conversationHighlights: conversationMemories,
              personalizedSuggestions,
            },
          });
        } catch (error) {
          console.error('Failed to fetch memory insights:', error);
          return NextResponse.json(
            { 
              success: false, 
              error: 'Failed to fetch memory insights',
              details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
          );
        }
      }

      case 'preferences': {
        const preferences = await mem0Service.getUserPreferences(userId);
        return NextResponse.json({ success: true, data: preferences });
      }

      case 'location-history': {
        const locationParam = searchParams.get('location');
        const location = locationParam ? JSON.parse(locationParam) : undefined;
        const history = await mem0Service.getLocationHistory(userId, location);
        return NextResponse.json({ success: true, data: history });
      }

      case 'conversation-context': {
        const limit = parseInt(searchParams.get('limit') || DEFAULT_HISTORY_LIMIT.toString(), 10);
        const context = await mem0Service.getConversationContext(userId, limit);
        return NextResponse.json({ success: true, data: context });
      }

      case 'frequent-locations': {
        const locations = await mem0Service.getFrequentLocations(userId);
        return NextResponse.json({ success: true, data: locations });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown resource: ${resource}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Memory GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve memory data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, userId, ...data } = body;

    if (!type || !userId) {
      return NextResponse.json(
        { success: false, error: 'Type and userId are required' },
        { status: 400 }
      );
    }

    const mem0Service = await getServerMem0Service();

    switch (type) {
      case 'location': {
        const memory: LocationMemory = {
          ...data.memory,
          context: {
            timeOfDay: determineTimeOfDay(new Date()),
            dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
            ...data.memory.context,
          },
        };
        const memoryId = await mem0Service.addLocationMemory(userId, memory);
        return NextResponse.json({ success: true, data: { memoryId } });
      }

      case 'conversation': {
        const { query, response, context } = data;
        const memoryId = await mem0Service.addConversationMemory(userId, query, response, context);
        return NextResponse.json({ success: true, data: { memoryId } });
      }

      case 'preference': {
        const { preferences } = data;
        const memoryId = await mem0Service.addPreferenceMemory(userId, preferences);
        return NextResponse.json({ success: true, data: { memoryId } });
      }

      case 'search': {
        const { query, limit = 10 } = data;
        const memories = await mem0Service.getRelevantMemories(userId, query, limit);
        return NextResponse.json({ success: true, data: memories });
      }

      case 'search-by-location': {
        const { location, radius } = data;
        const memories = await mem0Service.searchMemoriesByLocation(userId, location, radius);
        return NextResponse.json({ success: true, data: memories });
      }

      case 'search-by-poi-type': {
        const { poiType } = data;
        const memories = await mem0Service.searchMemoriesByPOIType(userId, poiType);
        return NextResponse.json({ success: true, data: memories });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown type: ${type}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Memory POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process memory request' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const resource = searchParams.get('resource');
    const userId = resolveUserId(request, searchParams.get('userId'));

    if (!resource) {
      return NextResponse.json(
        { success: false, error: 'Resource parameter is required' },
        { status: 400 }
      );
    }

    const mem0Service = await getServerMem0Service();

    switch (resource) {
      case 'all': {
        await mem0Service.clearUserMemories(userId);
        return NextResponse.json({ success: true, data: { message: 'All memories cleared' } });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown resource: ${resource}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Memory DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to clear memories' },
      { status: 500 }
    );
  }
}