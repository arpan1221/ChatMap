import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server external packages - prevents bundling for client
  serverExternalPackages: ['mem0ai', 'form-data'],
  
  // Enable experimental features for better performance
  experimental: {
    optimizePackageImports: ['leaflet', 'react-leaflet', '@turf/turf'],
  },
  
  // Enable Turbopack for faster development
  turbopack: {
    resolveAlias: {
      // Only alias modules that are truly not needed in the browser
      fs: 'false',
      net: 'false',
      tls: 'false',
      'form-data': 'false',
    },
  },
  
  // Configure webpack for Leaflet compatibility (fallback for non-Turbopack builds)
  webpack: (config, { isServer }) => {
    // Fix for Leaflet markers not showing in production
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        'form-data': false,
      };
    }
    
    // Exclude mem0ai from client-side bundle
    config.externals = config.externals || [];
    if (!isServer) {
      config.externals.push({
        'mem0ai': 'commonjs mem0ai',
        'form-data': 'commonjs form-data',
      });
    }
    
    return config;
  },
  
  // Configure images for external API usage
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  
  // Headers for CORS and security
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
    ];
  },
  
  // Environment variables validation
  env: {
    ORS_API_KEY: process.env.ORS_API_KEY,
    OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  },
};

export default nextConfig;
