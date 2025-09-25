/**
 * React hook for memory operations
 * Provides a clean interface for components to interact with the memory service
 */

import { useCallback, useState } from 'react';
import { getClientMemoryService } from './client-memory-service';
import type {
  ConversationMemory,
  Location,
  LocationFrequency,
  LocationMemory,
  Memory,
  UserPreferences,
} from '@/src/lib/types';

export interface UseMemoryReturn {
  // Memory operations
  addLocationMemory: (userId: string, memory: LocationMemory) => Promise<string>;
  addConversationMemory: (
    userId: string,
    query: string,
    response: string,
    context: Record<string, unknown>
  ) => Promise<string>;
  addPreferenceMemory: (userId: string, preferences: UserPreferences) => Promise<string>;
  
  // Memory retrieval
  getRelevantMemories: (userId: string, query: string, limit?: number) => Promise<Memory[]>;
  getLocationHistory: (userId: string, location?: Location) => Promise<LocationMemory[]>;
  getUserPreferences: (userId: string) => Promise<UserPreferences>;
  getConversationContext: (userId: string, limit?: number) => Promise<ConversationMemory[]>;
  getFrequentLocations: (userId: string) => Promise<LocationFrequency[]>;
  
  // Memory search
  searchMemoriesByLocation: (userId: string, location: Location, radius: number) => Promise<Memory[]>;
  searchMemoriesByPOIType: (userId: string, poiType: string) => Promise<Memory[]>;
  
  // Memory management
  clearUserMemories: (userId: string) => Promise<void>;
  
  // Loading states
  isLoading: boolean;
  error: string | null;
}

export function useMemory(): UseMemoryReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const memoryService = getClientMemoryService();

  const handleOperation = useCallback(async <T>(
    operation: () => Promise<T>
  ): Promise<T> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await operation();
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addLocationMemory = useCallback(async (userId: string, memory: LocationMemory): Promise<string> => {
    return handleOperation(() => memoryService.addLocationMemory(userId, memory));
  }, [memoryService, handleOperation]);

  const addConversationMemory = useCallback(async (
    userId: string,
    query: string,
    response: string,
    context: Record<string, unknown>
  ): Promise<string> => {
    return handleOperation(() => memoryService.addConversationMemory(userId, query, response, context));
  }, [memoryService, handleOperation]);

  const addPreferenceMemory = useCallback(async (userId: string, preferences: UserPreferences): Promise<string> => {
    return handleOperation(() => memoryService.addPreferenceMemory(userId, preferences));
  }, [memoryService, handleOperation]);

  const getRelevantMemories = useCallback(async (userId: string, query: string, limit = 10): Promise<Memory[]> => {
    return handleOperation(() => memoryService.getRelevantMemories(userId, query, limit));
  }, [memoryService, handleOperation]);

  const getLocationHistory = useCallback(async (userId: string, location?: Location): Promise<LocationMemory[]> => {
    return handleOperation(() => memoryService.getLocationHistory(userId, location));
  }, [memoryService, handleOperation]);

  const getUserPreferences = useCallback(async (userId: string): Promise<UserPreferences> => {
    return handleOperation(() => memoryService.getUserPreferences(userId));
  }, [memoryService, handleOperation]);

  const getConversationContext = useCallback(async (userId: string, limit = 20): Promise<ConversationMemory[]> => {
    return handleOperation(() => memoryService.getConversationContext(userId, limit));
  }, [memoryService, handleOperation]);

  const getFrequentLocations = useCallback(async (userId: string): Promise<LocationFrequency[]> => {
    return handleOperation(() => memoryService.getFrequentLocations(userId));
  }, [memoryService, handleOperation]);

  const searchMemoriesByLocation = useCallback(async (
    userId: string,
    location: Location,
    radius: number
  ): Promise<Memory[]> => {
    return handleOperation(() => memoryService.searchMemoriesByLocation(userId, location, radius));
  }, [memoryService, handleOperation]);

  const searchMemoriesByPOIType = useCallback(async (userId: string, poiType: string): Promise<Memory[]> => {
    return handleOperation(() => memoryService.searchMemoriesByPOIType(userId, poiType));
  }, [memoryService, handleOperation]);

  const clearUserMemories = useCallback(async (userId: string): Promise<void> => {
    return handleOperation(() => memoryService.clearUserMemories(userId));
  }, [memoryService, handleOperation]);

  return {
    addLocationMemory,
    addConversationMemory,
    addPreferenceMemory,
    getRelevantMemories,
    getLocationHistory,
    getUserPreferences,
    getConversationContext,
    getFrequentLocations,
    searchMemoriesByLocation,
    searchMemoriesByPOIType,
    clearUserMemories,
    isLoading,
    error,
  };
}
