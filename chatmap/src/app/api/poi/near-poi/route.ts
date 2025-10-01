/**
 * Find POIs Near POI API Route
 * Find POIs of type X near the nearest POI of type Y
 * Delegates to findPOIsNearPOI use case
 */

import { NextRequest, NextResponse } from 'next/server';
import { findPOIsNearPOI } from '@/src/usecases';
import type { APIResponse, POI, POIType, TransportMode, Location } from '@/src/lib/types';
import type { POIWithDistance } from '@/src/usecases/types';
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

const FindPOIsNearPOIRequestSchema = z.object({
  primaryPOIType: POITypeSchema,
  secondaryPOIType: POITypeSchema,
  userLocation: LocationSchema,
  transport: TransportModeSchema.optional().default('walking'),
  maxTimeFromSecondary: z.number().min(1).max(60).optional().default(15),
  maxResults: z.number().min(1).max(50).optional().default(20),
  cuisine: z.string().optional(),
});

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/poi/near-poi
 * Find POIs of type X near the nearest POI of type Y
 * 
 * @example
 * ```json
 * {
 *   "primaryPOIType": "cafe",
 *   "secondaryPOIType": "park",
 *   "userLocation": { "lat": 51.5074, "lng": -0.1278, "display_name": "London" },
 *   "transport": "walking",
 *   "maxTimeFromSecondary": 10,
 *   "maxResults": 10
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<{ anchorPOI: POI; primaryPOIs: POIWithDistance[] }>>> {
  try {
    const body = await request.json();

    // Validate request
    const validation = FindPOIsNearPOIRequestSchema.safeParse(body);
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
      primaryPOIType,
      secondaryPOIType,
      userLocation,
      transport,
      maxTimeFromSecondary,
      maxResults,
      cuisine,
    } = validation.data;

    // Call use case
    const result = await findPOIsNearPOI({
      primaryPOIType,
      secondaryPOIType,
      userLocation,
      transport,
      maxTimeFromSecondary,
      maxResults,
      cuisine,
    });

    // Handle error from use case
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Failed to find POIs near POI',
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
        anchorPOI: result.data!.anchorPOI,
        primaryPOIs: result.data!.primaryPOIs,
      },
      metadata: {
        count: result.data!.count,
        transport: result.data!.transport,
        searchRadius: result.data!.searchRadius,
        primaryPOIType,
        secondaryPOIType,
        location: userLocation.display_name,
        maxTimeFromSecondary,
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
        warnings: result.metadata?.warnings,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse);
  } catch (error) {
    console.error('[FindPOIsNearPOI API] Error:', error);

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
 * GET /api/poi/near-poi
 * Health check and API information
 */
export async function GET(): Promise<NextResponse<APIResponse<unknown>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'healthy',
      endpoint: '/api/poi/near-poi',
      method: 'POST',
      description: 'Find POIs of type X near the nearest POI of type Y',
      complexity: 'multi-step',
      exampleQuery: 'Find coffee shops near the nearest park',
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
