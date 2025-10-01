/**
 * Directions API Route
 * Calculate routes between locations
 * Delegates to getRoute use case
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRoute } from '@/src/usecases';
import type { APIResponse, Location, TransportMode } from '@/src/lib/types';
import type { RouteInfo } from '@/src/usecases/types';
import { z } from 'zod';

// ============================================================================
// Request Validation
// ============================================================================

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  display_name: z.string(),
  address: z.any().optional(),
});

const TransportModeSchema = z.enum(['walking', 'driving', 'cycling', 'public_transport']);

const AvoidFeaturesSchema = z.array(
  z.enum(['highways', 'tollways', 'ferries', 'fords', 'steps'])
).optional();

const DirectionsRequestSchema = z.object({
  start: LocationSchema,
  end: LocationSchema,
  waypoints: z.array(LocationSchema).optional(),
  transport: TransportModeSchema.optional().default('driving'),
  avoidFeatures: AvoidFeaturesSchema,
  alternativeRoutes: z.boolean().optional().default(false),
});

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/directions
 * Get turn-by-turn directions between locations
 * 
 * @example
 * ```json
 * {
 *   "start": { "lat": 51.5074, "lng": -0.1278, "display_name": "London" },
 *   "end": { "lat": 48.8566, "lng": 2.3522, "display_name": "Paris" },
 *   "waypoints": [...],
 *   "transport": "driving",
 *   "avoidFeatures": ["tollways", "ferries"],
 *   "alternativeRoutes": true
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<RouteInfo[]>>> {
  try {
    const body = await request.json();
    console.log('[Directions API] Request body:', JSON.stringify(body, null, 2));

    // Validate request
    const validation = DirectionsRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request parameters',
          details: validation.error.errors,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    const { start, end, waypoints, transport, avoidFeatures, alternativeRoutes } =
      validation.data;

    // Call use case
    const result = await getRoute({
      start,
      end,
      waypoints,
      transport,
      avoidFeatures,
      alternativeRoutes,
    });

    // Handle error from use case
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Failed to calculate route',
          details: result.error?.details,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 500 }
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      data: result.data!.routes,
      metadata: {
        transport: result.data!.transport,
        bestRouteIndex: result.data!.bestRouteIndex,
        routeCount: result.data!.routes.length,
        totalDistance: result.data!.routes[result.data!.bestRouteIndex].distance,
        totalDuration: result.data!.routes[result.data!.bestRouteIndex].duration,
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<RouteInfo[]>);
  } catch (error) {
    console.error('[Directions API] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

/**
 * GET /api/directions
 * Health check and API information
 */
export async function GET(): Promise<NextResponse<APIResponse<unknown>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'healthy',
      endpoint: '/api/directions',
      method: 'POST',
      supportedTransportModes: ['walking', 'driving', 'cycling', 'public_transport'],
      supportedAvoidFeatures: ['highways', 'tollways', 'ferries', 'fords', 'steps'],
      features: {
        alternativeRoutes: true,
        waypoints: true,
        turnByTurnInstructions: true,
        geometryData: true,
      },
    },
    timestamp: new Date().toISOString(),
  } as APIResponse);
}