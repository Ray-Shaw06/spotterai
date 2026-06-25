/**
 * SpotterAI — Firebase config (for optional cross-device sync)
 * ============================================================================
 * Paste your own Firebase **web app** config below to enable "Sign in with
 * Google" + cloud sync. Until you do, the app stays 100% local (sign-in is
 * hidden) — nothing breaks.
 *
 * IMPORTANT: this config is NOT a secret. A Firebase web apiKey is a public
 * project identifier, not a credential — Google designs it to ship in client
 * code. Your data is protected by Firestore **security rules** (see the README),
 * which only let a signed-in user read/write their own document. So it is safe
 * to commit this file.
 *
 * Setup steps are in the README → "Cross-device sync (Google + Firebase)".
 */

export const firebaseConfig = {
  apiKey: "AIzaSyBPWVAO-rqb18BD7vM8wK5mMT31ZnCJZfU",
  authDomain: "spotterai-c02c6.firebaseapp.com",
  projectId: "spotterai-c02c6",
  appId: "1:254561575776:web:641fc68013f30c05607405",
};

// Sync turns on only once the placeholder apiKey is replaced.
export const SYNC_CONFIGURED = !String(firebaseConfig.apiKey || "").startsWith("YOUR_");
