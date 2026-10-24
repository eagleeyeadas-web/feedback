import {
  getVapidPublicKeyApi,
  subscribePushApi,
  unsubscribePushApi,
  getPushSubscriptionStatusApi,
  sendTestPushNotificationApi,
} from './api';

/**
 * Convert URL-safe base64 string to Uint8Array required by PushManager.subscribe
 */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Detect device type and capabilities
 */
export function getDeviceInfo() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  let deviceType = 'Desktop';
  if (isAndroid) deviceType = 'Android';
  else if (isIos) deviceType = 'iOS';

  const isPushApiSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  // On iOS, Web Push is only supported if added to the Home Screen (iOS 16.4+)
  const requiresHomeScreen = isIos && !isStandalone;

  return {
    isAndroid,
    isIos,
    isStandalone,
    deviceType,
    isPushApiSupported,
    requiresHomeScreen,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  };
}

/**
 * Ensure Service Worker is registered
 */
export async function getServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker is not supported in this browser.');
  }

  // Register sw.js if not already registered
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } else {
    // Proactively check for service worker updates so latest click handler is always active
    reg.update().catch(() => {});
  }

  // Wait for service worker to be active
  if (reg.installing || reg.waiting) {
    await new Promise((resolve) => {
      const sw = reg.installing || reg.waiting;
      sw.addEventListener('statechange', (e) => {
        if (e.target.state === 'activated') {
          resolve();
        }
      });
      // Fallback timeout
      setTimeout(resolve, 1500);
    });
  }

  return reg;
}

/**
 * Get current push subscription on this browser
 */
export async function getCurrentPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn('[PUSH] Could not get current subscription:', err.message);
    return null;
  }
}

/**
 * Subscribe user to Web Push
 */
export async function subscribeToPush(token) {
  const devInfo = getDeviceInfo();

  if (!devInfo.isPushApiSupported) {
    if (devInfo.requiresHomeScreen) {
      throw new Error(
        'On iPhone and iPad, push notifications require adding this website to your Home Screen first.\nTap the Share button (square with arrow) at the bottom of Safari, then choose "Add to Home Screen".'
      );
    }
    throw new Error('Push notifications are not supported in this browser or environment.');
  }

  // 1. Explicitly request permission
  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error(
      'Notification permission was denied. Please open your browser settings or click the lock/settings icon in the URL bar to allow notifications for this site.'
    );
  }
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  // 2. Ready the service worker
  const reg = await getServiceWorkerRegistration();
  await navigator.serviceWorker.ready;

  // 3. Get VAPID public key from backend
  const publicKey = await getVapidPublicKeyApi();
  if (!publicKey) {
    throw new Error('VAPID public key could not be retrieved from the server.');
  }

  // 4. Create PushSubscription via PushManager
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await reg.pushManager.getSubscription();

  if (subscription) {
    // If existing, we can keep or resubscribe
    try {
      await subscription.unsubscribe();
    } catch {
      // Continue to fresh subscribe
    }
  }

  subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  // 5. Send subscription to server
  const subJson = subscription.toJSON();
  await subscribePushApi(token, {
    subscription: subJson,
    device_type: devInfo.deviceType,
    user_agent: navigator.userAgent,
  });

  return {
    success: true,
    subscription,
    deviceType: devInfo.deviceType,
  };
}

/**
 * Unsubscribe user from Web Push
 */
export async function unsubscribeFromPush(token) {
  try {
    const sub = await getCurrentPushSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      if (token) {
        await unsubscribePushApi(token, endpoint).catch(() => {});
      }
    }
    return { success: true };
  } catch (err) {
    console.error('[PUSH] Failed to unsubscribe:', err);
    throw err;
  }
}

/**
 * Trigger a test notification to verify delivery
 */
export async function triggerTestPushNotification(token) {
  return await sendTestPushNotificationApi(token);
}

/**
 * Check whether push is active and registered for this user/device
 */
export async function getLocalPushStatus(token) {
  const devInfo = getDeviceInfo();
  if (!devInfo.isPushApiSupported) {
    return {
      supported: false,
      isSubscribed: false,
      devInfo,
      statusLabel: devInfo.requiresHomeScreen ? 'Requires iOS Home Screen' : 'Unsupported on this device',
    };
  }

  if (devInfo.permission === 'denied') {
    return {
      supported: true,
      isSubscribed: false,
      devInfo,
      statusLabel: 'Blocked in Browser',
    };
  }

  const sub = await getCurrentPushSubscription();
  const hasBrowserSub = Boolean(sub);

  let serverStatus = { isSubscribed: false };
  if (token && sub?.endpoint) {
    try {
      serverStatus = await getPushSubscriptionStatusApi(token, sub.endpoint);
    } catch {
      serverStatus = { isSubscribed: hasBrowserSub };
    }
  }

  const isSubscribed = Boolean(hasBrowserSub || serverStatus.isSubscribed);

  return {
    supported: true,
    isSubscribed,
    devInfo,
    statusLabel: isSubscribed ? 'Active on this device' : 'Not Enabled',
  };
}
