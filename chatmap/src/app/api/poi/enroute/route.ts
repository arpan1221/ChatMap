/**
 * Find POI Enroute API Route
 * Find optimal POI stopover along route to destination
 * Delegates to findPOIEnroute use case
 */

import { NextRequest, NextResponse } from 'next/server';
import { findPOIEnroute } from '@/src/usecases';
import type { APIResponse, POI, POIType, TransportMode, Location } from '@/src/lib/types';
import type { FindPOIEnrouteResult } from '@/src/usecases/types';
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

const POITypeSchema = z.enum([
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

const FindPOIEnrouteRequestSchema = z.object({
  poiType: POITypeSchema,
  userLocation: LocationSchema,
  destination: z.union([z.string().min(2), LocationSchema]),
  transport: TransportModeSchema.optional().default('driving'),
  maxTotalTimeMinutes: z.number().min(5).max(180),
  maxDetourMinutes: z.number().min(1).max(30).optional().default(10),
  cuisine: z.string().optional(),
});

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/poi/enroute
 * Find optimal POI stopover along route to destination
 * 
 * @example
 * ```json
 * {
 *   "poiType": "gas_station",
 *   "userLocation": { "lat": 34.0522, "lng": -118.2437, "display_name": "Los Angeles" },
 *   "destination": "LAX Airport",
 *   "transport": "driving",
 *   "maxTotalTimeMinutes": 45,
 *   "maxDetourMinutes": 5
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<FindPOIEnrouteResult>>> {
  try {
    const body = await request.json();

    // Validate request
    const validation = FindPOIEnrouteRequestSchema.safeParse(body);
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

    const {
      poiType,
      userLocation,
      destination,
      transport,
      maxTotalTimeMinutes,
      maxDetourMinutes,
      cuisine,
    } = validation.data;

    // Call use case
    const result = await findPOIEnroute({
      poiType,
      userLocation,
      destination,
      transport,
      maxTotalTimeMinutes,
      maxDetourMinutes,
      cuisine,
    });

    // Handle error from use case
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Failed to find POI enroute',
          details: result.error?.details,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { 
          status: result.error?.code === 'NO_RESULTS_FOUND' ? 404 :
                  result.error?.code === 'TIME_CONSTRAINT_EXCEEDED' ? 400 : 500
        }
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      data: result.data!,
      metadata: {
        poiType,
        transport,
        origin: userLocation.display_name,
        destination: result.data!.destination.display_name,
        directDuration: result.data!.directRoute.duration,
        optimizedDuration: result.data!.optimizedRoute.duration,
        timeSavings: result.data!.timeSavings,
        detourDistance: result.data!.detourDistance,
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<FindPOIEnrouteResult>);
  } catch (error) {
    console.error('[FindPOIEnroute API] Error:', error);

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
 * GET /api/poi/enroute
 * Health check and API information
 */
export async function GET(): Promise<NextResponse<APIResponse<unknown>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'healthy',
      endpoint: '/api/poi/enroute',
      method: 'POST',
      description: 'Find optimal POI stopover along route to destination',
      complexity: 'multi-step',
      exampleQuery: 'Find gas station before going to airport in 30 minutes',
      supportedPOITypes: [
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
      ],
      supportedTransportModes: ['walking', 'driving', 'cycling', 'public_transport'],
      timeConstraints: {
        maxTotalTime: { min: 5, max: 180, unit: 'minutes' },
        maxDetour: { min: 1, max: 30, unit: 'minutes' },
      },
    },
    timestamp: new Date().toISOString(),
  } as APIResponse);
}
