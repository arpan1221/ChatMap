export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  OllamaRequest,
  OllamaResponse,
  ParsedQuery,
  POI,
  ChatMessage,
  UserPreferences,
  LocationMemory,
  MemoryContextSummary,
} from '@/src/lib/types';
import { getServerMem0Service } from '@/src/lib/memory/mem0-server';
import type { Mem0Service } from '@/src/lib/memory/mem0-service';

// Ollama configuration
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// Request types
type ChatRequestType = 'parse' | 'respond';

interface ParseRequest {
  type: 'parse';
  message: string;
  location?: {
    lat: number;
    lng: number;
    display_name: string;
  };
  conversationHistory?: ChatMessage[];
  userId?: string;
  memoryEnabled?: boolean;
}

interface RespondRequest {
  type: 'respond';
  query: ParsedQuery;
  pois: POI[];
  isochroneData?: any;
  conversationHistory?: ChatMessage[];
  userId?: string;
  memoryEnabled?: boolean;
}

type ChatRequest = ParseRequest | RespondRequest;

interface ParseResponseData {
  parsedQuery: ParsedQuery;
  memoryContext: MemoryContextSummary;
  preferenceSignals: UserPreferences;
  personalizedSuggestions: string[];
  recordedMemoryIds?: {
    preferenceId?: string;
  };
}

interface RespondResponseData {
  response: string;
  memoryContext: MemoryContextSummary;
  preferenceSignals: UserPreferences;
  personalizedSuggestions: string[];
  recordedMemoryIds: {
    conversationId?: string;
    locationId?: string;
    preferenceId?: string;
  };
}

const KNOWN_POI_TYPES: Set<ParsedQuery['poiType']> = new Set([
  'restaurant',
  'cafe',
  'grocery',
  'pharmacy',
  'hospital',
  'school',
  'park',
  'gym',
  'bank',
  'atm',
  'gas_station',
  'shopping',
  'entertainment',
  'transport',
  'accommodation',
  'other',
]);

function hasPreferenceSignals(preferences: UserPreferences): boolean {
  return Object.entries(preferences).some(([key, value]) => {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  });
}

function preferencesChanged(newPrefs: UserPreferences, oldPrefs: UserPreferences): boolean {
  const keys = new Set([
    ...Object.keys(newPrefs as Record<string, any>),
    ...Object.keys(oldPrefs as Record<string, any>),
  ]);

  for (const key of keys) {
    const newValue = (newPrefs as Record<string, any>)[key];
    const oldValue = (oldPrefs as Record<string, any>)[key];

    if (Array.isArray(newValue) || Array.isArray(oldValue)) {
      const newArray = Array.isArray(newValue) ? newValue : [];
      const oldArray = Array.isArray(oldValue) ? oldValue : [];
      if (newArray.length !== oldArray.length) return true;
      const newSet = new Set(newArray);
      const oldSet = new Set(oldArray);
      for (const item of newSet) {
        if (!oldSet.has(item)) return true;
      }
      for (const item of oldSet) {
        if (!newSet.has(item)) return true;
      }
      continue;
    }

    if (
      newValue &&
      oldValue &&
      typeof newValue === 'object' &&
      typeof oldValue === 'object'
    ) {
      if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
        return true;
      }
      continue;
    }

    if (newValue !== oldValue) {
      return true;
    }
  }

  return false;
}

async function loadMemoryContext(
  mem0Service: Mem0Service,
  userId: string,
  message?: string,
  limit: number = 6,
): Promise<MemoryContextSummary> {
  const fallback: MemoryContextSummary = {
    userId,
    preferences: {},
    conversationMemories: [],
    locationHistory: [],
    relevantMemories: [],
    frequentLocations: [],
  };

  try {
    const [preferences, conversationMemories, locationHistory, frequentLocations] = await Promise.all([
      mem0Service.getUserPreferences(userId),
      mem0Service.getConversationContext(userId, limit),
      mem0Service.getLocationHistory(userId),
      mem0Service.getFrequentLocations(userId),
    ]);

    const relevantMemories = message
      ? await mem0Service.getRelevantMemories(userId, message, limit)
      : [];

    return {
      userId,
      preferences,
      conversationMemories,
      locationHistory,
      relevantMemories,
      frequentLocations,
    };
  } catch (error) {
    console.error('[Mem0] Failed to load memory context:', error);
    return fallback;
  }
}

function buildMemoryContextPrompt(context?: MemoryContextSummary): string {
  if (!context) {
    return '';
  }

  const sections: string[] = [];

  const { preferences, locationHistory, conversationMemories, frequentLocations } = context;

  if (preferences) {
    const prefDetails: string[] = [];
    if (preferences.favoritePOITypes?.length) {
      prefDetails.push(`Prefers: ${preferences.favoritePOITypes.join(', ')}`);
    }
    if (preferences.favoriteTransport?.length) {
      prefDetails.push(`Transport: ${preferences.favoriteTransport.join(', ')}`);
    }
    if (preferences.dietaryRestrictions?.length) {
      prefDetails.push(`Dietary: ${preferences.dietaryRestrictions.join(', ')}`);
    }
    if (preferences.budgetPreference && preferences.budgetPreference !== 'any') {
      prefDetails.push(`Budget: ${preferences.budgetPreference}`);
    }
    if (preferences.accessibilityNeeds?.length) {
      prefDetails.push(`Accessibility: ${preferences.accessibilityNeeds.join(', ')}`);
    }
    if (prefDetails.length > 0) {
      sections.push(`User preferences: ${prefDetails.join(' | ')}`);
    }
  }

  if (frequentLocations.length > 0) {
    const topLocations = frequentLocations
      .slice(0, 3)
      .map(
        (entry) =>
          `${entry.location.display_name} (${entry.count} visits${entry.poiTypes?.length ? `, likes ${entry.poiTypes.join(', ')}` : ''})`,
      )
      .join('; ');
    sections.push(`Frequent locations: ${topLocations}`);
  }

  if (locationHistory.length > 0) {
    const recentLocations = locationHistory
      .slice(-3)
      .map((memory) => `${memory.location.display_name} for ${memory.query}`)
      .join('; ');
    sections.push(`Recent location searches: ${recentLocations}`);
  }

  if (conversationMemories.length > 0) {
    const lastConversation = conversationMemories
      .slice(-2)
      .map((memory) => `Q: ${memory.query} | A: ${memory.response}`)
      .join('\n');
    sections.push(`Recent conversation context:\n${lastConversation}`);
  }

  return sections.length > 0 ? `\n\nUser memory profile:\n${sections.join('\n')}` : '';
}

function determineTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return 'late night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function buildLocationMemoryRecord(
  userId: string,
  userMessage: string,
  parsedQuery: ParsedQuery,
  pois: POI[],
): LocationMemory {
  const now = new Date();

  return {
    id: `${userId}-${now.getTime()}`,
    userId,
    location: parsedQuery.location,
    query: userMessage || `Looking for ${parsedQuery.poiType}`,
    poisFound: pois,
    selectedPOI: pois[0],
    satisfaction: undefined,
    timestamp: now.toISOString(),
    context: {
      timeOfDay: determineTimeOfDay(now),
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      activity: parsedQuery.keywords && parsedQuery.keywords.length > 0 ? parsedQuery.keywords[0] : undefined,
      transportMode: parsedQuery.transport,
    },
  };
}

function derivePersonalizedSuggestions(context: MemoryContextSummary, limit = 5): string[] {
  const suggestions = new Set<string>();

  context.frequentLocations.slice(0, 3).forEach((entry) => {
    suggestions.add(`Places near ${entry.location.display_name}`);
  });

  context.preferences.favoritePOITypes?.forEach((type) => {
    if (type) {
      suggestions.add(`Find more ${type} spots`);
    }
  });

  context.preferences.favoriteCuisines?.forEach((cuisine) => {
    suggestions.add(`Show ${cuisine} restaurants again`);
  });

  const recentLocations = context.locationHistory.slice(-3);
  recentLocations.forEach((memory) => {
    if (memory.context?.timeOfDay) {
      suggestions.add(`Similar places for ${memory.context.timeOfDay}`);
    }
    suggestions.add(`More like ${memory.location.display_name}`);
  });

  context.conversationMemories.slice(-2).forEach((memory) => {
    if (memory.extractedPreferences?.favoriteTransport?.length) {
      suggestions.add(`Plan a route by ${memory.extractedPreferences.favoriteTransport[0]}`);
    }
  });

  return Array.from(suggestions).slice(0, limit);
}

function getLatestUserMessage(conversationHistory?: ChatMessage[]): string {
  if (!conversationHistory || conversationHistory.length === 0) {
    return '';
  }

  for (let i = conversationHistory.length - 1; i >= 0; i -= 1) {
    if (conversationHistory[i].role === 'user') {
      return conversationHistory[i].content;
    }
  }

  return '';
}

function derivePreferencesFromQuery(
  parsedQuery: ParsedQuery,
  originalMessage: string,
  context?: MemoryContextSummary,
): UserPreferences {
  const preferences: UserPreferences = {};

  if (parsedQuery.transport) {
    preferences.favoriteTransport = [parsedQuery.transport];
  }

  if (parsedQuery.poiType && parsedQuery.poiType !== 'other') {
    preferences.favoritePOITypes = [parsedQuery.poiType];
  }

  if (parsedQuery.cuisine && parsedQuery.cuisine !== 'none') {
    preferences.favoriteCuisines = [parsedQuery.cuisine];
  }

  if (parsedQuery.priceRange) {
    preferences.budgetPreference =
      parsedQuery.priceRange === 'budget'
        ? 'low'
        : parsedQuery.priceRange === 'upscale'
        ? 'high'
        : parsedQuery.priceRange === 'moderate'
        ? 'medium'
        : 'any';
  }

  const lowered = originalMessage.toLowerCase();
  if (lowered.includes('wheelchair') || lowered.includes('accessible')) {
    preferences.accessibilityNeeds = ['wheelchair_access'];
  }

  if (lowered.includes('parking')) {
    preferences.parkingPreference = 'preferred';
  }

  if (lowered.includes('budget') || lowered.includes('cheap')) {
    preferences.budgetPreference = 'low';
  }

  if (context?.preferences) {
    return {
      ...context.preferences,
      ...preferences,
      favoriteTransport: preferences.favoriteTransport
        ? Array.from(
            new Set([
              ...(context.preferences.favoriteTransport ?? []),
              ...preferences.favoriteTransport,
            ]),
          )
        : context.preferences.favoriteTransport,
      favoritePOITypes: preferences.favoritePOITypes
        ? Array.from(
            new Set([
              ...(context.preferences.favoritePOITypes ?? []),
              ...preferences.favoritePOITypes,
            ]),
          )
        : context.preferences.favoritePOITypes,
      favoriteCuisines: preferences.favoriteCuisines
        ? Array.from(
            new Set([
              ...(context.preferences.favoriteCuisines ?? []),
              ...preferences.favoriteCuisines,
            ]),
          )
        : context.preferences.favoriteCuisines,
      dietaryRestrictions: context.preferences.dietaryRestrictions,
    };
  }

  return preferences;
}

// ============================================================================
// OLLAMA API INTEGRATION
// ============================================================================

async function callOllama(prompt: string, options: Partial<OllamaRequest['options']> = {}): Promise<string> {
  const requestBody: OllamaRequest = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: {
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 1000,
      ...options,
    },
  };

  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data: OllamaResponse = await response.json();
    return data.response.trim();
  } catch (error) {
    console.error('Ollama API error:', error);
    throw new Error('Failed to connect to Ollama. Please ensure Ollama is running on localhost:11434');
  }
}

// ============================================================================
// QUERY PARSING
// ============================================================================

// Helper function to fix common JSON issues
function fixCommonJsonIssues(jsonString: string): string {
  let fixed = jsonString.trim();
  
  // Fix trailing commas before closing braces/brackets
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix unescaped quotes in strings
  fixed = fixed.replace(/([^\\])"([^"]*)"([^\\])/g, (match, before, content, after) => {
    // Only fix if it's not already properly escaped
    if (!content.includes('\\"')) {
      return `${before}"${content.replace(/"/g, '\\"')}"${after}`;
    }
    return match;
  });
  
  // Fix missing quotes around property names
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  
  // Fix single quotes to double quotes
  fixed = fixed.replace(/'/g, '"');
  
  // Fix unescaped backslashes
  fixed = fixed.replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2');
  
  // Fix missing commas between properties
  fixed = fixed.replace(/"\s*}\s*"/g, '", "');
  fixed = fixed.replace(/"\s*}\s*{/g, '", {');
  
  // Ensure all required fields are present with defaults
  const requiredFields = {
    'poiType': '"other"',
    'transport': '"walking"',
    'timeMinutes': '15',
    'location': '{"lat":0,"lng":0,"display_name":"Unknown Location"}',
    'keywords': '[]',
    'cuisine': '"none"',
    'priceRange': '"any"',
    'searchStrategy': '"all_within_time"'
  };
  
  // Add missing required fields
  for (const [field, defaultValue] of Object.entries(requiredFields)) {
    if (!fixed.includes(`"${field}"`)) {
      // Find the last closing brace and add the field before it
      const lastBraceIndex = fixed.lastIndexOf('}');
      if (lastBraceIndex > 0) {
        const beforeBrace = fixed.substring(0, lastBraceIndex);
        const afterBrace = fixed.substring(lastBraceIndex);
        
        // Check if we need to add a comma
        const needsComma = !beforeBrace.trim().endsWith(',') && !beforeBrace.trim().endsWith('{');
        const comma = needsComma ? ',' : '';
        
        fixed = beforeBrace + comma + `"${field}":${defaultValue}` + afterBrace;
      }
    }
  }
  
  return fixed;
}

async function parseQuery(
  message: string,
  location?: ParseRequest['location'],
  conversationHistory?: ChatMessage[],
  memoryContext?: MemoryContextSummary,
): Promise<ParsedQuery> {
  const queryLower = message.toLowerCase();
  const locationContext = location
    ? `User is located at: ${location.display_name} (${location.lat}, ${location.lng})`
    : 'User location is not specified';
  const memoryContextPrompt = buildMemoryContextPrompt(memoryContext);

  // Build enhanced conversation context for better follow-up query handling
  const conversationContext = conversationHistory && conversationHistory.length > 0 
    ? `\n\nPrevious conversation context (last 3 messages):\n${conversationHistory.slice(-3).map(msg => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
      ).join('\n')}\n\nCurrent user message: "${message}"\n\nIMPORTANT: If the current message is a follow-up question (like "how about 15 mins drive?" or "what about walking distance?"), maintain the context from the previous query but update the specific parameter mentioned.`
    : `\n\nCurrent user message: "${message}"`;

  const parsePrompt = `You are an advanced location query parser. Extract structured information from natural language queries about finding places.

${locationContext}${memoryContextPrompt}${conversationContext}

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any code, explanations, or other text. Just the JSON.

CRITICAL: The JSON must include ALL required fields: poiType, transport, timeMinutes, location, keywords, cuisine, and priceRange.

TRANSPORT MODE: Choose ONLY ONE transport mode. If the query mentions multiple modes, pick the most appropriate one (e.g., if "walking or driving" is mentioned, choose "walking" for shorter distances, "driving" for longer ones).

FOOD QUERY DETECTION: If the query contains a cuisine type (mexican, italian, chinese, etc.) + any food-related word (places, food, restaurants, spots, etc.), ALWAYS set poiType to "restaurant" and cuisine to the specific type.

Return ONLY a JSON object with this exact structure:
{
  "poiType": "restaurant|cafe|grocery|pharmacy|hospital|school|park|gym|bank|atm|gas_station|shopping|entertainment|transport|accommodation|other",
  "transport": "walking", // Choose ONE mode: walking, driving, cycling, or public_transport
  "timeMinutes": number,
  "location": {
    "lat": number,
    "lng": number,
    "display_name": string
  },
  "keywords": ["keyword1", "keyword2"],
  "cuisine": "mexican|italian|chinese|indian|japanese|thai|american|french|mediterranean|other|none",
  "priceRange": "budget|moderate|upscale|any",
  "searchStrategy": "all_within_time|nearest_only" // Default to "all_within_time", use "nearest_only" for "closest", "nearest", "any closer" queries
}

Rules:
- poiType: Choose the most specific category that matches the query. 
  * If the user mentions ANY food-related terms with a cuisine type (mexican, italian, chinese, etc.), ALWAYS use "restaurant" as poiType.
  * Food-related terms include: restaurants, places, food, cuisine, dining, eateries, spots, joints, etc.
  * Examples: "mexican places" → restaurant, "italian food" → restaurant, "chinese spots" → restaurant
- transport: Default to "walking" unless specified otherwise. If previous conversation mentioned a transport mode, maintain it unless changed.
- timeMinutes: Extract time limit (5-60 minutes), default to 15 if not specified. If user asks about a different time (e.g., "how about 15 minutes?"), use that time.
- location: Use provided location or extract from query if mentioned
- keywords: Extract specific search terms (e.g., "mexican", "24 hour", "organic", "vegan", "close by", "nearby", "places")
- cuisine: Extract cuisine type if mentioned, "none" if not specified. Common cuisines: mexican, italian, chinese, indian, japanese, thai, american, french, mediterranean
- priceRange: Extract price level if mentioned, "any" if not specified
- searchStrategy: Use "nearest_only" for queries like "closest", "nearest", "any closer ones", "nearest one". Default to "all_within_time" for all other queries.
- If location is not provided and not in query, use lat: 0, lng: 0, display_name: "Unknown Location"
- CONTEXTUAL FOLLOW-UP HANDLING: For follow-up queries, maintain context from previous conversation:
  * If user asks "how about 15 mins drive?" after "find coffee shops within 15 mins walk", keep poiType="cafe" but change transport="driving" and timeMinutes=15
  * If user asks "what about walking distance?" after "show me restaurants I can drive to", keep poiType="restaurant" but change transport="walking"
  * If user asks "how about 20 minutes?" after any query, keep everything the same but update timeMinutes=20
  * If user asks "any closer ones?" or "nearest one?", keep everything the same but set searchStrategy to "nearest_only"
- CRITICAL: ANY query mentioning a cuisine type + food-related word = restaurant. "mexican places" = restaurant, "italian food" = restaurant, "chinese spots" = restaurant.

Examples:
- "Find mexican restaurants within 20 minutes walk" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 20, "keywords": ["mexican"], "cuisine": "mexican", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "mexican restaurants close by" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": ["mexican", "close by"], "cuisine": "mexican", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "mexican places close by" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": ["mexican", "places", "close by"], "cuisine": "mexican", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "italian food near me" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": ["italian"], "cuisine": "italian", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "chinese places nearby" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": ["chinese", "nearby"], "cuisine": "chinese", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "thai spots around here" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": ["thai", "spots"], "cuisine": "thai", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "Coffee shops I can drive to in 10 minutes" → {"poiType": "cafe", "transport": "driving", "timeMinutes": 10, "keywords": [], "cuisine": "none", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "Nearby 24 hour pharmacies" → {"poiType": "pharmacy", "transport": "walking", "timeMinutes": 15, "keywords": ["24 hour"], "cuisine": "none", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- "Upscale italian restaurants near me" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": ["upscale", "italian"], "cuisine": "italian", "priceRange": "upscale", "searchStrategy": "all_within_time", "location": {...}}
- "Find the nearest coffee shop" → {"poiType": "cafe", "transport": "walking", "timeMinutes": 15, "keywords": [], "cuisine": "none", "priceRange": "any", "searchStrategy": "nearest_only", "location": {...}}

Context-aware examples:
- Previous: "Find me gyms within 10 minutes walk" → Current: "how about 15 minutes?" → {"poiType": "gym", "transport": "walking", "timeMinutes": 15, "keywords": [], "cuisine": "none", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- Previous: "Show me restaurants I can drive to" → Current: "what about walking distance?" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 15, "keywords": [], "cuisine": "none", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- Previous: "Find coffee shops within 15 mins walk" → Current: "how about 15 mins drive?" → {"poiType": "cafe", "transport": "driving", "timeMinutes": 15, "keywords": [], "cuisine": "none", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- Previous: "Find mexican restaurants within 20 minutes walk" → Current: "any closer ones?" → {"poiType": "restaurant", "transport": "walking", "timeMinutes": 20, "keywords": ["mexican"], "cuisine": "mexican", "priceRange": "any", "searchStrategy": "nearest_only", "location": {...}}
- Previous: "Show me pharmacies I can drive to in 10 minutes" → Current: "what about 15 minutes?" → {"poiType": "pharmacy", "transport": "driving", "timeMinutes": 15, "keywords": [], "cuisine": "none", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}
- Previous: "Find italian restaurants within 15 mins walk" → Current: "how about cycling?" → {"poiType": "restaurant", "transport": "cycling", "timeMinutes": 15, "keywords": ["italian"], "cuisine": "italian", "priceRange": "any", "searchStrategy": "all_within_time", "location": {...}}`;

  try {
    const response = await callOllama(parsePrompt, { temperature: 0.3 });
    
    console.log('Ollama response:', response);
    console.log('Query being parsed:', message);
    
    // Extract JSON from response - try multiple patterns with better error handling
    let jsonMatch = null;
    
    // First try: Standard JSON object matching
    jsonMatch = response.match(/\{[\s\S]*?\}/);
    
    if (!jsonMatch) {
      // Second try: More flexible matching for nested objects
      jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
    }
    
    if (!jsonMatch) {
      // Third try: Look for JSON at the end of the response
      const lines = response.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{') && line.includes('}')) {
          jsonMatch = [line];
          break;
        }
      }
    }
    
    if (!jsonMatch) {
      // Fourth try: Look for JSON anywhere in the response
      const jsonStart = response.indexOf('{');
      if (jsonStart !== -1) {
        const jsonEnd = response.lastIndexOf('}');
        if (jsonEnd > jsonStart) {
          jsonMatch = [response.substring(jsonStart, jsonEnd + 1)];
        }
      }
    }
    if (!jsonMatch) {
      // Try to find incomplete JSON that starts with { but might be cut off
      const incompleteMatch = response.match(/\{[\s\S]*$/);
      if (incompleteMatch) {
        console.log('Found incomplete JSON, attempting to complete...');
        jsonMatch = incompleteMatch;
      } else {
        throw new Error('No JSON found in response');
      }
    }

    let parsed;
    let jsonString = '';
    try {
      // Clean the JSON string before parsing
      jsonString = jsonMatch[0].trim();
      
      // Remove any leading/trailing whitespace and ensure it starts and ends with braces
      if (!jsonString.startsWith('{')) {
        const startIndex = jsonString.indexOf('{');
        if (startIndex !== -1) {
          jsonString = jsonString.substring(startIndex);
        }
      }
      if (!jsonString.endsWith('}')) {
        const endIndex = jsonString.lastIndexOf('}');
        if (endIndex !== -1) {
          jsonString = jsonString.substring(0, endIndex + 1);
        }
      }
      
      console.log('Cleaned JSON string:', jsonString);
      
      // Additional validation and fixing
      jsonString = fixCommonJsonIssues(jsonString);
      
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      const error = parseError as Error;
      console.error('JSON parse error:', error);
      console.error('Original response:', response);
      console.error('Extracted JSON:', jsonMatch[0]);
      console.error('Cleaned JSON:', jsonString);
      console.error('Error at position:', error.message.match(/position (\d+)/)?.[1] || 'unknown');
      
      // Show the problematic area around the error position
      const errorPos = parseInt(error.message.match(/position (\d+)/)?.[1] || '0');
      if (errorPos > 0) {
        const start = Math.max(0, errorPos - 20);
        const end = Math.min(jsonString.length, errorPos + 20);
        console.error('Context around error:', jsonString.substring(start, end));
        console.error('Error position marker:', ' '.repeat(Math.min(20, errorPos - start)) + '^');
      }
      
      // Try to fix common JSON issues
      let fixedJson = jsonMatch[0].trim();
      
      // Fix common JSON syntax issues
      fixedJson = fixedJson
        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas before closing braces/brackets
        .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2') // Fix unescaped backslashes
        .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2') // Fix unescaped backslashes (second pass)
        .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2'); // Fix unescaped backslashes (third pass)
      
      // Check if JSON is incomplete (missing closing braces or cut off mid-property)
      const openBraces = (fixedJson.match(/\{/g) || []).length;
      const closeBraces = (fixedJson.match(/\}/g) || []).length;
      const missingBraces = openBraces - closeBraces;
      
      // If JSON appears to be cut off mid-property, try to complete it
      if (fixedJson.trim().endsWith(',') || fixedJson.trim().endsWith(':')) {
        console.log('JSON appears to be cut off mid-property, attempting to complete...');
        
        // Remove trailing comma or colon
        fixedJson = fixedJson.replace(/[,:]\s*$/, '');
        
        // Add missing required fields with default values
        const requiredFields = [
          '"keywords": []',
          '"cuisine": "none"',
          '"priceRange": "any"'
        ];
        
        // Check which fields are missing and add them
        const missingFields = requiredFields.filter(field => !fixedJson.includes(field.split(':')[0]));
        
        if (missingFields.length > 0) {
          // Add missing fields before the last closing brace
          const lastBraceIndex = fixedJson.lastIndexOf('}');
          if (lastBraceIndex > 0) {
            const beforeBrace = fixedJson.substring(0, lastBraceIndex);
            const afterBrace = fixedJson.substring(lastBraceIndex);
            
            // Check if we need to add a comma before the new fields
            const needsComma = !beforeBrace.trim().endsWith(',') && !beforeBrace.trim().endsWith('{');
            const comma = needsComma ? ',' : '';
            
            fixedJson = beforeBrace + comma + '\n    ' + missingFields.join(',\n    ') + '\n  ' + afterBrace;
          } else {
            // No closing brace found, add all missing fields
            fixedJson += ',\n    ' + missingFields.join(',\n    ') + '\n  }';
          }
        }
      } else if (missingBraces > 0) {
        // Fix missing closing braces
        fixedJson += '}'.repeat(missingBraces);
        console.log('Fixed JSON by adding missing braces:', fixedJson);
        
        // Add missing required fields by adding them with default values
        const requiredFields = [];
        if (!fixedJson.includes('"keywords"')) {
          requiredFields.push('"keywords": []');
        }
        if (!fixedJson.includes('"cuisine"')) {
          requiredFields.push('"cuisine": "none"');
        }
        if (!fixedJson.includes('"priceRange"')) {
          requiredFields.push('"priceRange": "any"');
        }
        
        if (requiredFields.length > 0) {
          // Find the last closing brace and add fields before it
          const lastBraceIndex = fixedJson.lastIndexOf('}');
          if (lastBraceIndex > 0) {
            const beforeBrace = fixedJson.substring(0, lastBraceIndex);
            const afterBrace = fixedJson.substring(lastBraceIndex);
            
            // Check if we need to add a comma before the new fields
            const needsComma = !beforeBrace.trim().endsWith(',') && !beforeBrace.trim().endsWith('{');
            const comma = needsComma ? ',' : '';
            
            fixedJson = beforeBrace + comma + '\n    ' + requiredFields.join(',\n    ') + '\n  ' + afterBrace;
          }
        }
      }
      
      try {
        parsed = JSON.parse(fixedJson);
        console.log('Successfully parsed fixed JSON:', parsed);
      } catch (secondError) {
        console.error('Still invalid after fixing JSON:', secondError);
        console.error('Fixed JSON that failed:', fixedJson);
        
        // Last resort: create a minimal valid JSON with defaults
        console.log('Creating fallback JSON with defaults...');
        
        // Try to extract basic info from the original query for fallback
        const cuisineTerms = ['mexican', 'italian', 'chinese', 'indian', 'japanese', 'thai', 'american', 'french', 'mediterranean'];
        const foodTerms = ['places', 'food', 'restaurants', 'spots', 'joints', 'eateries', 'dining', 'cuisine'];
        
        const detectedCuisine = cuisineTerms.find(cuisine => queryLower.includes(cuisine));
        const hasFoodTerm = foodTerms.some(term => queryLower.includes(term));
        
        // Extract time from query
        const timeMatch = queryLower.match(/(\d+)\s*minute/);
        const extractedTime = timeMatch ? parseInt(timeMatch[1]) : 15;
        
        // Extract transport mode more comprehensively
        let transport = 'walking';
        if (queryLower.includes('drive') || queryLower.includes('driving') || queryLower.includes('car')) {
          transport = 'driving';
        } else if (queryLower.includes('bike') || queryLower.includes('cycling') || queryLower.includes('cycle')) {
          transport = 'cycling';
        } else if (queryLower.includes('transit') || queryLower.includes('bus') || queryLower.includes('train') || queryLower.includes('public transport')) {
          transport = 'public_transport';
        }
        
        parsed = {
          poiType: (detectedCuisine && hasFoodTerm) ? 'restaurant' : 'other',
          transport: transport,
          timeMinutes: Math.max(5, Math.min(60, extractedTime)),
          location: location || { lat: 0, lng: 0, display_name: 'Unknown Location' },
          keywords: detectedCuisine ? [detectedCuisine] : [],
          cuisine: detectedCuisine || 'none',
          priceRange: 'any',
          searchStrategy: 'all_within_time'
        };
        console.log('Using fallback JSON with query analysis:', parsed);
      }
    }
    
    // Post-process to fix common parsing issues
    let finalPoiType = parsed.poiType || 'other';
    let finalCuisine = parsed.cuisine || 'none';
    let finalTransport = parsed.transport || 'walking';
    
    // Query-based POI type detection (override Ollama if clearly wrong)
    const coffeeTerms = ['coffee', 'coffee shop', 'coffeehouse', 'coffee house', 'café', 'cafe', 'espresso', 'latte', 'cappuccino'];
    const restaurantTerms = ['restaurant', 'restaurants', 'dining', 'food', 'eatery', 'eateries', 'diner', 'bistro', 'grill'];
    const groceryTerms = ['grocery', 'grocery store', 'supermarket', 'market', 'food store', 'convenience store'];
    const pharmacyTerms = ['pharmacy', 'pharmacies', 'drugstore', 'chemist', 'medicine', 'prescription'];
    const hospitalTerms = ['hospital', 'hospitals', 'clinic', 'clinic', 'doctor', 'medical', 'emergency'];
    const schoolTerms = ['school', 'schools', 'university', 'college', 'education', 'campus'];
    const parkTerms = ['park', 'parks', 'playground', 'recreation', 'outdoor'];
    const gymTerms = ['gym', 'gyms', 'fitness', 'workout', 'exercise', 'gymnasium'];
    const bankTerms = ['bank', 'banks', 'atm', 'atms', 'financial', 'credit union'];
    const gasTerms = ['gas station', 'gas', 'fuel', 'petrol', 'gasoline'];
    const shoppingTerms = ['shopping', 'mall', 'malls', 'store', 'stores', 'retail'];
    const entertainmentTerms = ['entertainment', 'cinema', 'movie', 'theater', 'theatre', 'bar', 'pub', 'club'];
    const transportTerms = ['transport', 'transportation', 'bus', 'train', 'station', 'transit'];
    const hotelTerms = ['hotel', 'hotels', 'accommodation', 'lodging', 'motel', 'hostel'];
    
    // Check for coffee-related terms first (highest priority)
    if (coffeeTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'cafe';
      console.log('Query-based detection: Detected coffee-related terms, setting POI type to cafe');
    }
    // Check for restaurant terms
    else if (restaurantTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'restaurant';
      console.log('Query-based detection: Detected restaurant-related terms, setting POI type to restaurant');
    }
    // Check for other specific terms
    else if (groceryTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'grocery';
      console.log('Query-based detection: Detected grocery-related terms, setting POI type to grocery');
    }
    else if (pharmacyTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'pharmacy';
      console.log('Query-based detection: Detected pharmacy-related terms, setting POI type to pharmacy');
    }
    else if (hospitalTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'hospital';
      console.log('Query-based detection: Detected hospital-related terms, setting POI type to hospital');
    }
    else if (schoolTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'school';
      console.log('Query-based detection: Detected school-related terms, setting POI type to school');
    }
    else if (parkTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'park';
      console.log('Query-based detection: Detected park-related terms, setting POI type to park');
    }
    else if (gymTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'gym';
      console.log('Query-based detection: Detected gym-related terms, setting POI type to gym');
    }
    else if (bankTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'bank';
      console.log('Query-based detection: Detected bank-related terms, setting POI type to bank');
    }
    else if (gasTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'gas_station';
      console.log('Query-based detection: Detected gas station-related terms, setting POI type to gas_station');
    }
    else if (shoppingTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'shopping';
      console.log('Query-based detection: Detected shopping-related terms, setting POI type to shopping');
    }
    else if (entertainmentTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'entertainment';
      console.log('Query-based detection: Detected entertainment-related terms, setting POI type to entertainment');
    }
    else if (transportTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'transport';
      console.log('Query-based detection: Detected transport-related terms, setting POI type to transport');
    }
    else if (hotelTerms.some(term => queryLower.includes(term))) {
      finalPoiType = 'accommodation';
      console.log('Query-based detection: Detected hotel-related terms, setting POI type to accommodation');
    }
    
    // Normalize POI types to match expected values
    const poiTypeMapping: Record<string, string> = {
      'coffee shop': 'cafe',
      'coffee': 'cafe',
      'coffeehouse': 'cafe',
      'coffee house': 'cafe',
      'café': 'cafe',
      'cafe': 'cafe',
      'restaurant': 'restaurant',
      'restaurants': 'restaurant',
      'dining': 'restaurant',
      'food': 'restaurant',
      'grocery store': 'grocery',
      'grocery': 'grocery',
      'supermarket': 'grocery',
      'pharmacy': 'pharmacy',
      'chemist': 'pharmacy',
      'drugstore': 'pharmacy',
      'hospital': 'hospital',
      'clinic': 'hospital',
      'school': 'school',
      'university': 'school',
      'college': 'school',
      'park': 'park',
      'gym': 'gym',
      'fitness': 'gym',
      'bank': 'bank',
      'atm': 'atm',
      'gas station': 'gas_station',
      'fuel': 'gas_station',
      'shopping': 'shopping',
      'mall': 'shopping',
      'entertainment': 'entertainment',
      'transport': 'transport',
      'hotel': 'accommodation',
      'accommodation': 'accommodation',
    };
    
    if (poiTypeMapping[finalPoiType.toLowerCase()]) {
      const originalPoiType = finalPoiType;
      finalPoiType = poiTypeMapping[finalPoiType.toLowerCase()];
      console.log('Post-processing: Normalized POI type', { original: originalPoiType, normalized: finalPoiType });
    }
    
    // If poiType is "other" but we have a cuisine, it's likely a restaurant
    if (finalPoiType === 'other' && finalCuisine !== 'none') {
      finalPoiType = 'restaurant';
    }
    
    // Check if the original query contains cuisine + food terms but wasn't recognized
    const cuisineTerms = ['mexican', 'italian', 'chinese', 'indian', 'japanese', 'thai', 'american', 'french', 'mediterranean'];
    const foodTerms = ['places', 'food', 'restaurants', 'spots', 'joints', 'eateries', 'dining', 'cuisine'];
    
    const hasCuisine = cuisineTerms.some(cuisine => queryLower.includes(cuisine));
    const hasFoodTerm = foodTerms.some(term => queryLower.includes(term));
    
    if (hasCuisine && hasFoodTerm && finalPoiType === 'other') {
      finalPoiType = 'restaurant';
      finalCuisine = cuisineTerms.find(cuisine => queryLower.includes(cuisine)) || 'none';
      console.log('Post-processing: Fixed cuisine query detection', { original: parsed.poiType, fixed: finalPoiType, cuisine: finalCuisine });
    }
    
    // Fix transport mode detection
    if (queryLower.includes('drive') || queryLower.includes('driving') || queryLower.includes('car')) {
      finalTransport = 'driving';
    } else if (queryLower.includes('bike') || queryLower.includes('cycling') || queryLower.includes('cycle')) {
      finalTransport = 'cycling';
    } else if (queryLower.includes('transit') || queryLower.includes('bus') || queryLower.includes('train') || queryLower.includes('public transport')) {
      finalTransport = 'public_transport';
    } else if (memoryContext?.preferences.favoriteTransport?.length) {
      finalTransport = memoryContext.preferences.favoriteTransport[0];
    }
    
    // Fix POI type detection for common queries
    if (queryLower.includes('gym') || queryLower.includes('fitness')) {
      finalPoiType = 'gym';
    } else if (queryLower.includes('pharmacy') || queryLower.includes('drugstore')) {
      finalPoiType = 'pharmacy';
    } else if (queryLower.includes('hospital') || queryLower.includes('clinic')) {
      finalPoiType = 'hospital';
    } else if (queryLower.includes('school') || queryLower.includes('university') || queryLower.includes('college')) {
      finalPoiType = 'school';
    } else if (queryLower.includes('park') || queryLower.includes('playground')) {
      finalPoiType = 'park';
    } else if (queryLower.includes('bank') || queryLower.includes('atm')) {
      finalPoiType = 'bank';
    } else if (queryLower.includes('gas') || queryLower.includes('fuel') || queryLower.includes('station')) {
      finalPoiType = 'gas_station';
    } else if (queryLower.includes('shopping') || queryLower.includes('mall') || queryLower.includes('store')) {
      finalPoiType = 'shopping';
    } else if (finalPoiType === 'other' && memoryContext?.preferences.favoritePOITypes?.length) {
      const preferredPoiType = memoryContext.preferences.favoritePOITypes.find((type): type is ParsedQuery['poiType'] =>
        KNOWN_POI_TYPES.has(type as ParsedQuery['poiType']),
      );
      if (preferredPoiType) {
        finalPoiType = preferredPoiType;
      }
    }
    
    // Detect query context and intent
    const isNearestQuery = queryLower.includes('nearest') || queryLower.includes('closest') || 
                          queryLower.includes('closest to me') || queryLower.includes('nearest to me');
    const isAllWithinQuery = queryLower.includes('within') || queryLower.includes('in') || 
                            queryLower.includes('around') || queryLower.includes('near');
    
    // Determine search strategy
    let searchStrategy: 'nearest_only' | 'all_within_time' = 'all_within_time'; // default
    if (isNearestQuery && !isAllWithinQuery) {
      searchStrategy = 'nearest_only';
    } else if (isAllWithinQuery) {
      searchStrategy = 'all_within_time';
    }
    
    // Extract time more intelligently
    let extractedTime = 15; // default
    const timePatterns = [
      /(\d+)\s*minute/,
      /(\d+)\s*min/,
      /(\d+)\s*minutes?/,
      /within\s*(\d+)/,
      /in\s*(\d+)\s*minutes?/
    ];
    
    for (const pattern of timePatterns) {
      const match = queryLower.match(pattern);
      if (match) {
        extractedTime = parseInt(match[1]);
        break;
      }
    }
    
    // For nearest queries, use a reasonable time limit
    if (searchStrategy === 'nearest_only') {
      extractedTime = Math.min(extractedTime, 30); // Cap at 30 minutes for nearest searches
    }

    // Validate and set defaults - ensure all required fields are present
    const result: ParsedQuery = {
      poiType: finalPoiType,
      transport: finalTransport,
      timeMinutes: Math.max(5, Math.min(60, parsed.timeMinutes || extractedTime)),
      location: parsed.location || location || {
        lat: 0,
        lng: 0,
        display_name: 'Unknown Location'
      },
      keywords: parsed.keywords || [],
      cuisine: finalCuisine,
      priceRange: parsed.priceRange || 'any',
      searchStrategy: searchStrategy,
      showMultiModalDurations: true, // Always show multiple transport durations
      preferences: {
        maxResults: searchStrategy === 'nearest_only' ? 5 : 50, // Limit results for nearest searches
        radius: 5000, // 5km default
        amenities: [],
        rating: 0
      }
    };

    // Ensure all required fields are present (defensive programming)
    if (!result.keywords) result.keywords = [];
    if (!result.cuisine) result.cuisine = 'none';
    if (!result.priceRange) result.priceRange = 'any';
    if (!result.searchStrategy) result.searchStrategy = 'all_within_time';
    if (!result.showMultiModalDurations) result.showMultiModalDurations = true;
    
    // Validate that location is not (0,0) which causes isochrone API to fail
    if (result.location.lat === 0 && result.location.lng === 0) {
      console.log('Warning: Parsed query has invalid location (0,0), using fallback location');
      result.location = {
        lat: 29.7604,
        lng: -95.3698,
        display_name: 'Houston, TX (Fallback)'
      };
    }

    return result;
  } catch (error) {
    console.error('Query parsing error:', error);
    
    // Fallback parsing
    return {
      poiType: 'other',
      transport: 'walking',
      timeMinutes: 15,
      location: location || {
        lat: 0,
        lng: 0,
        display_name: 'Unknown Location'
      },
      preferences: {
        maxResults: 50,
        radius: 5000,
      }
    };
  }
}

// ============================================================================
// RESPONSE GENERATION
// ============================================================================

async function generateResponse(
  query: ParsedQuery,
  pois: POI[],
  isochroneData?: any,
  conversationHistory?: ChatMessage[],
  memoryContext?: MemoryContextSummary,
): Promise<string> {
  const poiCount = pois.length;
  const transportMode = query.transport;
  const timeLimit = query.timeMinutes;
  const poiType = query.poiType;

  const memoryPrompt = buildMemoryContextPrompt(memoryContext);

  // Group POIs by distance for better organization
  const nearbyPOIs = pois.filter(poi => (poi.distance || 0) < 500).slice(0, 5);
  const farPOIs = pois.filter(poi => (poi.distance || 0) >= 500).slice(0, 3);

  // Build conversation context for response
  const conversationContext = conversationHistory && conversationHistory.length > 0 
    ? `\n\nPrevious conversation context:\n${conversationHistory.slice(-2).map(msg => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
      ).join('\n')}\n\n`
    : '\n\n';

  const preferenceSignal = memoryContext?.preferences;
  const preferenceSummary = preferenceSignal
    ? `User preferences to respect: ${[
        preferenceSignal.favoritePOITypes?.length
          ? `favor ${preferenceSignal.favoritePOITypes.join(', ')}`
          : null,
        preferenceSignal.favoriteTransport?.length
          ? `prefers ${preferenceSignal.favoriteTransport.join(', ')} transport`
          : null,
        preferenceSignal.dietaryRestrictions?.length
          ? `dietary restrictions: ${preferenceSignal.dietaryRestrictions.join(', ')}`
          : null,
        preferenceSignal.budgetPreference && preferenceSignal.budgetPreference !== 'any'
          ? `budget preference: ${preferenceSignal.budgetPreference}`
          : null,
      ]
        .filter(Boolean)
        .join(' | ')}`
    : '';

  const responsePrompt = `You are a helpful location assistant. Generate a conversational response about the search results that encourages discussion and follow-up questions.${conversationContext}${memoryPrompt}

Query: Looking for ${poiType}s within ${timeLimit} minutes by ${transportMode}
Location: ${query.location.display_name}
Found ${poiCount} results

${preferenceSummary ? `${preferenceSummary}\n` : ''}

${query.keywords && query.keywords.length > 0 ? `Search keywords: ${query.keywords.join(', ')}\n` : ''}
${query.cuisine && query.cuisine !== 'none' ? `Cuisine type: ${query.cuisine}\n` : ''}
${query.priceRange && query.priceRange !== 'any' ? `Price range: ${query.priceRange}\n` : ''}

Nearby places (within 5 minutes walk):
${nearbyPOIs.map(poi => `- ${poi.name} (${Math.round((poi.distance || 0) / 1000 * 100) / 100}km, ${poi.walkTime || 'unknown'} min walk)${poi.tags?.cuisine ? ` - ${poi.tags.cuisine} cuisine` : ''}${poi.tags?.phone ? ` - ${poi.tags.phone}` : ''}`).join('\n')}

${farPOIs.length > 0 ? `Other places found:\n${farPOIs.map(poi => `- ${poi.name} (${Math.round((poi.distance || 0) / 1000 * 100) / 100}km, ${poi.walkTime || 'unknown'} min walk)${poi.tags?.cuisine ? ` - ${poi.tags.cuisine} cuisine` : ''}${poi.tags?.phone ? ` - ${poi.tags.phone}` : ''}`).join('\n')}` : ''}

Generate a helpful, conversational response that:
1. Acknowledges the search results with enthusiasm
2. Highlights the most convenient options with specific details
3. Mentions key details like distance, walk time, cuisine, and contact info
4. Encourages follow-up questions like "Tell me more about [specific place]", "What are the hours?", "Any recommendations?"
5. Suggests related searches if appropriate
6. Keeps it friendly and engaging (3-4 sentences)

If no results found, suggest:
- Expanding the search area or time limit
- Trying different keywords or cuisine types
- Checking for alternative POI types
- Asking for more specific preferences

Always end with a question or invitation to discuss the results further.`;

  try {
    const response = await callOllama(responsePrompt, { temperature: 0.8 });
    return response;
  } catch (error) {
    console.error('Response generation error:', error);
    
    // Fallback response
    if (poiCount === 0) {
      return `I couldn't find any ${poiType}s within ${timeLimit} minutes by ${transportMode} from ${query.location.display_name}. Try expanding your search area or adjusting the time limit.`;
    }
    
    const topPOI = pois[0];
    return `Found ${poiCount} ${poiType}s near you! The closest is ${topPOI.name} at ${Math.round((topPOI.distance || 0) / 1000 * 100) / 100}km away (${topPOI.walkTime || 'unknown'} min walk). ${poiCount > 1 ? `There are ${poiCount - 1} more options to explore.` : ''}`;
  }
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    
    if (!body.type || !['parse', 'respond'].includes(body.type)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request type. Must be "parse" or "respond"' 
        },
        { status: 400 }
      );
    }

    const mem0Service = await getServerMem0Service();
    const headerUserId =
      request.headers.get('x-user-id') ||
      request.headers.get('x-chatmap-user') ||
      request.headers.get('x-client-id');
    const bodyUserId = 'userId' in body && body.userId ? body.userId : undefined;
    const userId = bodyUserId || headerUserId || 'anonymous-user';
    const headerMemoryEnabled = request.headers.get('x-memory-enabled');
    const bodyMemoryEnabled = body.memoryEnabled !== false;
    const memoryEnabled = headerMemoryEnabled === 'false' ? false : bodyMemoryEnabled;

    await mem0Service.createUserSession(userId);

    let responsePayload: ParseResponseData | RespondResponseData;

    if (body.type === 'parse') {
      const parseBody = body as ParseRequest;

      if (!parseBody.message) {
        return NextResponse.json(
          {
            success: false,
            error: 'Message is required for parsing',
          },
          { status: 400 },
        );
      }

      const memoryContext = memoryEnabled
        ? await loadMemoryContext(mem0Service, userId, parseBody.message)
        : {
            userId,
            preferences: {},
            conversationMemories: [],
            locationHistory: [],
            relevantMemories: [],
            frequentLocations: [],
          } satisfies MemoryContextSummary;
      const parsedQuery = await parseQuery(
        parseBody.message,
        parseBody.location,
        parseBody.conversationHistory,
        memoryContext,
      );

      const preferenceSignals = derivePreferencesFromQuery(parsedQuery, parseBody.message, memoryContext);

      let preferenceId: string | undefined;
      if (
        memoryEnabled &&
        hasPreferenceSignals(preferenceSignals) &&
        preferencesChanged(preferenceSignals, memoryContext.preferences)
      ) {
        try {
          preferenceId = await mem0Service.addPreferenceMemory(userId, preferenceSignals);
        } catch (error) {
          console.error('[Mem0] Failed to store preference memory:', error);
        }
        memoryContext.preferences = preferenceSignals;
      }

      const personalizedSuggestions = derivePersonalizedSuggestions(memoryContext);

      responsePayload = {
        parsedQuery,
        memoryContext,
        preferenceSignals,
        personalizedSuggestions,
        recordedMemoryIds: preferenceId ? { preferenceId } : undefined,
      };
    } else {
      const respondBody = body as RespondRequest;

      if (!respondBody.query || !respondBody.pois) {
        return NextResponse.json(
          {
            success: false,
            error: 'Query and POIs are required for response generation',
          },
          { status: 400 },
        );
      }

      const latestUserMessage =
        getLatestUserMessage(respondBody.conversationHistory) ||
        `Looking for ${respondBody.query.poiType}${
          respondBody.query.cuisine && respondBody.query.cuisine !== 'none'
            ? ` with ${respondBody.query.cuisine} cuisine`
            : ''
        } near ${respondBody.query.location.display_name}`;

      const memoryContext = memoryEnabled
        ? await loadMemoryContext(mem0Service, userId, latestUserMessage)
        : {
            userId,
            preferences: {},
            conversationMemories: [],
            locationHistory: [],
            relevantMemories: [],
            frequentLocations: [],
          } satisfies MemoryContextSummary;

      const responseText = await generateResponse(
        respondBody.query,
        respondBody.pois,
        respondBody.isochroneData,
        respondBody.conversationHistory,
        memoryContext,
      );

      const preferenceSignals = derivePreferencesFromQuery(
        respondBody.query,
        latestUserMessage,
        memoryContext,
      );

      const recordedMemoryIds: RespondResponseData['recordedMemoryIds'] = {};

      if (
        memoryEnabled &&
        hasPreferenceSignals(preferenceSignals) &&
        preferencesChanged(preferenceSignals, memoryContext.preferences)
      ) {
        try {
          recordedMemoryIds.preferenceId = await mem0Service.addPreferenceMemory(
            userId,
            preferenceSignals,
          );
        } catch (error) {
          console.error('[Mem0] Failed to store preference memory:', error);
        }
        memoryContext.preferences = preferenceSignals;
      }

      if (memoryEnabled && respondBody.pois.length > 0) {
        const locationMemory = buildLocationMemoryRecord(
          userId,
          latestUserMessage,
          respondBody.query,
          respondBody.pois,
        );
        let locationId: string | undefined;
        try {
          locationId = await mem0Service.addLocationMemory(userId, locationMemory);
        } catch (error) {
          console.error('[Mem0] Failed to store location memory:', error);
        }
        if (locationId) {
          recordedMemoryIds.locationId = locationId;
          locationMemory.id = locationId;
          memoryContext.relevantMemories = [
            ...memoryContext.relevantMemories,
            {
              id: locationId,
              userId,
              type: 'location',
              content: locationMemory.query,
              metadata: {
                location: locationMemory.location,
                context: locationMemory.context,
                poisFound: locationMemory.poisFound.map((poi) => poi.name),
              },
              createdAt: locationMemory.timestamp,
            },
          ];
        }
        memoryContext.locationHistory = [...memoryContext.locationHistory, locationMemory];
        try {
          memoryContext.frequentLocations = await mem0Service.getFrequentLocations(userId);
        } catch (error) {
          console.error('[Mem0] Failed to refresh frequent locations:', error);
        }
      }

      let conversationId: string | undefined;
      if (memoryEnabled) {
        try {
          conversationId = await mem0Service.addConversationMemory(
            userId,
            latestUserMessage,
            responseText,
            {
              parsedQuery: respondBody.query,
              pois: respondBody.pois.slice(0, 5),
              isochroneData: respondBody.isochroneData ? { summary: true } : undefined,
              memoryReferences: memoryContext.relevantMemories.map((memory) => memory.id),
              locationMemoryId: recordedMemoryIds.locationId,
            },
          );
        } catch (error) {
          console.error('[Mem0] Failed to store conversation memory:', error);
        }
      }
      if (conversationId) {
        recordedMemoryIds.conversationId = conversationId;
      }

      memoryContext.conversationMemories = [
        ...memoryContext.conversationMemories,
        {
          id: conversationId ?? `${userId}-${Date.now()}`,
          userId,
          query: latestUserMessage,
          response: responseText,
          timestamp: new Date().toISOString(),
          context: {
            parsedQuery: respondBody.query,
            poisShared: respondBody.pois.slice(0, 3).map((poi) => ({ id: poi.id, name: poi.name })),
            locationMemoryId: recordedMemoryIds.locationId,
          },
          relatedPOIs: respondBody.pois.slice(0, 3),
          extractedPreferences: preferenceSignals,
        },
      ];

      const personalizedSuggestions = derivePersonalizedSuggestions(memoryContext);

      responsePayload = {
        response: responseText,
        memoryContext,
        preferenceSignals,
        personalizedSuggestions,
        recordedMemoryIds,
      };
    }

    return NextResponse.json({
      success: true,
      data: responsePayload,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Chat API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function GET() {
  try {
    // Test Ollama connection
    const testResponse = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!testResponse.ok) {
      throw new Error('Ollama not responding');
    }

    return NextResponse.json({
      success: true,
      message: 'Chat API is healthy',
      ollama: {
        endpoint: OLLAMA_ENDPOINT,
        model: OLLAMA_MODEL,
        status: 'connected',
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Ollama connection failed',
        ollama: {
          endpoint: OLLAMA_ENDPOINT,
          model: OLLAMA_MODEL,
          status: 'disconnected',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
