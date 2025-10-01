/**
 * Find Nearest POI API Route
 * Find the single nearest POI of a type
 * Delegates to findNearestPOI use case
 */

import { NextRequest, NextResponse } from 'next/server';
import { findNearestPOI } from '@/src/usecases';
import type { APIResponse, POI, POIType, TransportMode, Location } from '@/src/lib/types';
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

const FindNearestPOIRequestSchema = z.object({
  poiType: POITypeSchema,
  userLocation: LocationSchema,
  transport: TransportModeSchema.optional().default('walking'),
  maxDistanceMeters: z.number().optional(),
  maxTimeMinutes: z.number().min(1).max(120).optional().default(30),
  cuisine: z.string().optional(),
});

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/poi/nearest
 * Find the nearest POI of a given type
 * 
 * @example
 * ```json
 * {
 *   "poiType": "cafe",
 *   "userLocation": { "lat": 51.5074, "lng": -0.1278, "display_name": "London" },
 *   "transport": "walking",
 *   "maxTimeMinutes": 15
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<{ nearest: POI; alternatives: POI[] }>>> {
  try {
    const body = await request.json();

    // Validate request
    const validation = FindNearestPOIRequestSchema.safeParse(body);
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
      transport,
      maxDistanceMeters,
      maxTimeMinutes,
      cuisine,
    } = validation.data;

    // Call use case
    const result = await findNearestPOI({
      poiType,
      userLocation,
      transport,
      maxDistanceMeters,
      maxTimeMinutes,
      cuisine,
    });

    // Handle error from use case
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Failed to find nearest POI',
          details: result.error?.details,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: result.error?.code === 'NO_RESULTS_FOUND' ? 404 : 500 }
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      data: {
        nearest: result.data!.poi,
        alternatives: result.data!.alternativePOIs || [],
        strategy: result.data!.strategy,
      },
      metadata: {
        distance: result.data!.distance,
        travelTime: result.data!.travelTime,
        transport: result.data!.transport,
        poiType,
        location: userLocation.display_name,
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse);
  } catch (error) {
    console.error('[FindNearestPOI API] Error:', error);

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
 * GET /api/poi/nearest
 * Health check and API information
 */
export async function GET(): Promise<NextResponse<APIResponse<unknown>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'healthy',
      endpoint: '/api/poi/nearest',
      method: 'POST',
      description: 'Find the single nearest POI of a given type',
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
    },
    timestamp: new Date().toISOString(),
  } as APIResponse);
}
