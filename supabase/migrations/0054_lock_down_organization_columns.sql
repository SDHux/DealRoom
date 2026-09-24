-- Owners could PATCH any organizations column straight through the Data API with their
-- own token (subscription_status, plan_tier, trial_ends_at, deal_room_limit, stripe ids,
-- and the demo flags) -- i.e. grant themselves a paid plan. Logged-in users may now only
-- write the four columns the app itself edits directly. Billing fields stay writable by
-- the Stripe webhook (service_role) and by SECURITY DEFINER functions (set_org_logo,
-- set_stripe_customer_id, create_organization_with_owner, create_demo_workspace), which
-- run with the function owner's privileges and are unaffected.
revoke update on public.organizations from authenticated;
grant update (name, stage_labels, post_signature_stage_labels, onboarding_seen) on public.organizations to authenticated;
