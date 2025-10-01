/**
 * Agent Orchestrator
 * Routes queries to appropriate agents based on classification
 * Coordinates multi-agent workflows
 */

import { getQueryClassifier, type ClassifiedQuery, type ConversationContext } from './query-classifier';
import { getSimpleQueryAgent } from './simple-query-agent';
import { getMultiStepQueryAgent } from './multi-step-query-agent';
import type { BaseAgent, AgentContext, AgentResult } from './base-agent';
import type { Location, MemoryContextSummary } from '@/src/lib/types';
import { getMemoryClient } from '@/src/clients/memory-client';
import { Config } from '@/src/lib/config';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorRequest {
  query: string;
  userId: string;
  userLocation?: Location;
  conversationHistory?: ConversationContext;
  memoryEnabled?: boolean;
}

export interface OrchestratorResponse {
  success: boolean;
  classification: ClassifiedQuery;
  agentUsed: string;
  result?: AgentResult;
  error?: string;
  timestamp: string;
}

// ============================================================================
// Agent Orchestrator
// ============================================================================

export class AgentOrchestrator {
  private classifier;
  private simpleAgent;
  private multiStepAgent;
  private verbose: boolean;

  constructor(verbose = false) {
    this.classifier = getQueryClassifier();
    this.simpleAgent = getSimpleQueryAgent();
    this.multiStepAgent = getMultiStepQueryAgent();
    this.verbose = verbose;
  }

  /**
   * Main orchestration method
   * Classifies query and routes to appropriate agent
   */
  async orchestrate(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    const startTime = Date.now();

    try {
      // Step 1: Load memory context if enabled
      let memoryContext: MemoryContextSummary | undefined;
      if (request.memoryEnabled !== false && Config.memory.enabled) {
        try {
          const memoryClient = getMemoryClient();
          memoryContext = await memoryClient.getMemoryContext(request.userId);
          
          if (this.verbose) {
            console.log('[Orchestrator] Memory context loaded:', {
              preferences: Object.keys(memoryContext.preferences).length,
              conversations: memoryContext.conversationMemories.length,
              locations: memoryContext.locationHistory.length,
            });
          }
        } catch (error) {
          console.error('[Orchestrator] Failed to load memory context:', error);
          // Continue without memory - don't fail the entire request
        }
      }

      // Step 2: Classify the query
      if (this.verbose) {
        console.log('[Orchestrator] Classifying query:', request.query);
      }

      const classification = await this.classifier.classify(
        request.query,
        request.conversationHistory
      );

      if (this.verbose) {
        console.log('[Orchestrator] Classification:', {
          intent: classification.intent,
          complexity: classification.complexity,
          confidence: classification.confidence,
        });
      }

      // Step 3: Check if clarification is needed
      if (classification.intent === 'clarification' || classification.confidence < 0.5) {
        return {
          success: false,
          classification,
          agentUsed: 'none',
          error: 'Query needs clarification. Please be more specific about what you\'re looking for.',
          timestamp: new Date().toISOString(),
        };
      }

      // Step 4: Handle follow-up queries
      if (classification.intent === 'follow-up') {
        return this.handleFollowUp(request, classification);
      }

      // Step 5: Handle get-directions queries
      if (classification.intent === 'get-directions') {
        return this.handleGetDirections(request, classification);
      }

      // Step 6: Select and execute appropriate agent
      const agent = this.selectAgent(classification);
      const agentName = agent instanceof getSimpleQueryAgent().constructor
        ? 'SimpleQueryAgent'
        : 'MultiStepQueryAgent';

      if (this.verbose) {
        console.log(`[Orchestrator] Routing to ${agentName}`);
      }

      // Build agent context with memory
      const context: AgentContext = {
        userId: request.userId,
        userLocation: request.userLocation,
        conversationHistory: request.conversationHistory,
        entities: classification.entities,
        memoryEnabled: request.memoryEnabled !== false,
        memoryContext,
      };

      // Execute agent
      const result = await agent.execute(request.query, context);

      // Step 6: Store result in memory if enabled
      if (request.memoryEnabled !== false && Config.memory.enabled && result.success) {
        try {
          const memoryClient = getMemoryClient();
          await memoryClient.addMemory({
            userId: request.userId,
            content: request.query,
            type: 'conversation',
            metadata: {
              query: request.query,
              intent: classification.intent,
              complexity: classification.complexity,
              agentUsed: agentName,
              result: result.data,
              userLocation: request.userLocation,
              timestamp: new Date().toISOString(),
            },
          });

          if (this.verbose) {
            console.log('[Orchestrator] Result stored in memory');
          }
        } catch (error) {
          console.error('[Orchestrator] Failed to store in memory:', error);
          // Continue - don't fail the entire request
        }
      }

      const elapsed = Date.now() - startTime;
      if (this.verbose) {
        console.log(`[Orchestrator] Completed in ${elapsed}ms`);
      }

      return {
        success: result.success,
        classification,
        agentUsed: agentName,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[Orchestrator] Error:', error);

      return {
        success: false,
        classification: {
          intent: 'clarification',
          complexity: 'simple',
          entities: {},
          requiresContext: false,
          confidence: 0,
          reasoning: 'Error during orchestration',
        },
        agentUsed: 'none',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Select appropriate agent based on classification
   */
  private selectAgent(classification: ClassifiedQuery): BaseAgent {
    // Simple queries → Simple Agent
    if (classification.complexity === 'simple') {
      return this.simpleAgent;
    }

    // Multi-step queries → Multi-Step Agent
    if (classification.complexity === 'multi-step') {
      return this.multiStepAgent;
    }

    // Default to simple agent
    return this.simpleAgent;
  }

  /**
   * Handle get-directions queries
   * Gets directions to a specific location
   */
  private handleGetDirections(
    request: OrchestratorRequest,
    classification: ClassifiedQuery
  ): OrchestratorResponse {
    // For now, this is a placeholder implementation
    // In a full implementation, this would:
    // 1. Determine the destination from conversation context or user input
    // 2. Get directions from user's current location to destination
    // 3. Return route information

    return {
      success: true,
      classification,
      agentUsed: 'DirectionsHandler',
      result: {
        success: true,
        data: {
          message: 'Directions feature is coming soon! Please use the map to navigate to your destination.',
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle follow-up queries
   * Uses conversation context to maintain continuity
   */
  private handleFollowUp(
    request: OrchestratorRequest,
    classification: ClassifiedQuery
  ): OrchestratorResponse {
    // For now, return a message asking for more context
    // In a full implementation, this would:
    // 1. Retrieve last query results from conversation
    // 2. Apply modifications based on follow-up
    // 3. Return updated results

    return {
      success: false,
      classification,
      agentUsed: 'FollowUpHandler',
      error: 'Follow-up queries require conversation context. This feature is coming soon!',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate orchestrator request
   */
  static validateRequest(request: unknown): request is OrchestratorRequest {
    if (!request || typeof request !== 'object') {
      return false;
    }

    const req = request as Partial<OrchestratorRequest>;

    // Query must be a non-empty string
    if (!req.query || typeof req.query !== 'string' || req.query.trim().length === 0) {
      return false;
    }

    // UserId must be a non-empty string
    if (!req.userId || typeof req.userId !== 'string' || req.userId.trim().length === 0) {
      return false;
    }

    // User location is optional but must be valid if provided
    if (req.userLocation) {
      if (
        typeof req.userLocation.lat !== 'number' ||
        typeof req.userLocation.lng !== 'number' ||
        req.userLocation.lat < -90 ||
        req.userLocation.lat > 90 ||
        req.userLocation.lng < -180 ||
        req.userLocation.lng > 180
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    return {
      agents: {
        simple: this.simpleAgent.name,
        multiStep: this.multiStepAgent.name,
      },
      classifier: {
        available: !!this.classifier,
      },
    };
  }
}

// Export singleton instance
let orchestratorInstance: AgentOrchestrator | null = null;

export function getAgentOrchestrator(verbose = false): AgentOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new AgentOrchestrator(verbose);
  }
  return orchestratorInstance;
}

export default AgentOrchestrator;
