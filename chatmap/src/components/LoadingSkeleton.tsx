'use client';

import React from 'react';

// Skeleton component for message loading
export const MessageSkeleton: React.FC<{ isUser?: boolean }> = ({ isUser = false }) => {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`flex space-x-2 max-w-[85%] sm:max-w-md ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
        {/* Avatar skeleton */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
        </div>
        
        {/* Message content skeleton */}
        <div className={`flex-1 ${isUser ? 'text-right' : ''}`}>
          <div className={`rounded-2xl px-3 py-2 sm:px-4 ${
            isUser 
              ? 'bg-gray-200 rounded-br-md' 
              : 'bg-gray-100 rounded-bl-md'
          }`}>
            <div className="space-y-2">
              <div className="h-4 bg-gray-300 rounded animate-pulse w-3/4"></div>
              <div className="h-4 bg-gray-300 rounded animate-pulse w-1/2"></div>
            </div>
          </div>
          
          {/* Timestamp skeleton */}
          <div className="mt-1">
            <div className="h-3 bg-gray-200 rounded animate-pulse w-16"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Skeleton component for POI cards
export const POISkeleton: React.FC = () => {
  return (
    <div className="p-4 border border-gray-200 rounded-lg animate-pulse">
      <div className="flex items-start space-x-3">
        {/* POI icon skeleton */}
        <div className="w-12 h-12 bg-gray-200 rounded-full flex-shrink-0"></div>
        
        {/* Content skeleton */}
        <div className="flex-1 space-y-2">
          <div className="h-5 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    </div>
  );
};

// Skeleton component for map loading
export const MapSkeleton: React.FC = () => {
  return (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto animate-pulse"></div>
        <div className="space-y-2">
          <div className="h-4 bg-gray-200 rounded w-32 mx-auto animate-pulse"></div>
          <div className="h-3 bg-gray-200 rounded w-24 mx-auto animate-pulse"></div>
        </div>
      </div>
    </div>
  );
};

// Skeleton component for input loading
export const InputSkeleton: React.FC = () => {
  return (
    <div className="w-full">
      <div className="relative">
        <div className="w-full h-12 bg-gray-200 rounded-full animate-pulse"></div>
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 bg-gray-300 rounded-full animate-pulse"></div>
      </div>
    </div>
  );
};

// Skeleton component for header loading
export const HeaderSkeleton: React.FC = () => {
  return (
    <div className="flex-shrink-0 bg-white border-b border-gray-200 px-3 py-2 sm:px-4 sm:py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="w-5 h-5 sm:w-6 sm:h-6 bg-gray-200 rounded animate-pulse flex-shrink-0"></div>
          <div className="min-w-0 flex-1">
            <div className="h-5 sm:h-6 bg-gray-200 rounded animate-pulse w-24"></div>
            <div className="hidden sm:block mt-1 h-3 bg-gray-200 rounded animate-pulse w-32"></div>
          </div>
        </div>
        
        <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
          <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
        </div>
      </div>
    </div>
  );
};

// Skeleton component for error states
export const ErrorSkeleton: React.FC = () => {
  return (
    <div className="p-4 bg-red-50 rounded-lg animate-pulse">
      <div className="flex items-center space-x-2">
        <div className="w-5 h-5 bg-red-200 rounded-full"></div>
        <div className="h-4 bg-red-200 rounded w-3/4"></div>
      </div>
    </div>
  );
};

// Generic skeleton component
interface SkeletonProps {
  className?: string;
  lines?: number;
  width?: string;
  height?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  className = '', 
  lines = 1, 
  width = 'w-full',
  height = 'h-4'
}) => {
  if (lines === 1) {
    return (
      <div className={`${height} ${width} bg-gray-200 rounded animate-pulse ${className}`}></div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={`${height} ${width} bg-gray-200 rounded animate-pulse ${
            i === lines - 1 ? 'w-3/4' : 'w-full'
          }`}
        ></div>
      ))}
    </div>
  );
};
