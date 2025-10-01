/**
 * Query Classifier
 * Analyzes user queries and classifies them into intent categories
 * Uses Ollama LLM with structured prompt
 */

import { getOllamaClient } from '@/src/clients/ollama-client';
import { QUERY_CLASSIFIER_PROMPT } from './prompts';
import type { POIType, TransportMode } from '@/src/lib/types';

// ============================================================================
// Types
// ============================================================================

export type QueryIntent =
  | 'find-nearest'
  | 'find-within-time'
  | 'find-near-poi'
  | 'find-enroute'
  | 'get-directions'
  | 'follow-up'
  | 'clarification';

export type QueryComplexity = 'simple' | 'multi-step';

export interface QueryEntities {
  primaryPOI?: POIType;
  secondaryPOI?: POIType;
  transport?: TransportMode;
  timeConstraint?: number;
  destination?: string;
  cuisine?: string;
  keywords?: string[];
}

export interface ClassifiedQuery {
  intent: QueryIntent;
  complexity: QueryComplexity;
  entities: QueryEntities;
  requiresContext: boolean;
  confidence: number;
  reasoning: string;
}

export interface ConversationContext {
  messages: {
    role: 'user' | 'assistant';
    content: string;
  }[];
  lastQuery?: ClassifiedQuery;
  lastResults?: {
    pois?: unknown[];
    route?: unknown;
  };
}

// ============================================================================
// Query Classifier
// ============================================================================

export class QueryClassifier {
  private promptTemplate: string;

  constructor() {
    // Use exported prompt template
    this.promptTemplate = QUERY_CLASSIFIER_PROMPT;
  }

  /**
   * Classify a user query into intent and extract entities
   */
  async classify(
    query: string,
    context?: ConversationContext
  ): Promise<ClassifiedQuery> {
    try {
      const ollama = getOllamaClient();

      // Build prompt with context
      const fullPrompt = this.buildPrompt(query, context);

      // Get classification from LLM
      const response = await ollama.generate({
        model: 'llama3.2:3b',
        prompt: fullPrompt,
        options: {
          temperature: 0.3, // Low temperature for consistent classification
          num_predict: 500,
        },
      });

      // Parse JSON response
      const classified = this.parseResponse(response.response);

      // Validate and return
      return this.validateClassification(classified, query);
    } catch (error) {
      console.error('[QueryClassifier] Classification error:', error);

      // Fallback to rule-based classification
      return this.fallbackClassify(query, context);
    }
  }

  /**
   * Build full prompt with query and context
   */
  private buildPrompt(query: string, context?: ConversationContext): string {
    let prompt = this.promptTemplate;

    // Add conversation context if available
    if (context && context.messages.length > 0) {
      const recentMessages = context.messages.slice(-3);
      const contextStr = recentMessages
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n');

      prompt += `\n\n## Previous Conversation\n\n${contextStr}\n`;
    }

    // Add current query
    prompt += `\n\n## Current Query\n\n"${query}"`;

    return prompt;
  }

  /**
   * Parse LLM response to extract classification
   */
  private parseResponse(response: string): ClassifiedQuery {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const json = JSON.parse(jsonMatch[0]);

      return {
        intent: json.intent || 'clarification',
        complexity: json.complexity || 'simple',
        entities: json.entities || {},
        requiresContext: json.requiresContext ?? false,
        confidence: json.confidence ?? 0.5,
        reasoning: json.reasoning || '',
      };
    } catch (error) {
      console.error('[QueryClassifier] Failed to parse response:', error);
      throw error;
    }
  }

  /**
   * Validate classification and apply business rules
   */
  private validateClassification(
    classified: ClassifiedQuery,
    query: string
  ): ClassifiedQuery {
    // Ensure valid intent
    const validIntents: QueryIntent[] = [
      'find-nearest',
      'find-within-time',
      'find-near-poi',
      'find-enroute',
      'get-directions',
      'follow-up',
      'clarification',
    ];

    if (!validIntents.includes(classified.intent)) {
      classified.intent = 'clarification';
      classified.confidence = Math.min(classified.confidence, 0.5);
    }

    // Handle cuisine types - convert to proper POI types
    if (classified.entities.cuisine) {
      const cuisineToPOIType: Record<string, string> = {
        'italian': 'restaurant',
        'mexican': 'restaurant',
        'chinese': 'restaurant',
        'japanese': 'restaurant',
        'indian': 'restaurant',
        'thai': 'restaurant',
        'french': 'restaurant',
        'american': 'restaurant',
        'pizza': 'restaurant',
        'burger': 'restaurant',
        'sushi': 'restaurant',
        'seafood': 'restaurant',
        'steakhouse': 'restaurant',
        'cafe': 'cafe',
        'coffee': 'cafe',
        'bakery': 'cafe',
        'bar': 'restaurant',
        'pub': 'restaurant',
        'food court': 'restaurant',
        'foodcourt': 'restaurant',
      };

      const cuisineLower = classified.entities.cuisine.toLowerCase();
      if (cuisineToPOIType[cuisineLower]) {
        classified.entities.primaryPOI = cuisineToPOIType[cuisineLower] as POIType;
      }
    }



    // Map brand names to proper POI types for primary POI
    if (classified.entities.primaryPOI) {
      const brandToPOIType: Record<string, string> = {
        'starbucks': 'cafe',
        'coffee shop': 'cafe',
        'dunkin': 'cafe',
        'dunkin donuts': 'cafe',
        'peet\'s': 'cafe',
        'peets': 'cafe',
        'mcdonald\'s': 'restaurant',
        'mcdonalds': 'restaurant',
        'burger king': 'restaurant',
        'wendy\'s': 'restaurant',
        'wendys': 'restaurant',
        'cvs': 'pharmacy',
        'walgreens': 'pharmacy',
        'rite aid': 'pharmacy',
        'whole foods': 'grocery',
        'safeway': 'grocery',
        'walmart': 'grocery',
        'target': 'shopping',
        'mall': 'shopping',
        'gas station': 'gas_station',
        'gas': 'gas_station',
        'shell': 'gas_station',
        'exxon': 'gas_station',
        'chevron': 'gas_station',
        'bp': 'gas_station',
        'hospital': 'hospital',
        'clinic': 'hospital',
        'pharmacy': 'pharmacy',
        'drugstore': 'pharmacy',
        'bank': 'bank',
        'atm': 'atm',
        'atm machine': 'atm',
        'restaurant': 'restaurant',
        'cafe': 'cafe',
        'coffee': 'cafe',
        'grocery': 'grocery',
        'grocery store': 'grocery',
        'supermarket': 'grocery',
        'shopping': 'shopping',
        'store': 'shopping',
        'shop': 'shopping',
      };

      const primaryLower = classified.entities.primaryPOI.toLowerCase();
      if (brandToPOIType[primaryLower]) {
        classified.entities.primaryPOI = brandToPOIType[primaryLower] as POIType;
      }
    }

    // Force "quick bite" queries to be restaurants (not cafes)
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('quick bite') || lowerQuery.includes('grab bite') || lowerQuery.includes('grab food') || lowerQuery.includes('bite on the way')) {
      classified.entities.primaryPOI = 'restaurant';
    }

    // Fix intent if secondaryPOI is present (multi-step query)
    if (classified.entities.secondaryPOI) {
      // Convert brand names to POI types
      const brandToPOIType: Record<string, string> = {
        'starbucks': 'cafe',
        'coffee shop': 'cafe',
        'dunkin': 'cafe',
        'peet\'s': 'cafe',
        'mcdonald\'s': 'restaurant',
        'mcdonalds': 'restaurant',
        'burger king': 'restaurant',
        'wendy\'s': 'restaurant',
        'cvs': 'pharmacy',
        'walgreens': 'pharmacy',
        'rite aid': 'pharmacy',
        'whole foods': 'grocery',
        'safeway': 'grocery',
        'walmart': 'grocery',
        'target': 'shopping',
        'mall': 'shopping',
        'gas station': 'gas_station',
        'gas': 'gas_station',
        'shell': 'gas_station',
        'exxon': 'gas_station',
        'chevron': 'gas_station',
        'bp': 'gas_station',
      };

      const secondaryLower = classified.entities.secondaryPOI.toLowerCase();
      if (brandToPOIType[secondaryLower]) {
        classified.entities.secondaryPOI = brandToPOIType[secondaryLower] as POIType;
      }

      // CRITICAL: Check if LLM swapped primary and secondary POIs
      // For queries like "find X near Y", X should be primary (what user wants), Y should be secondary (anchor point)
      const queryLower = query.toLowerCase();
      const nearKeywords = ['near', 'close to', 'closest to', 'nearest to', 'around', 'by'];
      
      // Find where the "near" keyword appears in the query
      let nearIndex = -1;
      for (const keyword of nearKeywords) {
        const idx = queryLower.indexOf(keyword);
        if (idx !== -1) {
          nearIndex = idx;
          break;
        }
      }
      
      // Don't swap entities for enroute queries - they have different logic
      if (nearIndex !== -1 && classified.entities.primaryPOI && classified.entities.secondaryPOI && 
          classified.intent !== 'find-enroute') {
        // Find positions of primary and secondary POIs in the query
        // Use original query terms, not mapped ones, for position finding
        const originalQuery = query.toLowerCase();
        let primaryPos = -1;
        let secondaryPos = -1;
        
        // Try to find original terms in the query
        const primaryTerms = [classified.entities.primaryPOI.toLowerCase()];
        const secondaryTerms = [classified.entities.secondaryPOI.toLowerCase()];
        
        // Add common variations
        if (classified.entities.primaryPOI === 'cafe') {
          primaryTerms.push('starbucks', 'coffee', 'coffee shop');
        }
        if ((classified.entities.secondaryPOI as string) === 'mexican place' || (classified.entities.secondaryPOI as string) === 'mexican restaurant') {
          secondaryTerms.push('mexican places', 'mexican food', 'mexican');
        }
        
        for (const term of primaryTerms) {
          const pos = originalQuery.indexOf(term);
          if (pos !== -1) {
            primaryPos = pos;
            break;
          }
        }
        
        for (const term of secondaryTerms) {
          const pos = originalQuery.indexOf(term);
          if (pos !== -1) {
            secondaryPos = pos;
            break;
          }
        }
        
        console.log(`[QueryClassifier] Before swapping: primary="${classified.entities.primaryPOI}" (pos: ${primaryPos}), secondary="${classified.entities.secondaryPOI}" (pos: ${secondaryPos}), nearIndex: ${nearIndex}`);
        
        // If primary appears AFTER the near keyword and secondary appears BEFORE it, they're swapped!
        // Example: "find atms(secondaryPos) near(nearIndex) hospital(primaryPos)" - hospital is wrongly labeled as primary
        // But for "find mexican places near starbucks", mexican places (before near) should be primary, starbucks (after near) should be secondary
        if (primaryPos > nearIndex && secondaryPos < nearIndex) {
          console.log(`[QueryClassifier] Swapping primary and secondary: primary="${classified.entities.primaryPOI}" <-> secondary="${classified.entities.secondaryPOI}"`);
          const temp = classified.entities.primaryPOI;
          classified.entities.primaryPOI = classified.entities.secondaryPOI;
          classified.entities.secondaryPOI = temp;
        }
      }
    }

    // Fix invalid POI types - map non-standard food-related terms to restaurant
    if (classified.entities.primaryPOI && 
        (classified.entities.primaryPOI as string === 'food' || 
         classified.entities.primaryPOI as string === 'bite' || 
         classified.entities.primaryPOI as string === 'quick bite' || 
         classified.entities.primaryPOI as string === 'food court')) {
      console.log(`[QueryClassifier] Converting ${classified.entities.primaryPOI} to restaurant`);
      classified.entities.primaryPOI = 'restaurant';
    }

    // If primaryPOI is "place" and we have a cuisine, convert to restaurant
    console.log(`[QueryClassifier] Checking place conversion: primaryPOI="${classified.entities.primaryPOI}", cuisine="${classified.entities.cuisine}"`);
    if ((classified.entities.primaryPOI as string) === 'place' && classified.entities.cuisine) {
      console.log(`[QueryClassifier] Converting place to restaurant for cuisine: ${classified.entities.cuisine}`);
      classified.entities.primaryPOI = 'restaurant';
    }
    
    // Convert cuisine-specific restaurants to generic "restaurant"
    if (classified.entities.primaryPOI && 
        (classified.entities.primaryPOI as string).includes('restaurant') && 
        classified.entities.cuisine) {
      console.log(`[QueryClassifier] Converting ${classified.entities.primaryPOI} to restaurant for cuisine: ${classified.entities.cuisine}`);
      classified.entities.primaryPOI = 'restaurant';
    }
    
    // Check for enroute patterns - if destination is mentioned with "on the way", "before going", etc.
    const enrouteKeywords = ['on the way', 'on my way', 'along the way', 'before going', 'enroute', 'en route', 'grab', 'stop'];
    const hasEnrouteKeyword = enrouteKeywords.some(kw => query.toLowerCase().includes(kw));
    const hasDestination = classified.entities.destination && classified.entities.destination.length > 0;
    
    if (hasEnrouteKeyword && hasDestination && classified.entities.primaryPOI) {
      console.log(`[QueryClassifier] Detected enroute pattern - forcing intent to find-enroute`);
      classified.intent = 'find-enroute';
      classified.complexity = 'multi-step';
    }
    
    // If secondaryPOI is set, force multi-step find-near-poi
    if (classified.entities.secondaryPOI) {

      // Extract cuisine from primaryPOI if it contains a cuisine type
      if (classified.entities.primaryPOI) {
        const primaryLower = classified.entities.primaryPOI.toLowerCase();
        const cuisineTypes = ['mexican', 'italian', 'chinese', 'japanese', 'thai', 'indian', 'french', 'american', 'mediterranean'];
        
        for (const cuisine of cuisineTypes) {
          if (primaryLower.includes(cuisine)) {
            classified.entities.cuisine = cuisine as 'mexican' | 'italian' | 'chinese' | 'japanese' | 'thai' | 'indian' | 'french' | 'american' | 'mediterranean';
            // Remove cuisine from primaryPOI, leaving just the POI type
            classified.entities.primaryPOI = classified.entities.primaryPOI
              .replace(new RegExp(cuisine, 'i'), '')
              .trim() as POIType;
            break;
          }
        }
      }

      classified.intent = 'find-near-poi';
      classified.complexity = 'multi-step';
    }

    // Set default transport mode if not specified
    if (!classified.entities.transport) {
      classified.entities.transport = 'walking';
    }

    // Set complexity based on intent
    else if (
      classified.intent === 'find-near-poi' ||
      classified.intent === 'find-enroute'
    ) {
      classified.complexity = 'multi-step';
    } else {
      classified.complexity = 'simple';
    }

    // Ensure confidence is in valid range
    classified.confidence = Math.max(0, Math.min(1, classified.confidence));

    // Additional validation: Check if LLM got enroute queries wrong
    const queryLower = query.toLowerCase();
    const enroutePattern = /grab.*on.*way|quick.*on.*way|eat.*on.*way|coffee.*on.*way|bite.*on.*way|food.*on.*way/;
    const matchesEnroute = queryLower.match(enroutePattern);
    
    if (matchesEnroute && classified.intent !== 'find-enroute') {
      console.log('[QueryClassifier] Overriding LLM classification for enroute query');
      const fallback = this.fallbackClassify(query);
      return {
        ...fallback,
        confidence: 0.9, // High confidence in fallback
        reasoning: 'Overridden LLM classification with fallback for enroute query'
      };
    }

    // Additional validation: Check if LLM got clarification queries wrong
    if (queryLower.match(/how about|what about|try|instead|change|switch|different|other/) && 
        classified.intent !== 'clarification') {
      console.log('[QueryClassifier] Overriding LLM classification for clarification query');
      const fallback = this.fallbackClassify(query);
      return {
        ...fallback,
        confidence: 0.9, // High confidence in fallback
        reasoning: 'Overridden LLM classification with fallback for clarification query'
      };
    }

    console.log(`[QueryClassifier] Final result: primaryPOI="${classified.entities.primaryPOI}", secondaryPOI="${classified.entities.secondaryPOI}", cuisine="${classified.entities.cuisine}"`);

    return classified;
  }

  /**
   * Fallback rule-based classification when LLM fails
   */
  private fallbackClassify(
    query: string,
    context?: ConversationContext
  ): ClassifiedQuery {
    const lowerQuery = query.toLowerCase();
    const entities: QueryEntities = {};

    // Extract transport mode
    if (lowerQuery.includes('walk')) entities.transport = 'walking';
    else if (lowerQuery.includes('driv')) entities.transport = 'driving';
    else if (lowerQuery.includes('cycl') || lowerQuery.includes('bike'))
      entities.transport = 'cycling';

    // Extract time constraint
    const timeMatch = lowerQuery.match(/(\d+)\s*(min|minute)/);
    if (timeMatch) {
      entities.timeConstraint = parseInt(timeMatch[1]);
    }

    // Extract POI types and destinations for enroute queries
    if (lowerQuery.match(/restaurant|food|eat|grab.*bite|quick.*bite|dining|meal|bite|food/)) {
      entities.primaryPOI = 'restaurant';
    } else if (lowerQuery.match(/coffee|cafe|drink/)) {
      entities.primaryPOI = 'cafe';
    } else if (lowerQuery.match(/gas|fuel|station/)) {
      entities.primaryPOI = 'gas_station';
    } else if (lowerQuery.match(/pharmacy|drug|medicine/)) {
      entities.primaryPOI = 'pharmacy';
    }

    // Extract destination for enroute queries
    if (lowerQuery.match(/downtown|city center|center/)) {
      entities.destination = 'downtown';
    } else if (lowerQuery.match(/airport/)) {
      entities.destination = 'airport';
    } else if (lowerQuery.match(/movie|theater|cinema/)) {
      entities.destination = 'movie theater';
    }

    // Classify intent based on keywords
    let intent: QueryIntent = 'clarification';
    let complexity: QueryComplexity = 'simple';

    // Check for clarification patterns first (before other patterns)
    if (lowerQuery.match(/how about|what about|try|instead|change|switch|different|other/)) {
      intent = 'clarification';
    } else if (lowerQuery.match(/on the way|enroute|before going|along the way|on my way|grab.*on.*way|quick.*on.*way|eat.*on.*way|coffee.*on.*way|bite.*on.*way|food.*on.*way/)) {
      intent = 'find-enroute';
      complexity = 'multi-step';
    } else if (lowerQuery.match(/nearest|closest/)) {
      intent = 'find-nearest';
    } else if (lowerQuery.match(/within|in.*minutes|in.*mins/) && !lowerQuery.match(/how about|what about|try|instead|change|switch|different|other/)) {
      intent = 'find-within-time';
    } else if (lowerQuery.match(/near|close to|around/)) {
      intent = 'find-near-poi';
      complexity = 'multi-step';
    } else if (lowerQuery.match(/directions|route|how to get|navigate|way to|path to|give me directions|show me the way|take me to/)) {
      intent = 'get-directions';
    } else if (
      context &&
      context.lastQuery &&
      lowerQuery.match(/more|details|that|this|it|yes|give me|show me/)
    ) {
      intent = 'follow-up';
    }

    return {
      intent,
      complexity,
      entities,
      requiresContext: intent === 'follow-up',
      confidence: 0.6, // Lower confidence for fallback
      reasoning: 'Fallback rule-based classification',
    };
  }

  /**
   * Default inline prompt template (fallback)
   */
  private getDefaultPrompt(): string {
    return `You are a query classifier. Classify the following location search query.

Respond with JSON containing:
- intent: "find-nearest" | "find-within-time" | "find-near-poi" | "find-enroute" | "follow-up" | "clarification"
- complexity: "simple" | "multi-step"
- entities: { primaryPOI?, secondaryPOI?, transport?, timeConstraint?, destination?, cuisine? }
- requiresContext: boolean
- confidence: number (0-1)
- reasoning: string

Query:`;
  }
}

// Export singleton instance
let classifierInstance: QueryClassifier | null = null;

export function getQueryClassifier(): QueryClassifier {
  if (!classifierInstance) {
    classifierInstance = new QueryClassifier();
  }
  return classifierInstance;
}

export default QueryClassifier;
