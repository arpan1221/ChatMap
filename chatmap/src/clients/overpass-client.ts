/**
 * Overpass API Client
 * Handles POI queries from OpenStreetMap with bounded bbox and rate limiting
 */

import { Config } from '@/src/lib/config';
import { withRetry, RetryableError } from '@/src/lib/retry';
import { RateLimiter } from '@/src/lib/rate-limiter';
import type { POI, POIType, Location } from '@/src/lib/types';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface OverpassBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OverpassQueryOptions {
  bounds: OverpassBounds;
  tags?: Record<string, string | string[]>;
  timeout?: number;
  maxResults?: number;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
  bounds?: {
    minlat: number;
    minlon: number;
    maxlat: number;
    maxlon: number;
  };
  members?: {
    type: string;
    ref: number;
    role: string;
    lat?: number;
    lon?: number;
  }[];
}

export interface OverpassResponse {
  version: number;
  generator: string;
  osm3s: {
    timestamp_osm_base: string;
    copyright: string;
  };
  elements: OverpassElement[];
}

export class OverpassError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OverpassError';
  }
}

// ============================================================================
// POI Type Mappings
// ============================================================================

/**
 * Map ChatMap POI types to Overpass tags
 */
const POI_TYPE_TAGS: Record<POIType, string> = {
  restaurant: 'node[amenity=restaurant]',
  cafe: 'node[amenity=cafe]',
  grocery: 'node[shop~"supermarket|convenience|grocery"]',
  pharmacy: 'node[amenity=pharmacy]',
  hospital: 'node[amenity=hospital]',
  school: 'node[amenity=school]',
  park: 'node[leisure=park]',
  gym: 'node[leisure~"fitness_centre|sports_centre"]',
  bank: 'node[amenity=bank]',
  atm: 'node[amenity=atm]',
  gas_station: 'node[amenity=fuel]',
  shopping: 'node[shop]',
  entertainment: 'node[amenity~"cinema|theatre|nightclub"]',
  transport: 'node[amenity~"bus_station|train_station"]',
  accommodation: 'node[tourism~"hotel|hostel|motel"]',
  other: 'node[amenity]',
};

// ============================================================================
// Overpass Client
// ============================================================================

export class OverpassClient {
  private readonly config = Config.overpass;
  private readonly rateLimiter: RateLimiter;
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = this.config.endpoint;
    
    // Initialize rate limiter (Overpass: be conservative with rate limits)
    this.rateLimiter = new RateLimiter({
      intervalMs: this.config.rateLimitMs,
      maxRequests: 2,
      windowMs: 1000,
      onThrottle: (waitTime) => {
        if (Config.app.isDevelopment) {
          console.log(`[Overpass] Rate limited, waiting ${waitTime}ms`);
        }
      },
    });
  }

  /**
   * Build Overpass QL query string
   */
  private buildQuery(options: OverpassQueryOptions, customQuery?: string): string {
    const { bounds, tags, timeout = 25, maxResults = 100 } = options;
    
    // Bounded box string
    const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

    let query = `[out:json][timeout:${timeout}];`;

    if (customQuery) {
      // Use custom query with bbox
      query += customQuery.replace('{{bbox}}', bbox);
    } else if (tags) {
      // Build query from tags
      const tagFilters = Object.entries(tags)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `["${key}"~"${value.join('|')}"]`;
          }
          return `["${key}"="${value}"]`;
        })
        .join('');

      query += `(node${tagFilters}(${bbox}););`;
    } else {
      // Default: all amenity nodes
      query += `(node[amenity](${bbox}););`;
    }

    // Output format
    query += `out center ${maxResults};`;

    return query;
  }

  /**
   * Execute Overpass query with retry logic and rate limiting
   */
  private async executeQuery(query: string): Promise<OverpassResponse> {
    return this.rateLimiter.execute(async () => {
      return withRetry(
        async () => {
          const formData = new URLSearchParams();
          formData.append('data', query);

          const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json',
            },
            body: formData.toString(),
            signal: AbortSignal.timeout(this.config.timeout),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            
            // Check for Overpass-specific errors
            if (response.status === 429 || errorText.includes('rate_limited')) {
              throw new RetryableError('Overpass API rate limit exceeded');
            }

            if (response.status === 504 || errorText.includes('timeout')) {
              throw new RetryableError('Overpass API timeout');
            }

            // Determine if error is retryable
            const isRetryable = response.status >= 500;
            
            const error = new OverpassError(
              errorText || `Overpass API error: ${response.statusText}`,
              response.status,
              { query, statusText: response.statusText }
            );

            if (isRetryable) {
              throw new RetryableError(error.message, error);
            }
            throw error;
          }

          return response.json() as Promise<OverpassResponse>;
        },
        {
          maxRetries: this.config.maxRetries,
          initialDelay: 2000, // Longer initial delay for Overpass
          onRetry: (error, attempt, delay) => {
            console.warn(
              `[Overpass] Request failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`,
              error instanceof Error ? error.message : String(error)
            );
          },
        }
      );
    });
  }

  /**
   * Convert Overpass element to ChatMap POI
   */
  private elementToPOI(element: OverpassElement, poiType?: POIType): POI {
    const lat = element.lat || element.center?.lat || 0;
    const lon = element.lon || element.center?.lon || 0;
    const tags = element.tags || {};

    return {
      id: `osm-${element.type}-${element.id}`,
      name: tags.name || tags['name:en'] || tags.operator || `Unnamed ${poiType || 'location'}`,
      type: poiType || 'other',
      lat,
      lng: lon,
      tags: {
        ...tags,
        osm_type: element.type,
        osm_id: element.id.toString(),
      },
    };
  }

  /**
   * Find POIs by type within bounded area
   * 
   * @example
   * ```typescript
   * const pois = await overpassClient.findPOIs({
   *   poiType: 'restaurant',
   *   bounds: {
   *     south: 51.5,
   *     west: -0.2,
   *     north: 51.6,
   *     east: -0.1,
   *   },
   *   maxResults: 50,
   * });
   * ```
   */
  async findPOIs(params: {
    poiType: POIType;
    bounds: OverpassBounds;
    cuisine?: string;
    maxResults?: number;
    timeout?: number;
  }): Promise<POI[]> {
    let query = POI_TYPE_TAGS[params.poiType] || POI_TYPE_TAGS.other;

    // Add cuisine filter for restaurants
    if (params.poiType === 'restaurant' && params.cuisine && params.cuisine !== 'none') {
      query = `node[amenity=restaurant][cuisine~"${params.cuisine}",i]`;
    }

    const bbox = `${params.bounds.south},${params.bounds.west},${params.bounds.north},${params.bounds.east}`;
    const overpassQuery = `[out:json][timeout:${params.timeout || 25}];(${query}(${bbox}););out center ${params.maxResults || 100};`;

    const response = await this.executeQuery(overpassQuery);

    return response.elements.map(element => this.elementToPOI(element, params.poiType));
  }

  /**
   * Find POIs by custom tags within bounded area
   * 
   * @example
   * ```typescript
   * const pois = await overpassClient.findPOIsByTags({
   *   tags: { amenity: 'cafe', 'diet:vegan': 'yes' },
   *   bounds: { south: 51.5, west: -0.2, north: 51.6, east: -0.1 },
   * });
   * ```
   */
  async findPOIsByTags(params: {
    tags: Record<string, string | string[]>;
    bounds: OverpassBounds;
    maxResults?: number;
    timeout?: number;
  }): Promise<POI[]> {
    const options: OverpassQueryOptions = {
      bounds: params.bounds,
      tags: params.tags,
      timeout: params.timeout,
      maxResults: params.maxResults,
    };

    const query = this.buildQuery(options);
    const response = await this.executeQuery(query);

    return response.elements.map(element => this.elementToPOI(element));
  }

  /**
   * Find POIs within radius of a point
   * Creates a bounding box around the point
   * 
   * @example
   * ```typescript
   * const pois = await overpassClient.findPOIsNearPoint({
   *   location: { lat: 51.5074, lng: -0.1278 },
   *   poiType: 'cafe',
   *   radiusMeters: 500,
   * });
   * ```
   */
  async findPOIsNearPoint(params: {
    location: Location;
    poiType: POIType;
    radiusMeters: number;
    cuisine?: string;
    maxResults?: number;
  }): Promise<POI[]> {
    // Calculate bounding box from point and radius
    // 1 degree latitude ≈ 111km
    const latDelta = (params.radiusMeters / 111000);
    // 1 degree longitude varies with latitude
    const lngDelta = (params.radiusMeters / (111000 * Math.cos(params.location.lat * Math.PI / 180)));

    const bounds: OverpassBounds = {
      south: params.location.lat - latDelta,
      west: params.location.lng - lngDelta,
      north: params.location.lat + latDelta,
      east: params.location.lng + lngDelta,
    };

    return this.findPOIs({
      poiType: params.poiType,
      bounds,
      cuisine: params.cuisine,
      maxResults: params.maxResults,
    });
  }

  /**
   * Execute custom Overpass QL query
   * For advanced use cases
   * 
   * @example
   * ```typescript
   * const response = await overpassClient.customQuery(`
   *   [out:json][timeout:25];
   *   (
   *     node[amenity=restaurant][cuisine=italian](51.5,-0.2,51.6,-0.1);
   *   );
   *   out center 50;
   * `);
   * ```
   */
  async customQuery(query: string): Promise<OverpassResponse> {
    return this.executeQuery(query);
  }

  /**
   * Get POI details by OSM ID
   * 
   * @example
   * ```typescript
   * const poi = await overpassClient.getPOIById('node', 123456789);
   * ```
   */
  async getPOIById(osmType: 'node' | 'way' | 'relation', osmId: number): Promise<POI | null> {
    const query = `[out:json];${osmType}(${osmId});out center;`;
    const response = await this.executeQuery(query);

    if (response.elements.length === 0) {
      return null;
    }

    return this.elementToPOI(response.elements[0]);
  }
}

// Export singleton instance
let overpassClientInstance: OverpassClient | null = null;

export function getOverpassClient(): OverpassClient {
  if (!overpassClientInstance) {
    overpassClientInstance = new OverpassClient();
  }
  return overpassClientInstance;
}

export default OverpassClient;
