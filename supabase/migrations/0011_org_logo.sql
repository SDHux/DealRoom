alter table organizations add column logo_url text;

-- Bucket for org logos. Path convention: {org_id}/logo (no extension -- content-type comes
-- from the upload's actual file; browsers render fine without an extension in the URL).
-- Public bucket: logos need to render for prospects viewing a deal room too, without a
-- signed-URL round trip, and aren't sensitive.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

-- storage.objects has RLS enabled by Supabase on every project by default.
-- (storage.foldername(name))[1] is the first path segment, i.e. the org_id.
create policy org_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and current_org_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  );

create policy org_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-logos'
    and current_org_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  )
  with check (
    bucket_id = 'org-logos'
    and current_org_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  );

create policy org_logos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and current_org_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  );

-- Public-bucket reads via the public URL bypass RLS entirely by design, but this covers
-- authenticated/anon API paths (list/download) too, as defense in depth.
create policy org_logos_select on storage.objects
  for select to public
  using (bucket_id = 'org-logos');

-- The one column an admin (not just owner) may change on organizations. A narrow RPC
-- instead of loosening organizations_update (owner-only by design in 0002, and that policy
-- also covers slug/plan_tier/stripe_customer_id -- loosening it would expose those to
-- admin writes too). Org name stays owner-only via the existing policy, unchanged.
create or replace function public.set_org_logo(p_org_id uuid, p_logo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_org_role(p_org_id) not in ('owner', 'admin') then
    raise exception 'Not authorized to change this organization''s logo';
  end if;

  update organizations set logo_url = p_logo_url where id = p_org_id;
end;
$$;

revoke all on function public.set_org_logo(uuid, text) from public;
grant execute on function public.set_org_logo(uuid, text) to authenticated;
