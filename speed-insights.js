/**
 * Vercel Speed Insights initialization
 * ============================================================================
 * Injects the Speed Insights tracking script to monitor web vitals and
 * performance metrics. This module follows the same pattern as analytics.js.
 *
 * Speed Insights does NOT track in development mode - only in production.
 */

import { injectSpeedInsights } from "@vercel/speed-insights";

// Initialize Speed Insights
// This will automatically track Core Web Vitals and other performance metrics
injectSpeedInsights({
  debug: false, // Set to true for debugging in development
});
