/**
 * Matrix API Route
 * Calculate travel time/distance matrices between multiple locations
 * Uses OpenRouteService Matrix API
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getORSClient, ORSError } from '@/src/clients/ors-client';
import type { Location, TransportMode, APIResponse } from '@/src/lib/types';

// ============================================================================
// Request/Response Types
// ============================================================================

interface MatrixRequestBody {
  locations: Location[];
  profile?: TransportMode;
  sources?: number[]; // Indices of source locations
  destinations?: number[]; // Indices of destination locations
  metrics?: ('distance' | 'duration')[];
  units?: 'm' | 'km' | 'mi';
}

interface MatrixResponseData {
  durations?: number[][]; // Matrix of durations in seconds
  distances?: number[][]; // Matrix of distances in meters
  sources: {
    location: [number, number];
    snappedDistance?: number;
  }[];
  destinations: {
    location: [number, number];
    snappedDistance?: number;
  }[];
  metadata: {
    profile: string;
    timestamp: string;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function validateMatrixRequest(body: unknown): body is MatrixRequestBody {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const req = body as Partial<MatrixRequestBody>;

  // Validate locations array
  if (!Array.isArray(req.locations) || req.locations.length < 2) {
    return false;
  }

  // Validate each location
  for (const loc of req.locations) {
    if (
      typeof loc.lat !== 'number' ||
      typeof loc.lng !== 'number' ||
      loc.lat < -90 ||
      loc.lat > 90 ||
      loc.lng < -180 ||
      loc.lng > 180
    ) {
      return false;
    }
  }

  // Validate sources/destinations if provided
  if (req.sources && !Array.isArray(req.sources)) {
    return false;
  }

  if (req.destinations && !Array.isArray(req.destinations)) {
    return false;
  }

  return true;
}

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/matrix
 * Calculate travel time/distance matrix between locations
 * 
 * @example
 * ```json
 * {
 *   "locations": [
 *     { "lat": 51.5074, "lng": -0.1278, "display_name": "London" },
 *     { "lat": 51.5155, "lng": -0.0922, "display_name": "Shoreditch" },
 *     { "lat": 51.5033, "lng": -0.1195, "display_name": "Waterloo" }
 *   ],
 *   "profile": "driving",
 *   "metrics": ["duration", "distance"]
 * }
 * ```
 */
export async function POST(request: NextRequest): Promise<NextResponse<APIResponse<MatrixResponseData>>> {
  try {
    const body = await request.json();

    // Validate request
    if (!validateMatrixRequest(body)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request. Provide at least 2 locations with valid coordinates.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const {
      locations,
      profile = 'driving',
      sources,
      destinations,
      metrics = ['duration', 'distance'],
      units = 'm',
    } = body;

    // Check location count limits
    if (locations.length > 50) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many locations. Maximum is 50.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Get ORS client
    const orsClient = getORSClient();

    // Calculate matrix
    const matrixResponse = await orsClient.getMatrix({
      locations,
      profile,
      sources,
      destinations,
      metrics,
      units,
    });

    // Build response
    const responseData: MatrixResponseData = {
      durations: matrixResponse.durations,
      distances: matrixResponse.distances,
      sources: matrixResponse.sources,
      destinations: matrixResponse.destinations,
      metadata: {
        profile,
        timestamp: new Date().toISOString(),
      },
    };

    return NextResponse.json({
      success: true,
      data: responseData,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[Matrix API] Error:', error);

    if (error instanceof ORSError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          details: {
            statusCode: error.statusCode,
            orsErrorCode: error.orsErrorCode,
          },
          timestamp: new Date().toISOString(),
        },
        { status: error.statusCode || 500 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to calculate matrix',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/matrix
 * Health check endpoint
 */
export async function GET(): Promise<NextResponse<APIResponse<{ status: string }>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'Matrix API is operational',
    },
    timestamp: new Date().toISOString(),
  });
}
