/**
 * Nominatim Geocoding API Client
 * Handles address to coordinates conversion with rate limiting
 * Complies with Nominatim usage policy
 */

import { Config } from '@/src/lib/config';
import { withRetry, RetryableError } from '@/src/lib/retry';
import { RateLimiter } from '@/src/lib/rate-limiter';
import type { Location } from '@/src/lib/types';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface NominatimSearchParams {
  q?: string; // Free-form query
  street?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  postalcode?: string;
  format?: 'json' | 'jsonv2' | 'geojson' | 'geocodejson';
  addressdetails?: 0 | 1;
  extratags?: 0 | 1;
  namedetails?: 0 | 1;
  limit?: number; // Max results (default 10, max 50)
  bounded?: 0 | 1;
  viewbox?: string; // min_lon,min_lat,max_lon,max_lat
  countrycodes?: string; // Comma-separated ISO 3166-1 alpha-2 codes
  exclude_place_ids?: string; // Comma-separated place IDs to exclude
  dedupe?: 0 | 1; // Remove duplicate results
}

export interface NominatimReverseParams {
  lat: number;
  lon: number;
  format?: 'json' | 'jsonv2' | 'geojson' | 'geocodejson';
  addressdetails?: 0 | 1;
  extratags?: 0 | 1;
  namedetails?: 0 | 1;
  zoom?: number; // Level of detail (0-18)
}

export interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
  [key: string]: string | undefined;
}

export interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
  boundingbox: [string, string, string, string]; // [min_lat, max_lat, min_lon, max_lon]
  importance?: number;
  place_rank?: number;
  category?: string;
  type?: string;
  extratags?: Record<string, string>;
  namedetails?: Record<string, string>;
}

export class NominatimError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'NominatimError';
  }
}

// ============================================================================
// Nominatim Client
// ============================================================================

export class NominatimClient {
  private readonly config = Config.nominatim;
  private readonly rateLimiter: RateLimiter;
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = this.config.endpoint;
    
    // Initialize rate limiter (Nominatim: max 1 request per second)
    this.rateLimiter = new RateLimiter({
      intervalMs: this.config.rateLimitMs,
      maxRequests: 1,
      windowMs: 1000,
      onThrottle: (waitTime) => {
        if (Config.app.isDevelopment) {
          console.log(`[Nominatim] Rate limited, waiting ${waitTime}ms`);
        }
      },
    });
  }

  /**
   * Make a request to Nominatim API with retry logic and rate limiting
   */
  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>
  ): Promise<T> {
    return this.rateLimiter.execute(async () => {
      return withRetry(
        async () => {
          const url = new URL(endpoint, this.baseUrl);

          // Add query parameters
          Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
              url.searchParams.append(key, String(value));
            }
          });

          // Nominatim requires User-Agent header
          const headers: Record<string, string> = {
            'User-Agent': this.config.userAgent,
            'Accept': 'application/json',
            'Accept-Language': 'en', // Prefer English results
          };

          const response = await fetch(url.toString(), {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            
            // Determine if error is retryable
            const isRetryable = response.status >= 500 || response.status === 429;
            
            const error = new NominatimError(
              errorText || `Nominatim API error: ${response.statusText}`,
              response.status,
              { statusText: response.statusText }
            );

            if (isRetryable) {
              throw new RetryableError(error.message, error);
            }
            throw error;
          }

          return response.json() as Promise<T>;
        },
        {
          maxRetries: this.config.maxRetries,
          onRetry: (error, attempt, delay) => {
            console.warn(
              `[Nominatim] Request failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`,
              error instanceof Error ? error.message : String(error)
            );
          },
        }
      );
    });
  }

  /**
   * Search for locations by address or free-form query
   * 
   * @example
   * ```typescript
   * // Free-form search
   * const results = await nominatimClient.search({
   *   q: '1600 Amphitheatre Parkway, Mountain View, CA',
   *   limit: 5,
   * });
   * 
   * // Structured search
   * const results = await nominatimClient.search({
   *   street: '1600 Amphitheatre Parkway',
   *   city: 'Mountain View',
   *   state: 'California',
   *   country: 'USA',
   * });
   * ```
   */
  async search(params: NominatimSearchParams): Promise<NominatimResult[]> {
    const queryParams: Record<string, string | number | undefined> = {
      ...params,
      format: params.format || 'jsonv2',
      addressdetails: params.addressdetails !== undefined ? params.addressdetails : 1,
      limit: params.limit || 10,
    };

    const results = await this.makeRequest<NominatimResult[]>('/search', queryParams);

    // Log attribution in development
    if (Config.app.isDevelopment && results.length > 0) {
      console.log('[Nominatim] Attribution:', results[0].licence);
    }

    return results;
  }

  /**
   * Reverse geocode: convert coordinates to address
   * 
   * @example
   * ```typescript
   * const result = await nominatimClient.reverse({
   *   lat: 37.4224764,
   *   lon: -122.0842499,
   *   zoom: 18,
   * });
   * ```
   */
  async reverse(params: NominatimReverseParams): Promise<NominatimResult> {
    const queryParams: Record<string, string | number | undefined> = {
      lat: params.lat,
      lon: params.lon,
      format: params.format || 'jsonv2',
      addressdetails: params.addressdetails !== undefined ? params.addressdetails : 1,
      zoom: params.zoom || 18,
      extratags: params.extratags,
      namedetails: params.namedetails,
    };

    const result = await this.makeRequest<NominatimResult>('/reverse', queryParams);

    // Log attribution in development
    if (Config.app.isDevelopment) {
      console.log('[Nominatim] Attribution:', result.licence);
    }

    return result;
  }

  /**
   * Geocode a single address string to Location
   * Convenience method for simple geocoding
   * 
   * @example
   * ```typescript
   * const location = await nominatimClient.geocode('Eiffel Tower, Paris');
   * console.log(location); // { lat: 48.858844, lng: 2.294351, display_name: '...' }
   * ```
   */
  async geocode(address: string, options?: { limit?: number; countrycodes?: string }): Promise<Location | null> {
    const results = await this.search({
      q: address,
      limit: options?.limit || 1,
      countrycodes: options?.countrycodes,
      addressdetails: 1,
    });

    if (results.length === 0) {
      return null;
    }

    const result = results[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
      address: result.address,
    };
  }

  /**
   * Reverse geocode coordinates to Location with address
   * Convenience method for simple reverse geocoding
   * 
   * @example
   * ```typescript
   * const location = await nominatimClient.reverseGeocode(48.858844, 2.294351);
   * console.log(location.display_name); // 'Eiffel Tower, ...'
   * ```
   */
  async reverseGeocode(lat: number, lng: number, zoom?: number): Promise<Location | null> {
    const result = await this.reverse({
      lat,
      lon: lng,
      zoom: zoom || 18,
      addressdetails: 1,
    });

    if (!result) {
      return null;
    }

    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
      address: result.address,
    };
  }

  /**
   * Batch geocode multiple addresses
   * Automatically rate-limited to comply with Nominatim policy
   * 
   * @example
   * ```typescript
   * const locations = await nominatimClient.batchGeocode([
   *   'Eiffel Tower, Paris',
   *   'Big Ben, London',
   *   'Colosseum, Rome',
   * ]);
   * ```
   */
  async batchGeocode(addresses: string[], options?: { limit?: number; countrycodes?: string }): Promise<(Location | null)[]> {
    const results: (Location | null)[] = [];

    for (const address of addresses) {
      try {
        const location = await this.geocode(address, options);
        results.push(location);
      } catch (error) {
        console.error(`[Nominatim] Failed to geocode "${address}":`, error);
        results.push(null);
      }
    }

    return results;
  }

  /**
   * Get location suggestions/autocomplete for partial address
   * Returns multiple results for user to choose from
   * 
   * @example
   * ```typescript
   * const suggestions = await nominatimClient.suggest('123 Main St', 5);
   * // Returns up to 5 matching addresses
   * ```
   */
  async suggest(partialAddress: string, limit: number = 5): Promise<Location[]> {
    const results = await this.search({
      q: partialAddress,
      limit,
      addressdetails: 1,
      dedupe: 1,
    });

    return results.map(result => ({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
      address: result.address,
    }));
  }
}

// Export singleton instance
let nominatimClientInstance: NominatimClient | null = null;

export function getNominatimClient(): NominatimClient {
  if (!nominatimClientInstance) {
    nominatimClientInstance = new NominatimClient();
  }
  return nominatimClientInstance;
}

export default NominatimClient;
