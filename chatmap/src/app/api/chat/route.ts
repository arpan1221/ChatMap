/**
 * Chat API Route
 * Handles query parsing and response generation
 * This is a compatibility layer for the frontend
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOllamaClient } from '@/src/clients/ollama-client';
import type { APIResponse, ParsedQuery, Location, POI, IsochroneData, ChatMessage } from '@/src/lib/types';

export const runtime = 'nodejs';

// Parse query request/response types
interface ParseQueryRequest {
  type: 'parse';
  message: string;
  location: Location;
  conversationHistory?: ChatMessage[];
  userId?: string;
  memoryEnabled?: boolean;
}

interface ParseQueryResponse {
  parsedQuery: ParsedQuery;
  memoryContext?: Record<string, unknown>;
  preferenceSignals?: Record<string, unknown>;
  personalizedSuggestions?: string[];
}

// Generate response request/response types
interface GenerateResponseRequest {
  type: 'respond';
  query: ParsedQuery;
  pois: POI[];
  isochroneData: IsochroneData;
  conversationHistory?: ChatMessage[];
  userId?: string;
  memoryEnabled?: boolean;
}

interface GenerateResponseResponse {
  response: string;
  memoryContext?: Record<string, unknown>;
  preferenceSignals?: Record<string, unknown>;
  personalizedSuggestions?: string[];
}

/**
 * POST /api/chat
 * Handles both parse and respond actions
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type } = body;

    if (type === 'parse') {
      return handleParse(body as ParseQueryRequest);
    } else if (type === 'respond') {
      return handleRespond(body as GenerateResponseRequest);
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid type. Must be "parse" or "respond"',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process chat request',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

/**
 * Handle query parsing
 */
async function handleParse(req: ParseQueryRequest): Promise<NextResponse> {
  const { message, location } = req;

  try {
    const ollama = getOllamaClient();

    // Simple prompt for query parsing
    const prompt = `You are a location query parser. Extract the following from the user's query:

RULES:
1. poiType: Use ONLY these exact values:
   - "cafe" for coffee shops, cafes, coffee, starbucks
   - "restaurant" for restaurants, dining, food
   - "pharmacy" for pharmacies, drugstores
   - "hospital" for hospitals, medical centers
   - "park" for parks, gardens
   - "gym" for gyms, fitness centers
   - "gas_station" for gas stations, petrol stations
   - "grocery" for grocery stores, supermarkets
   - "shopping" for shops, malls, stores
   - "bank" for banks
   - "atm" for ATMs

2. timeMinutes: Extract the time (default 15 if not mentioned)

3. transport: "walking", "driving", or "cycling" (default "walking")

4. searchStrategy: CRITICAL RULE:
   - "all_within_time" → If query mentions "within", "in X minutes", or asks for multiple places
   - "nearest_only" → ONLY if query explicitly says "nearest" or "closest" WITHOUT any time constraint
   - "find-enroute" → If query mentions "on the way", "grab X on the way", "quick bite on the way", "before going to"

5. keywords: Array of additional search terms like cuisine types, features, or brand names
   Example: "mexican restaurant" → keywords: ["mexican"]
   Example: "24 hour pharmacy" → keywords: ["24 hour"]

6. cuisine: Specific cuisine type for restaurant queries (e.g., "mexican", "italian", "chinese")

CRITICAL: For queries like "X near/close to Y" (multi-step queries):
- PRIMARY POI (X) = What the user WANTS TO FIND → goes in poiType
- SECONDARY POI (Y) = The reference point / anchor → goes in keywords
- Pattern: "show me X near Y" → X is primary, Y is secondary

Examples:
- "show me cafes near hospital" → poiType: "cafe", keywords: ["hospital"]
- "mexican restaurant near starbucks" → poiType: "restaurant", cuisine: "mexican", keywords: ["cafe"]
- "pharmacy close to park" → poiType: "pharmacy", keywords: ["park"]
- "find restaurants near the nearest hospital" → poiType: "restaurant", keywords: ["hospital"]

IMPORTANT: The word "nearest" usually modifies the SECONDARY POI, not the primary one!

User location: ${location.display_name}
Query: "${message}"

EXAMPLES:
✓ "Find coffee shops within 15 minutes walk" → {poiType: "cafe", searchStrategy: "all_within_time", timeMinutes: 15, keywords: []}
✓ "Where are the nearest pharmacies?" → {poiType: "pharmacy", searchStrategy: "nearest_only", timeMinutes: 10, keywords: []}
✓ "mexican restaurant closest to starbucks" → {poiType: "restaurant", searchStrategy: "nearest_only", timeMinutes: 15, cuisine: "mexican", keywords: ["starbucks"]}
✓ "Find italian food in 20 minutes" → {poiType: "restaurant", searchStrategy: "all_within_time", timeMinutes: 20, cuisine: "italian", keywords: []}
✓ "want to grab a quick bite on the way downtown" → {poiType: "restaurant", searchStrategy: "find-enroute", timeMinutes: 45, keywords: ["downtown"]}

Respond with ONLY JSON (no markdown):
{
  "poiType": "cafe",
  "timeMinutes": 15,
  "transport": "walking",
  "searchStrategy": "all_within_time",
  "keywords": [],
  "cuisine": ""
}`;

    const response = await ollama.generate({
      model: 'llama3.2:3b',
      prompt,
      stream: false,
    });

    // Parse the response
    let parsedData;
    try {
      // Extract JSON from response
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('[Chat API] Failed to parse LLM response:', parseError);
      // Fallback parsing - check query intent
      const lowerMessage = message.toLowerCase();
      
      // Priority: time constraints override "nearest" keywords
      const hasTimeConstraint = lowerMessage.match(/within|in\s+\d+|for\s+\d+/);
      const hasNearestKeyword = lowerMessage.match(/nearest|closest/);
      
      const searchStrategy = hasTimeConstraint 
        ? 'all_within_time' 
        : hasNearestKeyword 
          ? 'nearest_only' 
          : 'all_within_time';
      
      parsedData = {
        poiType: 'cafe',
        timeMinutes: 15,
        transport: 'walking',
        searchStrategy,
      };
    }

    // Validate and fix search strategy based on query keywords
    if (!parsedData.searchStrategy || parsedData.searchStrategy === 'time_based') {
      const lowerMessage = message.toLowerCase();
      const hasTimeConstraint = lowerMessage.match(/within|in\s+\d+|for\s+\d+/);
      const hasNearestKeyword = lowerMessage.match(/nearest|closest/);
      
      // Time constraints take priority over "nearest" keywords
      parsedData.searchStrategy = hasTimeConstraint 
        ? 'all_within_time' 
        : hasNearestKeyword 
          ? 'nearest_only' 
          : 'all_within_time';
    }

    const parsedQuery: ParsedQuery = {
      poiType: parsedData.poiType || 'restaurant',
      timeMinutes: parsedData.timeMinutes || (parsedData.searchStrategy === 'nearest_only' ? 10 : 15),
      transport: (parsedData.transport || 'walking') as 'walking' | 'driving' | 'cycling',
      location: location,
      searchStrategy: parsedData.searchStrategy as 'nearest_only' | 'all_within_time',
      keywords: parsedData.keywords || [],
      cuisine: parsedData.cuisine || undefined,
    };

    const result: ParseQueryResponse = {
      parsedQuery,
      memoryContext: {},
      preferenceSignals: {},
      personalizedSuggestions: [],
    };

    // Wrap in APIResponse format for frontend
    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    } as APIResponse);
  } catch (error) {
    console.error('[Chat API] Parse error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse query',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

/**
 * Handle response generation
 */
async function handleRespond(req: GenerateResponseRequest): Promise<NextResponse> {
  const { query, pois, isochroneData } = req;

  try {
    const ollama = getOllamaClient();

    // Generate natural language response with detailed POI information
    const poiDetails = pois.slice(0, 5).map((poi, index) => {
      const distance = poi.distance ? `${(poi.distance / 1000).toFixed(2)} km` : 'Unknown distance';
      const duration = poi.durations ? 
        Object.entries(poi.durations)
          .map(([mode, time]) => `${mode}: ${time}min`)
          .join(', ') : 
        'Unknown duration';
      
      return `${index + 1}. ${poi.name} (${poi.type}) - ${distance} away, ${duration}`;
    }).join('\n');

    const prompt = `You are a helpful location assistant. The user asked about "${query.poiType}".

Found ${pois.length} places within ${query.timeMinutes} minutes by ${query.transport}.

Here are the top results:
${poiDetails}

Generate a friendly, informative response (3-4 sentences) that:
1. Acknowledges the search
2. Highlights the top 2-3 most interesting places
3. Mentions any special features (like cuisine, amenities, etc.)
4. Suggests next steps like "Click on any marker for directions" or "Ask for more details about a specific place"

Be conversational and helpful.`;

    const response = await ollama.generate({
      model: 'llama3.2:3b',
      prompt,
      stream: false,
    });

    const result: GenerateResponseResponse = {
      response: response.response.trim(),
      memoryContext: {},
      preferenceSignals: {},
      personalizedSuggestions: [],
    };

    // Wrap in APIResponse format for frontend
    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    } as APIResponse);
  } catch (error) {
    console.error('[Chat API] Respond error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate response',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat
 * Health check
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Chat API is running. Use POST to parse or respond.',
    timestamp: new Date().toISOString(),
  });
}
