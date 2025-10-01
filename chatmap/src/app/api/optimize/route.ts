/**
 * Optimization API Route
 * Solve Vehicle Routing Problems (VRP) for optimal multi-stop routes
 * Uses OpenRouteService Optimization API
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getORSClient, ORSError, OptimizationRequest, type ORSProfile } from '@/src/clients/ors-client';
import type { Location, TransportMode, APIResponse } from '@/src/lib/types';

// ============================================================================
// Request/Response Types
// ============================================================================

interface Job {
  id: number;
  location: Location;
  service?: number; // Service time in seconds
  timeWindows?: [number, number][]; // Time windows in seconds from start
  skills?: number[]; // Required vehicle skills
  priority?: number; // 0-100, higher = more important
}

interface Vehicle {
  id: number;
  profile: TransportMode;
  start: Location;
  end?: Location;
  capacity?: number[];
  skills?: number[];
  timeWindow?: [number, number]; // Available time window in seconds
  maxTasks?: number;
  maxTravelTime?: number; // Max total travel time in seconds
  maxDistance?: number; // Max total distance in meters
}

interface OptimizationRequestBody {
  jobs: Job[];
  vehicles: Vehicle[];
  options?: {
    includeGeometry?: boolean;
  };
}

interface OptimizationStep {
  type: 'start' | 'job' | 'end';
  id?: number;
  location: Location;
  arrival?: number;
  duration?: number;
  distance?: number;
  service?: number;
  waitingTime?: number;
}

interface OptimizedRoute {
  vehicleId: number;
  cost: number;
  service: number;
  duration: number;
  waitingTime: number;
  distance: number;
  steps: OptimizationStep[];
  geometry?: [number, number][];
}

interface OptimizationResponseData {
  summary: {
    cost: number;
    unassigned: number;
    service: number;
    duration: number;
    waitingTime: number;
    distance: number;
    computingTime: {
      loading: number;
      solving: number;
      routing: number;
    };
  };
  routes: OptimizedRoute[];
  unassigned: {
    id: number;
    location: Location;
    reason: string;
  }[];
  metadata: {
    timestamp: string;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function validateOptimizationRequest(body: unknown): body is OptimizationRequestBody {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const req = body as Partial<OptimizationRequestBody>;

  // Validate jobs array
  if (!Array.isArray(req.jobs) || req.jobs.length === 0) {
    return false;
  }

  // Validate each job
  for (const job of req.jobs) {
    if (
      typeof job.id !== 'number' ||
      !job.location ||
      typeof job.location.lat !== 'number' ||
      typeof job.location.lng !== 'number'
    ) {
      return false;
    }
  }

  // Validate vehicles array
  if (!Array.isArray(req.vehicles) || req.vehicles.length === 0) {
    return false;
  }

  // Validate each vehicle
  for (const vehicle of req.vehicles) {
    if (
      typeof vehicle.id !== 'number' ||
      !vehicle.start ||
      typeof vehicle.start.lat !== 'number' ||
      typeof vehicle.start.lng !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

function locationToCoordinate(location: Location): [number, number] {
  return [location.lng, location.lat];
}

function coordinateToLocation(coordinate: [number, number], displayName?: string): Location {
  return {
    lat: coordinate[1],
    lng: coordinate[0],
    display_name: displayName || `${coordinate[1]}, ${coordinate[0]}`,
  };
}

function mapProfileToORS(profile: TransportMode): ORSProfile {
  const profileMap: Record<TransportMode, ORSProfile> = {
    walking: 'foot-walking',
    driving: 'driving-car',
    cycling: 'cycling-regular',
    public_transport: 'foot-walking',
  };
  return profileMap[profile] || 'driving-car';
}

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/optimize
 * Optimize routes for multiple vehicles visiting multiple locations
 * 
 * @example
 * ```json
 * {
 *   "jobs": [
 *     {
 *       "id": 1,
 *       "location": { "lat": 51.5074, "lng": -0.1278, "display_name": "Job 1" },
 *       "service": 300
 *     },
 *     {
 *       "id": 2,
 *       "location": { "lat": 51.5155, "lng": -0.0922, "display_name": "Job 2" },
 *       "service": 400
 *     }
 *   ],
 *   "vehicles": [
 *     {
 *       "id": 1,
 *       "profile": "driving",
 *       "start": { "lat": 51.5033, "lng": -0.1195, "display_name": "Depot" },
 *       "end": { "lat": 51.5033, "lng": -0.1195, "display_name": "Depot" }
 *     }
 *   ]
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<OptimizationResponseData>>> {
  try {
    const body = await request.json();

    // Validate request
    if (!validateOptimizationRequest(body)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request. Provide valid jobs and vehicles arrays.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const { jobs, vehicles, options } = body;

    // Check limits
    if (jobs.length > 100) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many jobs. Maximum is 100.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    if (vehicles.length > 10) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many vehicles. Maximum is 10.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Get ORS client
    const orsClient = getORSClient();

    // Convert request to ORS format
    const orsRequest: OptimizationRequest = {
      jobs: jobs.map(job => ({
        id: job.id,
        location: locationToCoordinate(job.location),
        service: job.service,
        time_windows: job.timeWindows as [[number, number]] | undefined,
        skills: job.skills,
        priority: job.priority,
      })),
      vehicles: vehicles.map(vehicle => ({
        id: vehicle.id,
        profile: mapProfileToORS(vehicle.profile),
        start: locationToCoordinate(vehicle.start),
        end: vehicle.end ? locationToCoordinate(vehicle.end) : undefined,
        capacity: vehicle.capacity,
        skills: vehicle.skills,
        time_window: vehicle.timeWindow,
        max_tasks: vehicle.maxTasks,
        max_travel_time: vehicle.maxTravelTime,
        max_distance: vehicle.maxDistance,
      })),
      options: {
        g: options?.includeGeometry !== false,
      },
    };

    // Optimize routes
    const optimizationResponse = await orsClient.optimize(orsRequest);

    // Map response back to our format
    const responseData: OptimizationResponseData = {
      summary: {
        cost: optimizationResponse.summary.cost,
        unassigned: optimizationResponse.summary.unassigned,
        service: optimizationResponse.summary.service,
        duration: optimizationResponse.summary.duration,
        waitingTime: optimizationResponse.summary.waiting_time,
        distance: optimizationResponse.summary.distance,
        computingTime: {
          loading: optimizationResponse.summary.computing_times.loading,
          solving: optimizationResponse.summary.computing_times.solving,
          routing: optimizationResponse.summary.computing_times.routing,
        },
      },
      routes: optimizationResponse.routes.map(route => {
        // Find original job/vehicle data for display names
        const getJobById = (id: number) => jobs.find(j => j.id === id);
        const getVehicleById = (id: number) => vehicles.find(v => v.id === id);

        return {
          vehicleId: route.vehicle,
          cost: route.cost,
          service: route.service,
          duration: route.duration,
          waitingTime: route.waiting_time,
          distance: route.distance,
          steps: route.steps.map(step => {
            let location: Location;
            
            if (step.type === 'start') {
              const vehicle = getVehicleById(route.vehicle);
              location = vehicle?.start || coordinateToLocation(step.location, 'Start');
            } else if (step.type === 'end') {
              const vehicle = getVehicleById(route.vehicle);
              location = vehicle?.end || vehicle?.start || coordinateToLocation(step.location, 'End');
            } else {
              const job = getJobById(step.id!);
              location = job?.location || coordinateToLocation(step.location, `Job ${step.id}`);
            }

            return {
              type: step.type,
              id: step.id,
              location,
              arrival: step.arrival,
              duration: step.duration,
              distance: step.distance,
              service: step.service,
              waitingTime: step.waiting_time,
            };
          }),
          geometry: route.geometry
            ? JSON.parse(
                Buffer.from(route.geometry, 'base64').toString('utf-8')
              ).coordinates
            : undefined,
        };
      }),
      unassigned: optimizationResponse.unassigned.map(unassigned => {
        const job = jobs.find(j => j.id === unassigned.id);
        return {
          id: unassigned.id,
          location: job?.location || coordinateToLocation(unassigned.location),
          reason: unassigned.reason,
        };
      }),
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    return NextResponse.json({
      success: true,
      data: responseData,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[Optimization API] Error:', error);

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
        error: error instanceof Error ? error.message : 'Failed to optimize routes',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/optimize
 * Health check endpoint
 */
export async function GET(): Promise<NextResponse<APIResponse<{ status: string }>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'Optimization API is operational',
    },
    timestamp: new Date().toISOString(),
  });
}
