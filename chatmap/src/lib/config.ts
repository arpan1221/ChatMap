/**
 * Centralized configuration management with Zod validation
 * All secrets and URLs must be loaded through this module
 */

import { z } from 'zod';

// Environment variable schema
const envSchema = z.object({
  // Ollama Configuration
  OLLAMA_ENDPOINT: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.2:3b'),
  OLLAMA_TIMEOUT: z.coerce.number().default(30000),
  OLLAMA_MAX_RETRIES: z.coerce.number().default(3),

  // OpenRouteService Configuration
  OPENROUTESERVICE_API_KEY: z.string().min(1, 'OpenRouteService API key is required'),
  OPENROUTESERVICE_ENDPOINT: z.string().url().default('https://api.openrouteservice.org'),
  OPENROUTESERVICE_TIMEOUT: z.coerce.number().default(30000),
  OPENROUTESERVICE_MAX_RETRIES: z.coerce.number().default(3),

  // Nominatim Configuration
  NOMINATIM_ENDPOINT: z.string().url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: z.string().default('ChatMap/1.0 (https://github.com/chatmap)'),
  NOMINATIM_RATE_LIMIT_MS: z.coerce.number().default(1000), // 1 request per second
  NOMINATIM_TIMEOUT: z.coerce.number().default(60000), // 60 seconds - Nominatim can be very slow
  NOMINATIM_MAX_RETRIES: z.coerce.number().default(1), // Only retry once - timeouts are long

  // Overpass API Configuration
  OVERPASS_ENDPOINT: z.string().url().default('https://overpass-api.de/api/interpreter'),
  OVERPASS_TIMEOUT: z.coerce.number().default(25000),
  OVERPASS_MAX_RETRIES: z.coerce.number().default(3),
  OVERPASS_RATE_LIMIT_MS: z.coerce.number().default(500),

  // Memory Configuration (Qdrant + mem0)
  MEMORY_ENABLED: z.coerce.boolean().default(true),
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),
  MEMORY_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  MEMORY_COLLECTION_NAME: z.string().default('chatmap_memories'),

  // Application Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // Rate Limiting
  DEFAULT_RATE_LIMIT_MS: z.coerce.number().default(100),
  DEFAULT_MAX_RETRIES: z.coerce.number().default(3),
  DEFAULT_RETRY_DELAY_MS: z.coerce.number().default(1000),
  DEFAULT_MAX_RETRY_DELAY_MS: z.coerce.number().default(10000),
  DEFAULT_BACKOFF_MULTIPLIER: z.coerce.number().default(2),
});

type Env = z.infer<typeof envSchema>;

/**
 * Load and validate environment variables
 * Throws if validation fails
 */
function loadEnv(): Env {
  const env = {
    OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    OLLAMA_TIMEOUT: process.env.OLLAMA_TIMEOUT,
    OLLAMA_MAX_RETRIES: process.env.OLLAMA_MAX_RETRIES,

    OPENROUTESERVICE_API_KEY: process.env.OPENROUTESERVICE_API_KEY,
    OPENROUTESERVICE_ENDPOINT: process.env.OPENROUTESERVICE_ENDPOINT,
    OPENROUTESERVICE_TIMEOUT: process.env.OPENROUTESERVICE_TIMEOUT,
    OPENROUTESERVICE_MAX_RETRIES: process.env.OPENROUTESERVICE_MAX_RETRIES,

    NOMINATIM_ENDPOINT: process.env.NOMINATIM_ENDPOINT,
    NOMINATIM_USER_AGENT: process.env.NOMINATIM_USER_AGENT,
    NOMINATIM_RATE_LIMIT_MS: process.env.NOMINATIM_RATE_LIMIT_MS,
    NOMINATIM_TIMEOUT: process.env.NOMINATIM_TIMEOUT,
    NOMINATIM_MAX_RETRIES: process.env.NOMINATIM_MAX_RETRIES,

    OVERPASS_ENDPOINT: process.env.OVERPASS_ENDPOINT,
    OVERPASS_TIMEOUT: process.env.OVERPASS_TIMEOUT,
    OVERPASS_MAX_RETRIES: process.env.OVERPASS_MAX_RETRIES,
    OVERPASS_RATE_LIMIT_MS: process.env.OVERPASS_RATE_LIMIT_MS,

    MEMORY_ENABLED: process.env.MEMORY_ENABLED,
    QDRANT_URL: process.env.QDRANT_URL,
    QDRANT_API_KEY: process.env.QDRANT_API_KEY,
    MEMORY_EMBEDDING_MODEL: process.env.MEMORY_EMBEDDING_MODEL,
    MEMORY_COLLECTION_NAME: process.env.MEMORY_COLLECTION_NAME,

    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,

    DEFAULT_RATE_LIMIT_MS: process.env.DEFAULT_RATE_LIMIT_MS,
    DEFAULT_MAX_RETRIES: process.env.DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_DELAY_MS: process.env.DEFAULT_RETRY_DELAY_MS,
    DEFAULT_MAX_RETRY_DELAY_MS: process.env.DEFAULT_MAX_RETRY_DELAY_MS,
    DEFAULT_BACKOFF_MULTIPLIER: process.env.DEFAULT_BACKOFF_MULTIPLIER,
  };

  try {
    return envSchema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .filter(e => e.message.includes('required'))
        .map(e => e.path.join('.'));
      
      const invalidVars = error.errors
        .filter(e => !e.message.includes('required'))
        .map(e => `${e.path.join('.')}: ${e.message}`);

      let errorMessage = 'Configuration validation failed:\n';
      
      if (missingVars.length > 0) {
        errorMessage += `\nMissing required variables:\n  - ${missingVars.join('\n  - ')}\n`;
      }
      
      if (invalidVars.length > 0) {
        errorMessage += `\nInvalid values:\n  - ${invalidVars.join('\n  - ')}\n`;
      }

      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    throw error;
  }
}

// Load configuration once at startup
let config: Env | null = null;

/**
 * Get validated configuration
 * Lazy loads and caches the config
 */
export function getConfig(): Env {
  if (!config) {
    config = loadEnv();
    
    // Log configuration in development (without sensitive data)
    if (config.NODE_ENV === 'development' && config.LOG_LEVEL === 'debug') {
      console.log('[Config] Loaded configuration:', {
        ollama: {
          endpoint: config.OLLAMA_ENDPOINT,
          model: config.OLLAMA_MODEL,
        },
        openRouteService: {
          endpoint: config.OPENROUTESERVICE_ENDPOINT,
          hasApiKey: !!config.OPENROUTESERVICE_API_KEY,
        },
        nominatim: {
          endpoint: config.NOMINATIM_ENDPOINT,
          userAgent: config.NOMINATIM_USER_AGENT,
        },
        overpass: {
          endpoint: config.OVERPASS_ENDPOINT,
        },
        memory: {
          enabled: config.MEMORY_ENABLED,
          qdrantUrl: config.QDRANT_URL,
        },
      });
    }
  }

  return config;
}

/**
 * Type-safe configuration accessors
 */
export const Config = {
  get ollama() {
    const cfg = getConfig();
    return {
      endpoint: cfg.OLLAMA_ENDPOINT,
      model: cfg.OLLAMA_MODEL,
      timeout: cfg.OLLAMA_TIMEOUT,
      maxRetries: cfg.OLLAMA_MAX_RETRIES,
    };
  },

  get openRouteService() {
    const cfg = getConfig();
    return {
      apiKey: cfg.OPENROUTESERVICE_API_KEY,
      endpoint: cfg.OPENROUTESERVICE_ENDPOINT,
      timeout: cfg.OPENROUTESERVICE_TIMEOUT,
      maxRetries: cfg.OPENROUTESERVICE_MAX_RETRIES,
    };
  },

  get nominatim() {
    const cfg = getConfig();
    return {
      endpoint: cfg.NOMINATIM_ENDPOINT,
      userAgent: cfg.NOMINATIM_USER_AGENT,
      rateLimitMs: cfg.NOMINATIM_RATE_LIMIT_MS,
      timeout: cfg.NOMINATIM_TIMEOUT,
      maxRetries: cfg.NOMINATIM_MAX_RETRIES,
    };
  },

  get overpass() {
    const cfg = getConfig();
    return {
      endpoint: cfg.OVERPASS_ENDPOINT,
      timeout: cfg.OVERPASS_TIMEOUT,
      maxRetries: cfg.OVERPASS_MAX_RETRIES,
      rateLimitMs: cfg.OVERPASS_RATE_LIMIT_MS,
    };
  },

  get memory() {
    const cfg = getConfig();
    return {
      enabled: cfg.MEMORY_ENABLED,
      qdrantUrl: cfg.QDRANT_URL,
      qdrantApiKey: cfg.QDRANT_API_KEY,
      embeddingModel: cfg.MEMORY_EMBEDDING_MODEL,
      collectionName: cfg.MEMORY_COLLECTION_NAME,
    };
  },

  get retry() {
    const cfg = getConfig();
    return {
      defaultMaxRetries: cfg.DEFAULT_MAX_RETRIES,
      defaultRetryDelay: cfg.DEFAULT_RETRY_DELAY_MS,
      defaultMaxRetryDelay: cfg.DEFAULT_MAX_RETRY_DELAY_MS,
      defaultBackoffMultiplier: cfg.DEFAULT_BACKOFF_MULTIPLIER,
    };
  },

  get app() {
    const cfg = getConfig();
    return {
      nodeEnv: cfg.NODE_ENV,
      logLevel: cfg.LOG_LEVEL,
      isDevelopment: cfg.NODE_ENV === 'development',
      isProduction: cfg.NODE_ENV === 'production',
      isTest: cfg.NODE_ENV === 'test',
    };
  },
};

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  config = null;
}
