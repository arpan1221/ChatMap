/**
 * Geocode Use Case
 * Converts address strings to geographic coordinates
 */

import { getNominatimClient } from '@/src/clients/nominatim-client';
import type {
  GeocodeRequest,
  GeocodeResult,
  UseCaseResult,
  UseCaseMetadata,
} from './types';
import {
  createSuccess,
  createError,
  UseCaseErrorCode,
} from './types';

/**
 * Geocode an address to coordinates
 * 
 * Flow:
 * 1. Validate input
 * 2. Call Nominatim API
 * 3. Return locations
 */
export async function geocode(
  request: GeocodeRequest
): Promise<UseCaseResult<GeocodeResult>> {
  const startTime = Date.now();

  try {
    // Step 1: Validate
    if (!request.address || request.address.trim().length < 2) {
      return createError(
        UseCaseErrorCode.INVALID_INPUT,
        'Address must be at least 2 characters'
      );
    }

    // Step 2: Call Nominatim
    const nominatimClient = getNominatimClient();
    
    const results = await nominatimClient.search({
      q: request.address,
      limit: request.maxResults || 5,
      countrycodes: request.countryCode,
      viewbox: request.bounds
        ? `${request.bounds.west},${request.bounds.south},${request.bounds.east},${request.bounds.north}`
        : undefined,
      addressdetails: 1,
      dedupe: 1, // Remove duplicate results for faster processing
    });

    if (results.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No locations found for: ${request.address}`,
        { address: request.address }
      );
    }

    // Convert NominatimResults to Locations
    const locations = results.map(result => ({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
      address: result.address,
    }));

    const metadata: UseCaseMetadata = {
      executionTimeMs: Date.now() - startTime,
      apiCallsCount: 1,
    };

    return createSuccess<GeocodeResult>(
      {
        locations,
        query: request.address,
        resultCount: locations.length,
      },
      metadata
    );
  } catch (error) {
    console.error('[Geocode] Error:', error);

    return createError(
      UseCaseErrorCode.GEOCODING_FAILED,
      error instanceof Error ? error.message : 'Geocoding failed',
      error,
      true
    );
  }
}

export default geocode;
