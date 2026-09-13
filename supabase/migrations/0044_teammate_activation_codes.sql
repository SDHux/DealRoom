-- Team Admin/Manager Rework, Data model #1 (revised design, post-review): activation-code
-- storage and verification. Account CREATION itself moved out of this migration entirely --
-- it happens in a Netlify function (netlify/functions/provision-teammate.mts) via
-- Supabase's Admin API, using the SUPABASE_SERVICE_ROLE_KEY already configured in Netlify
-- (same key stripe-webhook.mts already uses), not a direct auth.users INSERT. Reasoning:
-- auth.users is Supabase-owned internal schema, not a documented interface -- writing to it
-- directly worked in an earlier draft of this migration but bypasses the interface Supabase
-- actually maintains, so a future Auth upgrade could silently break it with no warning. A
-- standing database function that can mint working login credentials on its own is also a
-- bigger permanent attack surface than a server-side call gated behind a secret nothing but
-- the Netlify runtime holds.
--
-- What's left here is exactly the part that's safe and correct as a Postgres function: the
-- 6-digit code's own storage/verification, entirely within public.organization_members and
-- pgcrypto, no auth.users involved at all on this path.
--
-- SECURITY: the code is NOT the rep's literal Supabase Auth password (an earlier draft did
-- this; reworked). A 1,000,000-value keyspace held open for up to 7 days is not safely
-- defended by Supabase's own generic sign-in rate limit alone (checked: 360 requests/hour,
-- per IP address, not per-target-account -- a determined attacker rotating IPs could
-- plausibly exhaust the keyspace within the code's lifetime). Instead: the account is
-- created with a long random password the client never sees or can authenticate with
-- directly, and the code is verified through verify_activation_code() below, which enforces
-- its own tight, per-account attempt cap and expiry, independent of Supabase's IP-scoped
-- limits. A verified code doesn't log the rep in itself -- it authorizes
-- provision-teammate.mts's Netlify function to mint a one-time Supabase recovery token via
-- the Admin API (admin.generateLink, type=recovery), which the client exchanges via
-- verifyOtp() to get a real session and the exact PASSWORD_RECOVERY event this app's
-- existing ResetPassword UI already handles.
--
-- Hashed with pgcrypto's bcrypt (extensions.crypt + gen_salt('bf')), the same primitive this
-- app already uses for real passwords -- deliberately not a fast general-purpose hash
-- (sha256/md5/digest). Salting alone doesn't meaningfully protect a keyspace this small
-- against a fast hash: an attacker who has a row's salt (normally stored alongside the hash,
-- not secret) can compute all 1,000,000 possible fast-hash values for that exact salt in a
-- fraction of a second on ordinary hardware. bcrypt's deliberate slowness (not its salting)
-- is what actually makes a per-row brute force expensive.
alter table organization_members add column activation_code_hash text;
alter table organization_members add column activation_expires_at timestamptz;
alter table organization_members add column activation_attempts integer not null default 0;

-- Admin-only, same authorization check as provision-teammate.mts's own is_admin gate.
-- Generates a fresh code for a teammate still in 'invited' status, resets the attempt
-- counter to zero and issues a new 7-day expiry alongside it -- a rep who fat-fingered their
-- original code a few times and got a Resend shouldn't still be sitting near their old
-- attempt cap on the very next try with the new one.
create or replace function public.resend_teammate_code(p_org_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_email text;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and is_admin
  ) then
    raise exception 'Only this organization''s Admin can resend an activation code';
  end if;

  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and status = 'invited'
  ) then
    raise exception 'That teammate has already activated their account, or isn''t part of this organization';
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  update organization_members
  set
    activation_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf')),
    activation_expires_at = now() + interval '7 days',
    activation_attempts = 0
  where org_id = p_org_id and user_id = p_user_id;

  select email into v_email from profiles where id = p_user_id;
  return jsonb_build_object('user_id', p_user_id, 'email', v_email, 'code', v_code);
end;
$$;

revoke all on function public.resend_teammate_code(uuid, uuid) from public;
grant execute on function public.resend_teammate_code(uuid, uuid) to authenticated;

-- Called by provision-teammate.mts (Netlify, service-role-authenticated) right after it
-- creates the auth.users row via the Admin API, to finish setting up the org membership,
-- profile, and initial code -- kept as a single atomic Postgres statement rather than two
-- separate PostgREST inserts from the function, so this half of the operation can't itself
-- partially fail. Still Admin-only, checked the same way as every other function here.
create or replace function public.finish_teammate_provisioning(
  p_org_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_is_manager boolean,
  p_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and is_admin
  ) then
    raise exception 'Only this organization''s Admin can add a teammate';
  end if;

  insert into organization_members (
    org_id, user_id, role, is_admin, is_manager, status,
    activation_code_hash, activation_expires_at, activation_attempts
  ) values (
    p_org_id, p_user_id, 'member', false, coalesce(p_is_manager, false), 'invited',
    extensions.crypt(p_code, extensions.gen_salt('bf')), now() + interval '7 days', 0
  );

  insert into profiles (id, email, full_name)
  values (p_user_id, lower(trim(p_email)), nullif(trim(p_full_name), ''));
end;
$$;

revoke all on function public.finish_teammate_provisioning(uuid, uuid, text, text, boolean, text) from public;
grant execute on function public.finish_teammate_provisioning(uuid, uuid, text, text, boolean, text) to authenticated;

-- The public, pre-login entry point -- callable by anon (the rep has no session yet when
-- they submit their code). Locks the target row for the duration of the check (select ...
-- for update) so two near-simultaneous submissions of the same correct code can't both
-- succeed: the second one blocks until the first commits, then finds activation_code_hash
-- already null (consumed) and correctly reports failure instead of the caller (provision-
-- teammate's activation endpoint) firing a second generateLink for the same code.
--
-- Does NOT flip status to 'active' -- that's still complete_activation()'s job, called by
-- the rep's own client only after they've actually set a real password. This function only
-- proves the code was correct and consumes it; status stays 'invited' until the real
-- password exists, matching the original design (spec: "first successful login immediately
-- requires the rep to set their own real password before landing in their bivy").
create or replace function public.verify_activation_code(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_member record;
begin
  select id into v_user_id from auth.users where email = lower(trim(p_email));
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  select * into v_member
  from organization_members
  where user_id = v_user_id and status = 'invited'
  for update;

  if v_member is null or v_member.activation_code_hash is null then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  if v_member.activation_expires_at < now() then
    return jsonb_build_object('success', false, 'error', 'expired');
  end if;

  if v_member.activation_attempts >= 8 then
    return jsonb_build_object('success', false, 'error', 'locked');
  end if;

  if v_member.activation_code_hash is distinct from extensions.crypt(p_code, v_member.activation_code_hash) then
    update organization_members set activation_attempts = activation_attempts + 1
    where user_id = v_user_id;
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  -- Correct: consume the code now, inside this same locked transaction, so a concurrent
  -- duplicate submission (blocked above on FOR UPDATE) sees it already gone the moment it
  -- proceeds, rather than racing us to a second generateLink call downstream.
  update organization_members set activation_code_hash = null where user_id = v_user_id;

  return jsonb_build_object('success', true, 'user_id', v_user_id, 'org_id', v_member.org_id);
end;
$$;

revoke all on function public.verify_activation_code(text, text) from public;
grant execute on function public.verify_activation_code(text, text) to authenticated, anon;

-- Called by the rep themselves, immediately after they've set a real password following a
-- successful code verification. Narrow and self-only: flips just the caller's own row from
-- 'invited' to 'active', nothing else -- org_members_update (0002, role-based) doesn't let a
-- plain member touch their own row at all, so this is the one deliberate, minimal exception,
-- scoped to exactly this one transition.
create or replace function public.complete_activation()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update organization_members
  set status = 'active'
  where user_id = auth.uid() and status = 'invited';
end;
$$;

revoke all on function public.complete_activation() from public;
grant execute on function public.complete_activation() to authenticated;
