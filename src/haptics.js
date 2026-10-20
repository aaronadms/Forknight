// haptics.js — drop-in replacement for navigator.vibrate()
// Uses native Capacitor haptics on iOS, falls back to navigator.vibrate on Android/web
//
// Usage: import { haptic } from './haptics';
//        haptic();           // light tap (default)
//        haptic('medium');   // medium impact
//        haptic('heavy');    // heavy impact

let Haptics = null;

// Lazy-load Capacitor Haptics — only available in native context
const loadHaptics = async () => {
  if (Haptics) return Haptics;
  try {
    const cap = await import('@capacitor/haptics');
    Haptics = cap.Haptics;
    return Haptics;
  } catch {
    return null;
  }
};

export const haptic = async (style = 'light') => {
  const h = await loadHaptics();
  if (h) {
    // Native iOS haptics via Capacitor
    try {
      const { ImpactStyle } = await import('@capacitor/haptics');
      const styleMap = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      };
      await h.impact({ style: styleMap[style] || ImpactStyle.Light });
      return;
    } catch {}
  }
  // Fallback: web vibration API (Android Chrome)
  try {
    navigator.vibrate && navigator.vibrate(style === 'heavy' ? 20 : 10);
  } catch {}
};

// Notification haptics — success, warning, error
export const hapticNotification = async (type = 'success') => {
  const h = await loadHaptics();
  if (h) {
    try {
      const { NotificationType } = await import('@capacitor/haptics');
      const typeMap = {
        success: NotificationType.Success,
        warning: NotificationType.Warning,
        error: NotificationType.Error,
      };
      await h.notification({ type: typeMap[type] || NotificationType.Success });
      return;
    } catch {}
  }
  try { navigator.vibrate && navigator.vibrate([10, 50, 10]); } catch {}
};
