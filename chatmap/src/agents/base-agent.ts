/**
 * Base Agent Class
 * Provides common functionality for all specialized agents
 */

import { getOllamaClient, OllamaClient } from '@/src/clients/ollama-client';
import type { QueryEntities, ConversationContext } from './query-classifier';
import type { Location, MemoryContextSummary } from '@/src/lib/types';

// Generic tool interface
interface GenericTool {
  name: string;
  description: string;
  invoke: (input: any) => Promise<any>;
}

// ============================================================================
// Types
// ============================================================================

export interface AgentContext {
  userId: string;
  userLocation?: Location;
  conversationHistory?: ConversationContext;
  entities: QueryEntities;
  memoryEnabled?: boolean;
  memoryContext?: MemoryContextSummary;
}

export interface AgentResult {
  success: boolean;
  data?: unknown;
  message?: string;
  error?: string;
  toolsUsed?: string[];
  reasoningSteps?: string[];
}

export interface AgentConfig {
  name: string;
  description: string;
  maxIterations?: number;
  temperature?: number;
  verbose?: boolean;
}

// ============================================================================
// Base Agent
// ============================================================================

export abstract class BaseAgent {
  public readonly name: string;
  protected description: string;
  protected llm: OllamaClient;
  protected tools: GenericTool[];
  protected config: AgentConfig;
  protected verbose: boolean;

  constructor(tools: GenericTool[], config: AgentConfig) {
    this.name = config.name;
    this.description = config.description;
    this.llm = getOllamaClient();
    this.tools = tools;
    this.config = {
      maxIterations: 5,
      temperature: 0.7,
      verbose: false,
      ...config,
    };
    this.verbose = this.config.verbose || false;
  }

  /**
   * Execute the agent to handle a user query
   * Must be implemented by subclasses
   */
  abstract execute(
    query: string,
    context: AgentContext
  ): Promise<AgentResult>;

  /**
   * Get a tool by name
   */
  protected getTool(name: string): GenericTool | undefined {
    return this.tools.find(tool => tool.name === name);
  }

  /**
   * Execute a tool with parameters
   */
  protected async executeTool(
    toolName: string,
    params: unknown
  ): Promise<unknown> {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    try {
      if (this.verbose) {
        console.log(`[${this.name}] Executing tool: ${toolName}`, params);
      }

      const result = await tool.invoke(params as any);

      if (this.verbose) {
        console.log(`[${this.name}] Tool result:`, result);
      }

      return result;
    } catch (error) {
      console.error(`[${this.name}] Tool execution error:`, error);
      throw error;
    }
  }

  /**
   * Call LLM with a prompt
   */
  protected async callLLM(
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      format?: 'json' | '';
    }
  ): Promise<string> {
    try {
      if (this.verbose) {
        console.log(`[${this.name}] LLM prompt:`, prompt.substring(0, 200) + '...');
      }

      const response = await this.llm.generate({
        model: 'llama3.2:3b', // Use configured model
        prompt,
        options: {
          temperature: options?.temperature ?? this.config.temperature,
          num_predict: options?.maxTokens ?? 1000,
        },
        format: options?.format,
      });

      if (this.verbose) {
        console.log(`[${this.name}] LLM response:`, response.response.substring(0, 200) + '...');
      }

      return response.response;
    } catch (error) {
      console.error(`[${this.name}] LLM error:`, error);
      throw error;
    }
  }

  /**
   * Load prompt template (now imports from prompts module)
   */
  protected async loadPrompt(promptName: string): Promise<string> {
    try {
      const prompts = await import('./prompts');
      
      const promptMap: Record<string, string> = {
        'query-classifier': prompts.QUERY_CLASSIFIER_PROMPT,
        'simple-query-agent': prompts.SIMPLE_QUERY_AGENT_PROMPT,
        'multi-step-query-agent': prompts.MULTI_STEP_QUERY_AGENT_PROMPT,
      };

      return promptMap[promptName] || '';
    } catch (error) {
      console.error(`[${this.name}] Failed to load prompt: ${promptName}`, error);
      return '';
    }
  }

  /**
   * Build context string from conversation history
   */
  protected buildContextString(context: AgentContext): string {
    if (!context.conversationHistory || context.conversationHistory.messages.length === 0) {
      return '';
    }

    const recentMessages = context.conversationHistory.messages.slice(-3);
    const contextStr = recentMessages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    return `\n\nRecent Conversation:\n${contextStr}\n`;
  }

  /**
   * Extract entities string for prompts
   */
  protected buildEntitiesString(entities: QueryEntities): string {
    const parts: string[] = [];

    if (entities.primaryPOI) parts.push(`Looking for: ${entities.primaryPOI}`);
    if (entities.secondaryPOI) parts.push(`Near: ${entities.secondaryPOI}`);
    if (entities.transport) parts.push(`Transport: ${entities.transport}`);
    if (entities.timeConstraint) parts.push(`Time limit: ${entities.timeConstraint} minutes`);
    if (entities.destination) parts.push(`Destination: ${entities.destination}`);
    if (entities.cuisine) parts.push(`Cuisine: ${entities.cuisine}`);

    return parts.length > 0 ? `\n\nExtracted Info:\n${parts.join('\n')}\n` : '';
  }

  /**
   * Format error for user-friendly message
   */
  protected formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Create success result
   */
  protected createSuccess(
    data: unknown,
    message?: string,
    meta?: {
      toolsUsed?: string[];
      reasoningSteps?: string[];
    }
  ): AgentResult {
    return {
      success: true,
      data,
      message,
      toolsUsed: meta?.toolsUsed,
      reasoningSteps: meta?.reasoningSteps,
    };
  }

  /**
   * Create error result
   */
  protected createError(error: string): AgentResult {
    return {
      success: false,
      error,
    };
  }
}

export default BaseAgent;
