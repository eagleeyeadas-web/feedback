import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  getSubscriptionStatus,
  sendTestNotificationToUser,
  getNotificationHistory,
} from '../services/pushNotificationService.js';

const router = express.Router();

/**
 * GET /api/notifications/vapid-public-key
 * Returns the public VAPID key so frontend can create push subscriptions.
 * Never exposes the private key.
 */
router.get('/vapid-public-key', (req, res) => {
  try {
    const key = getVapidPublicKey();
    return res.json({ publicKey: key });
  } catch (err) {
    console.error('Failed to retrieve VAPID public key:', err);
    return res.status(500).json({ error: 'Failed to retrieve VAPID public key' });
  }
});

/**
 * POST /api/notifications/subscribe
 * Authenticated user registers a Web Push subscription for their device/browser
 */
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription, device_type, user_agent } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Valid subscription object is required' });
    }

    const userId = req.user?.id || req.profile?.id;
    const userEmail = req.profile?.email || req.user?.email || null;
    const userRole = req.profile?.role || null;

    const result = await saveSubscription({
      userId,
      userEmail,
      userRole,
      subscription,
      userAgent: user_agent || req.headers['user-agent'] || null,
      deviceType: device_type || 'Other',
    });

    return res.json({
      success: true,
      message: 'Push notifications enabled successfully on this device.',
      subscriptionId: result.id,
    });
  } catch (err) {
    console.error('Error saving push subscription:', err);
    return res.status(500).json({ error: err.message || 'Failed to save push subscription' });
  }
});

/**
 * POST /api/notifications/unsubscribe
 * Authenticated user unregisters a Web Push subscription
 */
router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required to unsubscribe' });
    }

    const userId = req.user?.id || req.profile?.id;
    await removeSubscription({ userId, endpoint });

    return res.json({
      success: true,
      message: 'Push notifications disabled successfully for this device.',
    });
  } catch (err) {
    console.error('Error removing push subscription:', err);
    return res.status(500).json({ error: err.message || 'Failed to remove push subscription' });
  }
});

/**
 * GET /api/notifications/subscription-status
 * Check if the current user/device is subscribed
 */
router.get('/subscription-status', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.profile?.id;
    const endpoint = req.query.endpoint || null;

    const status = await getSubscriptionStatus({ userId, endpoint });
    return res.json(status);
  } catch (err) {
    console.error('Error checking subscription status:', err);
    return res.status(500).json({ error: 'Failed to check subscription status' });
  }
});

/**
 * POST /api/notifications/test
 * Trigger a test push notification to user's registered devices
 */
router.post('/test', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.profile?.id;
    const userEmail = req.profile?.email || null;

    const result = await sendTestNotificationToUser({ userId, userEmail });
    return res.json(result);
  } catch (err) {
    console.error('Error sending test notification:', err);
    return res.status(400).json({ error: err.message || 'Failed to send test push notification' });
  }
});

/**
 * GET /api/notifications/history
 * Retrieve push delivery log
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const history = await getNotificationHistory(limit);
    return res.json({ history });
  } catch (err) {
    console.error('Error fetching notification history:', err);
    return res.status(500).json({ error: 'Failed to fetch notification history' });
  }
});

export default router;
