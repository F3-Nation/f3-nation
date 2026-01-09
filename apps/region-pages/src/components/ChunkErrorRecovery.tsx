'use client';

import { useEffect } from 'react';

/**
 * Client-side error recovery component to handle chunk loading failures
 * This prevents users from getting stuck when stale HTML references missing JS chunks
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    // Handle global JavaScript errors, particularly chunk loading failures
    const handleError = (event: ErrorEvent) => {
      const message = event.message || '';
      const filename = event.filename || '';

      // Check for chunk loading errors
      if (
        message.includes('Loading chunk') ||
        message.includes('ChunkLoadError') ||
        filename.includes('/_next/static/chunks/')
      ) {
        console.warn('Chunk loading error detected, reloading page:', message);
        // Force a hard reload to fetch fresh HTML and assets
        window.location.reload();
        return;
      }
    };

    // Handle unhandled promise rejections (common with dynamic imports)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason?.message || String(reason);

      if (
        message.includes('Loading chunk') ||
        message.includes('ChunkLoadError') ||
        message.includes('/_next/static/chunks/')
      ) {
        console.warn(
          'Chunk loading promise rejection detected, reloading page:',
          message
        );
        // Prevent the error from being logged to console
        event.preventDefault();
        // Force a hard reload to fetch fresh HTML and assets
        window.location.reload();
        return;
      }
    };

    // Add event listeners
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Cleanup event listeners on unmount
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection
      );
    };
  }, []);

  // This component doesn't render anything
  return null;
}
