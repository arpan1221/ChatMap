/**
 * Agent API Route
 * Intelligent query processing using LangChain agents
 * Routes queries through appropriate agents for optimal handling
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentOrchestrator,
  AgentOrchestrator,
  type OrchestratorRequest,
  type OrchestratorResponse,
} from '@/src/agents/agent-orchestrator';
import type { APIResponse } from '@/src/lib/types';

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/agent
 * Process a natural language query using intelligent agent routing
 * 
 * @example
 * ```json
 * {
 *   "query": "Find coffee shops within 15 minutes walk",
 *   "userId": "user123",
 *   "userLocation": {
 *     "lat": 51.5074,
 *     "lng": -0.1278,
 *     "display_name": "London"
 *   },
 *   "conversationHistory": {
 *     "messages": [
 *       {"role": "user", "content": "Show me restaurants"},
 *       {"role": "assistant", "content": "Here are restaurants near you..."}
 *     ]
 *   },
 *   "memoryEnabled": true
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<OrchestratorResponse>>> {
  try {
    const body = await request.json();

    // Validate request
    if (!AgentOrchestrator.validateRequest(body)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Invalid request. Provide: query (string), userId (string), and optional userLocation.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const orchestratorRequest: OrchestratorRequest = {
      query: body.query,
      userId: body.userId,
      userLocation: body.userLocation,
      conversationHistory: body.conversationHistory,
      memoryEnabled: body.memoryEnabled !== false,
    };

    // Get orchestrator
    const orchestrator = getAgentOrchestrator(true); // verbose mode

    // Orchestrate query through agents
    const response = await orchestrator.orchestrate(orchestratorRequest);

    // Return response
    if (response.success) {
      return NextResponse.json({
        success: true,
        data: response,
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: response.error || 'Agent execution failed',
          data: response,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[Agent API] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process query',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agent
 * Health check and agent system information
 */
export async function GET(): Promise<NextResponse<APIResponse<unknown>>> {
  try {
    const orchestrator = getAgentOrchestrator();
    const stats = orchestrator.getStats();

    return NextResponse.json({
      success: true,
      data: {
        status: 'Agent system operational',
        ...stats,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Agent system unavailable',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
