/**
 * Multi-Step Query Agent
 * Handles complex queries requiring multiple coordinated steps
 * - Find X near nearest Y
 * - Find X enroute to Y in Z time
 */

import { BaseAgent, type AgentContext, type AgentResult } from './base-agent';
import {
  findNearestPOITool,
  findPOIsWithinTimeTool,
  calculateMatrixTool,
  getDirectionsTool,
  optimizeRouteTool,
  geocodeAddressTool,
} from './tools';
import type { Location, POI } from '@/src/lib/types';

export class MultiStepQueryAgent extends BaseAgent {
  constructor() {
    super(
      [
        findNearestPOITool,
        findPOIsWithinTimeTool,
        calculateMatrixTool,
        getDirectionsTool,
        optimizeRouteTool,
        geocodeAddressTool,
      ],
      {
        name: 'MultiStepQueryAgent',
        description: 'Handles complex multi-step location queries',
        temperature: 0.7,
        verbose: true,
      }
    );
  }

  /**
   * Map cuisine types to proper POI types
   */
  private mapCuisineToPOIType(cuisine: string): string {
    const cuisineMap: Record<string, string> = {
      'italian': 'restaurant',
      'mexican': 'restaurant',
      'chinese': 'restaurant',
      'japanese': 'restaurant',
      'indian': 'restaurant',
      'thai': 'restaurant',
      'french': 'restaurant',
      'american': 'restaurant',
      'pizza': 'restaurant',
      'burger': 'restaurant',
      'sushi': 'restaurant',
      'seafood': 'restaurant',
      'steakhouse': 'restaurant',
      'cafe': 'cafe',
      'coffee': 'cafe',
      'bakery': 'cafe',
      'bar': 'restaurant',
      'pub': 'restaurant',
    };

    return cuisineMap[cuisine.toLowerCase()] || 'restaurant';
  }

  async execute(query: string, context: AgentContext): Promise<AgentResult> {
    const reasoningSteps: string[] = [];
    const toolsUsed: string[] = [];

    try {
      // Determine which type of complex query
      const queryType = this.determineComplexQueryType(context);
      reasoningSteps.push(`Complex query type: ${queryType}`);

      // Ensure we have user location
      if (!context.userLocation) {
        return this.createError('User location is required for location queries');
      }

      // Execute based on type
      let result: unknown;

      if (queryType === 'find-near-poi') {
        result = await this.handleFindNearPOI(context, reasoningSteps, toolsUsed);
      } else if (queryType === 'find-enroute') {
        result = await this.handleFindEnroute(context, reasoningSteps, toolsUsed);
      } else {
        return this.createError(`Unknown complex query type: ${queryType}`);
      }

      return this.createSuccess(result, undefined, { toolsUsed, reasoningSteps });
    } catch (error) {
      console.error('[MultiStepQueryAgent] Execution error:', error);
      return this.createError(this.formatError(error));
    }
  }

  /**
   * Determine complex query type from entities
   */
  private determineComplexQueryType(context: AgentContext): string {
    if (context.entities.secondaryPOI) {
      return 'find-near-poi';
    }
    if (context.entities.destination) {
      return 'find-enroute';
    }
    return 'unknown';
  }

  /**
   * Handle "find X near nearest Y" queries
   * Example: "Find coffee shops near the nearest park"
   * 
   * Steps:
   * 1. Find nearest Y (secondary POI)
   * 2. Find X (primary POIs) near that Y
   * 3. Calculate matrix to get accurate travel times
   * 4. Sort by distance from Y
   */
  private async handleFindNearPOI(
    context: AgentContext,
    reasoningSteps: string[],
    toolsUsed: string[]
  ): Promise<unknown> {
    const {
      primaryPOI,
      secondaryPOI,
      transport = 'walking',
      timeConstraint = 15,
      cuisine,
    } = context.entities;

    if (!primaryPOI || !secondaryPOI) {
      throw new Error('Both primary and secondary POI types are required');
    }

    // Step 1: Find nearest secondary POI (anchor point)
    reasoningSteps.push(`Step 1: Finding nearest ${secondaryPOI}`);
    
    const anchorResult = await this.executeTool('find_nearest_poi', {
      poiType: secondaryPOI,
      userLocation: context.userLocation!,
      transport,
    });
    toolsUsed.push('find_nearest_poi');

    const anchor = JSON.parse(anchorResult as string);
    if (!anchor.success) {
      throw new Error(`Could not find nearest ${secondaryPOI}`);
    }

    const anchorLocation = { lat: anchor.poi.lat, lng: anchor.poi.lng, display_name: anchor.poi.name };
    reasoningSteps.push(
      `Found anchor: ${anchor.poi.name} at ${Math.round(anchor.distance)}m`
    );

    // Step 2: Find primary POIs near the anchor
    // Progressive search strategy: try different transport modes and time constraints
    const searchStrategies = [
      { transport: 'walking', timeMinutes: timeConstraint },
      { transport: 'driving', timeMinutes: timeConstraint },
      { transport: 'walking', timeMinutes: 30 },
      { transport: 'driving', timeMinutes: 30 },
      { transport: 'walking', timeMinutes: 60 },
      { transport: 'driving', timeMinutes: 60 },
    ];
    
    let pois: { success: boolean; count: number; pois: POI[] } | null = null;
    let actualStrategy = searchStrategies[0];
    
    for (const strategy of searchStrategies) {
      actualStrategy = strategy;
      reasoningSteps.push(
        `Step 2: Finding ${primaryPOI}s within ${strategy.timeMinutes} minutes ${strategy.transport} of ${anchor.poi.name}`
      );

      // Map cuisine to proper POI type
      const mappedPOIType = cuisine ? this.mapCuisineToPOIType(cuisine) : primaryPOI;
      
      const poisResult = await this.executeTool('find_pois_within_time', {
        poiType: mappedPOIType,
        userLocation: anchorLocation,
        timeMinutes: strategy.timeMinutes,
        transport: strategy.transport,
        ...(cuisine && { cuisine }),
        maxResults: 20,
      });
      toolsUsed.push('find_pois_within_time');

      const parsedResult = JSON.parse(poisResult as string) as any;
      if (parsedResult && parsedResult.success && parsedResult.count > 0) {
        pois = parsedResult;
        reasoningSteps.push(`Found ${parsedResult.count} ${primaryPOI}s using ${strategy.transport} for ${strategy.timeMinutes} minutes`);
        break;
      }
    }
    
    if (!pois || !pois.success || pois.count === 0) {
      return {
        anchorPOI: anchor.poi,
        primaryPOIs: [],
        message: `No ${primaryPOI}s found within ${actualStrategy.timeMinutes} minutes ${actualStrategy.transport} of ${anchor.poi.name}`,
      };
    }

    // Step 3: Calculate matrix for accurate travel times
    reasoningSteps.push(
      `Step 3: Calculating travel times from ${anchor.poi.name} to ${pois.count} ${primaryPOI}s`
    );

    const locations = [anchorLocation, ...pois.pois.map((p: POI) => ({ lat: p.lat, lng: p.lng, display_name: p.name }))];
    
    const matrixResult = await this.executeTool('calculate_matrix', {
      locations,
      transport,
      metrics: ['duration', 'distance'],
    });
    toolsUsed.push('calculate_matrix');

    const matrix = JSON.parse(matrixResult as string);
    if (!matrix.success) {
      // Fallback to straight-line distances
      reasoningSteps.push('Matrix calculation failed, using straight-line distances');
    }

    // Step 4: Sort POIs by travel time from anchor
    const poisWithTimes = pois.pois.map((poi: POI, index: number) => {
      const poiLocation = { lat: poi.lat, lng: poi.lng, display_name: poi.name };
      const travelTime = matrix.success
        ? matrix.durations[0][index + 1] / 60 // Convert to minutes
        : this.estimateTravelTime(anchorLocation, poiLocation, transport);

      return {
        ...poi,
        travelTimeFromAnchor: Math.round(travelTime),
        distanceFromAnchor: matrix.success
          ? matrix.distances[0][index + 1]
          : this.calculateDistance(anchorLocation, poiLocation),
      };
    });

    // Sort by travel time
    poisWithTimes.sort((a, b) => a.travelTimeFromAnchor - b.travelTimeFromAnchor);

    reasoningSteps.push(
      `Found ${poisWithTimes.length} ${primaryPOI}s, closest is ${poisWithTimes[0].name} (${poisWithTimes[0].travelTimeFromAnchor} min away)`
    );

    return {
      anchorPOI: anchor.poi,
      primaryPOIs: poisWithTimes,
      count: poisWithTimes.length,
      isochrone: (pois as any)?.isochrone,
      transport: actualStrategy.transport,
      timeMinutes: actualStrategy.timeMinutes,
      strategy: actualStrategy,
    };
  }

  /**
   * Handle "find X enroute to Y" queries
   * Example: "Find gas station before airport in 30 mins"
   * 
   * Steps:
   * 1. Geocode destination if needed
   * 2. Get directions to destination
   * 3. Find candidate POIs along route
   * 4. Use optimization to find best stopover
   */
  private async handleFindEnroute(
    context: AgentContext,
    reasoningSteps: string[],
    toolsUsed: string[]
  ): Promise<unknown> {
    const {
      primaryPOI,
      destination,
      transport = 'driving',
      timeConstraint = 30,
      cuisine,
    } = context.entities;

    if (!primaryPOI || !destination) {
      throw new Error('Both POI type and destination are required');
    }

    // Step 1: Geocode destination with user location context
    reasoningSteps.push(`Step 1: Finding destination: ${destination}`);

    // Try multiple geocoding attempts for better success rate
    // Parse user location properly to avoid coordinate pollution
    // Use config defaults as fallbacks
    const { getDefaultLocation } = await import('@/src/lib/config');
    const defaultLocation = getDefaultLocation();
    let userCity = defaultLocation.city;
    let userState = defaultLocation.state;
    
    if (context.userLocation?.display_name) {
      const displayName = context.userLocation.display_name;
      // Check if it contains coordinates (has parentheses with numbers)
      if (displayName.includes('(') && displayName.includes(')')) {
        // Extract city from before the parentheses
        const beforeParens = displayName.split('(')[0].trim();
        if (beforeParens) {
          userCity = beforeParens.split(',')[0].trim();
          userState = beforeParens.split(',')[1]?.trim() || defaultLocation.state;
        }
      } else {
        // Normal address format
        userCity = displayName.split(',')[0] || defaultLocation.city;
        userState = displayName.split(',')[1]?.trim() || defaultLocation.state;
      }
    }
    
    const attempts = [
      destination, // Original destination
      // Add city context for better geocoding
      `${destination}, ${userCity}, ${userState}`,
      `${destination}, ${userCity}`,
      // Add downtown context if destination contains downtown
      ...(destination.toLowerCase().includes('downtown') ? [
        `downtown ${userCity}, ${userState}`,
        `downtown ${userCity}`,
        `${userCity} downtown`
      ] : [])
    ];
    
    let destData: any = null;
    
    for (const attempt of attempts) {
      try {
        console.log(`[MultiStepQueryAgent] Trying geocoding: "${attempt}"`);
        const destResult = await this.executeTool('geocode_address', {
          address: attempt,
        });
        toolsUsed.push('geocode_address');
        
        destData = JSON.parse(destResult as string);
        if (destData.success) {
          break;
        }
      } catch (error) {
        console.log(`[MultiStepQueryAgent] Geocoding failed for "${attempt}":`, error);
      }
    }
    
    if (!destData || !destData.success) {
      throw new Error(`Could not find destination: ${destination}. Tried: ${attempts.join(', ')}`);
    }

    const destinationLocation = destData.location;
    reasoningSteps.push(`Destination: ${destinationLocation.display_name}`);

    // Step 2: Get directions to destination
    reasoningSteps.push(
      `Step 2: Getting route from current location to ${destinationLocation.display_name}`
    );

    const directionsResult = await this.executeTool('get_directions', {
      coordinates: [context.userLocation!, destinationLocation],
      transport,
    });
    toolsUsed.push('get_directions');

    const directions = JSON.parse(directionsResult as string);
    if (!directions.success) {
      throw new Error('Could not calculate route to destination');
    }

    const directRoute = directions.routes[0];
    const directDuration = directRoute.summary?.duration || directRoute.properties?.summary?.duration || 0;
    reasoningSteps.push(
      `Direct route: ${Math.round(directDuration / 60)} minutes`
    );

    // Check if direct route exceeds time constraint
    if (directDuration / 60 > timeConstraint) {
      return {
        message: `Direct route to ${destination} takes ${Math.round(directDuration / 60)} minutes, which exceeds your ${timeConstraint} minute limit`,
        directRoute,
      };
    }

    // Step 3: Find POIs along route corridor
    reasoningSteps.push(
      `Step 3: Finding ${primaryPOI}s along route corridor`
    );

    // Create search area around route (simplified - use midpoint)
    const midLat = (context.userLocation!.lat + destinationLocation.lat) / 2;
    const midLng = (context.userLocation!.lng + destinationLocation.lng) / 2;
    const midpoint = {
      lat: midLat,
      lng: midLng,
      display_name: 'Route midpoint',
    };

    // Map cuisine to proper POI type
    const mappedPOIType = cuisine ? this.mapCuisineToPOIType(cuisine) : primaryPOI;
    
    const poisResult = await this.executeTool('find_pois_within_time', {
      poiType: mappedPOIType,
      userLocation: midpoint,
      timeMinutes: 15, // Search within 15 min of midpoint
      transport,
      ...(cuisine && { cuisine }),
      maxResults: 10,
    });
    toolsUsed.push('find_pois_within_time');

    const pois = JSON.parse(poisResult as string);
    if (!pois.success || pois.count === 0) {
      return {
        message: `No ${primaryPOI}s found along the route to ${destination}`,
        directRoute,
      };
    }

    // Step 4: Find optimal stopover using optimization
    reasoningSteps.push(
      `Step 4: Finding optimal ${primaryPOI} stopover among ${pois.count} candidates`
    );

    const optimizationResult = await this.executeTool('optimize_route', {
      jobs: pois.pois.slice(0, 5).map((poi: POI, index: number) => ({
        id: index + 1,
        location: { lat: poi.lat, lng: poi.lng, display_name: poi.name },
        service: 300, // 5 min stop time
        priority: 100,
      })),
      vehicle: {
        start: context.userLocation!,
        end: destinationLocation,
        transport,
      },
    });
    toolsUsed.push('optimize_route');

    const optimization = JSON.parse(optimizationResult as string);
    
    if (!optimization.success || optimization.routes.length === 0) {
      // Fallback: just return POIs sorted by distance
      reasoningSteps.push('Optimization failed, returning nearest POIs');
      return {
        candidatePOIs: pois.pois.slice(0, 5),
        stopoverPOI: pois.pois[0], // Use first POI as stopover
        destination: destinationLocation,
        directRoute,
        optimizedRoute: {
          distance: directRoute.properties.segments[0].distance,
          duration: directRoute.properties.segments[0].duration,
          geometry: {
            coordinates: directRoute.geometry.coordinates
          },
          steps: directRoute.properties.segments[0].steps || []
        },
        message: `Found ${pois.count} ${primaryPOI}s along the route`,
      };
    }

    const optimalRoute = optimization.routes[0];
    const stopoverStep = optimalRoute.steps.find((s: { type: string; location?: number[]; duration?: number }) => s.type === 'job');
    
    reasoningSteps.push(
      `Optimal route includes stopover, total time: ${Math.round(optimalRoute.duration / 60)} minutes`
    );

    return {
      optimizedRoute: {
        ...optimalRoute,
        distance: optimalRoute.distance,
        duration: optimalRoute.duration,
        geometry: {
          coordinates: optimalRoute.steps
            .filter((step: any) => step.location && Array.isArray(step.location))
            .map((step: any) => step.location)
        }
      },
      stopoverPOI: stopoverStep
        ? pois.pois[stopoverStep.id - 1]
        : pois.pois[0],
      destination: destinationLocation,
      directRoute,
      totalTime: Math.round(optimalRoute.duration / 60),
      timeSavings: Math.round((directDuration - optimalRoute.duration) / 60),
    };
  }

  /**
   * Calculate straight-line distance between two locations
   */
  private calculateDistance(loc1: Location, loc2: Location): number {
    const R = 6371e3;
    const φ1 = (loc1.lat * Math.PI) / 180;
    const φ2 = (loc2.lat * Math.PI) / 180;
    const Δφ = ((loc2.lat - loc1.lat) * Math.PI) / 180;
    const Δλ = ((loc2.lng - loc1.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Estimate travel time based on distance and transport mode
   */
  private estimateTravelTime(
    loc1: Location,
    loc2: Location,
    transport: string
  ): number {
    const distance = this.calculateDistance(loc1, loc2);
    const speeds: Record<string, number> = {
      walking: 1.4, // m/s
      driving: 13.9,
      cycling: 4.2,
      public_transport: 8.3,
    };
    const speed = speeds[transport] || 1.4;
    return (distance / speed) / 60; // minutes
  }
}

// Export singleton
let multiStepAgentInstance: MultiStepQueryAgent | null = null;

export function getMultiStepQueryAgent(): MultiStepQueryAgent {
  if (!multiStepAgentInstance) {
    multiStepAgentInstance = new MultiStepQueryAgent();
  }
  return multiStepAgentInstance;
}

export default MultiStepQueryAgent;
