/**
 * Agent API Client
 * Calls the intelligent agent system for query processing
 */

import type { Location } from './types';

// ============================================================================
// Types
// ============================================================================

export interface AgentRequest {
  query: string;
  userId: string;
  userLocation?: Location;
  conversationHistory?: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    lastQuery?: unknown;
    lastResults?: {
      pois?: unknown[];
      route?: unknown;
    };
  };
  memoryEnabled?: boolean;
}

export interface AgentResponse {
  success: boolean;
  data?: {
    classification: {
      intent: string;
      complexity: 'simple' | 'multi-step';
      entities: Record<string, unknown>;
      requiresContext: boolean;
      confidence: number;
      reasoning: string;
    };
    agentUsed: string;
    result: {
      success: boolean;
      data?: {
        poi?: unknown;
        pois?: unknown[];
        count?: number;
        isochrone?: unknown;
        anchorPOI?: unknown;
        primaryPOIs?: unknown[];
        routes?: unknown[];
        [key: string]: unknown;
      };
      message?: string;
      error?: string;
      toolsUsed?: string[];
      reasoningSteps?: string[];
    };
  };
  error?: string;
  timestamp: string;
}

/**
 * Call the agent endpoint to process a natural language query
 */
export async function callAgentAPI(request: AgentRequest): Promise<AgentResponse> {
  try {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('[AgentAPI] Error:', error);
    throw error;
  }
}

/**
 * Format agent response for chat display
 */
export function formatAgentResponseForChat(
  agentResponse: AgentResponse
): {
  content: string;
  metadata: {
    agent: {
      classification: unknown;
      agentUsed: string;
      toolsUsed?: string[];
      reasoningSteps?: string[];
      executionTimeMs?: number;
      apiCallsCount?: number;
      warnings?: string[];
    };
  };
  data: unknown;
} {
  if (!agentResponse.success || !agentResponse.data) {
    return {
      content: agentResponse.error || 'Agent processing failed',
      metadata: {
        agent: {
          classification: undefined,
          agentUsed: 'error',
        },
      },
      data: null,
    };
  }

  const { classification, agentUsed, result } = agentResponse.data;

  // Generate user-friendly message based on intent and result
  let content = result.message || 'Query processed successfully';

  if (result.success && result.data) {
    const data: any = result.data;
    
    // Format response based on what data we have
    if (data.poi) {
      content = `Found ${data.poi.name} at ${data.distance}m away (${data.travelTime} min ${data.transport})`;
      if (data.alternativePOIs && data.alternativePOIs.length > 0) {
        content += `\n\nAlternatives: ${data.alternativePOIs.slice(0, 2).map((p: any) => p.name).join(', ')}`;
      }
    } else if (data.pois && data.count) {
      content = `Found ${data.count} ${classification.entities?.primaryPOI || 'locations'} within ${classification.entities?.timeConstraint || data.timeMinutes} minutes`;
      if (data.pois.length > 0) {
        const top3 = data.pois.slice(0, 3);
        content += `:\n\n${top3.map((p: any) => `• ${p.name} (${p.distance}m away)`).join('\n')}`;
        if (data.count > 3) {
          content += `\n\n...and ${data.count - 3} more`;
        }
      }
    } else if (data.anchorPOI && data.primaryPOIs) {
      content = `Found ${data.count} ${classification.entities?.primaryPOIType || 'places'} near ${data.anchorPOI.name}`;
      if (data.primaryPOIs.length > 0) {
        const top3 = data.primaryPOIs.slice(0, 3);
        content += `:\n\n${top3.map((p: any) => `• ${p.name} (${p.travelTimeFromAnchor} min from ${data.anchorPOI.name})`).join('\n')}`;
      }
    } else if (data.stopoverPOI && data.destination) {
      content = `Optimal stopover: ${data.stopoverPOI.name}\n\n`;
      content += `Direct route: ${data.directRoute.duration} min\n`;
      content += `With stopover: ${data.optimizedRoute.duration} min\n`;
      content += `Detour: ${Math.abs(data.timeSavings)} min added`;
    } else if (data.routes) {
      const route: any = data.routes[0];
      content = `Route calculated: ${route.distance}m (${route.duration} min)`;
    }
  } else if (result.error) {
    content = result.error;
  }

  return {
    content,
    metadata: {
      agent: {
        classification,
        agentUsed,
        toolsUsed: result.toolsUsed,
        reasoningSteps: result.reasoningSteps,
        executionTimeMs: undefined, // Will be calculated by caller
        apiCallsCount: undefined, // Extracted from result data
        warnings: undefined,
      },
    },
    data: result.data,
  };
}

export default {
  callAgentAPI,
  formatAgentResponseForChat,
};
