-- Local-dev-only seed data (Supabase CLI convention: applied by `supabase db reset`,
-- never pushed to a hosted project by `supabase db push`).
--
-- Deliberately synthetic, not the real Kraft Heinz / Church & Dwight / Reckitt / Walmart
-- account data that's still hardcoded in app.jsx's INIT_DEALS today -- the build brief
-- separately calls out replacing that real account data with anonymized/synthetic sample
-- deals before this product is prospect-facing, and there's no reason to carry it forward
-- into the new schema even in a file the CLI treats as local-only, since this repo is
-- public on GitHub and the file itself still gets committed.
--
-- Note: this seeds one fixed "Local Dev Org" for schema/local development. The eventual
-- per-signup demo org (build brief step 7) is a runtime function invoked at signup, not
-- this static file -- don't conflate the two.

insert into organizations (id, name, slug, plan_tier)
values ('00000000-0000-0000-0000-000000000001', 'Local Dev Org', 'local-dev-org', 'trial');

-- Two synthetic sample deals, enough to exercise every table in this migration set.

insert into deals (
  id, org_id, company_name, primary_contact_name, title, stage, value_amount, currency,
  close_date, logo_initials, brand_color, industry, engagement_score,
  include_trial_sessions, welcome_message, exec_summary, discovery, share_slug, access_code
)
values (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'Northwind Foods', 'Priya Nair', 'Digital Shelf & PXM Platform', 'Evaluation',
  340000, 'USD', '2026-11-30', 'NW', '#2E7D32', 'CPG · Food & Beverage', 74,
  true,
  'Welcome to your dedicated deal workspace. This portal centralizes everything for your evaluation.',
  jsonb_build_object(
    'problem', 'Northwind is scaling digital commerce but struggles to keep product content consistent across retail endpoints.',
    'challenges', jsonb_build_array('No centralized PIM', 'Manual syndication to major retailers', 'Slow time-to-market for new SKUs'),
    'solutions', jsonb_build_array('Centralize product content in one platform', 'Automate syndication', 'Real-time digital shelf analytics')
  ),
  jsonb_build_object(
    'summary', 'Northwind Foods is a mid-size CPG brand investing in digital commerce growth.',
    'corporateStrategy', jsonb_build_array('Grow eCommerce revenue', 'Improve brand consistency at shelf'),
    'topOutcomes', jsonb_build_array('Grow digital shelf revenue', 'Reduce manual content operations'),
    'goals', jsonb_build_object('90 Days', jsonb_build_array('Centralize digital assets'), '1 Year', jsonb_build_array('Full catalog syndication'))
  ),
  'nw-foods-demo-8f2c1a', 'NW2026'
),
(
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000001',
  'Solace Health', 'Marcus Webb', 'Consumer Insights Platform', 'Discovery',
  215000, 'USD', '2026-12-15', 'SH', '#1A56DB', 'Health & Wellness', 45,
  false,
  'Welcome to your Solace Health deal workspace.',
  jsonb_build_object(
    'problem', 'Solace Health lacks real-time consumer sentiment visibility across retail channels.',
    'challenges', jsonb_build_array('Manual competitive monitoring', 'No unified analytics layer'),
    'solutions', jsonb_build_array('Deploy AI-powered sentiment dashboards', 'Automate competitive reporting')
  ),
  jsonb_build_object(
    'summary', 'Solace Health is a fast-growing wellness brand expanding its retail footprint.',
    'corporateStrategy', jsonb_build_array('Expand eCommerce presence', 'Improve brand monitoring'),
    'topOutcomes', jsonb_build_array('Faster competitive response', 'Reduced manual research time'),
    'goals', jsonb_build_object('90 Days', jsonb_build_array('Launch first dashboard'), '1 Year', jsonb_build_array('Full portfolio coverage'))
  ),
  'solace-health-demo-3e91b7', 'SH2026'
);

insert into stakeholders (id, deal_id, org_id, name, role_title, designation, engagement_score, business_unit, approval_required, reports_to)
values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Priya Nair', 'VP Digital Commerce', 'champion', 88, 'Digital Commerce', true, null),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Devon Cole', 'Chief Digital Officer', 'decision-maker', 41, 'Executive', true, null),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Anna Torres', 'Director of eCommerce', 'influencer', 62, 'eCommerce', false, '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Marcus Webb', 'Sr. Director Consumer Insights', 'champion', 71, 'Consumer Insights', true, null);

insert into deal_tasks (deal_id, org_id, phase, task, owner_name, buyer_owner_label, primary_stakeholder_id, due_date, status, notes, approval_required, sort_order)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Value Alignment', 'Initial Discovery Meeting', 'Mark H.', 'Priya Nair', '00000000-0000-0000-0000-000000000201', '2026-09-10', 'complete', 'Confirmed core pain points', false, 1),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Value Alignment', 'Custom Demo', 'Mark H.', 'Priya Nair + Anna Torres', '00000000-0000-0000-0000-000000000201', '2026-09-24', 'in-progress', '', false, 2),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Value Alignment', 'Initial Discovery Meeting', 'Mark H.', 'Marcus Webb', '00000000-0000-0000-0000-000000000211', '2026-10-01', 'complete', '', false, 1);

insert into documents (deal_id, org_id, title, file_type, category, storage_url)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Executive Discovery Deck — Northwind Foods', 'pptx', 'Presentation', '#'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'ROI Calculator (CPG Benchmark)', 'xlsx', 'ROI', '#'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Company Overview & Capabilities Deck', 'pptx', 'Presentation', '#');
