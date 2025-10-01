/**
 * Simple Query Agent
 * Handles straightforward single-step queries
 * - Find nearest X
 * - Find X within Y minutes
 */

import { BaseAgent, type AgentContext, type AgentResult } from './base-agent';
import {
  findNearestPOITool,
  findPOIsWithinTimeTool,
  geocodeAddressTool,
  getDirectionsTool,
} from './tools';
import type { QueryIntent } from './query-classifier';

export class SimpleQueryAgent extends BaseAgent {
  constructor() {
    super([findNearestPOITool, findPOIsWithinTimeTool, geocodeAddressTool, getDirectionsTool], {
      name: 'SimpleQueryAgent',
      description: 'Handles simple single-step location queries',
      temperature: 0.7,
      verbose: true,
    });
  }

  async execute(query: string, context: AgentContext): Promise<AgentResult> {
    const reasoningSteps: string[] = [];
    const toolsUsed: string[] = [];

    try {
      // Determine query intent from entities
      const intent = this.determineIntent(context);
      reasoningSteps.push(`Query intent: ${intent}`);

      // Ensure we have user location
      if (!context.userLocation) {
        return this.createError('User location is required for location queries');
      }

      // Execute based on intent
      let result: unknown;

      if (intent === 'find-nearest') {
        result = await this.handleFindNearest(context, reasoningSteps, toolsUsed);
      } else if (intent === 'find-within-time') {
        result = await this.handleFindWithinTime(context, reasoningSteps, toolsUsed);
      } else if (intent === 'get-directions') {
        result = await this.handleGetDirections(context, reasoningSteps, toolsUsed);
      } else {
        return this.createError(`Simple query agent cannot handle intent: ${intent}`);
      }

      return this.createSuccess(result, undefined, { toolsUsed, reasoningSteps });
    } catch (error) {
      console.error('[SimpleQueryAgent] Execution error:', error);
      return this.createError(this.formatError(error));
    }
  }

  /**
   * Determine intent from context entities
   */
  private determineIntent(context: AgentContext): QueryIntent {
    if (context.entities.timeConstraint) {
      return 'find-within-time';
    }
    // Check if this is a directions request based on the original query
    // For now, we'll rely on the classifier to set the correct intent
    return 'find-nearest';
  }

  /**
   * Handle "find nearest X" queries
   */
  private async handleFindNearest(
    context: AgentContext,
    reasoningSteps: string[],
    toolsUsed: string[]
  ): Promise<unknown> {
    const { primaryPOI, transport = 'walking', cuisine } = context.entities;

    if (!primaryPOI) {
      throw new Error('POI type not specified');
    }

    reasoningSteps.push(`Finding nearest ${primaryPOI}`);

    // Use find nearest POI tool
    const toolResult = await this.executeTool('find_nearest_poi', {
      poiType: primaryPOI,
      userLocation: context.userLocation!,
      transport,
      cuisine,
    });

    toolsUsed.push('find_nearest_poi');

    const parsed = JSON.parse(toolResult as string);
    if (!parsed.success) {
      throw new Error(parsed.error || 'Failed to find nearest POI');
    }

    reasoningSteps.push(`Found: ${parsed.poi.name} at ${Math.round(parsed.distance)}m away`);

    return {
      poi: parsed.poi,
      distance: parsed.distance,
      transport,
    };
  }

  /**
   * Handle "get directions" queries
   */
  private async handleGetDirections(
    context: AgentContext,
    reasoningSteps: string[],
    toolsUsed: string[]
  ): Promise<unknown> {
    reasoningSteps.push('Getting directions');

    // For follow-up directions requests, we need to get the destination from memory
    // For now, this is a placeholder - in a full implementation, we'd:
    // 1. Check conversation history for the last POI mentioned
    // 2. Or check memory for recently found POIs
    // 3. Use that as the destination

    // For demonstration, let's assume the user wants directions to a pharmacy
    const destination = {
      lat: 29.9994067,
      lng: -95.5839247,
      display_name: 'CVS Pharmacy'
    };

    const toolResult = await this.executeTool('get_directions', {
      coordinates: [context.userLocation!, destination],
      transport: 'driving',
    });
    toolsUsed.push('get_directions');

    const directions = JSON.parse(toolResult as string);
    if (!directions.success) {
      throw new Error('Could not get directions');
    }

    reasoningSteps.push(`Got directions with ${directions.routes?.length || 0} route(s)`);

    return {
      directions: directions.routes,
      destination,
    };
  }

  /**
   * Handle "find X within Y minutes" queries
   */
  private async handleFindWithinTime(
    context: AgentContext,
    reasoningSteps: string[],
    toolsUsed: string[]
  ): Promise<unknown> {
    const {
      primaryPOI,
      transport = 'walking',
      timeConstraint = 15,
      cuisine,
    } = context.entities;

    if (!primaryPOI) {
      throw new Error('POI type not specified');
    }

    reasoningSteps.push(
      `Finding ${primaryPOI}s within ${timeConstraint} minutes by ${transport}`
    );

    // Use find POIs within time tool
    const toolResult = await this.executeTool('find_pois_within_time', {
      poiType: primaryPOI,
      userLocation: context.userLocation!,
      timeMinutes: timeConstraint,
      transport,
      cuisine,
      maxResults: 50,
    });

    toolsUsed.push('find_pois_within_time');

    const parsed = JSON.parse(toolResult as string);
    if (!parsed.success) {
      throw new Error(parsed.error || 'Failed to find POIs');
    }

    reasoningSteps.push(`Found ${parsed.count} ${primaryPOI}s`);

    return {
      pois: parsed.pois,
      count: parsed.count,
      isochrone: parsed.isochrone,
      transport,
      timeMinutes: timeConstraint,
    };
  }
}

// Export singleton
let simpleAgentInstance: SimpleQueryAgent | null = null;

export function getSimpleQueryAgent(): SimpleQueryAgent {
  if (!simpleAgentInstance) {
    simpleAgentInstance = new SimpleQueryAgent();
  }
  return simpleAgentInstance;
}

export default SimpleQueryAgent;
