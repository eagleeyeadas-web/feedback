-- ====================================================================
-- Migration: 046_web_push_notifications.sql
-- Description: Web Push Subscriptions and Notification History Tables
-- Supports mobile and desktop push notifications with VAPID
-- ====================================================================

-- 1. Table for storing Web Push subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_email TEXT,
    user_role TEXT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    device_type TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for push_subscriptions
CREATE INDEX IF NOT EXISTS idx_push_sub_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_sub_endpoint ON public.push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_sub_is_active ON public.push_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_push_sub_user_role ON public.push_subscriptions(user_role);

-- 2. Table for recording push notification delivery history & audit
CREATE TABLE IF NOT EXISTS public.push_notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL,
    checklist_id UUID,
    checklist_number TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    recipients_attempted INTEGER DEFAULT 0,
    recipients_succeeded INTEGER DEFAULT 0,
    recipients_failed INTEGER DEFAULT 0,
    delivery_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for push_notification_history
CREATE INDEX IF NOT EXISTS idx_push_history_event_id ON public.push_notification_history(event_id);
CREATE INDEX IF NOT EXISTS idx_push_history_checklist_id ON public.push_notification_history(checklist_id);
CREATE INDEX IF NOT EXISTS idx_push_history_created_at ON public.push_notification_history(created_at DESC);

-- 3. Row Level Security (RLS)
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_history ENABLE ROW LEVEL SECURITY;

-- Subscriptions policy: Users can query and manage their own subscriptions
DROP POLICY IF EXISTS "Users can manage their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can manage their own push subscriptions"
    ON public.push_subscriptions
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Backend service role full access
DROP POLICY IF EXISTS "Service role full access push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Service role full access push_subscriptions"
    ON public.push_subscriptions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access push_notification_history" ON public.push_notification_history;
CREATE POLICY "Service role full access push_notification_history"
    ON public.push_notification_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
