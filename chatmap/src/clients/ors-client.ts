/**
 * OpenRouteService API Client
 * Handles isochrone, matrix, directions, and optimization API calls
 * with retry logic, error handling, and rate limiting
 */

import { Config } from '@/src/lib/config';
import { withRetry, RetryableError } from '@/src/lib/retry';
import { RateLimiter } from '@/src/lib/rate-limiter';
import type { TransportMode, Location } from '@/src/lib/types';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type ORSProfile =
  | 'driving-car'
  | 'driving-hgv'
  | 'cycling-regular'
  | 'cycling-road'
  | 'cycling-mountain'
  | 'cycling-electric'
  | 'foot-walking'
  | 'foot-hiking'
  | 'wheelchair';

export interface ORSLocation {
  lat: number;
  lng: number;
}

// Isochrone API
export interface IsochroneRequest {
  locations: [[number, number]]; // [longitude, latitude]
  profile: ORSProfile;
  range: number[]; // Time range in seconds
  range_type?: 'time' | 'distance';
  interval?: number;
  location_type?: 'start' | 'destination';
  attributes?: ('area' | 'reachfactor' | 'total_pop')[];
}

export interface IsochroneResponse {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: {
      group_index: number;
      value: number; // Time in seconds
      center: [number, number];
      area?: number;
      reachfactor?: number;
      total_pop?: number;
    };
    geometry: {
      type: 'Polygon';
      coordinates: [number, number][][];
    };
  }[];
  bbox: [number, number, number, number];
  metadata: {
    attribution: string;
    service: string;
    timestamp: number;
    query: IsochroneRequest;
  };
}

// Matrix API
export interface MatrixRequest {
  locations: [[number, number]]; // [longitude, latitude] for all locations
  profile: ORSProfile;
  sources?: number[]; // Indices of source locations
  destinations?: number[]; // Indices of destination locations
  metrics?: ('distance' | 'duration')[];
  units?: 'm' | 'km' | 'mi';
}

export interface MatrixResponse {
  durations?: number[][]; // Matrix of durations in seconds
  distances?: number[][]; // Matrix of distances in meters
  sources: {
    location: [number, number];
    snapped_distance?: number;
  }[];
  destinations: {
    location: [number, number];
    snapped_distance?: number;
  }[];
  metadata: {
    attribution: string;
    service: string;
    timestamp: number;
    query: MatrixRequest;
  };
}

// Directions API
export interface DirectionsRequest {
  coordinates: [[number, number]]; // [longitude, latitude] waypoints
  profile: ORSProfile;
  format?: 'json' | 'geojson';
  units?: 'm' | 'km' | 'mi';
  language?: string;
  geometry?: boolean;
  geometry_simplify?: boolean;
  instructions?: boolean;
  instructions_format?: 'text' | 'html';
  alternative_routes?: {
    share_factor?: number;
    target_count?: number;
    weight_factor?: number;
  };
  attributes?: ('avgspeed' | 'detourfactor' | 'percentage')[];
  maneuvers?: boolean;
  radiuses?: number[]; // Max distance to snap waypoints (meters)
  bearings?: [[number, number]]; // Direction at waypoints [bearing, deviation]
  continue_straight?: boolean;
  elevation?: boolean;
  extra_info?: ('steepness' | 'suitability' | 'surface' | 'waycategory' | 'waytype' | 'tollways' | 'traildifficulty' | 'osmid' | 'roadaccessrestrictions' | 'countryinfo' | 'green' | 'noise')[];
  optimized?: boolean;
  options?: {
    avoid_borders?: 'all' | 'controlled';
    avoid_countries?: string[];
    avoid_features?: ('highways' | 'tollways' | 'ferries' | 'fords' | 'steps')[];
    avoid_polygons?: {
      type: 'Polygon';
      coordinates: [[number, number][]];
    };
    vehicle_type?: 'hgv' | 'bus' | 'agricultural' | 'delivery' | 'forestry' | 'goods';
    profile_params?: {
      weightings?: {
        green?: number;
        quiet?: number;
      };
    };
    round_trip?: {
      length?: number;
      points?: number;
      seed?: number;
    };
  };
}

export interface DirectionsResponse {
  type?: 'FeatureCollection';
  features?: {
    type: 'Feature';
    properties: {
      segments: {
        distance: number;
        duration: number;
        steps: {
          distance: number;
          duration: number;
          type: number;
          instruction: string;
          name: string;
          way_points: [number, number];
        }[];
      }[];
      summary: {
        distance: number;
        duration: number;
      };
      way_points: number[];
    };
    geometry: {
      coordinates: [[number, number]];
      type: 'LineString';
    };
  }[];
  routes?: {
    summary: {
      distance: number;
      duration: number;
    };
    segments: {
      distance: number;
      duration: number;
      steps: {
        distance: number;
        duration: number;
        type: number;
        instruction: string;
        name: string;
        way_points: [number, number];
      }[];
    }[];
    bbox: [number, number, number, number];
    geometry?: string; // Encoded polyline
    way_points: number[];
  }[];
  bbox?: [number, number, number, number];
  metadata: {
    attribution: string;
    service: string;
    timestamp: number;
    query: DirectionsRequest;
  };
}

// Optimization API (Vehicle Routing Problem solver)
export interface OptimizationJob {
  id: number;
  service?: number; // Service time at location (seconds)
  amount?: number[]; // Capacity dimensions
  location: [number, number]; // [longitude, latitude]
  location_index?: number;
  skills?: number[]; // Required vehicle skills
  priority?: number; // 0-100, higher = more important
  time_windows?: [[number, number]]; // Unix timestamps or seconds from start
}

export interface OptimizationVehicle {
  id: number;
  profile: ORSProfile;
  start: [number, number]; // [longitude, latitude]
  start_index?: number;
  end?: [number, number]; // [longitude, latitude]
  end_index?: number;
  capacity?: number[]; // Vehicle capacity dimensions
  skills?: number[]; // Vehicle skills
  time_window?: [number, number]; // Available time window
  breaks?: {
    id: number;
    time_windows: [[number, number]];
    service: number;
  }[];
  max_tasks?: number; // Max number of jobs
  max_travel_time?: number; // Max total travel time (seconds)
  max_distance?: number; // Max total distance (meters)
  speed_factor?: number; // Speed multiplier (default 1.0)
}

export interface OptimizationRequest {
  jobs: OptimizationJob[];
  vehicles: OptimizationVehicle[];
  shipments?: {
    pickup: OptimizationJob;
    delivery: OptimizationJob;
    amount?: number[];
    skills?: number[];
    priority?: number;
  }[];
  options?: {
    g?: boolean; // Use geometry
  };
}

export interface OptimizationResponse {
  code: number;
  summary: {
    cost: number;
    unassigned: number;
    service: number;
    duration: number;
    waiting_time: number;
    priority: number;
    distance: number;
    computing_times: {
      loading: number;
      solving: number;
      routing: number;
    };
  };
  unassigned: {
    id: number;
    location: [number, number];
    reason: string;
  }[];
  routes: {
    vehicle: number;
    cost: number;
    service: number;
    duration: number;
    waiting_time: number;
    priority: number;
    distance: number;
    steps: {
      type: 'start' | 'job' | 'end';
      id?: number;
      location: [number, number];
      service?: number;
      waiting_time?: number;
      arrival?: number;
      duration?: number;
      distance?: number;
    }[];
    geometry?: string; // Encoded polyline
  }[];
}

// Error Types
export class ORSError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public orsErrorCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ORSError';
  }
}

// ============================================================================
// OpenRouteService Client
// ============================================================================

export class ORSClient {
  private readonly config = Config.openRouteService;
  private readonly rateLimiter: RateLimiter;
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = this.config.endpoint;
    
    // Initialize rate limiter (ORS free tier: 40 requests/minute)
    this.rateLimiter = new RateLimiter({
      intervalMs: 500, // Faster rate: ~120 requests per minute (will be limited by maxRequests)
      maxRequests: 40,
      windowMs: 60000,
      onThrottle: (waitTime) => {
        if (Config.app.isDevelopment) {
          console.log(`[ORS] Rate limited, waiting ${waitTime}ms`);
        }
      },
    });
  }

  /**
   * Helper to convert ChatMap TransportMode to ORS profile
   */
  private getORSProfile(transport: TransportMode): ORSProfile {
    const profileMap: Record<TransportMode, ORSProfile> = {
      walking: 'foot-walking',
      driving: 'driving-car',
      cycling: 'cycling-regular',
      public_transport: 'foot-walking', // Fallback to walking
    };
    return profileMap[transport] || 'foot-walking';
  }

  /**
   * Helper to convert Location to ORS coordinate format [lng, lat]
   */
  private locationToCoordinate(location: Location | ORSLocation): [number, number] {
    return [location.lng, location.lat];
  }

  /**
   * Make a request to ORS API with retry logic
   */
  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST',
    body?: unknown,
    queryParams?: Record<string, string>
  ): Promise<T> {
    return this.rateLimiter.execute(async () => {
      return withRetry(
        async () => {
          const url = new URL(endpoint, this.baseUrl);
          
          // Add API key as query parameter (ORS v2 requirement)
          url.searchParams.append('api_key', this.config.apiKey);
          
          // Add additional query parameters
          if (queryParams) {
            Object.entries(queryParams).forEach(([key, value]) => {
              url.searchParams.append(key, value);
            });
          }

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
          };

          const requestOptions: RequestInit = {
            method,
            headers,
            signal: AbortSignal.timeout(this.config.timeout),
          };

          if (body && method === 'POST') {
            requestOptions.body = JSON.stringify(body);
          }

          const response = await fetch(url.toString(), requestOptions);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            
            // Determine if error is retryable
            const isRetryable = response.status >= 500 || response.status === 429;
            
            const error = new ORSError(
              errorData.error?.message || `ORS API error: ${response.statusText}`,
              response.status,
              errorData.error?.code,
              errorData
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
              `[ORS] Request failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`,
              error instanceof Error ? error.message : String(error)
            );
          },
        }
      );
    });
  }

  // ============================================================================
  // Isochrone API
  // ============================================================================

  /**
   * Get isochrone polygons for a location
   * Shows areas reachable within specified time ranges
   * 
   * @example
   * ```typescript
   * const isochrones = await orsClient.getIsochrone({
   *   location: { lat: 51.5074, lng: -0.1278 },
   *   profile: 'foot-walking',
   *   range: [300, 600, 900], // 5, 10, 15 minutes
   * });
   * ```
   */
  async getIsochrone(params: {
    location: Location | ORSLocation;
    profile: ORSProfile | TransportMode;
    range: number | number[]; // Time in seconds
    rangeType?: 'time' | 'distance';
    interval?: number;
    attributes?: ('area' | 'reachfactor' | 'total_pop')[];
  }): Promise<IsochroneResponse> {
    const profile =
      typeof params.profile === 'string' && params.profile in { walking: 1, driving: 1, cycling: 1, public_transport: 1 }
        ? this.getORSProfile(params.profile as TransportMode)
        : (params.profile as ORSProfile);

    const range = Array.isArray(params.range) ? params.range : [params.range];

    const request: IsochroneRequest = {
      locations: [this.locationToCoordinate(params.location)],
      profile,
      range,
      range_type: params.rangeType || 'time',
      interval: params.interval,
      attributes: params.attributes,
    };

    return this.makeRequest<IsochroneResponse>(
      `/v2/isochrones/${profile}`,
      'POST',
      request
    );
  }

  // ============================================================================
  // Matrix API
  // ============================================================================

  /**
   * Calculate travel time/distance matrix between multiple locations
   * Returns matrices of durations and distances between all location pairs
   * 
   * @example
   * ```typescript
   * const matrix = await orsClient.getMatrix({
   *   locations: [
   *     { lat: 51.5074, lng: -0.1278 },
   *     { lat: 51.5155, lng: -0.0922 },
   *     { lat: 51.5033, lng: -0.1195 },
   *   ],
   *   profile: 'driving-car',
   *   metrics: ['duration', 'distance'],
   * });
   * ```
   */
  async getMatrix(params: {
    locations: (Location | ORSLocation)[];
    profile: ORSProfile | TransportMode;
    sources?: number[];
    destinations?: number[];
    metrics?: ('distance' | 'duration')[];
    units?: 'm' | 'km' | 'mi';
  }): Promise<MatrixResponse> {
    const profile =
      typeof params.profile === 'string' && params.profile in { walking: 1, driving: 1, cycling: 1, public_transport: 1 }
        ? this.getORSProfile(params.profile as TransportMode)
        : (params.profile as ORSProfile);

    const request: MatrixRequest = {
      locations: params.locations.map(loc => this.locationToCoordinate(loc)) as [[number, number]],
      profile,
      sources: params.sources,
      destinations: params.destinations,
      metrics: params.metrics || ['duration', 'distance'],
      units: params.units,
    };

    return this.makeRequest<MatrixResponse>(
      `/v2/matrix/${profile}`,
      'POST',
      request
    );
  }

  // ============================================================================
  // Directions API
  // ============================================================================

  /**
   * Get turn-by-turn directions between waypoints
   * Returns detailed route with geometry, instructions, and metadata
   * 
   * @example
   * ```typescript
   * const directions = await orsClient.getDirections({
   *   coordinates: [
   *     { lat: 51.5074, lng: -0.1278 },
   *     { lat: 51.5155, lng: -0.0922 },
   *   ],
   *   profile: 'driving-car',
   *   format: 'geojson',
   *   instructions: true,
   * });
   * ```
   */
  async getDirections(params: {
    coordinates: (Location | ORSLocation)[];
    profile: ORSProfile | TransportMode;
    format?: 'json' | 'geojson';
    units?: 'm' | 'km' | 'mi';
    instructions?: boolean;
    geometry?: boolean;
    elevation?: boolean;
    attributes?: ('avgspeed' | 'detourfactor' | 'percentage')[];
    maneuvers?: boolean;
    alternativeRoutes?: {
      shareeFactor?: number;
      targetCount?: number;
      weightFactor?: number;
    };
    avoidFeatures?: ('highways' | 'tollways' | 'ferries' | 'fords' | 'steps')[];
    options?: DirectionsRequest['options'];
  }): Promise<DirectionsResponse> {
    const profile =
      typeof params.profile === 'string' && params.profile in { walking: 1, driving: 1, cycling: 1, public_transport: 1 }
        ? this.getORSProfile(params.profile as TransportMode)
        : (params.profile as ORSProfile);

    const request: DirectionsRequest = {
      coordinates: params.coordinates.map(loc => this.locationToCoordinate(loc)) as [[number, number]],
      profile,
      format: params.format || 'geojson',
      units: params.units,
      instructions: params.instructions !== false,
      geometry: params.geometry !== false,
      elevation: params.elevation,
      attributes: params.attributes,
      maneuvers: params.maneuvers,
      alternative_routes: params.alternativeRoutes ? {
        share_factor: params.alternativeRoutes.shareeFactor,
        target_count: params.alternativeRoutes.targetCount,
        weight_factor: params.alternativeRoutes.weightFactor,
      } : undefined,
      options: {
        ...params.options,
        avoid_features: params.avoidFeatures,
      },
    };

    return this.makeRequest<DirectionsResponse>(
      `/v2/directions/${profile}/${params.format || 'geojson'}`,
      'POST',
      request
    );
  }

  // ============================================================================
  // Optimization API
  // ============================================================================

  /**
   * Solve Vehicle Routing Problem (VRP)
   * Optimizes routes for multiple vehicles visiting multiple locations
   * 
   * @example
   * ```typescript
   * const optimization = await orsClient.optimize({
   *   jobs: [
   *     { id: 1, location: [lng1, lat1], service: 300 },
   *     { id: 2, location: [lng2, lat2], service: 400 },
   *   ],
   *   vehicles: [{
   *     id: 1,
   *     profile: 'driving-car',
   *     start: [lngStart, latStart],
   *     end: [lngEnd, latEnd],
   *   }],
   * });
   * ```
   */
  async optimize(params: OptimizationRequest): Promise<OptimizationResponse> {
    return this.makeRequest<OptimizationResponse>(
      '/optimization',
      'POST',
      params
    );
  }
}

// Export singleton instance
let orsClientInstance: ORSClient | null = null;

export function getORSClient(): ORSClient {
  if (!orsClientInstance) {
    orsClientInstance = new ORSClient();
  }
  return orsClientInstance;
}

export default ORSClient;
