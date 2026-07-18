const DENIED_GUIDANCE = Object.freeze({
  ios_pwa: "Notifications are blocked. On iPhone, open the Settings app, find SpotterAI under Apps (or Notifications), then turn on Allow Notifications. SpotterAI will not ask again automatically.",
  android_pwa: "Notifications are blocked. On Android, open Settings, then Apps, SpotterAI, and Notifications, and allow notifications. SpotterAI will not ask again automatically.",
  unsupported: "Notifications are blocked. Open this device's app or site notification settings for SpotterAI and allow notifications. SpotterAI will not ask again automatically.",
});

export function notificationDeniedGuidance(platformGroup) {
  return DENIED_GUIDANCE[platformGroup] || DENIED_GUIDANCE.unsupported;
}
