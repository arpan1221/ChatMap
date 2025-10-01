/**
 * Query Classification API Route
 * Classifies user queries on the server side where environment variables are available
 */

import { NextRequest, NextResponse } from 'next/server';
import { getQueryClassifier } from '@/src/agents/query-classifier';
import type { ClassifiedQuery, ConversationContext } from '@/src/agents/query-classifier';
import type { APIResponse } from '@/src/lib/types';

export const runtime = 'nodejs';

interface ClassifyRequest {
  query: string;
  context?: ConversationContext;
}

/**
 * POST /api/classify
 * Classify a user query
 */
export async function POST(request: NextRequest) {
  try {
    const body: ClassifyRequest = await request.json();
    const { query, context } = body;

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error: 'Query is required',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    // Use the query classifier on the server side
    const classifier = getQueryClassifier();
    const classification = await classifier.classify(query, context);

    return NextResponse.json({
      success: true,
      data: classification,
      timestamp: new Date().toISOString(),
    } as APIResponse<ClassifiedQuery>);
  } catch (error) {
    console.error('[Classify API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Classification failed',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}
