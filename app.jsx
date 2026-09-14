const { useState, useEffect, useRef } = React;

// Supabase project config. The anon/publishable key is safe to embed client-side --
// protected by RLS, not secrecy -- same as any other public constant in this file.
const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";
if (typeof supabase === "undefined" || !supabase.createClient) {
  throw new Error("Supabase client library failed to load from CDN -- check that the supabase-js <script> tag in index.html loaded successfully (network/ad-blocker issue?).");
}
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// A prospect reaches one deal via an unguessable link (/d/{share_slug}), never a picker.
// No router library -- read the path once at load, same as any other module constant.
const PROSPECT_ROUTE = (() => {
  const m = window.location.pathname.match(/^\/d\/([^/]+)\/?$/);
  return m ? m[1] : null;
})();

// A newly-provisioned teammate reaches their own activation screen via ?activate={email},
// the link provision-teammate.mts hands back to the Admin alongside the 6-digit code (Team
// Admin/Manager Rework, Data model #1). Same "read once at load" pattern as PROSPECT_ROUTE.
const ACTIVATE_EMAIL = (() => {
  const v = new URLSearchParams(window.location.search).get("activate");
  return v ? decodeURIComponent(v) : null;
})();

const initialsOf = name => (name || "").split(" ").filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2);
const relTime = iso => {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};
const shortDate = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const fmtCurrency = (amount, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(amount || 0);
const fmtDuration = secs => {
  if (!secs && secs !== 0) return "";
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")} min`;
};

// Converts a normal Google Slides/Docs/Sheets share link (the one from the Share button,
// .../d/FILE_ID/edit?usp=sharing) into an embeddable viewer URL -- no "Publish to web" step
// required. Returns null if the URL doesn't match a recognized Docs/Sheets/Slides pattern.
// file_type reuses this app's existing pptx/docx/xlsx values (and their FILE_ICON entries)
// rather than inventing a fourth type just for embeds.
const parseGoogleDocUrl = url => {
  const m = (url || "").trim().match(/^https:\/\/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const [, kind, fileId] = m;
  const fileType = kind === "presentation" ? "pptx" : kind === "spreadsheets" ? "xlsx" : "docx";
  // Slides and Sheets embed via /embed; Docs via /preview (the one that renders cleanly in
  // an iframe without requiring Publish to web).
  const embedUrl = kind === "document"
    ? `https://docs.google.com/document/d/${fileId}/preview`
    : `https://docs.google.com/${kind}/d/${fileId}/embed`;
  return { fileType, embedUrl };
};

// Validates a Zoom cloud-recording share link (zoom.us/rec/share/... and the subdomain
// variants Zoom uses, e.g. us02web.zoom.us/rec/...). Unlike parseGoogleDocUrl there's no URL
// to build -- recording links open directly (the 'link' pattern), not embed, since Zoom's
// playback pages set X-Frame-Options and refuse to render inside an iframe. Returns null if
// the URL doesn't match.
const parseZoomRecordingUrl = url => {
  const trimmed = (url || "").trim();
  if (!/^https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/rec\/(share|play)\//.test(trimmed)) return null;
  return { url: trimmed };
};

// Transforms a Supabase `deals` row (with nested stakeholders/deal_tasks/documents from a
// PostgREST embed, or the equivalent shape from the get_deal_for_prospect RPC) into the
// exact camelCase shape the render tree below already expects. Keeping this as one pure
// function at the loading boundary means the ~700 lines of existing render code below
// don't need to change at all for the new column names.
function mapDealFromDb(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    createdBy: row.created_by,
    assignedTo: row.assigned_to || row.created_by,
    // Only present on the prospect-RPC path (get_deal_for_prospect, 0016) which embeds
    // these directly since a real prospect's own RLS can't read profiles/organizations.
    // The rep path resolves the same two fields itself, from data it's already fetching
    // for the avatar-cluster feature -- see the org-loading effect below.
    repProfile: row.rep ? {name:row.rep.full_name||row.rep.email, email:row.rep.email, photo:row.rep.avatar_url, title:row.rep.title, phone:row.rep.phone, linkedin:row.rep.linkedin_url, calendly:row.rep.calendly_url, initials:initialsOf(row.rep.full_name||row.rep.email)} : null,
    orgName: row.org_name || null,
    company: row.company_name,
    contact: row.primary_contact_name,
    title: row.title,
    stage: row.stage,
    value: fmtCurrency(row.value_amount, row.currency),
    // Raw numeric, alongside the formatted `value` string above -- the Manager Overview
    // needs to sum across deals, which a pre-formatted currency string can't do.
    valueAmount: row.value_amount || 0,
    currency: row.currency || "USD",
    closeDate: row.close_date,
    createdAt: row.created_at,
    logo: row.logo_initials,
    color: row.brand_color,
    industry: row.industry,
    engagement: row.engagement_score,
    accessCode: row.access_code,
    shareSlug: row.share_slug,
    includeTrialSessions: row.include_trial_sessions,
    welcomeMsg: row.welcome_message,
    execSummary: row.exec_summary || {},
    discovery: row.discovery || {},
    // Per-field overrides for MEDDPIC -- an entry present here means "show this stored
    // text instead of deriving it," absent/empty means "keep deriving as before."
    meddpic: row.meddpic || {},
    stakeholders: (row.stakeholders || []).map(s => ({
      id: s.id,
      name: s.name,
      role: s.role_title,
      designation: s.designation,
      engagement: s.engagement_score,
      lastSeen: relTime(s.last_seen_at),
      initials: initialsOf(s.name),
      bu: s.business_unit,
      email: s.email,
      approvalRequired: s.approval_required,
      docsViewed: [],
      linkedin: s.linkedin_url,
      reportsTo: s.reports_to,
    })),
    mapItems: (row.deal_tasks || []).slice().sort((a, b) => a.sort_order - b.sort_order).map(t => ({
      id: t.id,
      phase: t.phase,
      task: t.task,
      owner: t.owner_name,
      buyerOwner: t.buyer_owner_label,
      dueDate: t.due_date,
      status: t.status,
      notes: t.notes,
      approvalRequired: t.approval_required,
      calendlyEnabled: t.calendly_enabled,
    })),
    // Which sequence is currently shown/editable for this deal room (0028). Independent,
    // never-merged sibling array to mapItems above -- this separation (not a discriminator
    // column on one shared table) is what keeps MEDDPIC's Paper Process derivation,
    // computeDealStatus, and the AI Coach context automatically pre-signature-only with no
    // filter to remember at any of those sites.
    activeSequenceView: row.active_sequence_view || "pre_signature",
    experienceItems: (row.deal_experience_items || []).slice().sort((a, b) => a.sort_order - b.sort_order).map(t => ({
      id: t.id,
      phase: t.phase,
      task: t.task,
      owner: t.owner_name,
      buyerOwner: t.buyer_owner_label,
      dueDate: t.due_date,
      status: t.status,
      notes: t.notes,
      approvalRequired: t.approval_required,
      calendlyEnabled: t.calendly_enabled,
    })),
    // Prospect-only: get_deal_for_prospect (0028) now returns the org's real stage_labels/
    // post_signature_stage_labels directly on the deal payload, since a prospect's RLS can't
    // read organizations itself (same reasoning as repProfile above). null on the rep path,
    // where stageLabels/postSignatureStageLabels instead come from the org-loading effect.
    prospectStageLabels: row.stage_labels || null,
    prospectPostSignatureStageLabels: row.post_signature_stage_labels || null,
    content: (row.documents || []).map(d => ({
      id: d.id,
      title: d.title,
      type: d.file_type,
      uploaded: shortDate(d.created_at),
      category: d.category,
      storagePath: d.storage_path,
      isEmbed: d.is_embed,
      embedUrl: d.embed_url,
      views: 0,
      viewers: [],
      lastViewed: "Not yet viewed",
    })),
    activityLog: [],
    // Who's actually touched this deal -- the header's avatar cluster. Derived from the
    // created_by already recorded on the deal itself and every stakeholder/task/document
    // under it (no new column, no "assign a rep to a deal" feature -- just a distinct set
    // of ids), resolved to real names/initials once we have the org's profiles (see the
    // deals-loading effect below).
    contributorIds: Array.from(new Set([
      row.created_by,
      ...(row.stakeholders || []).map(s => s.created_by),
      ...(row.deal_tasks || []).map(t => t.created_by),
      ...(row.documents || []).map(d => d.created_by),
    ].filter(Boolean))),
    // How many items each contributor actually touched -- used to make the header
    // avatar cluster's tooltip say more than just a name (e.g. "added 3 items").
    contributorCounts: [
      row.created_by,
      ...(row.stakeholders || []).map(s => s.created_by),
      ...(row.deal_tasks || []).map(t => t.created_by),
      ...(row.documents || []).map(d => d.created_by),
    ].filter(Boolean).reduce((acc, id) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {}),
    // Default -- only the rep's org-loading effect resolves this to real names (it merges
    // in a profiles lookup that a prospect has no business making). Without this default,
    // a prospect's deal (loaded straight from get_deal_for_prospect, which never runs that
    // merge) would have contributors===undefined and crash the header's avatar cluster.
    contributors: [],
    // Same reasoning as contributors above -- only the rep's org-loading effect merges in
    // deal_risk_signals (rep-only data a prospect has no reason to see anyway). null here,
    // not undefined, so riskFlags() below has one clear "not loaded" case to check for.
    risk: null,
  };
}

// Turns deal.risk into secondary flags for the Analytics Deal Health card -- buyer-side
// engagement signals, distinct from the seller-side pace-vs-close-date calculation in
// computeDealStatus below, which is now the primary status. "Stalled" (no task activity
// in 7 days) was dropped from here -- computeDealStatus is a strictly better version of
// what it was trying to capture.
function riskFlags(deal) {
  const r = deal.risk;
  if (!r) return [];
  const flags = [];
  if (r.goingCold) flags.push({ key: "going_cold", label: "Going Cold", severity: "cold", reason: `No prospect activity in ${r.daysSinceVisit} day${r.daysSinceVisit === 1 ? "" : "s"}` });
  if (r.buyerDisengaged) flags.push({ key: "buyer_disengaged", label: "Buyer Disengaged", severity: "risk", reason: `${r.disengagedBuyerName}, your decision-maker, hasn't viewed any documents yet` });
  return flags;
}
// Hardcoded (not referencing P) since P isn't defined yet at this point in the file --
// "on" mirrors P.green/alpine, the other two are the mockup's own risk/cold dot colors.
const RISK_DOT_COLOR = { cold: "#8A6B63", risk: "#E0A94C", on: "#2C6E63" };

// Deal mapping completeness, for the Manager Overview rep drill-in (TEAM-VERSION-ADMIN-
// MANAGER-SPEC.md). Explicitly NOT a health/red-flag score -- just "what's filled in vs.
// not," using data the rep already put in the deal room. Never aggregated across deals or
// used to rank/sort reps (that would start to look like the analytics scoring Mark
// explicitly descoped) -- deal-by-deal and descriptive only.

// Mirrors the MEDDPIC tab's own derivation (see the tab==="meddpic" render block) exactly,
// so "filled" here means the same thing a rep would see if they opened that tab -- a
// stored override counts, and so does content the tab already derives for free from
// Discovery/Stakeholders/Action Plan. decisionCriteria and decisionProcess have no
// derivation path in the product today (the MEDDPIC tab shows "Not enough data yet" for
// both unless manually overridden) -- that's a real, pre-existing gap this indicator
// surfaces rather than papers over.
function meddpicFilledCount(deal) {
  const override = deal.meddpic || {};
  const hasOverride = k => !!(override[k] && String(override[k]).trim());
  const champions = deal.stakeholders.filter(s => s.designation === "champion");
  const decisionMakers = deal.stakeholders.filter(s => s.designation === "decision-maker");
  const paperProcessTasks = deal.mapItems.filter(t => t.phase === "Paper Process");
  const checks = [
    hasOverride("metrics") || (deal.discovery.topOutcomes || []).length > 0 || GOAL_PERIODS.some(p => (deal.discovery.goals?.[p] || []).length > 0),
    hasOverride("economicBuyer") || decisionMakers.length > 0,
    hasOverride("decisionCriteria"),
    hasOverride("decisionProcess"),
    hasOverride("paperProcess") || paperProcessTasks.length > 0,
    hasOverride("identifyPain") || (deal.discovery.challenges || []).length > 0,
    hasOverride("champion") || champions.length > 0,
  ];
  return checks.filter(Boolean).length;
}

// Generic "has this jsonb blob actually been touched" check for discovery/execSummary --
// both are free-form (strings, arrays, and {period: [...]} goal maps), so this doesn't
// assume specific field names, just "any array has entries or any string is non-empty,"
// one level deep.
function jsonbHasContent(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some(v => {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === "object") return Object.values(v).some(vv => Array.isArray(vv) ? vv.length > 0 : !!vv);
    return !!v;
  });
}

// DEFAULT (flagged per spec open question 5): kept exactly as written in the spec --
// stakeholders / MEDDPIC (all 7 elements) / discovery+exec-summary / tasks planned, shown
// as "N of 4 mapping areas complete." Mark can ask for a different or more granular
// checklist on review.
function mappingCompleteness(deal) {
  const meddpicFilled = meddpicFilledCount(deal);
  const activeItems = deal.activeSequenceView === "post_signature" ? deal.experienceItems : deal.mapItems;
  const areas = {
    stakeholders: deal.stakeholders.length > 0,
    meddpic: meddpicFilled === 7,
    discovery: jsonbHasContent(deal.discovery) && jsonbHasContent(deal.execSummary),
    tasks: activeItems.length > 0,
  };
  return { areas, meddpicFilled, completeCount: Object.values(areas).filter(Boolean).length };
}

// Primary "On Track"/"Watch"/"At Risk" status -- a rules-based comparison of the deal's
// actual Action Plan progress against how much of its own timeline (creation to close
// date) has elapsed. One source of truth for both the header pill and the Analytics Deal
// Health card headline, so they can never disagree.
//
// Expected-stage-by-elapsed-time table is Mark's own, for the 5-stage (with Trial
// Sessions) case. The 4-stage case (no Trial Sessions, so no distinct stage to spread the
// middle bands across) is an extrapolation, not explicitly specified -- merges the 50-75%
// and 75-90% bands into one, flagged here for review rather than silently guessed.
const STAGE_BENCHMARKS_TRIAL = [{maxElapsed:25,stage:0},{maxElapsed:50,stage:1},{maxElapsed:75,stage:2},{maxElapsed:90,stage:3},{maxElapsed:Infinity,stage:4}];
const STAGE_BENCHMARKS_NO_TRIAL = [{maxElapsed:25,stage:0},{maxElapsed:50,stage:1},{maxElapsed:90,stage:2},{maxElapsed:Infinity,stage:3}];
function computeDealStatus(deal) {
  if (!deal.closeDate || !deal.createdAt) return { status: "unknown", label: "No close date set" };
  const created = new Date(deal.createdAt).getTime();
  const close = new Date(deal.closeDate).getTime();
  const totalMs = close - created;
  const elapsedPct = totalMs <= 0 ? 100 : Math.max(0, Math.min(100, ((Date.now() - created) / totalMs) * 100));

  const benchmarks = deal.includeTrialSessions ? STAGE_BENCHMARKS_TRIAL : STAGE_BENCHMARKS_NO_TRIAL;
  const expectedStage = benchmarks.find(b => elapsedPct < b.maxElapsed).stage;

  // Actual current stage -- same per-step scoring ProcessTimeline already uses (the
  // furthest-along stage that isn't still pending), floored at 0: a brand-new deal with
  // nothing touched yet counts as "at Alignment," not "behind" it.
  const phases = deal.includeTrialSessions ? PHASES_ALL : PHASES_NO_TRIAL;
  const items = deal.mapItems.filter(t => phases.includes(t.phase));
  const phaseStatuses = phases.map(phase => {
    const phTasks = items.filter(t => t.phase === phase);
    if (phTasks.length === 0) return "pending";
    return phTasks.every(t => t.status === "complete") ? "complete" : "active";
  });
  let actualStage = 0;
  phaseStatuses.forEach((st, i) => { if (st !== "pending") actualStage = i; });

  const diff = actualStage - expectedStage;
  const status = diff >= 0 ? "on-track" : diff === -1 ? "watch" : "at-risk";
  const label = status === "on-track" ? "On Track" : status === "watch" ? "Watch" : "At Risk";
  return { status, label, expectedStage, actualStage, elapsedPct: Math.round(elapsedPct) };
}
// Real engagement score, derived from the exact same fields Analytics' Room Visits/
// Interactions/Total Time cards already display (deal.activityLog, deal.content) plus
// deal.risk.daysSinceVisit -- the same precise value already computed server-side for
// the risk-signal system -- so the header number and Analytics can never drift into two
// different calculations. Weights are a first draft, explicitly tunable; not written
// back to the stored (always-50, never-updated) deals.engagement_score column.
function computeEngagementScore(deal) {
  const visitCount = (deal.activityLog||[]).reduce((a,d)=>a+d.entries.length,0);
  const daysSinceVisit = deal.risk?.daysSinceVisit;
  const recencyPts = daysSinceVisit==null ? 0 : 40 - Math.min(40, (Math.max(0,daysSinceVisit-3)/11)*40);
  const frequencyPts = Math.min(30, visitCount*10);
  const docsWithViews = (deal.content||[]).filter(c=>c.views>0).length;
  const totalDocs = (deal.content||[]).length;
  const breadthPts = totalDocs ? (docsWithViews/totalDocs)*30 : 0;
  return Math.round(Math.max(0, Math.min(100, recencyPts+frequencyPts+breadthPts)));
}

const API = "/api/ai-coach";
// Rep-only feature (the AI panel and every button that opens it are already gated to
// viewMode==="rep" -- see app render below); the server enforces the same boundary plus
// a per-org monthly cap, so every call here has to carry the caller's own Supabase
// session token, same as create-checkout-session/create-portal-session's accessToken.
const callClaude = async (sys, usr, max = 1400) => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Please sign in to use AI Coach");
  const r = await fetch(API, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ system:sys, max_tokens:max, messages:[{role:"user",content:usr}], accessToken:session.access_token })});
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || "AI Coach request failed"); }
  const d = await r.json(); return d.text || "";
};

// myBivy / SRENE brand palette. Keys are kept from the pre-rebrand palette so every
// existing `P.accent`/`P.bg`/etc. usage site below picks up the new look automatically --
// only the hex values changed, not the shape of this object. `purple`/`teal` (no longer
// part of the brand system) are remapped to neutral-ink and alpine respectively wherever
// they were previously used for decorative variety, not semantic meaning.
const P = {
  bg:"#F6F5F2", surface:"#FFFFFF", border:"#E2E0DA", borderDark:"#C7C2B8",
  accent:"#D65F3C", accentLight:"#FBE9E2", accentMid:"#B94B2C",
  text:"#252A2E", textSec:"#6B7178", textMute:"#6B7178",
  green:"#2C6E63", greenBg:"#E1EEEC", greenBorder:"#BFDBD4",
  amber:"#96631F", amberBg:"#FBF1DE", amberBorder:"#F0D9A8",
  red:"#DC2626", redBg:"#FEF2F2", redBorder:"#FECACA",
  purple:"#1B1F23", purpleBg:"#EFEDE8", purpleBorder:"#E2E0DA",
  teal:"#2C6E63", tealBg:"#E1EEEC", tealBorder:"#BFDBD4",
  // New brand-specific tokens (mockup :root block)
  ink:"#1B1F23", inkSoft:"#262C31", chalk:"#F4F2ED",
  ropeBorder:"#F0C9B7", amberDot:"#E0A94C",
  fontDisplay:"'Barlow Condensed',sans-serif", fontBody:"'Inter','Segoe UI',sans-serif", fontMono:"'JetBrains Mono',monospace",
};
const LOGO_MARK = (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M2 15 Q7 13 11 14 Q15 15 22 11" stroke="#D65F3C" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M4 10.5 Q8 8.5 11 9.5 Q14 10.5 19 7" stroke="#F4F2ED" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

// Module-level (not a local const inside DealRoom, where it originally lived) so that
// ManagerOverviewScreen -- a sibling component, not nested inside DealRoom -- can also
// render <style>{CSS}</style> on its own full-screen replace. A component-local CSS would
// silently resolve to the browser's own global `window.CSS` (the CSS Typed OM object)
// inside ManagerOverviewScreen instead of throwing a ReferenceError, which is exactly what
// happened here: React error #31, "objects are not valid as a react child", crashing the
// entire Team Overview screen.
const CSS=`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${P.bg}}::-webkit-scrollbar-thumb{background:${P.borderDark};border-radius:3px}
input,select,textarea{font-family:inherit;outline:none;}
input:focus,select:focus,textarea:focus{border-color:${P.accent}!important;box-shadow:0 0 0 3px ${P.accentLight};}
.hr:hover{background:${P.bg}!important}.hd:hover{background:${P.bg}!important;cursor:pointer}.hv:hover{opacity:.82}
.fade{animation:fi .2s ease}@keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.shim>div{animation:sh 1.5s ease infinite alternate;background:linear-gradient(90deg,#f1f5f9,#e9edf5,#f1f5f9);background-size:200%;border-radius:4px;}@keyframes sh{from{background-position:0%}to{background-position:100%}}
select option{background:#fff}
.mono{font-family:${P.fontMono};}
.headline{font-family:${P.fontDisplay};font-weight:700;}`;


// Fixed order, not derived from Object.keys/entries -- a JSONB blob's key order depends on
// however it was written (a different AI-extraction or import run could produce these in
// a different order), so it's not reliably chronological unless enforced here.
const GOAL_PERIODS = ["90 Days","1 Year","Beyond"];
const PHASES_ALL = ["Value Alignment","Product Demo","Trial Sessions","Business Case","Paper Process"];
const PHASES_NO_TRIAL = ["Value Alignment","Product Demo","Business Case","Paper Process"];
// Single source of truth for the 5 fixed sales stages -- folds in what used to be a second,
// parallel copy of this same key->phase mapping (ProcessTimeline's own stepPhase() ternary).
// `phase` is the literal string stored on deal_tasks.phase (DB check-constrained, never
// renamed) -- only `label` is ever org-configurable (organizations.stage_labels, 0024).
const STAGE_DEFS = [
  {key:"alignment",desc:"Align on value, requirements, and loop in stakeholders",phase:"Value Alignment"},
  {key:"demo",desc:"Custom day-in-the-life demo tailored to your workflows",phase:"Product Demo"},
  {key:"eval",desc:"2-week POC including team testing and integration deep dive",trialOnly:true,phase:"Trial Sessions"},
  {key:"decision",desc:"Pricing & plans, business case, executive summary and decision",phase:"Business Case"},
  {key:"formalize",desc:"Order form, T&Cs, legal and compliance",phase:"Paper Process"},
];
const DEFAULT_STAGE_LABELS = {alignment:"Alignment",demo:"Product Demo",eval:"Trial / Evaluation",decision:"Decision",formalize:"Formalize"};

// Post-signature customer-journey sequence -- independent of the close sequence above,
// lives in its own deal_experience_items table (not deal_tasks), its own phase set, and
// its own org-customizable label map (organizations.post_signature_stage_labels, 0028).
// Same key/phase/label split as STAGE_DEFS: `phase` is the literal, DB-check-constrained
// string, `key` is the stable label-lookup id, `label` is resolved only at render time.
const PHASES_POST_SIGNATURE = ["Kickoff & Intro","Requirements","Implementation","Training","Go Live / Activation"];
const POST_SIGNATURE_STAGE_DEFS = [
  {key:"kickoff",desc:"Introduce the onboarding team and set expectations",phase:"Kickoff & Intro"},
  {key:"requirements",desc:"Gather technical and workflow requirements",phase:"Requirements"},
  {key:"implementation",desc:"Configure and build out the environment",phase:"Implementation"},
  {key:"training",desc:"Train the team on day-to-day usage",phase:"Training"},
  {key:"golive",desc:"Final checks and go-live activation",phase:"Go Live / Activation"},
];
const DEFAULT_POST_SIGNATURE_STAGE_LABELS = {kickoff:"Kickoff & Intro",requirements:"Requirements",implementation:"Implementation",training:"Training",golive:"Go Live / Activation"};

// deals.stage (0003) -- the 7-value sales-cycle stage used by the Manager Overview's
// per-rep stage breakdown. Distinct from STAGE_DEFS above, which is the Action Plan
// close-sequence phase set on deal_tasks, not this column.
const DEAL_STAGES = ["Discovery","Evaluation","Trial","Proposal","Negotiation","Closed Won","Closed Lost"];
const CLOSED_DEAL_STAGES = ["Closed Won","Closed Lost"];

// Literal DB phase string -> whatever this org calls that stage today (custom label, or the
// default if never renamed). Used anywhere a phase name is *displayed*; filtering/grouping
// always keeps using the literal phase string itself, never this. Parameterized so both the
// pre-signature and post-signature sequences can share the same lookup logic.
const phaseDisplayLabelFor = (phase, stageLabels, stageDefs, defaultLabels) => {
  const def = stageDefs.find(s => s.phase === phase);
  if (!def) return phase;
  return (stageLabels && stageLabels[def.key]) || defaultLabels[def.key];
};
const phaseDisplayLabel = (phase, stageLabels) => phaseDisplayLabelFor(phase, stageLabels, STAGE_DEFS, DEFAULT_STAGE_LABELS);
// Phase headers are plain uppercase mono labels in the brand system (no color-coded pill
// per phase) -- see the mockup's .phase-name, which is deliberately un-colored.
const STATUS_CFG = {
  complete:{text:P.green,bg:P.greenBg,border:P.greenBorder,label:"Complete"},
  "in-progress":{text:P.amber,bg:P.amberBg,border:P.amberBorder,label:"In Progress"},
  pending:{text:P.textMute,bg:P.bg,border:P.border,label:"Pending"},
};
const DESIG_CFG = {
  champion:{label:"Champion",color:P.green,bg:P.greenBg,border:P.greenBorder},
  "decision-maker":{label:"Decision Maker",color:P.accent,bg:P.accentLight,border:P.ropeBorder},
  influencer:{label:"Influencer",color:P.purple,bg:P.purpleBg,border:P.purpleBorder},
  blocker:{label:"Blocker",color:P.amber,bg:P.amberBg,border:P.amberDot},
};
const FILE_ICON = {pptx:{icon:"▤",c:"#C55A11"},xlsx:{icon:"⊞",c:"#1D6F42"},pdf:{icon:"▪",c:"#C00000"},docx:{icon:"≡",c:"#2B579A"},image:{icon:"▧",c:"#7C3AED"},link:{icon:"⌘",c:"#6366F1"},video:{icon:"▶",c:"#2D8CFF"}};

// Small identification-only brand marks for the Content-tab toolbar buttons (not full logos
// with wordmarks) -- inlined as raw SVG since this app loads no icon library. Google's is the
// standard 4-color "G" (official brand colors). Zoom's is their official app-icon mark (blue
// rounded-square with the white abstract "Z"/arrow shape); it's a rounded-square glyph rather
// than literally camera-shaped, but it's what Zoom's own brand/press assets use to represent
// the product, sourced from a maintained third-party logo collection, not fabricated from memory.
const GoogleDocIcon = () => (
  <svg width="15" height="15" viewBox="0 0 256 262" xmlns="http://www.w3.org/2000/svg">
    <path d="M255.878,133.451 C255.878,122.717 255.007,114.884 253.122,106.761 L130.55,106.761 L130.55,155.209 L202.497,155.209 C201.047,167.249 193.214,185.381 175.807,197.565 L175.563,199.187 L214.318,229.21 L217.003,229.478 C241.662,206.704 255.878,173.196 255.878,133.451" fill="#4285F4"/>
    <path d="M130.55,261.1 C165.798,261.1 195.389,249.495 217.003,229.478 L175.807,197.565 C164.783,205.253 149.987,210.62 130.55,210.62 C96.027,210.62 66.726,187.847 56.281,156.37 L54.75,156.5 L14.452,187.687 L13.925,189.152 C35.393,231.798 79.49,261.1 130.55,261.1" fill="#34A853"/>
    <path d="M56.281,156.37 C53.525,148.247 51.93,139.543 51.93,130.55 C51.93,121.556 53.525,112.853 56.136,104.73 L56.063,103 L15.26,71.312 L13.925,71.947 C5.077,89.644 0,109.517 0,130.55 C0,151.583 5.077,171.455 13.925,189.152 L56.281,156.37" fill="#FBBC05"/>
    <path d="M130.55,50.479 C155.064,50.479 171.6,61.068 181.029,69.917 L217.873,33.943 C195.245,12.91 165.798,0 130.55,0 C79.49,0 35.393,29.301 13.925,71.947 L56.136,104.73 C66.726,73.253 96.027,50.479 130.55,50.479" fill="#EB4335"/>
  </svg>
);
const ZoomIcon = () => (
  <svg width="15" height="15" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient x1="23.666%" y1="95.6118%" x2="76.334%" y2="4.3882%" id="zoomIconGrad">
        <stop stopColor="#0845BF" offset="0%"/>
        <stop stopColor="#0B5CFF" offset="50%"/>
        <stop stopColor="#4F90EE" offset="100%"/>
      </linearGradient>
    </defs>
    <path d="M256,128 C256,141.568 254.976,155.136 252.672,168.192 C245.76,211.456 211.456,245.76 168.192,252.672 C155.136,254.976 141.568,256 128,256 C114.432,256 100.864,254.976 87.808,252.672 C44.544,245.76 10.24,211.456 3.328,168.192 C1.024,155.136 0,141.568 0,128 C0,114.432 1.024,100.864 3.328,87.808 C10.24,44.544 44.544,10.24 87.808,3.328 C100.864,1.024 114.432,0 128,0 C141.568,0 155.136,1.024 168.192,3.328 C211.456,10.24 245.76,44.544 252.672,87.808 C254.976,100.864 256,114.432 256,128 Z" fill="url(#zoomIconGrad)"/>
    <path d="M204.032,207.872 L75.008,207.872 C66.56,207.872 58.368,203.264 54.528,195.84 C49.92,187.136 51.712,176.64 58.624,169.728 L148.48,79.872 L83.968,79.872 C66.304,79.872 51.968,65.536 51.968,47.872 L170.752,47.872 C179.2,47.872 187.392,52.48 191.232,59.904 C195.84,68.608 194.048,79.104 187.136,86.016 L97.536,176.128 L172.032,176.128 C189.696,176.128 204.032,190.208 204.032,207.872 Z" fill="#FFFFFF"/>
  </svg>
);
// Mirrors the deal-documents bucket's allowed_mime_types (0012_deal_documents.sql) -- this
// mapping is just for instant client-side feedback, the bucket itself is the real gate.
const ALLOWED_DOC_MIME = {
  "application/pdf":"pdf",
  "application/msword":"docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx",
  "application/vnd.ms-powerpoint":"pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation":"pptx",
  "application/vnd.ms-excel":"xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"xlsx",
  "image/png":"image","image/jpeg":"image","image/gif":"image","image/webp":"image",
};

const Badge = ({label,color,bg,border,small}) => (
  <span style={{padding:small?"2px 7px":"3px 10px",borderRadius:4,background:bg,border:`1px solid ${border}`,color,fontSize:small?10:11,fontWeight:700,whiteSpace:"nowrap"}}>{label}</span>
);
// Add/edit/remove for a plain list of free-text items -- shared by every editable list
// section across Executive Summary and Discovery, instead of duplicating the same
// add/remove logic at each of the 7 call sites.
const EditableList = React.forwardRef(({items,onChange},ref) => {
  const [draft,setDraft]=useState("");
  const add=()=>{if(!draft.trim())return;onChange([...items,draft.trim()]);setDraft("");};
  // Exposes the "Add item" text as a save-time flush, not just the Enter/+Add path -- a
  // parent's Save button only ever sees `items` (what's been committed), so without this
  // whatever's still sitting typed-but-unsubmitted in the input is silently lost on Save.
  // Returns the final array synchronously so the caller can use it immediately instead of
  // reading back `items`, which won't reflect this flush until the next render.
  React.useImperativeHandle(ref,()=>({
    flush:()=>{
      if(!draft.trim())return items;
      const next=[...items,draft.trim()];
      onChange(next);
      setDraft("");
      return next;
    }
  }));
  return (<div>
    {items.map((item,i)=>(
      <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
        <input value={item} onChange={e=>onChange(items.map((it,j)=>j===i?e.target.value:it))} style={{flex:1,border:`1px solid ${P.border}`,borderRadius:6,padding:"7px 10px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"}}/>
        <button onClick={()=>onChange(items.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:P.textMute,fontSize:16,cursor:"pointer",flexShrink:0}}>×</button>
      </div>
    ))}
    <div style={{display:"flex",gap:8}}>
      <input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="Add item..." style={{flex:1,border:`1px solid ${P.border}`,borderRadius:6,padding:"7px 10px",fontSize:13,color:P.text,background:P.surface,fontFamily:"inherit",outline:"none"}}/>
      <button onClick={add} style={{padding:"7px 14px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>+ Add</button>
    </div>
  </div>);
});
const renderMD = t => t
  .replace(/^## (.+)/gm,`<div style="font-size:12px;font-weight:800;color:${P.accent};margin:14px 0 5px;text-transform:uppercase;letter-spacing:.07em;border-bottom:2px solid ${P.accentLight};padding-bottom:3px">$1</div>`)
  .replace(/\*\*(.+?)\*\*/g,`<strong style="color:${P.text}">$1</strong>`)
  .replace(/^- (.+)/gm,`<div style="display:flex;gap:7px;margin:3px 0"><span style="color:${P.accent};font-size:10px;margin-top:3px;flex-shrink:0">◆</span><span>$1</span></div>`)
  .replace(/\n\n/g,`<div style="margin:6px 0"></div>`).replace(/\n/g,"<br/>");

const LI_SVG = <svg width="11" height="11" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;

const ProspectLogin = ({deal,shareSlug,onSuccess}) => {
  const [email,setEmail]=useState(""); const [code,setCode]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const go=async()=>{
    setLoading(true);setError("");
    if(shareSlug){
      // Real external prospect: deal is unknown until this RPC succeeds -- there is no
      // RLS path for an anon caller to read deal data any other way (see 0006 migration).
      // Sign in anonymously first (if not already) so auth.uid() is populated when the RPC
      // runs -- that's what lets it record a durable, checkable identity for this prospect
      // against this deal (prospect_sessions.user_id), which Storage RLS then relies on for
      // document access (see 0012_deal_documents.sql). Checking for an existing session
      // first avoids minting a new anonymous user on every retry from the same browser.
      const {data:{session:existingSession}}=await sb.auth.getSession();
      if(!existingSession){
        const {error:anonErr}=await sb.auth.signInAnonymously();
        if(anonErr){setError("Couldn't start a secure session. Please retry.");setLoading(false);return;}
      }
      const {data,error:rpcErr}=await sb.rpc("get_deal_for_prospect",{p_share_slug:shareSlug,p_access_code:code,p_email:email});
      if(rpcErr||!data||data.error){setError("Invalid email or access code. Please check with your account executive.");setLoading(false);return;}
      onSuccess(mapDealFromDb(data.deal));
    }else{
      // Rep previewing their own already-loaded deal -- no RPC needed, data's already
      // securely scoped to this authenticated user via RLS.
      setTimeout(()=>{if(code.toUpperCase()===deal.accessCode&&email.includes("@")){onSuccess(email);}else{setError("Invalid email or access code. Please check with your account executive.");setLoading(false);}},600);
    }
  };
  return (<div style={{flex:1,minHeight:"100vh",background:"linear-gradient(135deg,#FBE9E2 0%,#F6F5F2 60%,#E1EEEC 100%)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:440,background:P.surface,borderRadius:20,padding:"44px 40px",boxShadow:"0 20px 60px rgba(27,31,35,0.10)",border:`1px solid ${P.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:P.ink,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
          <span className="headline" style={{fontSize:17,color:P.text}}>myBivy</span>
        </div>
        {/* Company branding only shown when we already have deal data (rep preview) --
            a real prospect hasn't authenticated yet, so we don't know or leak which
            company this link belongs to until after a successful code check. */}
        {deal&&<div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:6,background:P.accentLight,display:"flex",alignItems:"center",justifyContent:"center"}}><span className="headline" style={{fontSize:10,color:P.accentMid}}>{deal.logo}</span></div>
          <span style={{fontSize:12,fontWeight:600,color:P.textSec}}>{deal.company}</span>
        </div>}
      </div>
      <div className="headline" style={{fontSize:26,color:P.text,marginBottom:6}}>Access your Deal Room</div>
      <div style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:28}}>Your account executive has prepared a private workspace for your evaluation. Enter your credentials to access.</div>
      <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5}}>Your Work Email</label>
        <input value={email} onChange={e=>{setEmail(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="you@company.com" type="email" style={{width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"}}/></div>
      <div style={{marginBottom:20}}><label style={{fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5}}>Access Code</label>
        <input value={code} onChange={e=>{setCode(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="Provided by your AE" style={{width:"100%",border:`1px solid ${error?P.red:P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none",letterSpacing:"0.08em"}}/>
        {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}</div>
      <button onClick={go} disabled={loading||!email||!code} style={{width:"100%",padding:"12px",background:loading||!email||!code?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:loading||!email||!code?"not-allowed":"pointer"}}>{loading?"Verifying…":"Access My Deal Room →"}</button>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:20,padding:"12px 14px",background:P.accentLight,borderRadius:8,border:`1px solid #F0C9B7`}}>
        <span style={{fontSize:14}}>🔒</span><span style={{fontSize:11,color:P.accent,fontWeight:500,lineHeight:1.5}}>This workspace is private. Only authorized participants with a valid access code can enter.</span>
      </div>
      {/* Only known during a rep's own preview (deal is passed) -- a real prospect hasn't
          authenticated yet, so which rep to contact isn't known client-side at this
          point. Previously showed one hardcoded person's email regardless. */}
      {deal?.repProfile?.email&&<div style={{textAlign:"center",marginTop:18,fontSize:11,color:P.textMute}}>No code? Contact <span style={{color:P.accent,fontWeight:600}}>{deal.repProfile.email}</span></div>}
    </div>
  </div>);
};

const ProcessTimeline = ({deal,stageLabels,stageDefs=STAGE_DEFS,defaultLabels=DEFAULT_STAGE_LABELS,items:itemsProp,phases:phasesProp,inverted=false}) => {
  const base=stageDefs.map(s=>({...s,label:(stageLabels&&stageLabels[s.key])||defaultLabels[s.key]}));
  const steps=base.filter(s=>!s.trialOnly||deal.includeTrialSessions);
  const phases=phasesProp||(deal.includeTrialSessions?PHASES_ALL:PHASES_NO_TRIAL);
  const items=(itemsProp||deal.mapItems).filter(t=>phases.includes(t.phase));

  // Score each step from its own underlying task phase independently -- not a raw % of
  // all tasks across the whole deal (that made unrelated later phases look done from a
  // few early completions), and not a strict left-to-right walk either (that failed to
  // show any progress at all when a rep works a later phase, like Product Demo, before
  // an earlier one has any tasks -- a real deal doesn't always fill in phases in order).
  const phaseStatuses=steps.map(s=>{
    const phTasks=items.filter(t=>t.phase===s.phase);
    if(phTasks.length===0)return "pending";
    return phTasks.every(t=>t.status==="complete")?"complete":"active";
  });
  // Post-signature mode visually inverts this bar (orange field, white overlay) so a rep
  // can tell which sequence they're in at a glance without reading text. Checked contrast
  // before picking this treatment: a flat orange background with the *existing* white text
  // colors left as-is computes to ~3.5:1 for the step labels -- passes for large text/
  // non-text elements but fails WCAG AA's 4.5:1 floor for normal-size text. So labels/the
  // helper line sit in solid-white pills (guaranteed full contrast in any state) rather
  // than as raw white text on the orange field; only the large graphical elements
  // (connector line, step circles) go straight white/translucent-white, which is fine
  // under the 3:1 non-text contrast rule.
  return (
    <div style={{background:inverted?P.accent:P.surface,border:`1px solid ${inverted?"rgba(255,255,255,0.25)":P.border}`,borderRadius:14,padding:"28px 36px",marginBottom:24,boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"}}>
      <div style={inverted?{display:"inline-block",fontSize:13,fontWeight:600,color:P.ink,marginBottom:28,background:"#fff",borderRadius:6,padding:"4px 10px"}:{fontSize:13,fontWeight:600,color:P.textMute,marginBottom:28}}>Track where we are in the process at any given time</div>
      <div style={{display:"flex",alignItems:"flex-start"}}>
        {steps.map((step,i)=>{
          const isCom=phaseStatuses[i]==="complete",isAct=phaseStatuses[i]==="active";
          return (<div key={step.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",position:"relative"}}>
            {i<steps.length-1&&<div style={{position:"absolute",top:15,left:"50%",width:"100%",height:2,background:inverted?(isCom?"#fff":"rgba(255,255,255,0.35)"):(isCom?P.accent:P.border),zIndex:0}}/>}
            <div style={{width:30,height:30,borderRadius:"50%",background:inverted?(isCom?"#fff":"transparent"):(isCom?P.accent:P.surface),border:`2.5px solid ${inverted?(isCom||isAct?"#fff":"rgba(255,255,255,0.4)"):(isCom||isAct?P.accent:P.border)}`,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1,marginBottom:10,flexShrink:0}}>
              {isCom&&<svg width="13" height="13" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke={inverted?P.accent:"#fff"} strokeWidth="1.6" strokeLinecap="round"/></svg>}
            </div>
            <div style={inverted?{fontSize:12.5,fontWeight:600,color:P.ink,maxWidth:110,padding:"3px 8px",background:"#fff",borderRadius:6}:{fontSize:12.5,fontWeight:600,color:isCom?P.text:isAct?P.accentMid:P.textMute,maxWidth:110,padding:"0 4px"}}>{step.label}</div>
          </div>);
        })}
      </div>
    </div>
  );
};

const OrgNode = ({s,all,depth=0,viewMode}) => {
  const dc=DESIG_CFG[s.designation]||DESIG_CFG.influencer;
  const children=all.filter(x=>x.reportsTo===s.id);
  return (<div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
    <div style={{background:P.surface,border:`2px solid ${depth===0?P.accent:P.border}`,borderRadius:10,padding:"12px 16px",minWidth:156,textAlign:"center",boxShadow:depth===0?`0 0 0 4px ${P.accentLight}`:"0 1px 4px rgba(0,0,0,0.07)"}}>
      <div style={{width:38,height:38,borderRadius:"50%",background:P.accentLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:P.accent,margin:"0 auto 8px"}}>{s.initials}</div>
      <div style={{fontSize:12,fontWeight:700,color:P.text}}>{s.name}</div>
      <div style={{fontSize:10,color:P.textSec,marginTop:2,marginBottom:6}}>{s.role}</div>
      {/* Internal sales classification -- never shown to a prospect, even about themselves
          or a colleague. */}
      {viewMode==="rep"&&<Badge small label={dc.label} color={dc.color} bg={dc.bg} border={dc.border}/>}
      <a href={s.linkedin} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,marginTop:8,fontSize:10,color:"#0A66C2",textDecoration:"none",fontWeight:600}}>{LI_SVG}LinkedIn</a>
    </div>
    {children.length>0&&<div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{width:2,height:22,background:P.borderDark}}/>
      <div style={{display:"flex",gap:20}}>
        {children.map(c=><div key={c.id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:2,height:22,background:P.borderDark}}/><OrgNode s={c} all={all} depth={depth+1} viewMode={viewMode}/></div>)}
      </div>
    </div>}
  </div>);
};

// Fixed expected headers (case-insensitive, trimmed, with a couple of common aliases)
// rather than a full drag-and-drop column-mapping UI -- the same "simple, explainable"
// level as the risk-signal thresholds, not over-engineered for a feature nobody's used
// yet. Matches DealCreator's own manual-entry field set exactly.
const IMPORT_HEADER_ALIASES = {
  company:["company","company name"], contact:["contact","primary contact","contact name","primary contact name"],
  // "Primary Contact Title" has nowhere honest to go but here -- a real file (a CRM
  // export) used this column for the contact's job title, not a deal title, since it had
  // no deal-title column at all. Flagging the ambiguity rather than silently guessing.
  title:["title","deal title","primary contact title"],
  value:["value","deal value"], closeDate:["close date","closedate"],
  industry:["industry"], accessCode:["access code","accesscode"], welcomeMsg:["welcome message","welcome msg"],
  problem:["problem","the problem","exec summary - problem"],
  challenges:["challenges","exec summary - challenges"],
  solutions:["solutions","exec summary - solutions"],
  discoverySummary:["discovery - summary","discovery summary"],
  corporateStrategy:["discovery - corporate strategy","corporate strategy"],
  topOutcomes:["discovery - outcomes","discovery - top outcomes","outcomes","top outcomes"],
  discoveryChallenges:["discovery - challenges"],
  primaryUseCase:["discovery - primary use case","primary use case"],
  goals90:["goals - 90 days","90 days"], goals1yr:["goals - 1 year","1 year"], goalsBeyond:["goals - beyond","beyond"],
  // Fallback when goals aren't split into three columns -- a real file had one flat
  // "Discovery - Goals" cell. Everything in it goes into the 90 Days bucket, the
  // nearest-term and least-presumptuous place to put an undifferentiated goals list.
  goalsGeneric:["discovery - goals","goals"],
};
// Stakeholders live on a separate sheet (a list-per-deal doesn't fit flat columns on the
// Deals sheet without an unwieldy "Stakeholder 1 Name/Stakeholder 2 Name..." scheme) --
// linked back to its deal by Company, matched case-insensitively within the same import.
const IMPORT_STAKEHOLDER_ALIASES = {
  company:["company","deal company"], name:["name"], role:["role","title"], designation:["designation"],
  bu:["business unit","bu"], email:["email"], linkedin:["linkedin","linkedin url"], approvalRequired:["approval required"],
  engagementScore:["engagement score (1-100)","engagement score"],
  // Holds a sibling stakeholder's *name*, not an id (ids don't exist until insert) --
  // resolved in a second pass once the whole batch has been written. See insertDeal/
  // mergeDealFromImport.
  reportsTo:["reports to"],
};
const pickField=(normalizedRow,aliases)=>{for(const a of aliases){if(normalizedRow[a]!==undefined&&normalizedRow[a]!=="")return normalizedRow[a];}return "";};
// Semicolon-separated -- the simple, standard way to cram a list into one spreadsheet
// cell, matching this feature's fixed-headers-over-a-mapping-UI level of simplicity.
const splitListCell=v=>String(v||"").split(";").map(s=>s.trim()).filter(Boolean);
const IMPORT_TEMPLATE_DEAL_HEADERS=["Company","Contact","Title","Value","Close Date","Industry","Access Code","Welcome Message","Problem","Challenges","Solutions","Discovery - Summary","Discovery - Corporate Strategy","Discovery - Outcomes","Discovery - Challenges","Discovery - Primary Use Case","Goals - 90 Days","Goals - 1 Year","Goals - Beyond"];
const IMPORT_TEMPLATE_STAKEHOLDER_HEADERS=["Company","Name","Role","Designation","Business Unit","Email","LinkedIn","Approval Required","Engagement Score (1-100)","Reports To"];

const DealCreator = ({onSave,onImport,onClose,stageLabels}) => {
  const [step,setStep]=useState(1);const [mode,setMode]=useState(null);const [tx,setTx]=useState("");const [loading,setLoading]=useState(false);
  const [importRows,setImportRows]=useState([]);const [importErrors,setImportErrors]=useState([]);const [importFileName,setImportFileName]=useState("");
  const [importHasStakeholderSheet,setImportHasStakeholderSheet]=useState(false);
  const [genError,setGenError]=useState("");
  const blank={company:"",contact:"",title:"",value:"",closeDate:"",industry:"",logo:"",color:"#1A4FBA",accessCode:"",includeTrialSessions:false,welcomeMsg:"",execSummary:{problem:"",challenges:[],solutions:[]},discovery:{summary:"",corporateStrategy:[],topOutcomes:[],challenges:[],jobsToBeDone:[],primaryUseCase:"",goals:{"90 Days":[],"1 Year":[],"Beyond":[]}},stakeholders:[],mapItems:[],content:[],activityLog:[]};
  const [draft,setDraft]=useState(blank);
  const downloadTemplate=()=>{
    const wb=XLSX.utils.book_new();
    const dealsSheet=XLSX.utils.aoa_to_sheet([
      IMPORT_TEMPLATE_DEAL_HEADERS,
      ["Acme Co.","Jane Doe","Renewal","50000","2026-12-31","Tech","","Welcome,\n\nThis room is for us to stay aligned on the sequence of events as our partnership progresses.\n✓ It will contain all relevant resources\n✓ Outline next steps, tasks and timelines\n✓ Feel free to share this URL to keep colleagues in the loop\n✓ Reach out to me directly to keep key discussions organized\n\nLooking forward to working with you on your goals!","Manual reporting takes hours each week","Slow onboarding; No mobile support; Manual reporting","Automated dashboards; Native mobile app; SSO","Acme Co. is a mid-market distributor modernizing its ops stack.","Consolidate point tools into one platform","Cut manual reporting time; improve forecast accuracy","Fragmented tools; no shared visibility across teams","Running a multi-stakeholder evaluation with a trackable action plan","Confirm budget and technical fit","Full team onboarded and first workflows live","Platform embedded as the team's default workflow"],
    ]);
    const stakeholdersSheet=XLSX.utils.aoa_to_sheet([
      IMPORT_TEMPLATE_STAKEHOLDER_HEADERS,
      ["Acme Co.","Jane Doe","VP Operations","decision-maker","Operations","jane@acme.com","https://linkedin.com/in/janedoe","yes","88",""],
    ]);
    XLSX.utils.book_append_sheet(wb,dealsSheet,"Deals");
    XLSX.utils.book_append_sheet(wb,stakeholdersSheet,"Stakeholders");
    XLSX.writeFile(wb,"deal-import-template.xlsx");
  };
  const handleImportFile=async file=>{
    setImportFileName(file.name);
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:"array"});
    const sheetName=name=>wb.SheetNames.find(n=>n.trim().toLowerCase()===name);
    const dealsSheetName=sheetName("deals")||wb.SheetNames[0];
    const stakeholdersSheetName=sheetName("stakeholders");

    const rows=XLSX.utils.sheet_to_json(wb.Sheets[dealsSheetName],{defval:""});
    const drafts=[];const errors=[];
    rows.forEach((row,i)=>{
      const norm=Object.fromEntries(Object.entries(row).map(([k,v])=>[String(k).trim().toLowerCase(),v]));
      const company=String(pickField(norm,IMPORT_HEADER_ALIASES.company)).trim();
      if(!company){errors.push(`Deals row ${i+2}: missing Company, skipped`);return;}
      const goals90=splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.goals90));
      const goals1yr=splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.goals1yr));
      const goalsBeyond=splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.goalsBeyond));
      // No split-by-period columns present -- fall back to putting one flat Goals cell
      // entirely in the nearest-term bucket rather than guessing how to divide it up.
      const goalsGeneric=(!goals90.length&&!goals1yr.length&&!goalsBeyond.length)?splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.goalsGeneric)):[];
      drafts.push({
        ...blank,
        company,
        contact:String(pickField(norm,IMPORT_HEADER_ALIASES.contact)).trim(),
        title:String(pickField(norm,IMPORT_HEADER_ALIASES.title)).trim(),
        value:String(pickField(norm,IMPORT_HEADER_ALIASES.value)).trim(),
        closeDate:String(pickField(norm,IMPORT_HEADER_ALIASES.closeDate)).trim(),
        industry:String(pickField(norm,IMPORT_HEADER_ALIASES.industry)).trim(),
        accessCode:String(pickField(norm,IMPORT_HEADER_ALIASES.accessCode)).trim(),
        welcomeMsg:String(pickField(norm,IMPORT_HEADER_ALIASES.welcomeMsg)).trim(),
        logo:company.slice(0,2).toUpperCase(),
        execSummary:{
          problem:String(pickField(norm,IMPORT_HEADER_ALIASES.problem)).trim(),
          challenges:splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.challenges)),
          solutions:splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.solutions)),
        },
        discovery:{
          summary:String(pickField(norm,IMPORT_HEADER_ALIASES.discoverySummary)).trim(),
          corporateStrategy:splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.corporateStrategy)),
          topOutcomes:splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.topOutcomes)),
          challenges:splitListCell(pickField(norm,IMPORT_HEADER_ALIASES.discoveryChallenges)),
          jobsToBeDone:[],
          primaryUseCase:String(pickField(norm,IMPORT_HEADER_ALIASES.primaryUseCase)).trim(),
          goals:{"90 Days":[...goals90,...goalsGeneric],"1 Year":goals1yr,"Beyond":goalsBeyond},
        },
        stakeholders:[],
      });
    });

    if(stakeholdersSheetName){
      const stakeholderRows=XLSX.utils.sheet_to_json(wb.Sheets[stakeholdersSheetName],{defval:""});
      stakeholderRows.forEach((row,i)=>{
        const norm=Object.fromEntries(Object.entries(row).map(([k,v])=>[String(k).trim().toLowerCase(),v]));
        const company=String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.company)).trim();
        const name=String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.name)).trim();
        if(!name){errors.push(`Stakeholders row ${i+2}: missing Name, skipped`);return;}
        const deal=drafts.find(d=>d.company.toLowerCase()===company.toLowerCase());
        if(!deal){errors.push(`Stakeholders row ${i+2}: "${company}" doesn't match any deal's Company, skipped`);return;}
        const designationRaw=String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.designation)).trim().toLowerCase();
        const designation=DESIG_CFG[designationRaw]?designationRaw:"influencer";
        const approvalText=String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.approvalRequired)).trim().toLowerCase();
        const engagementRaw=parseInt(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.engagementScore),10);
        deal.stakeholders.push({
          name,
          role:String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.role)).trim(),
          designation,
          bu:String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.bu)).trim(),
          email:String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.email)).trim(),
          linkedin:String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.linkedin)).trim(),
          approvalRequired:["yes","true","1"].includes(approvalText),
          engagement:isNaN(engagementRaw)?50:Math.max(0,Math.min(100,engagementRaw)),
          reportsToName:String(pickField(norm,IMPORT_STAKEHOLDER_ALIASES.reportsTo)).trim(),
        });
      });
    }

    setImportRows(drafts);setImportErrors(errors);
    setImportHasStakeholderSheet(!!stakeholdersSheetName);
  };
  // Previously: any failure here (network/API error, or a response that wasn't clean
  // JSON) silently landed on step 3 with a still-blank draft -- no error, no clue why.
  // Now: the whole call is one try/catch, extraction is robust to the model wrapping
  // the JSON in explanatory prose (not just code fences), and a real failure surfaces
  // the actual error/response text and keeps the user on step 2 to retry, instead of
  // silently advancing to an empty form.
  const gen=async()=>{
    setLoading(true);setGenError("");
    // The 5 stages the AI is told to use are this org's actual current labels (falling
    // back to defaults for anything never renamed), same as everywhere else stage labels
    // are resolved -- see phaseDisplayLabel/ProcessTimeline.
    const resolvedStages=STAGE_DEFS.map(s=>({...s,label:(stageLabels&&stageLabels[s.key])||DEFAULT_STAGE_LABELS[s.key]}));
    let res;
    try{
      res=await callClaude("You are an enterprise sales AI. Return ONLY valid JSON no markdown.",`Extract: company,contact,title,value,industry,accessCode(6-char uppercase),welcomeMsg(2 sentences),execSummary.problem(2 paragraphs),execSummary.challenges(array 4),execSummary.solutions(array 4),discovery.summary(2 sentences),discovery.corporateStrategy(array 3),discovery.topOutcomes(array 3),discovery.challenges(array 4),discovery.jobsToBeDone(array 3),discovery.primaryUseCase,discovery.goals({"90 Days":[],"1 Year":[],"Beyond":[]}),stakeholders(array:name,role,designation,bu,linkedin; designation must be exactly one of "champion","decision-maker","influencer","blocker" -- no other values, no different casing; exactly one stakeholder should be "decision-maker" and one should be "champion" where the transcript supports it),tasks(array of {stage,task}; stage must be exactly one of ${resolvedStages.map(s=>`"${s.label}"`).join(",")}; 2-3 tasks per stage, inferred from what's actually discussed or implied in the transcript, not generic placeholders).\n\n${tx}`,4000);
    }catch(e){setGenError(e.message||"AI request failed");setLoading(false);return;}
    try{
      const jsonMatch=res.match(/\{[\s\S]*\}/);
      if(!jsonMatch)throw new Error(`AI didn't return JSON. Raw response: ${res.slice(0,300)||"(empty)"}`);
      const p=JSON.parse(jsonMatch[0]);
      const init=n=>n.split(" ").map(x=>x[0]).join("").toUpperCase().slice(0,2);
      // deal_tasks.phase is DB-constrained to the 5 literal default strings regardless of
      // this org's display labels (see STAGE_DEFS) -- the AI was told to use the org's
      // labels for readability, so this maps its returned label back to the literal phase.
      // Falls back to the first stage rather than silently dropping a task if the AI's
      // wording doesn't match exactly (case/whitespace drift).
      const phaseForLabel=label=>{
        const norm=(label||"").trim().toLowerCase();
        const match=resolvedStages.find(s=>s.label.toLowerCase()===norm);
        return (match||resolvedStages[0]).phase;
      };
      setDraft(v=>({...v,...p,logo:(p.company||"").slice(0,2).toUpperCase(),execSummary:p.execSummary||v.execSummary,discovery:{...v.discovery,...(p.discovery||{})},stakeholders:(p.stakeholders||[]).map((s,i)=>({id:`s${i+1}`,...s,initials:init(s.name||""),engagement:50,lastSeen:"Just added",approvalRequired:s.designation==="decision-maker"||s.designation==="blocker",docsViewed:[],reportsTo:null})),mapItems:(p.tasks||[]).map((t,i)=>({id:i+1,phase:phaseForLabel(t.stage),task:t.task,owner:"",buyerOwner:p.contact||"",dueDate:"",status:"pending",notes:"",approvalRequired:false})),activityLog:[]}));
      setStep(3);
    }catch(e){setGenError(e.message||"Couldn't parse the AI's response");}
    setLoading(false);
  };
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textSec,letterSpacing:"0.04em",textTransform:"uppercase",display:"block",marginBottom:5};
  return (<div style={{position:"fixed",inset:0,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:680,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{padding:"20px 24px 16px",borderBottom:`1px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div className="headline" style={{fontSize:19,color:P.text}}>Create Deal Room{mode==="import"?"s":""}</div><div style={{fontSize:12,color:P.textSec,marginTop:2}}>{mode==="import"?"Import from Spreadsheet":`Step ${step} of 3 · ${["Choose Method","AI Generation","Review & Save"][step-1]}`}</div></div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{padding:24}}>
        {step===1&&<div><div style={{fontSize:14,color:P.textSec,marginBottom:20}}>How would you like to create this deal room?</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            {[{key:"transcript",icon:"🎙️",title:"From Transcript / Notes",desc:"Paste call notes. AI extracts all deal details automatically."},{key:"manual",icon:"✏️",title:"Build Manually",desc:"Enter deal details step by step with full control."},{key:"import",icon:"📊",title:"Import from Spreadsheet",desc:"Onboard your existing pipeline -- one row becomes one deal room."}].map(o=>(
              <div key={o.key} onClick={()=>{setMode(o.key);setStep(o.key==="transcript"?2:o.key==="import"?4:3);}} style={{border:`2px solid ${P.border}`,borderRadius:10,padding:20,cursor:"pointer"}} onMouseOver={e=>{e.currentTarget.style.borderColor=P.accent;e.currentTarget.style.background=P.accentLight;}} onMouseOut={e=>{e.currentTarget.style.borderColor=P.border;e.currentTarget.style.background=P.surface;}}>
                <div style={{fontSize:28,marginBottom:10}}>{o.icon}</div><div style={{fontSize:14,fontWeight:700,color:P.text,marginBottom:6}}>{o.title}</div><div style={{fontSize:12,color:P.textSec,lineHeight:1.5}}>{o.desc}</div>
              </div>))}
          </div>
        </div>}
        {step===2&&<div><div style={{fontSize:13,color:P.textSec,marginBottom:18,lineHeight:1.6}}>Paste discovery notes, LinkedIn profiles, or any context. AI builds the full deal room.</div>
          <textarea value={tx} onChange={e=>setTx(e.target.value)} placeholder="Paste transcript or context here..." style={{...inp,height:220,resize:"vertical",lineHeight:1.6,marginBottom:16}}/>
          {genError&&<div style={{background:P.redBg,border:`1px solid ${P.redBorder}`,borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:P.red,whiteSpace:"pre-wrap"}}>{genError}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={gen} disabled={loading||!tx.trim()} style={{flex:1,padding:"11px 20px",background:loading?P.border:P.accent,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>{loading?"⟳ Generating…":"✦ Generate with AI"}</button>
            <button onClick={()=>setStep(1)} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Back</button>
          </div>
        </div>}
        {step===3&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
            {[["Company *","company","text"],["Primary Contact","contact","text"],["Deal Title","title","text"],["Deal Value","value","text"],["Close Date","closeDate","date"],["Industry","industry","text"],["Access Code","accessCode","text"]].map(([l,k,t])=>(
              <div key={k}><label style={lbl}>{l}</label><input type={t} style={inp} value={draft[k]||""} onChange={e=>setDraft(p=>({...p,[k]:e.target.value}))}/></div>))}
          </div>
          <div style={{marginBottom:14}}><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={draft.includeTrialSessions} onChange={e=>setDraft(p=>({...p,includeTrialSessions:e.target.checked}))} style={{width:14,height:14}}/>Check this box to include a Trial Sessions phase in the sequence of events.</label></div>
          <div style={{marginBottom:14}}><label style={lbl}>Welcome Message</label><textarea value={draft.welcomeMsg||""} onChange={e=>setDraft(p=>({...p,welcomeMsg:e.target.value}))} style={{...inp,height:70,resize:"vertical"}}/></div>
          {draft.discovery.challenges.length>0&&<div style={{background:P.accentLight,border:`1px solid #F0C9B7`,borderRadius:8,padding:"12px 16px",marginBottom:12}}><div style={{fontSize:11,fontWeight:700,color:P.accent,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>AI Extracted — Challenges</div>{draft.discovery.challenges.map((c,i)=><div key={i} style={{fontSize:12,color:P.textSec,marginBottom:3}}>· {c}</div>)}</div>}
          {draft.stakeholders.length>0&&<div style={{background:P.greenBg,border:`1px solid ${P.greenBorder}`,borderRadius:8,padding:"12px 16px",marginBottom:14}}><div style={{fontSize:11,fontWeight:700,color:P.green,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>AI Extracted — Stakeholders ({draft.stakeholders.length})</div>{draft.stakeholders.map(s=><div key={s.id} style={{fontSize:12,color:P.textSec,marginBottom:3}}>· {s.name} — {s.role} ({s.designation})</div>)}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{if(!draft.company)return;onSave({...draft,id:Date.now(),logo:draft.logo||draft.company.slice(0,2).toUpperCase(),engagement:50});}} style={{flex:1,padding:"11px 20px",background:P.accent,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Deal Room →</button>
            <button onClick={()=>setStep(mode==="transcript"?2:1)} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Back</button>
          </div>
        </div>}
        {step===4&&<div>
          <div style={{fontSize:13,color:P.textSec,marginBottom:16,lineHeight:1.6}}>Upload a spreadsheet where each row is one deal. Download the template for the expected format -- it's a 2-sheet workbook (Deals + Stakeholders) so you can bring in your pipeline and its stakeholders together, fill it in, and upload it back.</div>
          <button onClick={downloadTemplate} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer",marginBottom:16}}>↓ Download Template</button>
          <label style={{display:"block",padding:"20px",border:`1.5px dashed ${P.border}`,borderRadius:10,textAlign:"center",cursor:"pointer",marginBottom:16,color:P.textSec,fontSize:13}}>
            {importFileName||"Click to choose a .csv or .xlsx file"}
            <input type="file" accept=".csv,.xlsx,.xls" onChange={e=>e.target.files[0]&&handleImportFile(e.target.files[0])} style={{display:"none"}}/>
          </label>
          {importFileName&&<>
            {importRows.length>0&&<div style={{background:P.greenBg,border:`1px solid ${P.greenBorder}`,borderRadius:8,padding:"12px 16px",marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:P.green,marginBottom:6}}>{importRows.length} deal{importRows.length===1?"":"s"} will be created{importRows.some(r=>r.stakeholders.length)?`, ${importRows.reduce((a,r)=>a+r.stakeholders.length,0)} stakeholders across these deals`:""}</div>
              <div style={{fontSize:12,color:P.textSec,lineHeight:1.6}}>{importRows.slice(0,5).map(r=>r.company).join(", ")}{importRows.length>5?`, +${importRows.length-5} more`:""}</div>
            </div>}
            {!importHasStakeholderSheet&&<div style={{fontSize:11,color:P.textMute,marginBottom:12}}>No "Stakeholders" sheet found -- stakeholders require the .xlsx template (a plain .csv can only hold one flat table).</div>}
            {importErrors.length>0&&<div style={{background:P.amberBg,border:`1px solid ${P.amberBorder}`,borderRadius:8,padding:"12px 16px",marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:P.amber,marginBottom:6}}>{importErrors.length} row{importErrors.length===1?"":"s"} skipped</div>
              {importErrors.map((e,i)=><div key={i} style={{fontSize:12,color:P.textSec,marginBottom:2}}>{e}</div>)}
            </div>}
          </>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>importRows.length&&onImport(importRows)} disabled={!importRows.length} style={{flex:1,padding:"11px 20px",background:importRows.length?P.accent:P.border,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:importRows.length?"pointer":"not-allowed"}}>Create {importRows.length||""} Deal Room{importRows.length===1?"":"s"} →</button>
            <button onClick={()=>{setMode(null);setImportRows([]);setImportErrors([]);setImportFileName("");setStep(1);}} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Back</button>
          </div>
        </div>}
      </div>
    </div>
  </div>);
};

// TODO(Mark): paste the two live Termly policy URLs here -- e.g.
// "https://app.termly.io/policy-viewer/policy.html?policyUUID=..." -- for both Terms of
// Service and Privacy Policy. That's the entire cutover: once these two constants are set,
// the signup checkbox below automatically switches from plain text to real clickable links.
// Leave both null only until the URLs are in hand -- don't ship a fake/placeholder URL.
const TERMS_URL = 'https://app.termly.io/policy-viewer/policy.html?policyUUID=4ec85596-cfc0-423b-a33b-9a878396a67a';
const PRIVACY_URL = 'https://app.termly.io/policy-viewer/policy.html?policyUUID=284c3efe-adea-4fd5-831d-9e0b60da569d';

const AuthGate = () => {
  const [mode,setMode]=useState("signin"); // "signin" | "signup" | "check-email"
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [orgName,setOrgName]=useState(""); const [fullName,setFullName]=useState("");
  const [phone,setPhone]=useState(""); const [termsAccepted,setTermsAccepted]=useState(false);
  const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const [forgotSent,setForgotSent]=useState(false);

  // resetPasswordForEmail deliberately doesn't reveal whether the email exists (Supabase's
  // own behavior) -- forgotSent shows the same generic confirmation either way, avoiding
  // account enumeration. The emailed link lands on /reset-password, but detection of the
  // recovery session doesn't depend on that path -- see DealRoom's onAuthStateChange, which
  // catches Supabase's PASSWORD_RECOVERY event regardless of which page it fires on.
  const sendResetLink=async()=>{
    if(!email){setError("Enter your email above first, then click \"Forgot password?\" again.");return;}
    setLoading(true);setError("");
    const {error:resetErr}=await sb.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/reset-password`});
    setLoading(false);
    if(resetErr){setError(resetErr.message||"Couldn't send reset email.");return;}
    setForgotSent(true);
  };

  const submit=async()=>{
    setLoading(true);setError("");
    try{
      if(mode==="signup"){
        // org_name/full_name/phone/terms_accepted_at all ride along as user metadata instead
        // of being acted on here -- Supabase stores this on auth.users regardless of whether
        // email confirmation is required, so it survives however long that takes. DealRoom's
        // own membership-resolution effect is the one place that reads it back and actually
        // creates the org/writes profiles, once a real session exists -- see its comment for
        // why duplicating that logic here (as this used to) isn't needed anymore.
        const {data,error:signUpErr}=await sb.auth.signUp({
          email,password,
          options:{data:{org_name:orgName,full_name:fullName||null,phone:phone||null,terms_accepted_at:new Date().toISOString()}},
        });
        if(signUpErr)throw signUpErr;
        if(!data.session)setMode("check-email");
      }else{
        const {error:signInErr}=await sb.auth.signInWithPassword({email,password});
        if(signInErr)throw signInErr;
      }
    }catch(e){setError(e.message||"Something went wrong. Please try again.");}
    setLoading(false);
  };

  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5};

  return (<div style={{flex:1,minHeight:"100vh",background:"linear-gradient(135deg,#FBE9E2 0%,#F6F5F2 60%,#E1EEEC 100%)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:420,background:P.surface,borderRadius:20,padding:"44px 40px",boxShadow:"0 20px 60px rgba(27,31,35,0.10)",border:`1px solid ${P.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:28}}>
        <div style={{width:36,height:36,background:P.ink,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
        <span className="headline" style={{fontSize:17,color:P.text}}>myBivy</span>
      </div>

      {mode==="check-email"?(<>
        <div className="headline" style={{fontSize:22,color:P.text,marginBottom:8}}>Check your email</div>
        <div style={{fontSize:13,color:P.textSec,lineHeight:1.6}}>We sent a confirmation link to <strong>{email}</strong>. Click it, then sign in below.</div>
        <button onClick={()=>setMode("signin")} style={{width:"100%",padding:"12px",marginTop:20,background:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Back to Sign In</button>
      </>):(<>
        <div className="headline" style={{fontSize:24,color:P.text,marginBottom:24}}>{mode==="signup"?"Create your workspace":"Sign in"}</div>
        {mode==="signup"&&<div style={{marginBottom:14}}><label style={lbl}>Organization Name</label>
          <input value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="Acme Sales Team" style={inp}/></div>}
        {mode==="signup"&&<div style={{marginBottom:14}}><label style={lbl}>Full Name</label>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Jane Doe" style={inp}/></div>}
        {mode==="signup"&&<div style={{marginBottom:14}}><label style={lbl}>Phone Number</label>
          <input value={phone} onChange={e=>setPhone(e.target.value)} type="tel" placeholder="(555) 123-4567" style={inp}/></div>}
        <div style={{marginBottom:14}}><label style={lbl}>Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@company.com" style={inp}/></div>
        <div style={{marginBottom:mode==="signup"?14:20}}><label style={lbl}>Password</label>
          <input value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} type="password" placeholder="••••••••" style={inp}/>
          {mode==="signin"&&(forgotSent?
            <div style={{fontSize:12,color:P.textSec,marginTop:8}}>Check your email for a link to reset your password.</div>
          :<div onClick={sendResetLink} style={{fontSize:12,color:P.accent,fontWeight:600,cursor:"pointer",marginTop:8,textAlign:"right"}}>Forgot password?</div>)}
          {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}</div>
        {mode==="signup"&&<label style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:20,fontSize:12,color:P.textSec,lineHeight:1.5,cursor:"pointer"}}>
          <input type="checkbox" checked={termsAccepted} onChange={e=>setTermsAccepted(e.target.checked)} style={{marginTop:2}}/>
          <span>I agree to the{" "}
            {TERMS_URL?<a href={TERMS_URL} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:P.accent,fontWeight:600}}>Terms of Service</a>
            :<span style={{fontWeight:600,color:P.text}}>Terms of Service</span>}
            {" "}and{" "}
            {PRIVACY_URL?<a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:P.accent,fontWeight:600}}>Privacy Policy</a>
            :<span style={{fontWeight:600,color:P.text}}>Privacy Policy</span>}
          </span>
        </label>}
        <button onClick={submit} disabled={loading||!email||!password||(mode==="signup"&&(!orgName||!termsAccepted))} style={{width:"100%",padding:"12px",background:loading||!email||!password?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>{loading?"Please wait…":mode==="signup"?"Create Workspace →":"Sign In →"}</button>
        <div style={{textAlign:"center",marginTop:18,fontSize:15,color:P.textMute}}>
          {mode==="signup"?"Already have an account? ":"New User "}
          <span onClick={()=>{setMode(mode==="signup"?"signin":"signup");setError("");}} style={{color:P.accent,fontWeight:700,cursor:"pointer"}}>{mode==="signup"?"Sign in":"Create a workspace"}</span>
        </div>
      </>)}
    </div>
  </div>);
};

// Shown instead of the normal AuthGate/app flow when DealRoom's onAuthStateChange catches a
// PASSWORD_RECOVERY event -- Supabase establishes a real (if short-lived) session the moment
// this fires, before the user has actually set a new password. Two different paths land
// here with the same event: a forgot-password emailed link, and (mode="activate") a
// newly-provisioned teammate who just verified their 6-digit code (ActivateTeammate below,
// via verifyOtp) -- same Supabase primitive, deliberately reused rather than building a
// second "set your password" screen. The two modes diverge only in what happens after
// updateUser succeeds: a forgot-password reset signs out so onDone() lands back on plain
// sign-in (this session was never meant to continue); activation instead marks the teammate
// active (complete_activation, 0044) and stays signed in, landing them straight in their
// bivy -- that IS the point of the flow, not an accident to sign out of.
const ResetPassword = ({onDone,mode}) => {
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const isActivating=mode==="activate";

  const submit=async()=>{
    if(password.length<6){setError("Password must be at least 6 characters.");return;}
    setLoading(true);setError("");
    const {error:updErr}=await sb.auth.updateUser({password});
    if(updErr){setError(updErr.message||"Couldn't update password.");setLoading(false);return;}
    if(isActivating){await sb.rpc("complete_activation");}
    else{await sb.auth.signOut();}
    onDone();
  };

  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5};

  return (<div style={{flex:1,minHeight:"100vh",background:"linear-gradient(135deg,#FBE9E2 0%,#F6F5F2 60%,#E1EEEC 100%)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:420,background:P.surface,borderRadius:20,padding:"44px 40px",boxShadow:"0 20px 60px rgba(27,31,35,0.10)",border:`1px solid ${P.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:28}}>
        <div style={{width:36,height:36,background:P.ink,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
        <span className="headline" style={{fontSize:17,color:P.text}}>myBivy</span>
      </div>
      <div className="headline" style={{fontSize:24,color:P.text,marginBottom:24}}>{isActivating?"Welcome! Set your password":"Set a new password"}</div>
      <div style={{marginBottom:20}}>
        <label style={lbl}>New Password</label>
        <input value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} type="password" placeholder="••••••••" style={inp}/>
        {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}
      </div>
      <button onClick={submit} disabled={loading||!password} style={{width:"100%",padding:"12px",background:loading||!password?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>{loading?"Please wait…":"Set Password →"}</button>
    </div>
  </div>);
};

// First-login screen for a newly-provisioned teammate (Team Admin/Manager Rework, Data
// model #1) -- reached via ?activate={email}, the link provision-teammate.mts hands the
// Admin alongside the 6-digit code. Distinct from AuthGate's normal sign-in: this isn't a
// password, it's a one-time code exchanged through activate-teammate.mts (which verifies it
// against its own bcrypt hash + attempt cap + expiry, not Supabase's generic sign-in rate
// limit -- see that function's comments for why) for a Supabase recovery token. Calling
// verifyOtp with that token establishes a real session and fires the same PASSWORD_RECOVERY
// event a forgot-password link would -- onVerified() here just flags that this particular
// recovery session came from activation, so DealRoom's render logic shows ResetPassword in
// "activate" mode (stays signed in) instead of "reset" mode (signs back out).
const ActivateTeammate = ({initialEmail,onVerified}) => {
  const [email,setEmail]=useState(initialEmail||"");
  const [code,setCode]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  const submit=async()=>{
    if(!email.trim()||code.trim().length!==6){setError("Enter your email and the 6-digit code exactly as sent.");return;}
    setLoading(true);setError("");
    try{
      const res=await fetch("/api/activate-teammate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim(),code:code.trim()})});
      const data=await res.json();
      if(!res.ok){setError(data.error||"Couldn't activate your account.");setLoading(false);return;}
      // token_hash-based verifyOtp takes ONLY token_hash + type -- Supabase rejects the call
      // ("Only the token_hash and type should be provided") if email rides along too; email
      // is exclusively for the other verifyOtp overload (email + a 6-digit OTP token, not
      // this token_hash flow). Found live during QA.
      const {error:otpErr}=await sb.auth.verifyOtp({token_hash:data.tokenHash,type:"recovery"});
      if(otpErr){setError(otpErr.message||"Couldn't finish activating your account.");setLoading(false);return;}
      onVerified();
    }catch{
      setError("Couldn't reach the server. Check your connection and try again.");
      setLoading(false);
    }
  };

  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5};

  return (<div style={{flex:1,minHeight:"100vh",background:"linear-gradient(135deg,#FBE9E2 0%,#F6F5F2 60%,#E1EEEC 100%)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:420,background:P.surface,borderRadius:20,padding:"44px 40px",boxShadow:"0 20px 60px rgba(27,31,35,0.10)",border:`1px solid ${P.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:28}}>
        <div style={{width:36,height:36,background:P.ink,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
        <span className="headline" style={{fontSize:17,color:P.text}}>myBivy</span>
      </div>
      <div className="headline" style={{fontSize:24,color:P.text,marginBottom:8}}>Activate your account</div>
      <div style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:24}}>Enter the email and 6-digit code your admin gave you.</div>
      <div style={{marginBottom:14}}>
        <label style={lbl}>Email</label>
        <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@company.com" style={inp}/>
      </div>
      <div style={{marginBottom:20}}>
        <label style={lbl}>6-Digit Code</label>
        <input value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,"").slice(0,6))} onKeyDown={e=>e.key==="Enter"&&submit()} inputMode="numeric" placeholder="123456" style={{...inp,letterSpacing:"0.3em",fontFamily:P.fontMono}}/>
        {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}
      </div>
      <button onClick={submit} disabled={loading} style={{width:"100%",padding:"12px",background:loading?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>{loading?"Please wait…":"Activate →"}</button>
    </div>
  </div>);
};

const NameYourOrg = ({onDone}) => {
  const [orgName,setOrgName]=useState(""); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  const submit=async()=>{
    setLoading(true);setError("");
    const {error:rpcErr}=await sb.rpc("create_organization_with_owner",{p_org_name:orgName,p_full_name:null});
    if(rpcErr){
      // This screen can render on a stale race: signup already created the org via its
      // own RPC call, but the auth-state-triggered membership check in the parent ran
      // before that call resolved, showing this screen when the user actually already
      // has an org. Don't trust the RPC error text alone -- check reality and proceed if
      // a membership now exists; only surface the error if it genuinely doesn't.
      const {data:{user}}=await sb.auth.getUser();
      const {data:mem}=await sb.from("organization_members").select("org_id").eq("user_id",user.id).limit(1).maybeSingle();
      if(mem){onDone();return;}
      setError(rpcErr.message);setLoading(false);return;
    }
    onDone();
  };
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  return (<div style={{flex:1,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:400,background:P.surface,borderRadius:20,padding:"40px",boxShadow:"0 20px 60px rgba(27,31,35,0.10)",border:`1px solid ${P.border}`}}>
      <div className="headline" style={{fontSize:22,color:P.text,marginBottom:8}}>Name your organization</div>
      <div style={{fontSize:13,color:P.textSec,marginBottom:20,lineHeight:1.6}}>One more step before you can start tracking deals.</div>
      <input value={orgName} onChange={e=>setOrgName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Acme Sales Team" style={inp}/>
      {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}
      <button onClick={submit} disabled={loading||!orgName} style={{width:"100%",padding:"12px",marginTop:16,background:loading||!orgName?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>{loading?"Creating…":"Continue →"}</button>
    </div>
  </div>);
};

const SettingsModal = ({orgId,myUserId,myRole,isAdmin,isTeamOrg,onClose}) => {
  // Team Admin/Manager Rework: on a team_5/10/15 org, Team and Billing move to the new
  // full-page AdminPortalScreen (matching team-admin-manager-mockup.html) -- this modal
  // stops offering them here so there's no lingering second path to the same controls.
  // General (org name/logo/stage labels) has no mockup-specified replacement yet, so it
  // stays reachable from here for every org, Team included.
  const showTeamTab=isAdmin&&!isTeamOrg;
  const showBillingTab=isAdmin&&!isTeamOrg;
  const [tab,setTab]=useState(showTeamTab?"team":isAdmin?"general":"profile");
  const [members,setMembers]=useState([]);
  const [invites,setInvites]=useState([]);
  const [org,setOrg]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [inviteName,setInviteName]=useState("");
  const [inviteEmail,setInviteEmail]=useState("");
  const [inviteIsManager,setInviteIsManager]=useState(false);
  const [inviteLoading,setInviteLoading]=useState(false);
  const [inviteResult,setInviteResult]=useState(null); // {email,code,activationUrl} shown once after a successful provision
  const [resendingId,setResendingId]=useState(null);
  const [orgName,setOrgName]=useState("");
  const [stageLabelsDraft,setStageLabelsDraft]=useState(DEFAULT_STAGE_LABELS);
  const [postSignatureStageLabelsDraft,setPostSignatureStageLabelsDraft]=useState(DEFAULT_POST_SIGNATURE_STAGE_LABELS);
  const [logoUploading,setLogoUploading]=useState(false);
  const [myProfileData,setMyProfileData]=useState(null);
  const [profileDraft,setProfileDraft]=useState({fullName:"",title:"",phone:"",linkedin:"",calendly:""});
  const [avatarUploading,setAvatarUploading]=useState(false);
  const [billingLoading,setBillingLoading]=useState(false);
  const [billingError,setBillingError]=useState("");

  const load=async()=>{
    setLoading(true);setError("");
    const [{data:mem,error:memErr},{data:inv,error:invErr},{data:orgRow,error:orgErr},{data:myProf,error:myProfErr}]=await Promise.all([
      sb.from("organization_members").select("id,user_id,role,status,is_admin,is_manager,created_at").eq("org_id",orgId),
      sb.from("org_invitations").select("id,email,role,created_at,expires_at").eq("org_id",orgId).is("accepted_at",null),
      sb.from("organizations").select("name,logo_url,deal_room_limit,subscription_status,trial_ends_at,current_period_end,stripe_subscription_id,stage_labels,post_signature_stage_labels").eq("id",orgId).single(),
      sb.from("profiles").select("full_name,email,title,phone,linkedin_url,calendly_url,avatar_url").eq("id",myUserId).single(),
    ]);
    if(memErr||invErr||orgErr||myProfErr){setError("Couldn't load settings");setLoading(false);return;}
    // organization_members and profiles both reference auth.users independently -- no
    // direct FK between them, so PostgREST can't embed this in one query. Same
    // merge-in-JS pattern already used for view stats/visits in the main loading effect.
    const userIds=(mem||[]).map(m=>m.user_id);
    const {data:profiles}=userIds.length?await sb.from("profiles").select("id,email,full_name").in("id",userIds):{data:[]};
    const profileById=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
    setMembers((mem||[]).map(m=>({...m,email:profileById[m.user_id]?.email,fullName:profileById[m.user_id]?.full_name})));
    setInvites(inv||[]);
    setOrg(orgRow);
    setOrgName(orgRow?.name||"");
    setStageLabelsDraft({...DEFAULT_STAGE_LABELS,...(orgRow?.stage_labels||{})});
    setPostSignatureStageLabelsDraft({...DEFAULT_POST_SIGNATURE_STAGE_LABELS,...(orgRow?.post_signature_stage_labels||{})});
    setMyProfileData(myProf);
    setProfileDraft({fullName:myProf?.full_name||"",title:myProf?.title||"",phone:myProf?.phone||"",linkedin:myProf?.linkedin_url||"",calendly:myProf?.calendly_url||""});
    setLoading(false);
  };
  useEffect(()=>{load();},[orgId]);

  // Deactivation (Data model #6/#5): if the target holds any bivys, Admin must pick a
  // successor and every bivy moves in one blind bulk RPC call before status flips --
  // Admin never sees deal names/values/stages, only the count fetched below.
  const [deactivateTarget,setDeactivateTarget]=useState(null);
  const [deactivateDealCount,setDeactivateDealCount]=useState(null);
  const [deactivateSuccessor,setDeactivateSuccessor]=useState("");
  const [deactivateLoading,setDeactivateLoading]=useState(false);

  const openDeactivate=async member=>{
    setDeactivateTarget(member);setDeactivateSuccessor("");setDeactivateDealCount(null);
    // Count-only RPC (0045), not a direct deals query -- deals_select RLS (0041) is
    // current_org_is_manager OR assigned_to=self OR solo, none of which a real Admin
    // (is_manager false) satisfies for a teammate's deals, so a raw head-count query
    // silently returned 0 here regardless of how many bivys the target actually held.
    const {data:counts}=await sb.rpc("admin_deal_counts_by_user",{p_org_id:orgId});
    const row=(counts||[]).find(c=>c.user_id===member.user_id);
    setDeactivateDealCount(row?Number(row.deal_count):0);
  };
  const confirmDeactivate=async()=>{
    if(deactivateDealCount>0&&!deactivateSuccessor)return;
    setDeactivateLoading(true);
    if(deactivateDealCount>0){
      const {error:rpcErr}=await sb.rpc("blind_reassign_all_deals",{p_org_id:orgId,p_from_user:deactivateTarget.user_id,p_to_user:deactivateSuccessor});
      if(rpcErr){setError(rpcErr.message||"Couldn't reassign this teammate's bivys");setDeactivateLoading(false);return;}
    }
    const {error:updErr}=await sb.from("organization_members").update({status:"deactivated"}).eq("id",deactivateTarget.id);
    setDeactivateLoading(false);
    if(updErr){setError("Couldn't deactivate this teammate");return;}
    setDeactivateTarget(null);
    load();
  };

  // Team Admin/Manager Rework, Data model #1: invite = real account/bivy provisioning, not
  // a passive org_invitations row -- see provision-teammate.mts. Goes through that Netlify
  // function (Admin API for the auth.users creation, not a client-side table insert) rather
  // than this modal talking to Supabase directly, since account creation needs privilege no
  // plain client session has.
  const sendInvite=async()=>{
    if(!inviteName.trim()||!inviteEmail.trim())return;
    setInviteLoading(true);setError("");setInviteResult(null);
    const {data:{session}}=await sb.auth.getSession();
    try{
      const res=await fetch("/api/provision-teammate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        orgId,accessToken:session?.access_token,fullName:inviteName.trim(),email:inviteEmail.trim(),isManager:inviteIsManager,
      })});
      const data=await res.json();
      if(!res.ok){setError(data.message||data.error||"Couldn't add teammate");setInviteLoading(false);return;}
      setInviteResult(data);
      setInviteName("");setInviteEmail("");setInviteIsManager(false);
      load();
    }catch{
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setInviteLoading(false);
  };
  // Pure Postgres RPC (0044) -- doesn't touch auth.users at all under the revised design
  // (the code is verified against its own hash, never the rep's literal Supabase password),
  // so no Netlify function is needed for this one, unlike the initial provisioning step.
  const resendCode=async userId=>{
    setResendingId(userId);setError("");setInviteResult(null);
    const {data,error:err}=await sb.rpc("resend_teammate_code",{p_org_id:orgId,p_user_id:userId});
    if(err){setError(err.message||"Couldn't resend code");setResendingId(null);return;}
    setInviteResult({...data,activationUrl:`${window.location.origin}/?activate=${encodeURIComponent(data.email)}`});
    setResendingId(null);
  };
  const cancelInvite=async id=>{await sb.from("org_invitations").delete().eq("id",id);load();};
  // Admin is not assignable from this control (spec: "there's effectively one Admin per
  // org today, the converted owner") -- this only ever toggles is_manager, Manager vs Rep.
  const changeManagerFlag=async(memberId,makeManager)=>{await sb.from("organization_members").update({is_manager:makeManager}).eq("id",memberId);load();};

  const saveOrgName=async()=>{
    const {error:err}=await sb.from("organizations").update({name:orgName}).eq("id",orgId);
    if(err){setError("Couldn't update organization name");return;}
    setError("");load();
  };

  const saveStageLabels=async()=>{
    const {error:err}=await sb.from("organizations").update({stage_labels:stageLabelsDraft}).eq("id",orgId);
    if(err){setError("Couldn't update stage labels");return;}
    setError("");load();
  };

  const savePostSignatureStageLabels=async()=>{
    const {error:err}=await sb.from("organizations").update({post_signature_stage_labels:postSignatureStageLabelsDraft}).eq("id",orgId);
    if(err){setError("Couldn't update post-signature stage labels");return;}
    setError("");load();
  };

  const uploadLogo=async file=>{
    setLogoUploading(true);
    const path=`${orgId}/logo`;
    const {error:upErr}=await sb.storage.from("org-logos").upload(path,file,{upsert:true,contentType:file.type});
    if(upErr){setError("Couldn't upload logo");setLogoUploading(false);return;}
    const {data:{publicUrl}}=sb.storage.from("org-logos").getPublicUrl(path);
    // upsert:true replaces the file at this same fixed path -- the URL itself never
    // changes, so without a cache-buster the browser just keeps showing whatever it
    // already had cached at that address on re-upload.
    const bustedUrl=`${publicUrl}?t=${Date.now()}`;
    const {error:rpcErr}=await sb.rpc("set_org_logo",{p_org_id:orgId,p_logo_url:bustedUrl});
    if(rpcErr){setError("Couldn't save logo");setLogoUploading(false);return;}
    setLogoUploading(false);load();
  };

  const saveMyProfile=async()=>{
    const {error:err}=await sb.from("profiles").update({
      full_name:profileDraft.fullName||null,title:profileDraft.title||null,
      phone:profileDraft.phone||null,linkedin_url:profileDraft.linkedin||null,
      calendly_url:profileDraft.calendly||null,
    }).eq("id",myUserId);
    if(err){setError("Couldn't save profile");return;}
    setError("");load();
  };

  // Self-scoped bucket (0016) -- own path, own RLS, no admin-only gate like org logos.
  const uploadAvatar=async file=>{
    setAvatarUploading(true);
    const path=`${myUserId}/avatar`;
    const {error:upErr}=await sb.storage.from("avatars").upload(path,file,{upsert:true,contentType:file.type});
    if(upErr){setError("Couldn't upload photo");setAvatarUploading(false);return;}
    const {data:{publicUrl}}=sb.storage.from("avatars").getPublicUrl(path);
    // Same fixed-path cache-busting fix as uploadLogo above.
    const bustedUrl=`${publicUrl}?t=${Date.now()}`;
    const {error:updErr}=await sb.from("profiles").update({avatar_url:bustedUrl}).eq("id",myUserId);
    if(updErr){setError("Couldn't save photo");setAvatarUploading(false);return;}
    setAvatarUploading(false);load();
  };

  // Both hit Netlify functions that forward this token so Postgres RLS (owner-only on
  // organizations, membership-only on organization_members) does the real authorization --
  // see create-checkout-session.mts/create-portal-session.mts. Fetched fresh here rather
  // than threaded in as a prop, same as ProspectLogin's own sb.auth.getSession() calls.
  const openCheckout=async()=>{
    setBillingLoading(true);setBillingError("");
    const {data:{session}}=await sb.auth.getSession();
    try{
      const res=await fetch("/api/create-checkout-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orgId,accessToken:session.access_token})});
      const data=await res.json();
      if(!res.ok||!data.url){setBillingError(data.error||"Couldn't start checkout");setBillingLoading(false);return;}
      window.location.href=data.url;
    }catch{setBillingError("Couldn't start checkout");setBillingLoading(false);}
  };
  const openPortal=async()=>{
    setBillingLoading(true);setBillingError("");
    const {data:{session}}=await sb.auth.getSession();
    try{
      const res=await fetch("/api/create-portal-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orgId,accessToken:session.access_token})});
      const data=await res.json();
      if(!res.ok||!data.url){setBillingError(data.error||"Couldn't open billing portal");setBillingLoading(false);return;}
      window.location.href=data.url;
    }catch{setBillingError("Couldn't open billing portal");setBillingLoading(false);}
  };

  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};

  return (<>
  <div style={{position:"fixed",inset:0,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:620,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{padding:"20px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div className="headline" style={{fontSize:19,color:P.text}}>Team &amp; Settings</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{padding:"14px 24px 0",display:"flex",gap:4,borderBottom:`1px solid ${P.border}`}}>
        {/* Bug 1 fix: My Profile is never gated -- every signed-in person can reach their
            own profile (this is also what feeds the prospect-facing rep card, 0037). Team/
            General/Billing are isAdmin-only now, not myRole==="owner" -- a Manager or Rep
            sees only the My Profile tab, matching "Rep's own settings stay scoped to
            profile only" and "Manager... cannot deactivate an account, change anyone's
            role, or see billing in any form." */}
        {[...(showTeamTab?[["team","Team"]]:[]),...(isAdmin?[["general","General"]]:[]),["profile","My Profile"],...(showBillingTab?[["billing","Billing"]]:[])].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:"8px 14px",background:"none",border:"none",borderBottom:`2px solid ${tab===k?P.accent:"transparent"}`,color:tab===k?P.accent:P.textSec,fontSize:13,fontWeight:tab===k?700:400,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      <div style={{padding:24}}>
        {error&&<div style={{fontSize:12,color:P.red,marginBottom:14,padding:"8px 12px",background:P.redBg,border:`1px solid ${P.redBorder}`,borderRadius:6}}>{error}</div>}
        {loading?<div style={{color:P.textMute,fontSize:13,textAlign:"center",padding:20}}>Loading…</div>:<>
        {tab==="team"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Members</div>
          {/* Reaching this tab at all already means isAdmin -- no per-row canManage check
              needed, every other row is this Admin's to manage. Admin isn't an assignable
              role here (spec: "there's effectively one Admin per org today"), so the only
              live control is Manager vs Rep via is_manager. */}
          {members.map(m=>(
            <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${P.bg}`,opacity:m.status==="deactivated"?0.55:1}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:P.text}}>{m.fullName||m.email||"Unknown"}</div>
                <div style={{fontSize:11,color:P.textMute}}>{m.email}</div>
              </div>
              {m.status==="invited"&&<Badge small label="invited" color={P.amber} bg={P.amberBg} border={P.amberBorder}/>}
              {m.status==="deactivated"&&<Badge small label="deactivated" color={P.textMute} bg={P.bg} border={P.border}/>}
              {m.user_id===myUserId?<Badge small label="admin" color={P.accent} bg={P.accentLight} border="#F0C9B7"/>
              :m.is_admin?<Badge small label="admin" color={P.textSec} bg={P.bg} border={P.border}/>
              :m.status==="deactivated"?<Badge small label={m.is_manager?"manager":"rep"} color={P.textSec} bg={P.bg} border={P.border}/>
              :(<>
                <select value={m.is_manager?"manager":"rep"} onChange={e=>changeManagerFlag(m.id,e.target.value==="manager")} style={{...inp,width:100,padding:"5px 8px",fontSize:11}}>
                  <option value="rep">Rep</option>
                  <option value="manager">Manager</option>
                </select>
                <button onClick={()=>openDeactivate(m)} style={{background:"none",border:"none",color:P.red,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Deactivate</button>
              </>)}
            </div>
          ))}

          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",margin:"20px 0 10px"}}>Invite a teammate</div>
          {/* TEMPORARY LOCKDOWN, reason updated: the original list (profile access, reassign
              confirmation, navigation dead-end) is now fixed -- Bugs 1/2/3 are all closed
              above. What's NOT built yet is Team billing/checkout (punch list #11): a
              solo org's plan_tier stays 'trial' no matter how many people join it, and
              enforce_seat_cap (0043) only fires for team_5/10/15 -- a 'trial' org has no
              cap at all. Lifting this gate today would let any Solo customer add unlimited
              teammates for free, indefinitely, with zero monetization -- a real business
              gap, not a code-quality one. Keep this in place until the Solo/Team activation
              split and the Team checkout flow exist and can convert an org's plan_tier to
              a real paid band before (or as part of) its first invite. The org that's
              already multi-member (used for iterating on Team features) is deliberately
              left working; everyone else can't reach this at all. The invite mechanism
              itself (provision-teammate.mts, this section below) is the real, reviewed,
              now fully live-tested Data model #1 implementation, not a placeholder -- only
              the *availability* is still gated, not the flow's correctness. */}
          {members.length===1?
            <div style={{fontSize:12,color:P.textSec,lineHeight:1.6,marginBottom:16,padding:"10px 12px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:8}}>Team invites are temporarily unavailable while we finish testing the Team features. Check back soon.</div>
          :<>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <input placeholder="Full name" value={inviteName} onChange={e=>setInviteName(e.target.value)} style={{...inp,flex:1}}/>
              <input placeholder="teammate@company.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} style={{...inp,flex:1}}/>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
              <select value={inviteIsManager?"manager":"rep"} onChange={e=>setInviteIsManager(e.target.value==="manager")} style={{...inp,width:110}}>
                <option value="rep">Rep</option>
                <option value="manager">Manager</option>
              </select>
              <button onClick={sendInvite} disabled={inviteLoading||!inviteName.trim()||!inviteEmail.trim()} style={{padding:"9px 16px",background:inviteLoading?P.border:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:inviteLoading?"not-allowed":"pointer",whiteSpace:"nowrap"}}>{inviteLoading?"Please wait…":"Invite"}</button>
            </div>
            <div style={{fontSize:11,color:P.textMute,lineHeight:1.6,marginBottom:16}}>Creates their account and bivy immediately. Share the code below with them yourself (or the link, which skips typing it in) -- they'll also get an activation email, when it lands.</div>
          </>}

          {inviteResult&&<div style={{marginBottom:16,padding:"12px 14px",background:P.accentLight,border:"1px solid #F0C9B7",borderRadius:8}}>
            <div style={{fontSize:11,fontWeight:700,color:P.accentMid,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>{inviteResult.email}</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div className="mono" style={{fontSize:22,fontWeight:700,letterSpacing:"0.2em",color:P.text}}>{inviteResult.code}</div>
              <button onClick={()=>navigator.clipboard.writeText(inviteResult.code)} style={{padding:"5px 10px",background:P.surface,border:`1px solid ${P.border}`,borderRadius:6,fontSize:11,color:P.textSec,cursor:"pointer"}}>Copy code</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>navigator.clipboard.writeText(inviteResult.activationUrl)} style={{padding:"5px 10px",background:P.surface,border:`1px solid ${P.border}`,borderRadius:6,fontSize:11,color:P.textSec,cursor:"pointer"}}>Copy activation link</button>
              <button onClick={()=>setInviteResult(null)} style={{background:"none",border:"none",color:P.textMute,fontSize:11,cursor:"pointer"}}>Dismiss</button>
            </div>
          </div>}

          {members.some(m=>m.status==="invited")&&<>
            <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Awaiting activation</div>
            {members.filter(m=>m.status==="invited").map(m=>(
              <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0"}}>
                <div style={{flex:1,fontSize:13,color:P.text}}>{m.fullName||m.email}</div>
                <button onClick={()=>resendCode(m.user_id)} disabled={resendingId===m.user_id} style={{background:"none",border:"none",color:resendingId===m.user_id?P.textMute:P.accent,fontSize:11,fontWeight:600,cursor:resendingId===m.user_id?"not-allowed":"pointer"}}>{resendingId===m.user_id?"Sending…":"Resend code"}</button>
              </div>
            ))}
          </>}

          {invites.length>0&&<>
            <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Pending invites (legacy)</div>
            {invites.map(i=>(
              <div key={i.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0"}}>
                <div style={{flex:1,fontSize:13,color:P.text}}>{i.email}</div>
                <Badge small label={i.role} color={P.textSec} bg={P.bg} border={P.border}/>
                <button onClick={()=>cancelInvite(i.id)} style={{background:"none",border:"none",color:P.textMute,fontSize:11,cursor:"pointer"}}>Cancel</button>
              </div>
            ))}
          </>}
        </div>}

        {tab==="general"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Organization Name</div>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            <input value={orgName} onChange={e=>setOrgName(e.target.value)} disabled={myRole!=="owner"} style={{...inp,opacity:myRole!=="owner"?0.6:1}}/>
            {myRole==="owner"&&<button onClick={saveOrgName} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>}
          </div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Logo</div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            {org?.logo_url?<img src={org.logo_url} alt="Org logo" style={{width:52,height:52,borderRadius:10,objectFit:"cover",border:`1px solid ${P.border}`}}/>
            :<div style={{width:52,height:52,borderRadius:10,background:P.bg,border:`1px solid ${P.border}`}}/>}
            <label style={{padding:"8px 16px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,fontSize:12,fontWeight:600,color:P.textSec,cursor:"pointer"}}>
              {logoUploading?"Uploading…":"Upload logo"}
              <input type="file" accept="image/*" onChange={e=>e.target.files[0]&&uploadLogo(e.target.files[0])} style={{display:"none"}} disabled={logoUploading}/>
            </label>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",margin:"20px 0 8px"}}>Stage Labels</div>
          <div style={{fontSize:11.5,color:P.textMute,lineHeight:1.5,marginBottom:12}}>Renames each stage everywhere it appears (the Action Plan stepper and its task-group header) -- the 5 stages themselves can't be added to or removed.</div>
          {STAGE_DEFS.map(s=>(
            <div key={s.key} style={{marginBottom:10}}>
              <input value={stageLabelsDraft[s.key]} onChange={e=>setStageLabelsDraft(d=>({...d,[s.key]:e.target.value}))} disabled={myRole!=="owner"} placeholder={DEFAULT_STAGE_LABELS[s.key]} style={{...inp,opacity:myRole!=="owner"?0.6:1}}/>
            </div>
          ))}
          {myRole==="owner"&&<button onClick={saveStageLabels} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save Stage Labels</button>}

          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",margin:"20px 0 8px"}}>Post-Signature Stage Labels</div>
          <div style={{fontSize:11.5,color:P.textMute,lineHeight:1.5,marginBottom:12}}>Renames each stage in the Post-Signature view -- same non-destructive rename as the Close Sequence: existing Experience items keep their phase, only the label changes.</div>
          {POST_SIGNATURE_STAGE_DEFS.map(s=>(
            <div key={s.key} style={{marginBottom:10}}>
              <input value={postSignatureStageLabelsDraft[s.key]} onChange={e=>setPostSignatureStageLabelsDraft(d=>({...d,[s.key]:e.target.value}))} disabled={myRole!=="owner"} placeholder={DEFAULT_POST_SIGNATURE_STAGE_LABELS[s.key]} style={{...inp,opacity:myRole!=="owner"?0.6:1}}/>
            </div>
          ))}
          {myRole==="owner"&&<button onClick={savePostSignatureStageLabels} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save Post-Signature Stage Labels</button>}
        </div>}

        {tab==="profile"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Photo</div>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
            {myProfileData?.avatar_url?<img src={myProfileData.avatar_url} alt="Your photo" style={{width:52,height:52,borderRadius:"50%",objectFit:"cover",border:`1px solid ${P.border}`}}/>
            :<div style={{width:52,height:52,borderRadius:"50%",background:P.accentLight,color:P.accentMid,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700}}>{initialsOf(profileDraft.fullName||myProfileData?.email||"")||"?"}</div>}
            <label style={{padding:"8px 16px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,fontSize:12,fontWeight:600,color:P.textSec,cursor:"pointer"}}>
              {avatarUploading?"Uploading…":"Upload photo"}
              <input type="file" accept="image/*" onChange={e=>e.target.files[0]&&uploadAvatar(e.target.files[0])} style={{display:"none"}} disabled={avatarUploading}/>
            </label>
          </div>
          <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:6}}>Name</label><input value={profileDraft.fullName} onChange={e=>setProfileDraft(d=>({...d,fullName:e.target.value}))} style={inp}/></div>
          <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:6}}>Title</label><input value={profileDraft.title} onChange={e=>setProfileDraft(d=>({...d,title:e.target.value}))} placeholder="Sr. Account Executive" style={inp}/></div>
          <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:6}}>Phone</label><input value={profileDraft.phone} onChange={e=>setProfileDraft(d=>({...d,phone:e.target.value}))} style={inp}/></div>
          <div style={{marginBottom:20}}><label style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:6}}>LinkedIn URL</label><input value={profileDraft.linkedin} onChange={e=>setProfileDraft(d=>({...d,linkedin:e.target.value}))} style={inp}/></div>
          <div style={{marginBottom:20}}><label style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",display:"block",marginBottom:6}}>Your Scheduling Link</label><input value={profileDraft.calendly} onChange={e=>setProfileDraft(d=>({...d,calendly:e.target.value}))} placeholder="https://calendly.com/you" style={inp}/></div>
          <div style={{fontSize:11,color:P.textMute,lineHeight:1.6,marginBottom:16}}>This is what your prospects see on the Welcome tab of any deal room you create.</div>
          <button onClick={saveMyProfile} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save Profile</button>
        </div>}

        {tab==="billing"&&myRole==="owner"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Plan</div>
          {(()=>{
            const status=org?.subscription_status||"trialing";
            const hasSubscription=!!org?.stripe_subscription_id;
            const daysLeft=org?.trial_ends_at?Math.max(0,Math.ceil((new Date(org.trial_ends_at)-new Date())/86400000)):null;
            // Once a real Stripe subscription exists, never show the pre-subscription
            // "Free trial — N days left" language again (Mark: subscribing should be a
            // one-way door away from free-trial wording), even while status is still
            // "trialing" during the Early Activation Promo's 2 free months.
            const label=status==="active"?"Active subscription"
              :status==="past_due"?"Payment failed"
              :status==="trialing"&&hasSubscription?"Trial — Early Activation Promo"
              :status==="trialing"?(daysLeft>0?`Free trial — ${daysLeft} day${daysLeft===1?"":"s"} left`:"Trial ended")
              :"Trial ended";
            return (<>
              <div style={{fontSize:14,fontWeight:700,color:status==="past_due"||(status==="trialing"&&!hasSubscription&&daysLeft===0)?P.red:P.text,marginBottom:4}}>{label}</div>
              {status==="active"&&org?.current_period_end&&<div style={{fontSize:12,color:P.textMute,marginBottom:16}}>Renews {new Date(org.current_period_end).toLocaleDateString()}</div>}
              {status==="trialing"&&hasSubscription&&org?.current_period_end&&<div style={{fontSize:12,color:P.textMute,marginBottom:16}}>First charge {new Date(org.current_period_end).toLocaleDateString()}</div>}
              {!hasSubscription&&<div style={{fontSize:12,color:P.textMute,marginBottom:16}}>myBivy is a single paid plan, up to {org?.deal_room_limit||10} active deal rooms.</div>}
            </>);
          })()}
          {billingError&&<div style={{fontSize:12,color:P.red,marginBottom:12,padding:"8px 12px",background:P.redBg,border:`1px solid ${P.redBorder}`,borderRadius:6}}>{billingError}</div>}
          {org?.stripe_subscription_id?
            <button onClick={openPortal} disabled={billingLoading} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:billingLoading?"not-allowed":"pointer",opacity:billingLoading?0.6:1}}>{billingLoading?"Please wait…":"Manage Billing"}</button>
          :<button onClick={openCheckout} disabled={billingLoading} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:billingLoading?"not-allowed":"pointer",opacity:billingLoading?0.6:1}}>{billingLoading?"Please wait…":"Upgrade →"}</button>}
        </div>}
        </>}
      </div>
    </div>
  </div>
  {/* Deactivate/blind-reassign modal (Data model #5/#6). Admin never sees a single deal
      name/value/stage here -- deactivateDealCount is a plain count() query, and the
      successor dropdown lists teammates by name only. */}
  {deactivateTarget&&<div style={{position:"fixed",inset:0,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100}}>
    <div style={{background:P.surface,borderRadius:16,width:420,padding:24,boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div className="headline" style={{fontSize:18,color:P.text,marginBottom:8}}>{deactivateDealCount>0?"Deactivate ":"Remove "}{deactivateTarget.fullName||deactivateTarget.email}</div>
      {deactivateDealCount===null?
        <div style={{fontSize:13,color:P.textMute,padding:"10px 0"}}>Checking their bivys…</div>
      :deactivateDealCount>0?(<>
        <div style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:16}}>This won't show you what's inside any bivy. Choose who takes over their {deactivateDealCount} active bivy{deactivateDealCount===1?"":"s"} before their access is removed.</div>
        <select value={deactivateSuccessor} onChange={e=>setDeactivateSuccessor(e.target.value)} style={{width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,marginBottom:16}}>
          <option value="">Choose a successor…</option>
          {members.filter(m=>m.user_id!==deactivateTarget.user_id&&m.status==="active").map(m=><option key={m.user_id} value={m.user_id}>Move all bivys to {m.fullName||m.email}</option>)}
        </select>
      </>):
        <div style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:16}}>{deactivateTarget.fullName||deactivateTarget.email} has no bivys of their own, there's nothing to hand off.</div>
      }
      <div style={{fontSize:12,color:P.textMute,lineHeight:1.6,marginBottom:18}}>This immediately removes their access to myBivy. This can't be undone from here.</div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={confirmDeactivate} disabled={deactivateLoading||deactivateDealCount===null||(deactivateDealCount>0&&!deactivateSuccessor)} style={{flex:1,padding:"11px 20px",background:deactivateLoading?P.border:P.red,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:deactivateLoading?"not-allowed":"pointer"}}>{deactivateLoading?"Please wait…":deactivateDealCount>0?"Deactivate":"Remove"}</button>
        <button onClick={()=>setDeactivateTarget(null)} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </div>
  </div>}
  </>);
};

// Shown once, over the empty "no deal rooms yet" state, the first time an org's owner logs
// in -- gated by organizations.onboarding_seen (0023), not a one-time in-memory flag, so it
// still shows correctly even if they close the tab before dismissing it. Content/layout
// lifted directly from mybivy-welcome-screen-overlay-mockup.html.
const WelcomeOverlay = ({onDone}) => {
  const [tooltipOpen,setTooltipOpen]=useState(false);
  return (<div style={{position:"fixed",inset:0,background:"rgba(20,22,25,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:24}}>
    <div style={{width:"100%",maxWidth:560,background:P.surface,borderRadius:20,boxShadow:"0 30px 80px rgba(0,0,0,0.35)",overflow:"hidden"}}>
      <div style={{padding:"40px 40px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:6,position:"relative"}}>
          <div onClick={()=>setTooltipOpen(v=>!v)} style={{width:52,height:52,borderRadius:14,background:P.ink,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer"}}>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M13 4L23 21H16.5L13 15L9.5 21H3L13 4Z" stroke={P.accent} strokeWidth="1.8" strokeLinejoin="round"/>
              <path d="M13 15L11 21H15L13 15Z" fill={P.chalk}/>
              <path d="M3 21H23" stroke={P.chalk} strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="headline" style={{fontSize:34,color:P.text,lineHeight:1.05}}>Welcome to your Bivy.</div>
          {tooltipOpen&&<div style={{position:"absolute",top:62,left:0,width:320,background:P.ink,color:P.chalk,fontSize:13,lineHeight:1.55,padding:"14px 16px",borderRadius:10,boxShadow:"0 12px 30px rgba(0,0,0,0.3)",zIndex:10}}>
            <b style={{color:P.accent}}>bivy</b> (noun) — a temporary base camp where an expedition readies before the final push to the summit.
          </div>}
        </div>
        <p style={{fontSize:15.5,color:P.textSec,margin:"14px 0 0",lineHeight:1.5}}>You're ready to create and share deal rooms.</p>
      </div>
      <div style={{padding:"28px 40px 8px"}}>
        {[["1",<>Complete your profile in <b>Settings</b></>],["2",<>Create your <b>first deal room</b></>],["3",<>Share it with your prospect and <b>align on your sequence of events</b></>]].map(([num,text],i)=>(
          <div key={num} style={{display:"flex",alignItems:"flex-start",gap:14,padding:"16px 0",borderTop:i===0?"none":`1px solid ${P.border}`}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:P.chalk,color:P.text,fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{num}</div>
            <div style={{fontSize:14.5,color:P.text,lineHeight:1.5,paddingTop:3}}>{text}</div>
          </div>
        ))}
      </div>
      <div style={{padding:"24px 40px 40px"}}>
        <button onClick={onDone} style={{width:"100%",padding:14,background:P.accent,border:"none",borderRadius:10,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>Get Started →</button>
      </div>
    </div>
  </div>);
};

// The deal's share_slug/access_code were being generated and stored (createDeal) but
// never surfaced anywhere in the UI -- a rep had no way to actually hand a prospect their
// link without going into Supabase directly. This is that missing affordance.
const ShareModal = ({deal,onClose,forProspect}) => {
  const [copied,setCopied]=useState(null); // "link" | "code" | null
  const link=`${window.location.origin}/d/${deal.shareSlug}`;
  const copy=(text,which)=>{navigator.clipboard.writeText(text);setCopied(which);setTimeout(()=>setCopied(null),1800);};
  const row={display:"flex",alignItems:"center",gap:8,border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",background:P.bg};
  const btn={padding:"7px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:480,padding:"24px 24px 28px",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Share this Deal Room</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      {/* Same link/code, same mechanism, either audience -- only the framing differs: a rep
          is sending this out, a prospect is forwarding to their own colleagues. */}
      <div style={{fontSize:12.5,color:P.textMute,marginBottom:18,lineHeight:1.5}}>{forProspect?`Share this link and access code with your colleagues to keep them in the loop on ${deal.company}.`:`Send your prospect this link and access code. They'll use both to get into their private view of ${deal.company}.`}</div>
      <div style={lbl0}>Prospect Link</div>
      <div style={{...row,marginBottom:14}}>
        <span style={{flex:1,fontSize:12.5,color:P.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{link}</span>
        <button onClick={()=>copy(link,"link")} style={btn}>{copied==="link"?"Copied ✓":"Copy"}</button>
      </div>
      <div style={lbl0}>Access Code</div>
      <div style={row}>
        <span className="mono" style={{flex:1,fontSize:14,fontWeight:700,color:P.text,letterSpacing:"0.08em"}}>{deal.accessCode}</span>
        <button onClick={()=>copy(deal.accessCode,"code")} style={btn}>{copied==="code"?"Copied ✓":"Copy"}</button>
      </div>
    </div>
  </div>);
};
const lbl0={fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6};

// Renders a Google Slides/Docs/Sheets embed inline via iframe -- the whole reason embed-type
// documents exist as a distinct thing from uploaded files (which mint a signed URL and open
// in a new tab instead; see openDocument).
const EmbedModal = ({doc,onClose}) => {
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:24}}>
    <div style={{background:P.surface,borderRadius:16,width:"100%",maxWidth:960,boxShadow:"0 24px 64px rgba(0,0,0,0.2)",overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:`1px solid ${P.border}`}}>
        <span style={{fontSize:14,fontWeight:700,color:P.text}}>{doc.title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <iframe src={doc.embedUrl} title={doc.title} style={{width:"100%",height:"70vh",border:"none"}} allowFullScreen/>
    </div>
  </div>);
};

// "Add Link" -- converts a normal Google share link (parseGoogleDocUrl) instead of requiring
// the obscure Publish-to-web embed URL. Title has no filename to borrow the way file upload
// does, so it's a real (pre-filled, editable) field rather than derived.
const AddEmbedModal = ({onSave,onClose}) => {
  const [url,setUrl]=useState("");
  const [title,setTitle]=useState("");
  const [error,setError]=useState("");
  const handleUrlChange=val=>{
    setUrl(val);setError("");
    if(!title){
      const parsed=parseGoogleDocUrl(val);
      if(parsed)setTitle(parsed.fileType==="pptx"?"Untitled Slides":parsed.fileType==="xlsx"?"Untitled Sheet":"Untitled Doc");
    }
  };
  const submit=()=>{
    const parsed=parseGoogleDocUrl(url);
    if(!parsed){setError("That doesn't look like a Google Slides, Docs, or Sheets link. Use the URL from that file's own Share button.");return;}
    if(!title.trim()){setError("Give it a title.");return;}
    onSave({title:title.trim(),...parsed});
  };
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:6};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:440,padding:"24px 24px 28px",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Add Google Doc</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{marginBottom:14}}><label style={lbl}>Google Slides / Docs / Sheets link</label>
        <input value={url} onChange={e=>handleUrlChange(e.target.value)} placeholder="https://docs.google.com/presentation/d/.../edit?usp=sharing" style={inp}/></div>
      <div style={{marginBottom:16}}><label style={lbl}>Title</label>
        <input value={title} onChange={e=>setTitle(e.target.value)} style={inp}/></div>
      {error&&<div style={{fontSize:12,color:P.red,marginBottom:14}}>{error}</div>}
      <button onClick={submit} style={{width:"100%",padding:11,background:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Add</button>
    </div>
  </div>);
};

const AddRecordingModal = ({onSave,onClose}) => {
  const [url,setUrl]=useState("");
  const [title,setTitle]=useState("Untitled Recording");
  const [error,setError]=useState("");
  const submit=()=>{
    const parsed=parseZoomRecordingUrl(url);
    if(!parsed){setError("That doesn't look like a Zoom recording link. Use the URL from Zoom's Share button on the recording.");return;}
    if(!title.trim()){setError("Give it a title.");return;}
    onSave({title:title.trim(),url:parsed.url});
  };
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:6};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:440,padding:"24px 24px 28px",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Add Recording</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{marginBottom:14}}><label style={lbl}>Zoom recording link</label>
        <input value={url} onChange={e=>{setUrl(e.target.value);setError("");}} placeholder="https://zoom.us/rec/share/..." style={inp}/></div>
      <div style={{marginBottom:16}}><label style={lbl}>Title</label>
        <input value={title} onChange={e=>setTitle(e.target.value)} style={inp}/></div>
      {error&&<div style={{fontSize:12,color:P.red,marginBottom:14}}>{error}</div>}
      <button onClick={submit} style={{width:"100%",padding:11,background:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Add</button>
    </div>
  </div>);
};

// Permanent, not archive -- confirmed explicitly. Cascades cleanly through every child
// table (stakeholders/tasks/documents/visit logs all have on-delete-cascade FKs to
// deals), so this is one delete call, not a multi-step cleanup -- but it's irreversible,
// so unlike every other delete in this app (task/stakeholder/member all skip
// confirmation), this one requires typing the company name to actually enable the button.
// Note: uploaded files in the deal-documents Storage bucket are not cleaned up by this --
// Storage isn't covered by Postgres FK cascade, so they'd become orphaned objects, not
// errors. Acceptable for now, not fixed here.
const DeleteDealModal = ({deal,onConfirm,onClose}) => {
  const [confirmText,setConfirmText]=useState("");
  const matches=confirmText.trim().toLowerCase()===deal.company.trim().toLowerCase();
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:460,padding:"24px 24px 28px",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Delete Deal Room</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{fontSize:12.5,color:P.textSec,marginBottom:16,lineHeight:1.6}}>This permanently deletes <strong style={{color:P.text}}>{deal.company}</strong> and everything under it — stakeholders, tasks, documents, and visit history. This cannot be undone.</div>
      <div style={lbl0}>Type "{deal.company}" to confirm</div>
      <input value={confirmText} onChange={e=>setConfirmText(e.target.value)} style={{width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none",marginBottom:18}}/>
      <div style={{display:"flex",gap:10}}>
        <button onClick={onConfirm} disabled={!matches} style={{flex:1,padding:"11px 20px",background:matches?P.red:P.border,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:matches?"pointer":"not-allowed"}}>Delete Permanently</button>
        <button onClick={onClose} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </div>
  </div>);
};

// Company name/deal title/value/close date could only ever be set once, at creation --
// no edit path existed afterward, even though value and close date in particular change
// constantly as a real deal progresses.
// members/canReassign are optional (undefined for a plain member, who never gets the
// "Assigned To" control) -- see the deal-settings entry point in DealRoom for how they're
// threaded through. The other entry point for reassignment is the Manager Overview
// drill-in banner (setManagerViewRep + reassignDeal directly), so both surfaces the spec
// suggested ("from the deal's settings, or directly from the Manager Overview") exist.
const EditDealModal = ({deal,members,canReassign,onSave,onClose}) => {
  const [draft,setDraft]=useState({company:deal.company||"",title:deal.title||"",value:(deal.value||"").replace(/[^0-9.]/g,""),closeDate:deal.closeDate||"",assignedTo:deal.assignedTo||""});
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:440,padding:"24px",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Edit Deal</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{marginBottom:12}}><label style={lbl0}>Company Name</label><input value={draft.company} onChange={e=>setDraft(d=>({...d,company:e.target.value}))} style={inp}/></div>
      <div style={{marginBottom:12}}><label style={lbl0}>Deal Title</label><input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))} style={inp}/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:canReassign&&members?.length?12:18}}>
        <div><label style={lbl0}>Value</label><input value={draft.value} onChange={e=>setDraft(d=>({...d,value:e.target.value}))} style={inp}/></div>
        <div><label style={lbl0}>Close Date</label><input type="date" value={draft.closeDate} onChange={e=>setDraft(d=>({...d,closeDate:e.target.value}))} style={inp}/></div>
      </div>
      {canReassign&&members?.length>0&&<div style={{marginBottom:18}}>
        <label style={lbl0}>Assigned To</label>
        <select value={draft.assignedTo} onChange={e=>setDraft(d=>({...d,assignedTo:e.target.value}))} style={inp}>
          {/* assigned_to only nulls out via ON DELETE SET NULL (0033) when the auth.users
              row itself is gone -- removing someone from the org (deleting their
              organization_members row) leaves assigned_to pointing at a user id absent
              from `members`. Without this fallback option, the <select>'s value wouldn't
              match any <option> and the browser would silently render the first member
              as "selected" while draft.assignedTo still held the real (different) id --
              so clicking Save with the dropdown untouched would reassign to whoever
              happened to be first in the list, not a no-op. */}
          {!members.some(m=>m.user_id===draft.assignedTo)&&draft.assignedTo&&<option value={draft.assignedTo}>Former team member</option>}
          {members.map(m=><option key={m.user_id} value={m.user_id}>{m.profile?.full_name||m.profile?.email||"Unnamed"}{m.role!=="member"?` (${m.role})`:""}</option>)}
        </select>
      </div>}
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>{if(!draft.company.trim())return;onSave(draft);}} style={{flex:1,padding:"11px 20px",background:P.accent,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Changes</button>
        <button onClick={onClose} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </div>
  </div>);
};

// Add (editing=null) and edit (editing=existing stakeholder) share this one modal, same
// pattern as DealCreator/SettingsModal/ShareModal. reportsTo excludes the stakeholder
// itself from the options list -- a stakeholder can't report to themselves.
const StakeholderModal = ({editing,allStakeholders,onSave,onClose}) => {
  const blank={name:"",role:"",designation:"influencer",bu:"",email:"",linkedin:"",reportsTo:"",approvalRequired:false};
  const [draft,setDraft]=useState(editing?{name:editing.name,role:editing.role,designation:editing.designation,bu:editing.bu||"",email:editing.email||"",linkedin:editing.linkedin||"",reportsTo:editing.reportsTo||"",approvalRequired:!!editing.approvalRequired}:blank);
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const save=()=>{if(!draft.name.trim())return;onSave({...draft,reportsTo:draft.reportsTo||null});};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:480,maxHeight:"85vh",overflowY:"auto",padding:24,boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>{editing?"Edit Stakeholder":"Add Stakeholder"}</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label style={lbl0}>Name *</label><input value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} style={inp}/></div>
        <div><label style={lbl0}>Role / Title</label><input value={draft.role} onChange={e=>setDraft(d=>({...d,role:e.target.value}))} style={inp}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label style={lbl0}>Designation</label><select value={draft.designation} onChange={e=>setDraft(d=>({...d,designation:e.target.value}))} style={inp}>{Object.keys(DESIG_CFG).map(k=><option key={k} value={k}>{DESIG_CFG[k].label}</option>)}</select></div>
        <div><label style={lbl0}>Business Unit</label><input value={draft.bu} onChange={e=>setDraft(d=>({...d,bu:e.target.value}))} style={inp}/></div>
      </div>
      <div style={{marginBottom:12}}><label style={lbl0}>Email</label><input type="email" value={draft.email} onChange={e=>setDraft(d=>({...d,email:e.target.value}))} placeholder="them@company.com" style={inp}/></div>
      <div style={{marginBottom:12}}><label style={lbl0}>LinkedIn URL</label><input value={draft.linkedin} onChange={e=>setDraft(d=>({...d,linkedin:e.target.value}))} style={inp}/></div>
      <div style={{marginBottom:16}}><label style={lbl0}>Reports To</label>
        <select value={draft.reportsTo} onChange={e=>setDraft(d=>({...d,reportsTo:e.target.value}))} style={inp}>
          <option value="">— None —</option>
          {allStakeholders.filter(s=>!editing||s.id!==editing.id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div style={{marginBottom:20}}><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={draft.approvalRequired} onChange={e=>setDraft(d=>({...d,approvalRequired:e.target.checked}))}/>Approval Required</label></div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={save} style={{flex:1,padding:"11px 20px",background:P.accent,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>{editing?"Save Changes":"Add Stakeholder"}</button>
        <button onClick={onClose} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </div>
  </div>);
};

// Opened by clicking a task's ring in Action Plan -- replaces the old standalone "×"
// delete button, which now lives as an action inside this modal instead.
const TaskModal = ({task,phases,onSave,onDelete,onClose,calendlyAvailable,itemLabel="Task"}) => {
  const [draft,setDraft]=useState({task:task.task,phase:task.phase,owner:task.owner||"",buyerOwner:task.buyerOwner||"",dueDate:task.dueDate||"",status:task.status,notes:task.notes||"",approvalRequired:!!task.approvalRequired,calendlyEnabled:!!task.calendlyEnabled});
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,display:"block"};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:480,maxHeight:"85vh",overflowY:"auto",padding:24,boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Edit {itemLabel}</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{marginBottom:12}}><label style={lbl}>{itemLabel} Name</label><input value={draft.task} onChange={e=>setDraft(d=>({...d,task:e.target.value}))} style={inp}/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label style={lbl}>Phase</label><select value={draft.phase} onChange={e=>setDraft(d=>({...d,phase:e.target.value}))} style={inp}>{phases.map(ph=><option key={ph}>{ph}</option>)}</select></div>
        <div><label style={lbl}>Status</label><select value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value}))} style={inp}><option value="complete">Complete</option><option value="in-progress">In Progress</option><option value="pending">Pending</option></select></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label style={lbl}>Seller</label><input value={draft.owner} onChange={e=>setDraft(d=>({...d,owner:e.target.value}))} style={inp}/></div>
        <div><label style={lbl}>Buyer Owner</label><input value={draft.buyerOwner} onChange={e=>setDraft(d=>({...d,buyerOwner:e.target.value}))} style={inp}/></div>
      </div>
      <div style={{marginBottom:12}}><label style={lbl}>Due Date</label><input type="date" value={draft.dueDate} onChange={e=>setDraft(d=>({...d,dueDate:e.target.value}))} style={inp}/></div>
      <div style={{marginBottom:14}}><label style={lbl}>Notes</label><textarea value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} style={{...inp,height:60,resize:"vertical"}}/></div>
      <div style={{marginBottom:12}}><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={draft.approvalRequired} onChange={e=>setDraft(d=>({...d,approvalRequired:e.target.checked}))}/>Approval Required</label></div>
      <div style={{marginBottom:20}}>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:calendlyAvailable?P.textSec:P.textMute,cursor:calendlyAvailable?"pointer":"not-allowed"}}>
          <input type="checkbox" checked={draft.calendlyEnabled} disabled={!calendlyAvailable} onChange={e=>setDraft(d=>({...d,calendlyEnabled:e.target.checked}))}/>Enable Scheduling
        </label>
        {!calendlyAvailable&&<div style={{fontSize:11,color:P.textMute,marginTop:4,marginLeft:22}}>Set your scheduling link in Settings first</div>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>{if(!draft.task.trim())return;onSave(draft);}} style={{flex:1,padding:"11px 20px",background:P.accent,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Changes</button>
        <button onClick={onClose} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Cancel</button>
        <button onClick={onDelete} style={{padding:"11px 18px",background:"none",border:"none",color:P.red,fontSize:13,fontWeight:600,cursor:"pointer"}}>Delete</button>
      </div>
    </div>
  </div>);
};

// ============ Team Admin/Manager Rework -- visual layer ============
// team-admin-manager-mockup.html is the Mark-approved visual source of truth (see
// TEAM-ADMIN-MANAGER-REWORK-SPEC.md) -- these components match its structure and color
// tokens exactly, wired to real Supabase data/RPCs instead of the mockup's static arrays.
// Only rendered for an org actually on a team_5/10/15 plan_tier (isTeamOrg in DealRoom) --
// a solo org's owner also carries is_admin/is_manager true (0040's solo-safety fix) and
// must never be routed here.
const TP = {
  bg:"#fbfaf8", surface:"#ffffff", surface2:"#f5f3ee",
  border:"#e9e5db", borderStrong:"#d3ccb9",
  text:"#181613", textMute:"#6b6355", textFaint:"#a89d89",
  accent:"#c15a3c", accentStrong:"#9c4530", accentSoft:"#f7e2d3",
  ink:"#171512", red:"#a8564f",
  stage:{Discovery:"#93a6c4",Evaluation:"#8b93b8",Trial:"#a288ab",Proposal:"#b98a94",Negotiation:"#c39a68","Closed Won":"#5f8f74","Closed Lost":"#a89d8c"},
};
const TIER_SEATS={team_5:5,team_10:10,team_15:15};
const TIER_PRICE={team_5:449,team_10:690,team_15:996};
const tpFont={fontFamily:"'Archivo',-apple-system,BlinkMacSystemFont,sans-serif"};
const tpMono={fontFamily:"'IBM Plex Mono',ui-monospace,monospace"};
const tpFmt=n=>"$"+Math.round(n||0).toLocaleString("en-US");
const TPFontImport=()=><style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');`}</style>;

const TPStatTile=({label,value,note,valueColor,borderColor,onClick})=>{
  const Tag=onClick?"button":"div";
  return <Tag onClick={onClick} style={{...tpFont,textAlign:"left",background:TP.surface,border:`1px solid ${TP.border}`,borderTop:`3px solid ${borderColor||TP.text}`,borderRadius:14,padding:"18px 20px",cursor:onClick?"pointer":"default",width:"100%"}}>
    <div style={{fontSize:11.5,textTransform:"uppercase",letterSpacing:"0.07em",color:TP.textFaint,fontWeight:600}}>{label}</div>
    <div style={{...tpMono,fontSize:26,fontWeight:600,marginTop:8,letterSpacing:"-0.01em",color:valueColor||TP.text}}>{value}</div>
    {note&&<div style={{fontSize:12.5,color:TP.textMute,marginTop:4}}>{note}</div>}
  </Tag>;
};

const TPTopbar=({roleLabel,impersonating,onToggleImpersonate,showImpersonateBtn,avatarInitials,onSettings})=>(
  <div style={{display:"flex",alignItems:"center",gap:16,padding:"14px 20px",marginBottom:22,flexWrap:"wrap",background:TP.ink,borderRadius:14}}>
    <div style={{display:"flex",alignItems:"center",gap:9,...tpFont,fontWeight:800,fontSize:19.5,letterSpacing:"-0.01em",color:"#fff"}}>
      <div style={{width:26,height:26,borderRadius:7,background:`linear-gradient(155deg, ${TP.accent}, ${TP.accentStrong})`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{width:15,height:15}}>{LOGO_MARK}</div></div>
      myBivy
    </div>
    <div style={{display:"flex",alignItems:"center",gap:12,marginLeft:"auto",flexWrap:"wrap"}}>
      <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11.5,fontWeight:700,padding:"5px 11px",borderRadius:100,textTransform:"uppercase",letterSpacing:"0.04em",background:impersonating?TP.accentSoft:"rgba(255,255,255,0.08)",border:impersonating?`1px dashed ${TP.accent}`:"1px solid rgba(255,255,255,0.15)",color:impersonating?TP.accentStrong:"rgba(255,255,255,0.75)"}}>{roleLabel}</span>
      {showImpersonateBtn&&<button onClick={onToggleImpersonate} style={{border:`1px solid ${impersonating?TP.accent:"rgba(255,255,255,0.25)"}`,background:impersonating?TP.accent:"rgba(255,255,255,0.08)",color:"#fff",borderRadius:100,fontSize:12.5,fontWeight:600,padding:"6px 13px",cursor:"pointer"}}>{impersonating?"Back to Admin":"View as Manager"}</button>}
      {onSettings&&<button onClick={onSettings} title="Org settings" style={{width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.08)",border:"none",color:"#fff",fontSize:13,cursor:"pointer"}}>⚙</button>}
      <button onClick={()=>sb.auth.signOut()} title="Sign out" style={{background:"none",border:"none",color:"rgba(255,255,255,0.55)",fontSize:11.5,fontWeight:600,cursor:"pointer"}}>Sign out</button>
      <div style={{width:30,height:30,borderRadius:"50%",background:TP.accentSoft,color:TP.accentStrong,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11.5,fontWeight:700,border:`1px solid ${TP.borderStrong}`,flexShrink:0}}>{avatarInitials}</div>
    </div>
  </div>
);

const TPBtn=({children,onClick,kind,disabled,style})=>{
  const kinds={
    primary:{background:TP.accent,color:"#fff",border:`1px solid ${TP.accent}`},
    ghost:{background:TP.surface,color:TP.text,border:`1px solid ${TP.borderStrong}`},
    danger:{background:"none",color:TP.red,border:"none",padding:"4px 2px"},
    text:{background:"none",color:TP.accent,border:"none",padding:"4px 2px"},
  };
  return <button onClick={onClick} disabled={disabled} style={{...tpFont,borderRadius:9,fontSize:13,fontWeight:600,padding:"9px 15px",cursor:disabled?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",gap:7,whiteSpace:"nowrap",opacity:disabled?0.55:1,...kinds[kind||"ghost"],...style}}>{children}</button>;
};

// Reassign, informed (Manager only) -- shows deal name/value/stage while choosing, distinct
// from Admin's blind bulk RPC used only during deactivation. `deals` is either one deal
// (single, from a drill-in dealroom line) or a rep's full list (bulk, from a Team Overview
// row's ⇄ action). Nothing commits until Save -- closes Bug 2's "no silent one-click moves"
// requirement for this surface too.
const ReassignModal=({repName,deals,others,onSave,onClose})=>{
  const [choices,setChoices]=useState({});
  return <div style={{position:"fixed",inset:0,background:"rgba(20,17,12,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1200}}>
    <div style={{...tpFont,background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:18,maxWidth:480,width:"100%",maxHeight:"88vh",overflowY:"auto"}}>
      <div style={{padding:"22px 24px 14px",borderBottom:`1px solid ${TP.border}`}}>
        <div style={{fontSize:17,fontWeight:700,color:TP.text}}>Reassign bivy{deals.length>1?"s":""} — {repName}</div>
        <div style={{fontSize:13,color:TP.textMute,marginTop:6,lineHeight:1.5}}>Choose a new owner. {repName} loses access the moment you save, the new owner gains it.</div>
      </div>
      <div style={{padding:"16px 24px"}}>
        {deals.map(d=>(
          <div key={d.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 0",borderBottom:`1px solid ${TP.border}`}}>
            <div><div style={{fontSize:13.5,fontWeight:600,color:TP.text}}>{d.company}</div><div style={{fontSize:12,color:TP.textMute}}>{d.value} · {d.stage}</div></div>
            <select value={choices[d.id]||""} onChange={e=>setChoices(c=>({...c,[d.id]:e.target.value}))} style={{width:170,border:`1px solid ${TP.border}`,borderRadius:8,padding:"6px 8px",fontSize:12.5,background:TP.surface,color:TP.text}}>
              <option value="">Keep with {repName}</option>
              {others.map(o=><option key={o.user_id} value={o.user_id}>Move to {o.fullName||o.email}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"16px 24px",borderTop:`1px solid ${TP.border}`}}>
        <TPBtn kind="ghost" onClick={onClose}>Cancel</TPBtn>
        <TPBtn kind="primary" onClick={()=>onSave(Object.entries(choices).filter(([,v])=>v))}>Save changes</TPBtn>
      </div>
    </div>
  </div>;
};

// Team Overview (Manager) + Rep drill-in. Rendered whenever isManager is true on a Team
// org -- covers both a genuine Manager teammate and an Admin who's toggled View as
// Manager on (a real permission grant, see toggleViewAsManager; this screen never knows
// or cares which case it is beyond `impersonating`, which only controls the exit banner).
const TeamOverviewScreen=({members,deals,onReassign,impersonating,onToggleImpersonate,avatarInitials})=>{
  const [drillId,setDrillId]=useState(null);
  const [reassignFor,setReassignFor]=useState(null); // null | {repId,repName,deals:[...]}

  const dealsByRep=deals.reduce((acc,d)=>{(acc[d.assignedTo]=acc[d.assignedTo]||[]).push(d);return acc;},{});
  const nameFor=m=>m.profile?.full_name||m.profile?.email||"Unnamed";
  const rows=members
    .map(m=>{
      const repDeals=dealsByRep[m.user_id]||[];
      const activeDeals=repDeals.filter(d=>!CLOSED_DEAL_STAGES.includes(d.stage));
      const pipelineValue=activeDeals.reduce((s,d)=>s+(d.valueAmount||0),0);
      const segCounts={};activeDeals.forEach(d=>{segCounts[d.stage]=(segCounts[d.stage]||0)+1;});
      const segments=DEAL_STAGES.filter(s=>segCounts[s]).map(s=>({stage:s,count:segCounts[s]}));
      return {...m,repDeals,activeDeals,pipelineValue,segments};
    })
    .filter(m=>m.role==="member"||m.repDeals.length>0)
    .sort((a,b)=>b.pipelineValue-a.pipelineValue);

  const totalPipeline=rows.reduce((s,r)=>s+r.pipelineValue,0);
  const totalActive=rows.reduce((s,r)=>s+r.activeDeals.length,0);
  const maxPipe=Math.max(...rows.map(r=>r.pipelineValue),1);

  if(drillId){
    const rep=rows.find(r=>r.user_id===drillId);
    if(!rep)return null;
    const sorted=[...rep.repDeals].sort((a,b)=>DEAL_STAGES.indexOf(a.stage)-DEAL_STAGES.indexOf(b.stage));
    const others=members.filter(m=>m.user_id!==rep.user_id);
    return <div style={{...tpFont,background:TP.bg,minHeight:"100vh",padding:"0 20px 64px"}}>
      <TPFontImport/>
      <div style={{maxWidth:1100,margin:"0 auto"}}>
        <TPTopbar roleLabel={impersonating?"Manager":"Manager"} impersonating={impersonating} avatarInitials={avatarInitials}/>
        {impersonating&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",marginBottom:20,borderRadius:10,background:TP.accentSoft,border:`1px dashed ${TP.accent}`,color:TP.accentStrong,fontSize:13.5,fontWeight:600}}>Viewing as Manager. Nothing you do here changes your own Admin permissions.<button onClick={onToggleImpersonate} style={{marginLeft:"auto",background:TP.surface,border:`1px solid ${TP.accent}`,color:TP.accentStrong,borderRadius:8,fontSize:12.5,fontWeight:700,padding:"6px 12px",cursor:"pointer"}}>Exit to Admin Portal</button></div>}
        <button onClick={()=>setDrillId(null)} style={{...tpFont,display:"inline-flex",alignItems:"center",gap:7,background:TP.surface2,border:`1px solid ${TP.border}`,padding:"8px 14px",borderRadius:100,fontSize:13.5,fontWeight:600,color:TP.text,cursor:"pointer",marginBottom:18}}>← Back to Team Overview</button>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:22,flexWrap:"wrap"}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:TP.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700}}>{initialsOf(nameFor(rep))}</div>
          <div><div style={{fontSize:21.5,fontWeight:700,color:TP.text}}>{nameFor(rep)}'s bivys</div><div style={{fontSize:13.5,color:TP.textMute,marginTop:3}}>{rep.activeDeals.length} active · {tpFmt(rep.pipelineValue)} in open pipeline</div></div>
        </div>
        <div style={{background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:16,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:`1px solid ${TP.border}`}}><div style={{fontSize:16,fontWeight:700,color:TP.text}}>Bivys</div><div style={{fontSize:12,color:TP.textFaint}}>{rep.repDeals.length} total, sorted by stage</div></div>
          {sorted.map(d=>{
            const mc=mappingCompleteness(d);
            const areaLabels=[["stakeholders","Stakeholders"],["meddpic","MEDDPIC"],["discovery","Discovery / exec summary"],["tasks","Tasks planned"]];
            const missing=areaLabels.filter(([k])=>!mc.areas[k]).map(([,l])=>l);
            return <div key={d.id} style={{display:"grid",gridTemplateColumns:"1.5fr 110px 130px 1.1fr",gap:18,alignItems:"center",padding:"17px 20px",borderBottom:`1px solid ${TP.border}`}}>
              <div><div style={{fontSize:14,fontWeight:600,color:TP.text}}>{d.company}</div><button onClick={()=>setReassignFor({repId:rep.user_id,repName:nameFor(rep),deals:[d]})} style={{marginTop:4,background:"none",border:"none",color:TP.accent,fontWeight:600,fontSize:12.5,cursor:"pointer",padding:0}}>⇄ Reassign</button></div>
              <div><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11.5,fontWeight:600,padding:"4px 10px",borderRadius:100,background:TP.surface2,border:`1px solid ${TP.border}`,whiteSpace:"nowrap"}}><span style={{width:7,height:7,borderRadius:"50%",background:TP.stage[d.stage]||TP.textFaint}}/>{d.stage}</span></div>
              <div style={{...tpMono,fontWeight:600,fontSize:14,textAlign:"right"}}>{d.value}</div>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:9}}>
                  <div style={{display:"flex",gap:4}}>{[0,1,2,3].map(i=>{const filled=Object.values(mc.areas)[i];return <span key={i} style={{width:9,height:9,borderRadius:2,border:`1.4px solid ${TP.accent}`,background:filled?TP.accent:"transparent",borderColor:filled?TP.accent:TP.borderStrong}}/>;})}</div>
                  <div style={{...tpMono,fontSize:12,color:TP.textMute}}>{mc.completeCount} of 4 mapped</div>
                </div>
                <div style={{fontSize:11,color:TP.textFaint,marginTop:4}}>{missing.length?<><b style={{color:TP.textMute}}>Missing:</b> {missing.join(", ")}</>:"All four mapping areas complete"}</div>
              </div>
            </div>;
          })}
        </div>
      </div>
      {reassignFor&&<ReassignModal repName={reassignFor.repName} deals={reassignFor.deals} others={others.map(o=>({user_id:o.user_id,fullName:o.profile?.full_name,email:o.profile?.email}))}
        onSave={changes=>{changes.forEach(([dealId,toId])=>onReassign(dealId,toId));setReassignFor(null);}} onClose={()=>setReassignFor(null)}/>}
    </div>;
  }

  return <div style={{...tpFont,background:TP.bg,minHeight:"100vh",padding:"0 20px 64px"}}>
    <TPFontImport/>
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <TPTopbar roleLabel="Manager" impersonating={impersonating} onToggleImpersonate={onToggleImpersonate} showImpersonateBtn={impersonating} avatarInitials={avatarInitials}/>
      {impersonating&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",marginBottom:20,borderRadius:10,background:TP.accentSoft,border:`1px dashed ${TP.accent}`,color:TP.accentStrong,fontSize:13.5,fontWeight:600}}>Viewing as Manager. Nothing you do here changes your own Admin permissions.<button onClick={onToggleImpersonate} style={{marginLeft:"auto",background:TP.surface,border:`1px solid ${TP.accent}`,color:TP.accentStrong,borderRadius:8,fontSize:12.5,fontWeight:700,padding:"6px 12px",cursor:"pointer"}}>Exit to Admin Portal</button></div>}
      <div style={{marginBottom:22}}>
        <div style={{fontSize:24,fontWeight:700,letterSpacing:"-0.01em",color:TP.text}}>Team Overview</div>
        <div style={{fontSize:13.5,color:TP.textMute,marginTop:5,maxWidth:640}}>A plain rollup of who's carrying what, stacked by pipeline value. Built to sit next to a rep in a 1:1, not to watch them from afar.</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:26}}>
        <TPStatTile label="Active pipeline" value={tpFmt(totalPipeline)} note={`Across ${rows.length} reps, ${totalActive} open bivys`} borderColor={TP.text}/>
        <TPStatTile label="Active bivys" value={totalActive} note="Not yet Closed Won or Lost" borderColor={TP.accent}/>
        <TPStatTile label="Active reps" value={rows.length} note="Add or remove reps from the Admin Portal" borderColor={TP.stage.Negotiation}/>
      </div>
      <div style={{background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:16,overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:`1px solid ${TP.border}`}}><div style={{fontSize:16,fontWeight:700,color:TP.text}}>Reps</div><div style={{fontSize:12,color:TP.textFaint}}>Stacked by active pipeline value, highest first</div></div>
        <div style={{display:"flex",flexWrap:"wrap",gap:12,padding:"12px 20px",borderBottom:`1px solid ${TP.border}`,background:TP.surface2}}>
          {DEAL_STAGES.map(s=><div key={s} style={{display:"flex",alignItems:"center",gap:6,fontSize:11.5,color:TP.textMute}}><span style={{width:9,height:9,borderRadius:2,background:TP.stage[s]}}/>{s}</div>)}
        </div>
        {rows.length===0?<div style={{padding:40,textAlign:"center",color:TP.textMute,fontSize:13}}>No reps with assigned deals yet.</div>:rows.map(r=>{
          const ad=r.activeDeals.length;
          return <div key={r.user_id} role="button" tabIndex={0} onClick={()=>setDrillId(r.user_id)} style={{display:"grid",gridTemplateColumns:"1.6fr 90px 1.3fr 1.3fr auto 18px",alignItems:"center",gap:18,padding:"16px 20px",borderBottom:`1px solid ${TP.border}`,cursor:"pointer",background:"none",width:"100%",textAlign:"left"}}>
            <span style={{display:"flex",alignItems:"center",gap:11,minWidth:0}}>
              <span style={{width:34,height:34,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",background:TP.accent}}>{initialsOf(nameFor(r))}</span>
              <span><div style={{fontWeight:600,fontSize:14.5,color:TP.text}}>{nameFor(r)}</div><div style={{fontSize:12,color:TP.textMute}}>{ad} active bivy{ad===1?"":"s"}</div></span>
            </span>
            <span style={{...tpMono,fontSize:13.5,color:TP.textMute}}><b style={{color:TP.text}}>{ad}</b> open</span>
            <span><div style={{...tpMono,fontWeight:600,fontSize:14,marginBottom:6}}>{tpFmt(r.pipelineValue)}</div><div style={{height:6,background:TP.surface2,borderRadius:100,overflow:"hidden",border:`1px solid ${TP.border}`}}><div style={{height:"100%",width:`${(r.pipelineValue/maxPipe*100).toFixed(1)}%`,background:TP.accent,borderRadius:100}}/></div></span>
            <span>
              <div style={{display:"flex",height:16,borderRadius:5,overflow:"hidden",border:`1px solid ${TP.border}`}}>{r.segments.map(s=><span key={s.stage} title={`${s.stage} · ${s.count}`} style={{height:"100%",width:`${(s.count/ad*100).toFixed(1)}%`,background:TP.stage[s.stage]}}/>)}</div>
              <div style={{fontSize:11,color:TP.textFaint,marginTop:6}}>{r.segments.map(s=>`${s.stage} · ${s.count}`).join("   ")}</div>
            </span>
            <button onClick={e=>{e.stopPropagation();setReassignFor({repId:r.user_id,repName:nameFor(r),deals:r.repDeals});}} style={{background:"none",border:"none",color:TP.accent,fontWeight:600,fontSize:12.5,cursor:"pointer",whiteSpace:"nowrap"}}>⇄ Reassign</button>
            <span style={{color:TP.textFaint,fontSize:16}}>›</span>
          </div>;
        })}
      </div>
      <div style={{marginTop:16,padding:"16px 18px",border:`1px dashed ${TP.borderStrong}`,borderRadius:12,fontSize:12.5,color:TP.textMute,lineHeight:1.6,background:TP.surface2}}><b style={{color:TP.text}}>What this screen won't do:</b> no scoring, no red flags, no ranking by anything but the numbers shown.</div>
    </div>
    {reassignFor&&<ReassignModal repName={reassignFor.repName} deals={reassignFor.deals} others={members.filter(m=>m.user_id!==reassignFor.repId).map(o=>({user_id:o.user_id,fullName:o.profile?.full_name,email:o.profile?.email}))}
      onSave={changes=>{changes.forEach(([dealId,toId])=>onReassign(dealId,toId));setReassignFor(null);}} onClose={()=>setReassignFor(null)}/>}
  </div>;
};

// Admin Portal -- billing, roster, roles. Zero deal content anywhere on this screen, by
// design (spec: "Admin... Zero visibility into deal names, values, stages, or mapping
// completeness, anywhere"). Self-contained data fetch/mutations, same pattern and same
// RPCs as the old SettingsModal's Team+Billing tabs (this is a re-skin, not new logic) --
// see TEAM-ADMIN-MANAGER-REWORK-SPEC.md's "What's left: the visual layer".
const AdminPortalScreen=({orgId,myUserId,planTier,subscriptionStatus,currentPeriodEnd,hasStripeSubscription,onToggleImpersonate,onOpenGeneralSettings})=>{
  const [members,setMembers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [inviteName,setInviteName]=useState("");
  const [inviteEmail,setInviteEmail]=useState("");
  const [inviteIsManager,setInviteIsManager]=useState(false);
  const [inviteLoading,setInviteLoading]=useState(false);
  const [inviteResult,setInviteResult]=useState(null);
  const [inviteError,setInviteError]=useState("");
  const [resendingId,setResendingId]=useState(null);
  const [deactivateTarget,setDeactivateTarget]=useState(null);
  const [deactivateDealCount,setDeactivateDealCount]=useState(null);
  const [deactivateSuccessor,setDeactivateSuccessor]=useState("");
  const [deactivateLoading,setDeactivateLoading]=useState(false);
  const [showBilling,setShowBilling]=useState(false);
  const [showWizard,setShowWizard]=useState(false);
  const [showFirstTime,setShowFirstTime]=useState(false);
  const myUserRow=members.find(m=>m.user_id===myUserId);

  const load=async()=>{
    setLoading(true);
    const {data:mem}=await sb.from("organization_members").select("id,user_id,role,status,is_admin,is_manager,created_at").eq("org_id",orgId);
    const userIds=(mem||[]).map(m=>m.user_id);
    const {data:profiles}=userIds.length?await sb.from("profiles").select("id,email,full_name").in("id",userIds):{data:[]};
    const profileById=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
    // Count-only RPC (0045), not a direct deals query -- deals_select RLS (0041) is
    // current_org_is_manager OR assigned_to=self OR solo, none of which a real Admin
    // (is_manager false) satisfies for a teammate's deals, so a raw select silently
    // returns zero rows here. This mirrors blind_reassign_all_deals's own "count only,
    // never content" security model for the exact same reason.
    const {data:dealCounts}=await sb.rpc("admin_deal_counts_by_user",{p_org_id:orgId});
    const countByUser={};(dealCounts||[]).forEach(d=>{countByUser[d.user_id]=Number(d.deal_count);});
    setMembers((mem||[]).map(m=>({...m,email:profileById[m.user_id]?.email,fullName:profileById[m.user_id]?.full_name,dealCount:countByUser[m.user_id]||0})));
    setLoading(false);
  };
  useEffect(()=>{load();},[orgId]);
  useEffect(()=>{
    const key=`mybivy_admin_portal_seen_${orgId}`;
    if(!localStorage.getItem(key)){setShowFirstTime(true);localStorage.setItem(key,"1");}
  },[orgId]);

  const sendInvite=async(name,email,isManager)=>{
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch("/api/provision-teammate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orgId,accessToken:session?.access_token,fullName:name,email,isManager})});
    const data=await res.json();
    if(!res.ok)throw new Error(data.message||data.error||"Couldn't add teammate");
    return data;
  };
  const submitInvite=async()=>{
    if(!inviteName.trim()||!inviteEmail.trim())return;
    setInviteLoading(true);setInviteError("");setInviteResult(null);
    try{
      const data=await sendInvite(inviteName.trim(),inviteEmail.trim(),inviteIsManager);
      setInviteResult(data);setInviteName("");setInviteEmail("");setInviteIsManager(false);load();
    }catch(e){setInviteError(e.message);}
    setInviteLoading(false);
  };
  const resendCode=async userId=>{
    setResendingId(userId);
    const {data,error:err}=await sb.rpc("resend_teammate_code",{p_org_id:orgId,p_user_id:userId});
    if(!err)setInviteResult({...data,activationUrl:`${window.location.origin}/?activate=${encodeURIComponent(data.email)}`});
    setResendingId(null);
  };
  const changeManagerFlag=async(memberId,makeManager)=>{await sb.from("organization_members").update({is_manager:makeManager}).eq("id",memberId);load();};
  const openDeactivate=async member=>{
    setDeactivateTarget(member);setDeactivateSuccessor("");setDeactivateDealCount(member.dealCount);
  };
  const confirmDeactivate=async()=>{
    if(deactivateDealCount>0&&!deactivateSuccessor)return;
    setDeactivateLoading(true);
    if(deactivateDealCount>0){
      const {error:rpcErr}=await sb.rpc("blind_reassign_all_deals",{p_org_id:orgId,p_from_user:deactivateTarget.user_id,p_to_user:deactivateSuccessor});
      if(rpcErr){setDeactivateLoading(false);return;}
    }
    await sb.from("organization_members").update({status:"deactivated"}).eq("id",deactivateTarget.id);
    setDeactivateLoading(false);setDeactivateTarget(null);load();
  };

  const activeCount=members.filter(m=>m.status!=="deactivated").length;
  const seatCap=TIER_SEATS[planTier]||0;
  const price=TIER_PRICE[planTier];
  const billingLabel=subscriptionStatus==="active"?"Current":subscriptionStatus==="past_due"?"Past due":subscriptionStatus==="canceled"?"Canceled":"Pending";
  const billingColor=subscriptionStatus==="active"?TP.stage["Closed Won"]:subscriptionStatus==="past_due"?TP.red:TP.textMute;

  return <div style={{...tpFont,background:TP.bg,minHeight:"100vh",padding:"0 20px 64px"}}>
    <TPFontImport/>
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <TPTopbar roleLabel="Admin" avatarInitials={initialsOf(myUserRow?.fullName||myUserRow?.email||"")} onSettings={onOpenGeneralSettings} showImpersonateBtn onToggleImpersonate={onToggleImpersonate} impersonating={false}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:24,marginBottom:22,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:24,fontWeight:700,letterSpacing:"-0.01em",color:TP.text}}>Admin Portal</div>
          <div style={{fontSize:13.5,color:TP.textMute,marginTop:5,maxWidth:640}}>Seats, billing, roles, and who's active. No deal names, values, stages, or mapping progress live here, that's the Manager's view, not the Admin's.</div>
        </div>
        <TPBtn kind="primary" onClick={()=>setShowWizard(true)}>🧭 Run team setup</TPBtn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14,marginBottom:26,maxWidth:640}}>
        <TPStatTile label="Plan" value={`Team · ${seatCap}`} note="Billed monthly" borderColor={TP.text}/>
        <TPStatTile label="Seats" value={<>{activeCount} <span style={{color:TP.textFaint,fontSize:16}}>/ {seatCap}</span></>} note={`${Math.max(0,seatCap-activeCount)} seats available`} borderColor={TP.accent}/>
        <TPStatTile label="Next invoice" value={price?`$${price}`:"—"} note={currentPeriodEnd?new Date(currentPeriodEnd).toLocaleDateString():"Not yet billed"} borderColor={TP.stage.Negotiation}/>
        <TPStatTile label="Billing status" value={billingLabel} valueColor={billingColor} note="Manage →" borderColor={TP.stage["Closed Won"]} onClick={()=>setShowBilling(true)}/>
      </div>
      <div style={{background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:16,overflow:"hidden",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,padding:"16px 20px",background:"color-mix(in srgb, "+TP.stage["Closed Won"]+" 16%, white)"}}>
          <div style={{fontSize:16,fontWeight:700,color:"color-mix(in srgb, "+TP.stage["Closed Won"]+" 70%, black)"}}>Roster</div>
          <TPBtn kind="ghost" onClick={()=>{setInviteName("");setInviteEmail("");setInviteResult(null);setInviteError("");document.getElementById("tp-invite-anchor")?.scrollIntoView({behavior:"smooth"});}}>+ Add teammate</TPBtn>
        </div>
        <div style={{display:"flex",gap:22,flexWrap:"wrap",padding:"14px 20px",background:TP.surface2,borderBottom:`1px solid ${TP.border}`,fontSize:12.5,color:TP.textMute}}>
          <div><b style={{color:TP.text}}>Admin</b> — billing, roster, roles. Can view as Manager, never sees deal content directly</div>
          <div><b style={{color:TP.text}}>Manager</b> — every rep's bivys, the Overview, and dealroom reassignment. No billing, no roster</div>
          <div><b style={{color:TP.text}}>Rep</b> — their own bivys and profile only</div>
        </div>
        {loading?<div style={{padding:30,textAlign:"center",color:TP.textMute,fontSize:13}}>Loading…</div>:members.map((m,i)=>{
          const isMe=m.user_id===myUserId;
          const isDeactivated=m.status==="deactivated";
          return <div key={m.id} style={{display:"grid",gridTemplateColumns:"1.7fr 130px 120px 120px 1.2fr",alignItems:"center",gap:14,padding:"14px 20px",borderBottom:`1px solid ${TP.border}`,background:i%2===1?TP.surface2:"transparent",opacity:isDeactivated?0.55:1}}>
            <div style={{display:"flex",alignItems:"center",gap:11,minWidth:0}}>
              <span style={{width:34,height:34,borderRadius:"50%",background:TP.accentSoft,color:TP.accentStrong,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{initialsOf(m.fullName||m.email||"")}</span>
              <span><div style={{fontWeight:600,fontSize:13.5,color:TP.text}}>{m.fullName||m.email||"Unknown"}</div><div style={{fontSize:11.5,color:TP.textMute}}>{m.email}</div></span>
            </div>
            {isMe?<div style={{fontSize:12,fontWeight:700,color:TP.accentStrong}}>Admin</div>
            :<select value={m.is_manager?"manager":"rep"} disabled={isDeactivated} onChange={e=>changeManagerFlag(m.id,e.target.value==="manager")} style={{border:`1px solid ${TP.border}`,borderRadius:8,background:isDeactivated?TP.surface2:TP.surface,color:isDeactivated?TP.textMute:TP.text,fontSize:12.5,fontWeight:600,padding:"6px 8px",width:"100%"}}>
                <option value="rep">Rep</option>
                <option value="manager">Manager</option>
              </select>}
            <div style={{...tpMono,fontSize:12.5,color:TP.textMute}}>{isMe?"—":`${m.dealCount} bivy${m.dealCount===1?"":"s"}`}</div>
            <div><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,padding:"4px 10px",borderRadius:100,border:`1px solid ${TP.border}`,textTransform:"uppercase",letterSpacing:"0.03em",background:m.status==="active"?TP.accentSoft:TP.surface2,color:m.status==="active"?TP.accentStrong:TP.textMute,borderColor:m.status==="active"?TP.accent:TP.border}}>{isDeactivated?"Deactivated":m.status==="active"?"Active":"Invited"}</span></div>
            <div style={{display:"flex",gap:12,justifyContent:"flex-end",flexWrap:"wrap"}}>
              {m.status==="invited"&&<TPBtn kind="text" disabled={resendingId===m.user_id} onClick={()=>resendCode(m.user_id)}>{resendingId===m.user_id?"Sending…":"Resend"}</TPBtn>}
              {!isMe&&!isDeactivated&&<TPBtn kind="danger" onClick={()=>openDeactivate(m)}>{m.dealCount>0?"Deactivate":"Remove"}</TPBtn>}
            </div>
          </div>;
        })}
        <div id="tp-invite-anchor" style={{padding:20,borderTop:`1px solid ${TP.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:TP.text,marginBottom:10}}>Invite a teammate</div>
          <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <input placeholder="Full name" value={inviteName} onChange={e=>setInviteName(e.target.value)} style={{flex:1,minWidth:160,border:`1px solid ${TP.border}`,borderRadius:8,padding:"9px 10px",fontSize:13}}/>
            <input placeholder="teammate@company.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} style={{flex:1,minWidth:200,border:`1px solid ${TP.border}`,borderRadius:8,padding:"9px 10px",fontSize:13}}/>
            <select value={inviteIsManager?"manager":"rep"} onChange={e=>setInviteIsManager(e.target.value==="manager")} style={{border:`1px solid ${TP.border}`,borderRadius:8,padding:"9px 8px",fontSize:13}}>
              <option value="rep">Rep</option>
              <option value="manager">Manager</option>
            </select>
            <TPBtn kind="primary" disabled={inviteLoading||!inviteName.trim()||!inviteEmail.trim()} onClick={submitInvite}>{inviteLoading?"Please wait…":"Invite"}</TPBtn>
          </div>
          {inviteError&&<div style={{fontSize:12.5,color:TP.red,marginBottom:8}}>{inviteError}</div>}
          <div style={{fontSize:12,color:TP.textMute,lineHeight:1.6}}>Creates their account and bivy immediately. Share the code below with them yourself (or the link, which skips typing it in) — they'll also get an activation email, when it lands.</div>
          {inviteResult&&<div style={{marginTop:12,padding:"12px 14px",background:TP.accentSoft,border:`1px solid ${TP.borderStrong}`,borderRadius:10}}>
            <div style={{fontSize:11,fontWeight:700,color:TP.accentStrong,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>{inviteResult.email}</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{...tpMono,fontSize:22,fontWeight:700,letterSpacing:"0.2em",color:TP.text}}>{inviteResult.code}</div>
              <TPBtn kind="ghost" onClick={()=>navigator.clipboard.writeText(inviteResult.code)}>Copy code</TPBtn>
            </div>
            <TPBtn kind="ghost" onClick={()=>navigator.clipboard.writeText(inviteResult.activationUrl)}>Copy activation link</TPBtn>
          </div>}
        </div>
      </div>
      <div style={{padding:"16px 18px",border:`1px dashed ${TP.borderStrong}`,borderRadius:12,fontSize:12.5,color:TP.textMute,lineHeight:1.6,background:TP.surface2}}><b style={{color:TP.text}}>This replaces the old Settings modal</b> for Admin and Manager on Team plans. A Rep's own settings stay scoped to their profile, no billing tab appears there.</div>
    </div>

    {deactivateTarget&&<div style={{position:"fixed",inset:0,background:"rgba(20,17,12,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1200}}>
      <div style={{...tpFont,background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:18,maxWidth:480,width:"100%"}}>
        <div style={{padding:"22px 24px 14px",borderBottom:`1px solid ${TP.border}`}}>
          <div style={{fontSize:17,fontWeight:700,color:TP.text}}>{deactivateDealCount>0?"Deactivate ":"Remove "}{deactivateTarget.fullName||deactivateTarget.email}</div>
          <div style={{fontSize:13,color:TP.textMute,marginTop:6,lineHeight:1.5}}>{deactivateDealCount>0?`This won't show you what's inside any bivy. Choose who takes over ${deactivateDealCount} active bivy${deactivateDealCount===1?"":"s"} before their access is removed.`:`${deactivateTarget.fullName||deactivateTarget.email} has no bivys of their own, there's nothing to hand off.`}</div>
        </div>
        <div style={{padding:"16px 24px"}}>
          {deactivateDealCount>0&&<select value={deactivateSuccessor} onChange={e=>setDeactivateSuccessor(e.target.value)} style={{width:"100%",border:`1px solid ${TP.border}`,borderRadius:9,padding:"9px 10px",fontSize:13.5,background:TP.surface,color:TP.text,marginBottom:14}}>
            <option value="">Choose a successor…</option>
            {members.filter(m=>m.user_id!==deactivateTarget.user_id&&m.status==="active").map(m=><option key={m.user_id} value={m.user_id}>Move all bivys to {m.fullName||m.email}</option>)}
          </select>}
          <div style={{fontSize:12.5,color:TP.textMute,lineHeight:1.5}}>☐ This immediately removes {deactivateTarget.fullName||deactivateTarget.email}'s access to myBivy. This can't be undone from here.</div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"16px 24px",borderTop:`1px solid ${TP.border}`}}>
          <TPBtn kind="ghost" onClick={()=>setDeactivateTarget(null)}>Cancel</TPBtn>
          <TPBtn onClick={confirmDeactivate} disabled={deactivateLoading||(deactivateDealCount>0&&!deactivateSuccessor)} style={{background:TP.red,borderColor:TP.red,color:"#fff"}}>{deactivateLoading?"Please wait…":deactivateDealCount>0?"Deactivate":"Remove"}</TPBtn>
        </div>
      </div>
    </div>}

    {showBilling&&<TeamBillingModal orgId={orgId} planTier={planTier} subscriptionStatus={subscriptionStatus} currentPeriodEnd={currentPeriodEnd} hasStripeSubscription={hasStripeSubscription} onClose={()=>setShowBilling(false)}/>}

    {showWizard&&<TeamSetupWizard onInvite={sendInvite} onDone={()=>{setShowWizard(false);load();}} onClose={()=>setShowWizard(false)}/>}

    {showFirstTime&&<div style={{position:"fixed",inset:0,background:"rgba(20,17,12,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1200}}>
      <div style={{...tpFont,background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:18,maxWidth:440,width:"100%",textAlign:"center",padding:"26px 24px 0"}}>
        <div style={{width:38,height:38,borderRadius:10,background:TP.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,margin:"0 auto 14px"}}>🧭</div>
        <div style={{fontSize:17.5,fontWeight:700,color:TP.text}}>First time setting up Team?</div>
        <div style={{fontSize:13.5,color:TP.textMute,lineHeight:1.6,marginTop:8}}>Walk through adding reps and choosing who's a Manager. You can add more or change roles anytime from the roster below.</div>
        <div style={{display:"flex",justifyContent:"center",gap:12,padding:"20px 0"}}>
          <TPBtn kind="ghost" onClick={()=>setShowFirstTime(false)}>Maybe later</TPBtn>
          <TPBtn kind="primary" onClick={()=>{setShowFirstTime(false);setShowWizard(true);}}>Open setup walkthrough</TPBtn>
        </div>
      </div>
    </div>}
  </div>;
};

// Billing modal: reuses the exact same Netlify functions as Solo's billing (create-portal-
// session.mts already generically handles update-card/cancel-plan for any Stripe
// subscription, regardless of tier -- no separate Team portal endpoint needed). Only
// checkout (first-time subscribe) needs a Team-specific function, since it has to pick one
// of three flat-rate tier Prices instead of Solo's single price -- see
// create-team-checkout-session.mts.
const TeamBillingModal=({orgId,planTier,subscriptionStatus,currentPeriodEnd,hasStripeSubscription,onClose})=>{
  const [tier,setTier]=useState(planTier&&TIER_PRICE[planTier]?planTier:"team_5");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const price=TIER_PRICE[planTier]||TIER_PRICE[tier];

  const openPortal=async()=>{
    setLoading(true);setError("");
    const {data:{session}}=await sb.auth.getSession();
    try{
      const res=await fetch("/api/create-portal-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orgId,accessToken:session.access_token})});
      const data=await res.json();
      if(!res.ok||!data.url){setError(data.error||"Couldn't open billing portal");setLoading(false);return;}
      window.location.href=data.url;
    }catch{setError("Couldn't open billing portal");setLoading(false);}
  };
  const openCheckout=async()=>{
    setLoading(true);setError("");
    const {data:{session}}=await sb.auth.getSession();
    try{
      const res=await fetch("/api/create-team-checkout-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orgId,accessToken:session.access_token,tier})});
      const data=await res.json();
      if(!res.ok||!data.url){setError(data.error||"Couldn't start checkout");setLoading(false);return;}
      window.location.href=data.url;
    }catch{setError("Couldn't start checkout");setLoading(false);}
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(20,17,12,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1200}}>
    <div style={{...tpFont,background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:18,maxWidth:480,width:"100%"}}>
      <div style={{padding:"22px 24px 14px",borderBottom:`1px solid ${TP.border}`}}>
        <div style={{fontSize:17,fontWeight:700,color:TP.text}}>{hasStripeSubscription?"Manage billing":"Subscribe to Team"}</div>
        {hasStripeSubscription&&<div style={{fontSize:13,color:TP.textMute,marginTop:6}}>Team · {TIER_SEATS[planTier]} seats · ${price}/month{currentPeriodEnd?` · renews ${new Date(currentPeriodEnd).toLocaleDateString()}`:""}</div>}
      </div>
      <div style={{padding:"20px 24px"}}>
        {!hasStripeSubscription&&<>
          <div style={{fontSize:12,fontWeight:700,color:TP.textMute,marginBottom:6}}>SEAT TIER</div>
          <select value={tier} onChange={e=>setTier(e.target.value)} style={{width:"100%",border:`1px solid ${TP.border}`,borderRadius:9,padding:"9px 10px",fontSize:13.5,marginBottom:16}}>
            {Object.entries(TIER_SEATS).map(([k,seats])=><option key={k} value={k}>Up to {seats} reps — ${TIER_PRICE[k]}/mo</option>)}
          </select>
        </>}
        {error&&<div style={{fontSize:12.5,color:TP.red,marginBottom:12}}>{error}</div>}
        {hasStripeSubscription?<>
          <div style={{fontSize:12,fontWeight:700,color:TP.textMute,marginBottom:6}}>PAYMENT METHOD</div>
          <div style={{fontSize:13,color:TP.textMute,marginBottom:16}}>Managed in the Stripe billing portal — update card, view invoices, or cancel from there.</div>
          <TPBtn kind="primary" disabled={loading} onClick={openPortal}>{loading?"Please wait…":"Open billing portal"}</TPBtn>
        </>:<TPBtn kind="primary" disabled={loading} onClick={openCheckout}>{loading?"Please wait…":`Subscribe — $${TIER_PRICE[tier]}/mo`}</TPBtn>}
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",padding:"16px 24px",borderTop:`1px solid ${TP.border}`}}>
        <TPBtn kind="ghost" onClick={onClose}>Done</TPBtn>
      </div>
    </div>
  </div>;
};

// Bulk-invite wizard -- each row calls the same provision-teammate flow as the roster's
// single invite field, just sequentially, one Admin API call per row (no batch endpoint;
// provisioning genuinely creates one auth.users row + one bivy per person, so there's no
// meaningful way to batch it server-side without changing that function's contract).
const TeamSetupWizard=({onInvite,onDone,onClose})=>{
  const [step,setStep]=useState(0);
  const [rows,setRows]=useState([{name:"",email:"",role:"rep"},{name:"",email:"",role:"rep"}]);
  const [submitting,setSubmitting]=useState(false);
  const [results,setResults]=useState([]);
  const total=3;

  const submit=async()=>{
    setSubmitting(true);
    const out=[];
    for(const r of rows.filter(r=>r.name.trim()&&r.email.trim())){
      try{await onInvite(r.name.trim(),r.email.trim(),r.role==="manager");out.push({email:r.email,ok:true});}
      catch(e){out.push({email:r.email,ok:false,error:e.message});}
    }
    setResults(out);setSubmitting(false);setStep(2);
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(20,17,12,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1200}}>
    <div style={{...tpFont,background:TP.surface,border:`1px solid ${TP.border}`,borderRadius:18,maxWidth:480,width:"100%",maxHeight:"88vh",overflowY:"auto"}}>
      <div style={{padding:"22px 24px"}}>
        <div style={{display:"flex",gap:6,marginBottom:14}}>{Array.from({length:total}).map((_,i)=><span key={i} style={{width:22,height:4,borderRadius:100,background:i<=step?TP.accent:TP.borderStrong}}/>)}</div>
        {step===0&&<>
          <div style={{fontSize:17,fontWeight:700,color:TP.text}}>Set up your team</div>
          <div style={{fontSize:13,color:TP.textMute,marginTop:8}}>Creates rep accounts and their bivys, and sets who's a Manager, not what's inside anyone's deals.</div>
        </>}
        {step===1&&<>
          <div style={{fontSize:17,fontWeight:700,color:TP.text}}>Add your team</div>
          <div style={{fontSize:13,color:TP.textMute,margin:"8px 0 14px"}}>Each row creates one real account and an empty bivy immediately.</div>
          {rows.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 110px 22px",gap:8,marginBottom:8,alignItems:"center"}}>
              <input placeholder="Full name" value={r.name} onChange={e=>setRows(rs=>rs.map((x,j)=>j===i?{...x,name:e.target.value}:x))} style={{border:`1px solid ${TP.border}`,borderRadius:8,padding:"8px 10px",fontSize:13}}/>
              <input type="email" placeholder="name@company.com" value={r.email} onChange={e=>setRows(rs=>rs.map((x,j)=>j===i?{...x,email:e.target.value}:x))} style={{border:`1px solid ${TP.border}`,borderRadius:8,padding:"8px 10px",fontSize:13}}/>
              <select value={r.role} onChange={e=>setRows(rs=>rs.map((x,j)=>j===i?{...x,role:e.target.value}:x))} style={{border:`1px solid ${TP.border}`,borderRadius:8,padding:"8px 6px",fontSize:12.5}}>
                <option value="rep">Rep</option>
                <option value="manager">Manager</option>
              </select>
              <button onClick={()=>setRows(rs=>rs.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:TP.textFaint,cursor:"pointer",fontSize:15}}>✕</button>
            </div>
          ))}
          <TPBtn kind="text" onClick={()=>setRows(rs=>[...rs,{name:"",email:"",role:"rep"}])}>+ Add another</TPBtn>
        </>}
        {step===2&&<>
          <div style={{fontSize:17,fontWeight:700,color:TP.text}}>{submitting?"Setting up…":"You're set"}</div>
          <div style={{fontSize:13,color:TP.textMute,margin:"8px 0"}}>{submitting?"Creating each account and bivy…":"Each teammate below is ready — share their code from the roster to get them activated."}</div>
          {!submitting&&results.map(r=><div key={r.email} style={{fontSize:12.5,padding:"6px 0",color:r.ok?TP.text:TP.red}}>{r.ok?"✓":"✕"} {r.email}{!r.ok?` — ${r.error}`:""}</div>)}
        </>}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"16px 24px",borderTop:`1px solid ${TP.border}`}}>
        <TPBtn kind="ghost" onClick={()=>step===0?onClose():step===2?onDone():setStep(s=>s-1)} style={{visibility:step===1?"visible":step===0?"visible":"hidden"}}>{step===0?"Cancel":"Back"}</TPBtn>
        {step<2?<TPBtn kind="primary" disabled={submitting} onClick={()=>step===1?submit():setStep(1)}>{step===1?(submitting?"Please wait…":"Finish"):"Next"}</TPBtn>
        :<TPBtn kind="primary" onClick={onDone}>Done</TPBtn>}
      </div>
    </div>
  </div>;
};

function DealRoom({prospectShareSlug}) {
  const [session,setSession]=useState(undefined); // undefined=checking, null=signed out, object=signed in
  const [isPasswordRecovery,setIsPasswordRecovery]=useState(false); // true between landing on a reset-password link and setting a new password
  // Newly-provisioned teammate flow (Team Admin/Manager Rework, Data model #1). showActivateScreen
  // starts true only when the URL actually carries ?activate=email; activatingViaCode flags
  // that the PASSWORD_RECOVERY session about to fire came from ActivateTeammate's code
  // exchange, not a forgot-password email link, so ResetPassword renders in "activate" mode
  // (stays signed in) instead of "reset" mode (signs back out) -- see ResetPassword's comment.
  const [showActivateScreen,setShowActivateScreen]=useState(!!ACTIVATE_EMAIL);
  const [activatingViaCode,setActivatingViaCode]=useState(false);
  const [needsOrgSetup,setNeedsOrgSetup]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const [orgId,setOrgId]=useState(null);
  const [myRole,setMyRole]=useState(null);
  // Team Admin/Manager Rework: the new authority for deal visibility and the Admin/Manager
  // split -- myRole (the legacy owner/admin/member column) stays around for the older
  // paths that still key off it (org_invitations, org_members_insert/update/delete), but
  // none of the new Admin Portal / Team Overview / View-as-Manager UI below should gate on
  // myRole anymore, only on these two flags.
  const [isAdmin,setIsAdmin]=useState(false);
  const [isManager,setIsManager]=useState(false);
  const [myProfile,setMyProfile]=useState(null); // the logged-in user's own profile -- sidebar identity, not "who created this deal"
  const [dealRoomLimit,setDealRoomLimit]=useState(10); // base-plan cap on active deal rooms (organizations.deal_room_limit)
  // Billing state -- mirrors org_is_locked (0018) for UX only; the real gate is the
  // enforce_org_not_locked trigger on deals/stakeholders/deal_tasks. Never checked for
  // viewMode==="prospect" -- soft lock is rep-side only, prospect share links are unaffected.
  const [subscriptionStatus,setSubscriptionStatus]=useState("trialing");
  const [trialEndsAt,setTrialEndsAt]=useState(null);
  const [hasStripeSubscription,setHasStripeSubscription]=useState(false); // organizations.stripe_subscription_id -- see org_is_locked (0032)
  // Team Admin/Manager Rework, visual layer: which full-page screen (AdminPortalScreen /
  // TeamOverviewScreen) an Admin or Manager lands on is gated on isTeamOrg, NOT on
  // isAdmin/isManager alone -- a solo org's owner also carries both flags true (the
  // solo-safety fix in 0040), and must keep seeing their own ordinary bivy exactly as
  // before. Only an org actually on a team_5/10/15 plan_tier gets the new routing.
  const [planTier,setPlanTier]=useState("trial");
  const [currentPeriodEnd,setCurrentPeriodEnd]=useState(null);
  const isTeamOrg=typeof planTier==="string"&&planTier.startsWith("team_");
  // organizations.onboarding_seen (0023) is the permanent gate, re-checked on every org data
  // load (not a one-time "just created" flag) -- so it still shows correctly if the owner
  // closes the tab before dismissing it, on their very next login.
  const [showWelcome,setShowWelcome]=useState(false);
  const [stageLabels,setStageLabels]=useState(DEFAULT_STAGE_LABELS); // organizations.stage_labels (0024), merged over defaults
  const [postSignatureStageLabels,setPostSignatureStageLabels]=useState(DEFAULT_POST_SIGNATURE_STAGE_LABELS); // organizations.post_signature_stage_labels (0028), merged over defaults
  // Mirrors org_is_locked (0032): once a real Stripe subscription exists, its own trial
  // governs (Early Activation Promo), not the original signup trial_ends_at.
  const isLocked=subscriptionStatus==="active"?false:(subscriptionStatus==="trialing"?!(hasStripeSubscription||(trialEndsAt&&new Date(trialEndsAt)>new Date())):true);
  // Client-side mirror of the enforce_org_not_locked trigger (0018) -- called at the top of
  // every create/edit mutation (not deletes, matching the trigger's own scope) so a locked
  // org gets one clear message instead of a raw Postgres exception surfacing through flash().
  const guardLocked=()=>{
    if(!isLocked)return false;
    flash("Your trial has ended — upgrade to keep editing (Settings → Billing)");
    return true;
  };
  const [showSettings,setShowSettings]=useState(false);
  const [loadingDeals,setLoadingDeals]=useState(!prospectShareSlug);
  const [deals,setDeals]=useState([]);
  const [activeId,setActiveId]=useState(null);
  const [viewMode,setViewMode]=useState(prospectShareSlug?"prospect":"rep");
  const [prospectAuth,setProspectAuth]=useState({});
  // Set only on the real external-prospect path (never the rep-preview-as-prospect
  // toggle) -- {id, dealId} for the one deal_visits row this browser session owns. Gates
  // document-view logging and the visit-duration heartbeat below.
  const [prospectVisit,setProspectVisit]=useState(null);
  const [tab,setTab]=useState(prospectShareSlug?"welcome":"map");
  const [aiOpen,setAiOpen]=useState(false);
  const [aiMode,setAiMode]=useState(null);
  const [aiText,setAiText]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [chatInput,setChatInput]=useState("");
  const [showCreator,setShowCreator]=useState(false);
  const [showShare,setShowShare]=useState(false);
  const [showAddEmbed,setShowAddEmbed]=useState(false);
  const [showAddRecording,setShowAddRecording]=useState(false);
  const [showEmbedDoc,setShowEmbedDoc]=useState(null); // the content item currently open in EmbedModal, or null
  const [showDeleteDeal,setShowDeleteDeal]=useState(false);
  const [showEditDeal,setShowEditDeal]=useState(false);
  const [showAddTask,setShowAddTask]=useState(null); // null, or the phase currently showing its Add Task form
  const [editingTask,setEditingTask]=useState(null); // null, or the task currently open in TaskModal
  const [showAddExperience,setShowAddExperience]=useState(null); // post-signature counterpart to showAddTask
  const [editingExperienceItem,setEditingExperienceItem]=useState(null); // post-signature counterpart to editingTask
  // Which single Executive Summary section (if any) is being edited -- "problem" |
  // "challenges" | "solutions" | null -- so editing one section never puts the others
  // into edit mode too. summarySectionDraft holds that one section's in-progress value
  // (a string for problem, an array for challenges/solutions).
  const [editingSummarySection,setEditingSummarySection]=useState(null);
  const [summarySectionDraft,setSummarySectionDraft]=useState(null);
  // Handle onto the active section's EditableList, so Save can flush its unsubmitted
  // "Add item" text before persisting (see EditableList.flush) instead of only saving
  // whatever was already committed via +Add.
  const execListRef=useRef(null);
  const [editingMeddpicSection,setEditingMeddpicSection]=useState(null); // null | one of the 7 keys
  const [meddpicSectionDraft,setMeddpicSectionDraft]=useState("");
  const [editingDiscovery,setEditingDiscovery]=useState(false);
  const [discoveryDraft,setDiscoveryDraft]=useState(null);
  // Keyed by discoveryDraft field name ("corporateStrategy" etc, or "goal:<period>") --
  // same flush-before-save purpose as execListRef, just one ref per list on this tab.
  const discoveryListRefs=useRef({});
  const [showStakeholderModal,setShowStakeholderModal]=useState(false);
  const [editingStakeholder,setEditingStakeholder]=useState(null);
  const [newTask,setNewTask]=useState({phase:"Value Alignment",task:"",owner:"",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false,calendlyEnabled:false});
  const [newExperienceItem,setNewExperienceItem]=useState({phase:"Kickoff & Intro",task:"",owner:"",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false,calendlyEnabled:false});
  const [toast,setToast]=useState(null);
  const [orgView,setOrgView]=useState(false);
  const [activeLog,setActiveLog]=useState(null);
  const [selCat,setSelCat]=useState("All");
  const [initError,setInitError]=useState(null);
  // Manager Overview (TEAM-VERSION-ADMIN-MANAGER-SPEC.md): org roster for owner/admin
  // (see the effect below), whether the full-screen Team Overview is showing, and --
  // while drilled into one rep's bivy -- which rep, filtering the sidebar/main view down
  // to just their assigned deals. managerViewRep is null in every other view.
  const [orgMembers,setOrgMembers]=useState([]);
  const [showManagerOverview,setShowManagerOverview]=useState(false);
  const [managerViewRep,setManagerViewRep]=useState(null); // null | {id, name}
  // Bug 2 fix: the reassign select used to commit on the raw onChange event -- a misclick
  // instantly handed a live deal to the wrong person, no way back except knowing to
  // reassign it again. Staged now: selecting a name only sets this pending choice; nothing
  // actually moves until the explicit Confirm click below.
  const [pendingReassign,setPendingReassign]=useState(null); // null | {dealId, newRepId, newRepName}

  // Rep path only: track the Supabase Auth session. Errors here (e.g. a network/CORS
  // problem reaching Supabase) are surfaced instead of leaving the app stuck silently on
  // the loading screen forever.
  useEffect(()=>{
    if(prospectShareSlug)return;
    sb.auth.getSession().then(({data})=>setSession(data.session)).catch(e=>setInitError(e.message||String(e)));
    // PASSWORD_RECOVERY fires when the user lands via their emailed reset link -- Supabase
    // establishes a real session at that point (session below won't be null), which would
    // otherwise drop them straight into the app instead of the "set new password" screen.
    const {data:sub}=sb.auth.onAuthStateChange((authEvent,s)=>{setSession(s);if(authEvent==="PASSWORD_RECOVERY")setIsPasswordRecovery(true);});
    return ()=>sub.subscription.unsubscribe();
  },[prospectShareSlug]);

  // Rep path only: once signed in, resolve org membership and load real deals.
  useEffect(()=>{
    if(prospectShareSlug||!session)return;
    let cancelled=false;
    (async()=>{
      setLoadingDeals(true);
      try{
      let {data:mem,error:memErr}=await sb.from("organization_members").select("org_id,role,is_admin,is_manager,status").eq("user_id",session.user.id).limit(1).maybeSingle();
      if(cancelled)return;
      if(memErr)throw memErr;
      if(!mem){
        // No membership yet -- check for a pending team invitation before concluding this
        // is a brand-new user who needs their own org created. See accept_pending_invite in
        // 0010_org_invitations.sql for why this only auto-joins a verified email.
        const {data:joinedOrgId,error:acceptErr}=await sb.rpc("accept_pending_invite");
        if(cancelled)return;
        if(acceptErr)throw acceptErr;
        if(joinedOrgId){
          ({data:mem,error:memErr}=await sb.from("organization_members").select("org_id,role,is_admin,is_manager,status").eq("user_id",session.user.id).limit(1).maybeSingle());
          if(cancelled)return;
          if(memErr)throw memErr;
        }else{
          // Not an invited teammate -- org_name/full_name/phone/terms_accepted_at were
          // carried through signup as user metadata (see AuthGate.submit()) precisely so
          // this moment, whenever a real session finally exists, needs no form and no
          // re-asking. Missing org_name only happens for an account that predates this
          // metadata-carrying signup, or some other session-creating path this app doesn't
          // have yet -- NameYourOrg stays as the fallback for exactly that edge case.
          const meta=session.user.user_metadata||{};
          if(meta.org_name){
            const {error:rpcErr}=await sb.rpc("create_organization_with_owner",{p_org_name:meta.org_name,p_full_name:meta.full_name||null,p_phone:meta.phone||null});
            if(cancelled)return;
            if(rpcErr)throw rpcErr;
            ({data:mem,error:memErr}=await sb.from("organization_members").select("org_id,role,is_admin,is_manager,status").eq("user_id",session.user.id).limit(1).maybeSingle());
            if(cancelled)return;
            if(memErr)throw memErr;
          }
        }
        if(mem){
          // One-time backfill onto profiles, covering the invited-teammate path too (whose
          // own accept_pending_invite insert leaves full_name/phone blank today). Harmless
          // no-op on every later login -- this whole block only runs when membership didn't
          // already exist.
          const meta=session.user.user_metadata||{};
          if(meta.full_name||meta.phone||meta.terms_accepted_at){
            await sb.from("profiles").update({
              ...(meta.full_name?{full_name:meta.full_name}:{}),
              ...(meta.phone?{phone:meta.phone}:{}),
              ...(meta.terms_accepted_at?{terms_accepted_at:meta.terms_accepted_at}:{}),
            }).eq("id",session.user.id);
            if(cancelled)return;
          }
        }
      }
      if(!mem){setNeedsOrgSetup(true);setLoadingDeals(false);return;}
      setNeedsOrgSetup(false);
      setOrgId(mem.org_id);
      setMyRole(mem.role);
      setIsAdmin(!!mem.is_admin);
      setIsManager(!!mem.is_manager);
      const {data:rows,error:rowsErr}=await sb.from("deals").select("*, stakeholders(*), deal_tasks(*), deal_experience_items(*), documents(*)").eq("org_id",mem.org_id).is("archived_at",null);
      if(cancelled)return;
      // A failed query must not be silently treated as "zero deals exist" -- surface it
      // as a real error instead (caught below), same principle as the rest of this fix.
      if(rowsErr)throw rowsErr;
      const mapped=(rows||[]).map(mapDealFromDb);

      // View counts and activity log are event-table aggregates, not stored fields --
      // fetch once per org load and merge in. Both will legitimately come back empty
      // right now since nothing yet writes a document_views/deal_visits row (no real
      // document viewer exists to trigger from) -- the plumbing is correct and ready for
      // when that instrumentation gets built.
      const allDocIds=mapped.flatMap(d=>d.content.map(c=>c.id));
      const allDealIds=mapped.map(d=>d.id);
      // Includes each deal's current assignedTo, not just contributorIds (created_by +
      // whoever's touched a stakeholder/task/document) -- a deal freshly reassigned to a
      // rep who hasn't added anything to it yet would otherwise have no profile fetched
      // for them, and repProfile below would wrongly come back null.
      const allContributorIds=Array.from(new Set([...mapped.flatMap(d=>d.contributorIds),...mapped.map(d=>d.assignedTo)].filter(Boolean)));
      const [{data:viewStats},{data:visits},{data:contributors},{data:riskRows},{data:orgRow},{data:myProfileRow}]=await Promise.all([
        allDocIds.length?sb.from("document_view_stats").select("*").in("document_id",allDocIds):{data:[]},
        allDealIds.length?sb.from("deal_visits").select("*, deal_visit_actions(*)").in("deal_id",allDealIds).order("started_at",{ascending:false}):{data:[]},
        // profiles has no direct FK to deals/stakeholders/etc, so this can't be embedded in
        // the main deals query -- same merge-in-JS pattern SettingsModal uses for members.
        // Widened beyond id/email/full_name (originally just for the avatar cluster) to
        // also cover title/phone/linkedin/avatar -- the same fetch now doubles as the
        // rep-profile source for the Welcome tab's AE card, no extra query needed.
        allContributorIds.length?sb.from("profiles").select("id,email,full_name,avatar_url,title,phone,linkedin_url,calendly_url").in("id",allContributorIds):{data:[]},
        allDealIds.length?sb.from("deal_risk_signals").select("*").in("deal_id",allDealIds):{data:[]},
        sb.from("organizations").select("name,deal_room_limit,subscription_status,trial_ends_at,stripe_subscription_id,onboarding_seen,stage_labels,post_signature_stage_labels,plan_tier,current_period_end").eq("id",mem.org_id).single(),
        sb.from("profiles").select("full_name,email,avatar_url,title").eq("id",session.user.id).single(),
      ]);
      if(cancelled)return;

      const statsByDoc=Object.fromEntries((viewStats||[]).map(v=>[v.document_id,v]));
      const visitsByDeal={};
      (visits||[]).forEach(v=>{(visitsByDeal[v.deal_id]=visitsByDeal[v.deal_id]||[]).push(v);});
      const profileById=Object.fromEntries((contributors||[]).map(p=>[p.id,p]));
      const riskByDeal=Object.fromEntries((riskRows||[]).map(r=>[r.deal_id,r]));
      const orgName=orgRow?.name||null;
      setDealRoomLimit(orgRow?.deal_room_limit||10);
      setSubscriptionStatus(orgRow?.subscription_status||"trialing");
      setTrialEndsAt(orgRow?.trial_ends_at||null);
      setHasStripeSubscription(!!orgRow?.stripe_subscription_id);
      setPlanTier(orgRow?.plan_tier||"trial");
      setCurrentPeriodEnd(orgRow?.current_period_end||null);
      setShowWelcome(orgRow?.onboarding_seen===false);
      setStageLabels({...DEFAULT_STAGE_LABELS,...(orgRow?.stage_labels||{})});
      setPostSignatureStageLabels({...DEFAULT_POST_SIGNATURE_STAGE_LABELS,...(orgRow?.post_signature_stage_labels||{})});
      if(myProfileRow){
        const name=myProfileRow.full_name||myProfileRow.email;
        setMyProfile({name,email:myProfileRow.email,photo:myProfileRow.avatar_url,title:myProfileRow.title,initials:initialsOf(name)});
      }

      const enriched=mapped.map(d=>({
        ...d,
        content:d.content.map(c=>{
          const stat=statsByDoc[c.id];
          return stat?{...c,views:stat.view_count,viewers:stat.viewer_names||[],lastViewed:stat.last_viewer_name?`${stat.last_viewer_name} · ${relTime(stat.last_viewed_at)}`:"Not yet viewed"}:c;
        }),
        activityLog:Object.entries(
          (visitsByDeal[d.id]||[]).reduce((acc,v)=>{
            const day=shortDate(v.started_at)||"Unknown";
            (acc[day]=acc[day]||[]).push({
              person:v.visitor_name||"Unknown",email:v.visitor_email||"",location:v.location||"",
              time:new Date(v.started_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
              duration:fmtDuration(v.duration_seconds),
              actions:(v.deal_visit_actions||[]).map(a=>({type:a.action_type,item:a.item_label,time:new Date(a.occurred_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})})),
            });
            return acc;
          },{})
        ).map(([date,entries])=>({date,entries})),
        contributors:d.contributorIds.map(id=>{
          const p=profileById[id];
          const name=p?.full_name||p?.email||"";
          return {id,name:name||"Unknown",initials:initialsOf(name)||"?",count:d.contributorCounts[id]||1};
        }),
        orgName,
        // Follows the deal's CURRENT assignee, not its creator -- this is the "who does
        // the prospect see as their rep" card (name/photo/phone/Calendly link), so a
        // reassigned deal needs to show the new owner, not whoever originally set the
        // room up. See the matching fix in get_deal_for_prospect (0037) for the same
        // card on the prospect-facing RPC path.
        repProfile:(()=>{
          const p=profileById[d.assignedTo];
          if(!p)return null;
          const name=p.full_name||p.email;
          return {name,email:p.email,photo:p.avatar_url,title:p.title,phone:p.phone,linkedin:p.linkedin_url,calendly:p.calendly_url,initials:initialsOf(name)};
        })(),
        risk:(()=>{const r=riskByDeal[d.id];return r?{
          goingCold:r.going_cold,stalled:r.stalled,buyerDisengaged:!!r.disengaged_buyer_name,
          daysSinceVisit:r.days_since_visit,daysSinceTaskActivity:r.days_since_task_activity,
          disengagedBuyerName:r.disengaged_buyer_name,
        }:null;})(),
      }));

      setDeals(enriched);
      setActiveId(enriched[0]?.id??null);
      setLoadingDeals(false);
      }catch(e){
        if(!cancelled){setInitError(e.message||String(e));setLoadingDeals(false);}
      }
    })();
    return ()=>{cancelled=true;};
  },[session,prospectShareSlug,refreshKey]);

  // Admin Portal / Team Overview support: the org roster, merged with profiles for display
  // names/avatars -- same merge-in-JS pattern as SettingsModal's Team tab (organization_members
  // and profiles both reference auth.users independently, no direct FK PostgREST can embed).
  // Gated on the new is_admin/is_manager flags, not the legacy role column -- a plain Rep
  // (neither flag set) never pays for this query, since they can't see either screen anyway.
  useEffect(()=>{
    if(prospectShareSlug||!orgId||!(isAdmin||isManager))return;
    let cancelled=false;
    (async()=>{
      const {data:mem}=await sb.from("organization_members").select("id,user_id,role,is_admin,is_manager,status").eq("org_id",orgId);
      if(cancelled)return;
      const userIds=(mem||[]).map(m=>m.user_id);
      const {data:profiles}=userIds.length?await sb.from("profiles").select("id,email,full_name,avatar_url").in("id",userIds):{data:[]};
      if(cancelled)return;
      const profileById=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
      setOrgMembers((mem||[]).map(m=>({...m,profile:profileById[m.user_id]||null})));
    })();
    return ()=>{cancelled=true;};
  },[prospectShareSlug,orgId,isAdmin,isManager]);

  // Resets the active deal selection whenever a manager drills into (or backs out of) a
  // rep's filtered view -- OR whenever `deals` itself changes underneath the current
  // selection, e.g. the active deal gets reassigned to a different rep mid-drill-in, or
  // deleted -- so it never silently keeps showing a deal that isn't even in the
  // now-visible set. `deals` in the dependency array (not just managerViewRep) is load-
  // bearing: without it, reassigning or deleting the active deal during a drill-in left
  // activeId pointing at a no-longer-visible deal until the next manual sidebar click.
  useEffect(()=>{
    const visible=managerViewRep?deals.filter(d=>d.assignedTo===managerViewRep.id):deals;
    if(!visible.find(d=>d.id===activeId))setActiveId(visible[0]?.id??null);
  },[managerViewRep,deals]);

  // Clears any staged-but-unconfirmed reassignment (Bug 2 fix) the moment the active deal
  // or drill-in target changes out from under it -- a pending "move to X?" prompt must never
  // silently survive a sidebar click onto a different deal, or an exit from the drill-in.
  useEffect(()=>{setPendingReassign(null);},[activeId,managerViewRep]);

  // Visit-duration heartbeat: a browser can't reliably signal "the tab just closed", so
  // this tracks visible-time via the Page Visibility API and periodically overwrites (not
  // accumulates) duration_seconds -- the server clamps it, so an overlapping/late call
  // can never record less real data than an earlier one. beforeunload is a best-effort
  // extra flush, not the primary mechanism (navigator.sendBeacon can't carry the Supabase
  // bearer token this RPC needs, so a guaranteed terminal write isn't possible here).
  useEffect(()=>{
    if(!prospectVisit)return;
    let visibleAccumMs=0;
    let lastResume=document.visibilityState==="visible"?Date.now():null;
    const flush=()=>{
      const totalMs=visibleAccumMs+(lastResume?Date.now()-lastResume:0);
      sb.rpc("update_deal_visit_duration",{p_visit_id:prospectVisit.id,p_duration_seconds:Math.round(totalMs/1000)});
    };
    const onVisibility=()=>{
      if(document.visibilityState==="hidden"){
        if(lastResume){visibleAccumMs+=Date.now()-lastResume;lastResume=null;}
        flush();
      }else{
        lastResume=Date.now();
      }
    };
    document.addEventListener("visibilitychange",onVisibility);
    window.addEventListener("beforeunload",flush);
    const interval=setInterval(flush,25000);
    return ()=>{
      document.removeEventListener("visibilitychange",onVisibility);
      window.removeEventListener("beforeunload",flush);
      clearInterval(interval);
    };
  },[prospectVisit]);

  // Manager drill-in (TEAM-VERSION-ADMIN-MANAGER-SPEC.md): reuses this same sidebar/main
  // view, just pre-filtered to one rep's assigned deals instead of "everything I can see"
  // -- the only place this filter needs applying, since RLS already did the owner/admin-
  // sees-everything-vs-member-sees-own-only split server-side for `deals` itself.
  const visibleDeals=managerViewRep?deals.filter(d=>d.assignedTo===managerViewRep.id):deals;
  const deal=visibleDeals.find(d=>d.id===activeId);
  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),2800);};
  // organizations_update RLS (owner-only) already covers this -- whoever can see the welcome
  // overlay is by definition the org's owner, no new RPC needed.
  const dismissWelcome=async()=>{await sb.from("organizations").update({onboarding_seen:true}).eq("id",orgId);setShowWelcome(false);};

  // Import-only: a spreadsheet's "Reports To" column holds a sibling stakeholder's name,
  // not an id -- ids don't exist until after insert. Matches both self and target by name
  // (not array position) against the full set of stakeholders now on the deal (existing
  // + newly inserted), so it works whether the manager is a brand-new row or one already
  // on the deal. A name that doesn't match anyone is left unset, not an error.
  const resolveReportsTo=async(sourceStakeholders,allDealStakeholders)=>{
    const byName=name=>allDealStakeholders.find(r=>r.name.toLowerCase()===name.toLowerCase());
    for(const s of sourceStakeholders){
      if(!s.reportsToName)continue;
      const self=byName(s.name);
      const target=byName(s.reportsToName);
      if(self&&target&&self.id!==target.id&&!self.reports_to){
        await sb.from("stakeholders").update({reports_to:target.id}).eq("id",self.id);
      }
    }
  };

  // Just the inserts, no UI feedback -- shared by the single-deal flow (createDeal) and
  // the bulk spreadsheet import (importDeals), which each need their own toast/refresh
  // behavior (one per deal vs. one summary for the whole batch) rather than duplicating
  // this insert logic twice.
  const insertDeal=async(draft)=>{
    const slugBase=(draft.company||"deal").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"deal";
    const shareSlug=`${slugBase}-${crypto.randomUUID().slice(0,8)}`;
    const accessCode=(draft.accessCode||Math.random().toString(36).slice(2,8).toUpperCase()).toUpperCase();
    const {data:newDeal,error}=await sb.from("deals").insert({
      org_id:orgId,
      created_by:session.user.id,
      // DEFAULT (TEAM-VERSION-ADMIN-MANAGER-SPEC.md): every deal is assigned to its
      // creator at creation time; owner/admin can hand it off to a different rep later
      // (Manager Overview drill-in banner).
      assigned_to:session.user.id,
      company_name:draft.company,
      primary_contact_name:draft.contact||null,
      title:draft.title||null,
      stage:"Discovery",
      value_amount:parseFloat((draft.value||"").replace(/[^0-9.]/g,""))||null,
      close_date:draft.closeDate||null,
      logo_initials:draft.logo||(draft.company||"").slice(0,2).toUpperCase(),
      brand_color:draft.color||P.accent,
      industry:draft.industry||null,
      engagement_score:50,
      include_trial_sessions:!!draft.includeTrialSessions,
      welcome_message:draft.welcomeMsg||null,
      exec_summary:draft.execSummary||{},
      discovery:draft.discovery||{},
      share_slug:shareSlug,
      access_code:accessCode,
    }).select().single();
    if(error||!newDeal)return{ok:false};

    if((draft.stakeholders||[]).length){
      const{data:inserted}=await sb.from("stakeholders").insert(draft.stakeholders.map(s=>({
        deal_id:newDeal.id,created_by:session.user.id,name:s.name,role_title:s.role,
        designation:s.designation,engagement_score:s.engagement??50,business_unit:s.bu||null,
        email:s.email||null,approval_required:!!s.approvalRequired,linkedin_url:s.linkedin||null,
      }))).select();
      await resolveReportsTo(draft.stakeholders,inserted);
    }
    if((draft.mapItems||[]).length){
      await sb.from("deal_tasks").insert(draft.mapItems.map((t,i)=>({
        deal_id:newDeal.id,created_by:session.user.id,phase:t.phase,task:t.task,
        owner_name:t.owner||null,buyer_owner_label:t.buyerOwner||null,due_date:t.dueDate||null,
        status:t.status||"pending",notes:t.notes||null,approval_required:!!t.approvalRequired,sort_order:i,
      })));
    }
    return{ok:true,action:"created",id:newDeal.id};
  };

  const createDeal=async(draft)=>{
    if(guardLocked())return;
    const{ok}=await insertDeal(draft);
    if(!ok){flash("Couldn't create deal room");return;}
    setShowCreator(false);
    flash("Deal room created!");
    setRefreshKey(k=>k+1);
  };

  const deleteDeal=async(dealId)=>{
    const{error}=await sb.from("deals").delete().eq("id",dealId);
    if(error){flash("Couldn't delete deal room");return;}
    setDeals(prev=>{
      const remaining=prev.filter(d=>d.id!==dealId);
      if(activeId===dealId)setActiveId(remaining[0]?.id??null);
      return remaining;
    });
    setShowDeleteDeal(false);
    flash("Deal room deleted");
  };

  const updateDealInfo=async(draft)=>{
    if(guardLocked())return;
    const logo=draft.company.slice(0,2).toUpperCase();
    // assignedTo only ever arrives here from EditDealModal's owner/admin-only "Assigned
    // To" control (undefined for anyone else, since that field doesn't render without
    // canReassign) -- reuses the same reassignDeal write can_manage_deal already allows,
    // just folded into this one save instead of a second round trip.
    const {error}=await sb.from("deals").update({
      company_name:draft.company,title:draft.title||null,
      value_amount:parseFloat(draft.value)||null,close_date:draft.closeDate||null,
      logo_initials:logo,
      ...(draft.assignedTo?{assigned_to:draft.assignedTo}:{}),
    }).eq("id",deal.id);
    if(error){flash("Couldn't save changes");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,company:draft.company,title:draft.title,value:fmtCurrency(parseFloat(draft.value)||0),closeDate:draft.closeDate||null,logo,...(draft.assignedTo?{assignedTo:draft.assignedTo}:{})}));
    setShowEditDeal(false);
    flash("Deal updated");
  };

  // Owner/admin only (can_manage_deal, tightened in 0036 to also cover the deal's
  // current assignee -- see that migration's comment for why). The deal_assignment_history
  // trigger (0034) logs the change server-side regardless of this call site, so nothing
  // extra needs writing here for the audit trail.
  const reassignDeal=async(dealId,newRepId)=>{
    const {error}=await sb.from("deals").update({assigned_to:newRepId}).eq("id",dealId);
    if(error){flash("Couldn't reassign deal");return;}
    setDeals(prev=>prev.map(d=>d.id!==dealId?d:{...d,assignedTo:newRepId}));
    flash("Deal reassigned");
  };

  // Team Admin/Manager Rework, Decisions #2: a real permission grant, not a client-side
  // display toggle -- flips is_manager on the Admin's OWN organization_members row, so
  // current_org_is_manager() (and every RLS policy keyed off it) genuinely changes what
  // this session can see, not just what the UI happens to render. Visible on the Admin's
  // own roster row like anyone else's (SettingsModal's Team tab reads the same is_manager
  // column), not a hidden override.
  const toggleViewAsManager=async()=>{
    const next=!isManager;
    const {error}=await sb.from("organization_members").update({is_manager:next}).eq("org_id",orgId).eq("user_id",session.user.id);
    if(error){flash("Couldn't switch view");return;}
    setIsManager(next);
    if(!next){setShowManagerOverview(false);setManagerViewRep(null);}
    // Found live during QA: the main deals fetch (org-load effect) doesn't depend on
    // isManager at all, so without this, an Admin's own already-loaded (and, pre-toggle,
    // RLS-restricted-to-nothing-of-their-own) deals array silently kept showing stale/empty
    // results after flipping is_manager, since deals_select genuinely returns more rows now
    // but nothing re-ran the query to pick that up. refreshKey is this app's existing
    // "force the org-load effect to rerun" mechanism (see createDeal/importDeals).
    setRefreshKey(k=>k+1);
  };

  // One row = one deal, per Mark's explicit scope call: bulk-onboarding an existing
  // pipeline, not bulk-adding stakeholders into a single deal. Sequential toast/refresh
  // (not per-row) -- see insertDeal's own comment for why the two are split.
  // Re-uploading the same (or an updated) spreadsheet must not create duplicates. A row
  // whose Company matches an existing deal (case-insensitive) updates that deal instead
  // of inserting a new one -- and only fills fields currently blank, never overwrites
  // something already there. `deal.value` is deliberately excluded: fmtCurrency turns
  // even a genuinely-unset amount into "$0", never an empty string, so "is it blank"
  // can't be told apart from "it's really $0" without a separate raw-value fetch --
  // not worth it since deal value is normally set at creation anyway.
  const mergeDealFromImport=async(existing,draft)=>{
    const patch={};
    if(!existing.contact&&draft.contact)patch.primary_contact_name=draft.contact;
    if(!existing.title&&draft.title)patch.title=draft.title;
    if(!existing.closeDate&&draft.closeDate)patch.close_date=draft.closeDate;
    if(!existing.industry&&draft.industry)patch.industry=draft.industry;
    if(!existing.welcomeMsg&&draft.welcomeMsg)patch.welcome_message=draft.welcomeMsg;
    const es={...existing.execSummary};let esChanged=false;
    if(!es.problem&&draft.execSummary.problem){es.problem=draft.execSummary.problem;esChanged=true;}
    if(!(es.challenges||[]).length&&draft.execSummary.challenges.length){es.challenges=draft.execSummary.challenges;esChanged=true;}
    if(!(es.solutions||[]).length&&draft.execSummary.solutions.length){es.solutions=draft.execSummary.solutions;esChanged=true;}
    if(esChanged)patch.exec_summary=es;
    const disc={...existing.discovery,goals:{...existing.discovery?.goals}};let discChanged=false;
    if(!disc.summary&&draft.discovery.summary){disc.summary=draft.discovery.summary;discChanged=true;}
    if(!disc.primaryUseCase&&draft.discovery.primaryUseCase){disc.primaryUseCase=draft.discovery.primaryUseCase;discChanged=true;}
    ["corporateStrategy","topOutcomes","challenges","jobsToBeDone"].forEach(k=>{
      if(!(disc[k]||[]).length&&(draft.discovery[k]||[]).length){disc[k]=draft.discovery[k];discChanged=true;}
    });
    GOAL_PERIODS.forEach(period=>{
      if(!(disc.goals[period]||[]).length&&(draft.discovery.goals[period]||[]).length){disc.goals[period]=draft.discovery.goals[period];discChanged=true;}
    });
    if(discChanged)patch.discovery=disc;
    if(Object.keys(patch).length){
      const{error}=await sb.from("deals").update(patch).eq("id",existing.id);
      if(error)return{ok:false};
    }

    const insertedNew=[];
    for(const s of draft.stakeholders){
      const match=existing.stakeholders.find(es2=>es2.name.toLowerCase()===s.name.toLowerCase());
      if(!match){
        const{data}=await sb.from("stakeholders").insert({
          deal_id:existing.id,created_by:session.user.id,name:s.name,role_title:s.role,
          designation:s.designation,engagement_score:s.engagement??50,business_unit:s.bu||null,
          email:s.email||null,linkedin_url:s.linkedin||null,approval_required:!!s.approvalRequired,
        }).select().single();
        if(data)insertedNew.push(data);
        continue;
      }
      const sPatch={};
      if(!match.role&&s.role)sPatch.role_title=s.role;
      if(!match.bu&&s.bu)sPatch.business_unit=s.bu;
      if(!match.email&&s.email)sPatch.email=s.email;
      if(!match.linkedin&&s.linkedin)sPatch.linkedin_url=s.linkedin;
      // engagement_score always has a value (50 default at creation) -- only treat that
      // exact default as "still unset" so a real, deliberately-recorded 50 isn't churned.
      if(match.engagement===50&&s.engagement!==50)sPatch.engagement_score=s.engagement;
      if(Object.keys(sPatch).length)await sb.from("stakeholders").update(sPatch).eq("id",match.id);
    }
    const allDealStakeholders=[
      ...existing.stakeholders.map(s=>({id:s.id,name:s.name,reports_to:s.reportsTo})),
      ...insertedNew.map(r=>({id:r.id,name:r.name,reports_to:r.reports_to})),
    ];
    await resolveReportsTo(draft.stakeholders,allDealStakeholders);
    return{ok:true,action:"updated"};
  };

  const importDeals=async(drafts)=>{
    if(guardLocked())return;
    // Matches against a fresh read from Supabase, not the deals already sitting in React
    // state -- if a previous import's post-import refetch (setRefreshKey below) hadn't
    // resolved yet by the time this import started, matching against stale state would
    // miss a company that in fact already exists, creating a duplicate instead of
    // updating it. Also processed sequentially (not Promise.all) and the tracking list
    // is appended to after each row, so two rows for the same new company *within the
        // same file* also merge into one instead of creating two.
    const{data:freshRows}=await sb.from("deals").select("*, stakeholders(*)").eq("org_id",orgId).is("archived_at",null);
    const known=(freshRows||[]).map(mapDealFromDb);
    const results=[];
    // Updates (matched by company name) never count against the limit -- only a genuinely
    // new row does, matching the enforce_deal_room_limit trigger (0017) this mirrors for UX.
    for(const draft of drafts){
      const existing=known.find(d=>d.company.toLowerCase()===draft.company.toLowerCase());
      if(!existing&&known.length>=dealRoomLimit){
        results.push({ok:false,action:"limit",company:draft.company});
        continue;
      }
      const result=existing?await mergeDealFromImport(existing,draft):await insertDeal(draft);
      if(result.ok&&result.action==="created"){
        known.push({...draft,id:result.id,company:draft.company,stakeholders:[]});
      }
      results.push(result);
    }
    const createdCount=results.filter(r=>r.ok&&r.action==="created").length;
    const updatedCount=results.filter(r=>r.ok&&r.action==="updated").length;
    const limitSkippedCount=results.filter(r=>r.action==="limit").length;
    const failCount=results.filter(r=>!r.ok&&r.action!=="limit").length;
    setShowCreator(false);
    const parts=[];
    if(createdCount)parts.push(`${createdCount} created`);
    if(updatedCount)parts.push(`${updatedCount} updated`);
    if(failCount)parts.push(`${failCount} failed`);
    if(limitSkippedCount)parts.push(`Plan limit reached (${dealRoomLimit} active deal rooms) — ${limitSkippedCount} not imported`);
    flash(parts.join(", "));
    setRefreshKey(k=>k+1);
  };

  // Task mutations: write to Supabase first, then reflect the confirmed result in local
  // state. can_manage_deal (creator or org owner/admin) already gates these at the RLS
  // layer -- a member who doesn't own this deal simply gets an error back.
  const updateTaskStatus=async(taskId,status)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deal_tasks").update({status}).eq("id",taskId);
    if(error){flash(error.message||"Couldn't update task");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:d.mapItems.map(t=>t.id===taskId?{...t,status}:t)}));
  };

  const deleteTask=async(taskId)=>{
    const {error}=await sb.from("deal_tasks").delete().eq("id",taskId);
    if(error){flash(error.message||"Couldn't delete task");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:d.mapItems.filter(t=>t.id!==taskId)}));
  };

  // Full-field edit from TaskModal (opened via the task ring) -- mirrors
  // updateTaskStatus's shape but covers every editable field, not just status.
  const updateTask=async(taskId,draft)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deal_tasks").update({
      task:draft.task,phase:draft.phase,owner_name:draft.owner||null,buyer_owner_label:draft.buyerOwner||null,
      due_date:draft.dueDate||null,status:draft.status,notes:draft.notes||null,approval_required:!!draft.approvalRequired,
      calendly_enabled:!!draft.calendlyEnabled,
    }).eq("id",taskId);
    if(error){flash(error.message||"Couldn't update task");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:d.mapItems.map(t=>t.id!==taskId?t:{
      ...t,task:draft.task,phase:draft.phase,owner:draft.owner,buyerOwner:draft.buyerOwner,
      dueDate:draft.dueDate,status:draft.status,notes:draft.notes,approvalRequired:draft.approvalRequired,
      calendlyEnabled:draft.calendlyEnabled,
    })}));
    setEditingTask(null);
    flash("Task updated");
  };

  const addTask=async(draft)=>{
    if(guardLocked())return;
    const {data,error}=await sb.from("deal_tasks").insert({
      deal_id:deal.id,
      created_by:session.user.id,
      phase:draft.phase,
      task:draft.task,
      owner_name:draft.owner||null,
      buyer_owner_label:draft.buyerOwner||null,
      due_date:draft.dueDate||null,
      status:"pending",
      notes:draft.notes||null,
      approval_required:!!draft.approvalRequired,
      calendly_enabled:!!draft.calendlyEnabled,
      sort_order:deal.mapItems.length,
    }).select().single();
    if(error||!data){flash((error&&error.message)||"Couldn't add task");return;}
    const mapped={id:data.id,phase:data.phase,task:data.task,owner:data.owner_name,buyerOwner:data.buyer_owner_label,dueDate:data.due_date,status:data.status,notes:data.notes,approvalRequired:data.approval_required,calendlyEnabled:data.calendly_enabled};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:[...d.mapItems,mapped]}));
    setNewTask({phase:"Value Alignment",task:"",owner:"",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false,calendlyEnabled:false});
    setShowAddTask(null);
    flash("Task added");
  };

  // Post-signature "Experience item" mutations -- 1:1 structural mirror of the deal_tasks
  // CRUD above, targeting deal_experience_items/deal.experienceItems instead. deleteExperienceItem
  // deliberately skips guardLocked(), matching deleteTask's own exemption (billing lock never
  // blocks deletes) -- freeze enforcement for the inactive sequence is a separate DB trigger
  // (enforce_active_sequence, 0028) that applies regardless of billing state.
  const updateExperienceStatus=async(itemId,status)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deal_experience_items").update({status}).eq("id",itemId);
    if(error){flash(error.message||"Couldn't update experience item");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,experienceItems:d.experienceItems.map(t=>t.id===itemId?{...t,status}:t)}));
  };

  const deleteExperienceItem=async(itemId)=>{
    const {error}=await sb.from("deal_experience_items").delete().eq("id",itemId);
    if(error){flash(error.message||"Couldn't delete experience item");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,experienceItems:d.experienceItems.filter(t=>t.id!==itemId)}));
  };

  const updateExperienceItem=async(itemId,draft)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deal_experience_items").update({
      task:draft.task,phase:draft.phase,owner_name:draft.owner||null,buyer_owner_label:draft.buyerOwner||null,
      due_date:draft.dueDate||null,status:draft.status,notes:draft.notes||null,approval_required:!!draft.approvalRequired,
      calendly_enabled:!!draft.calendlyEnabled,
    }).eq("id",itemId);
    if(error){flash(error.message||"Couldn't update experience item");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,experienceItems:d.experienceItems.map(t=>t.id!==itemId?t:{
      ...t,task:draft.task,phase:draft.phase,owner:draft.owner,buyerOwner:draft.buyerOwner,
      dueDate:draft.dueDate,status:draft.status,notes:draft.notes,approvalRequired:draft.approvalRequired,
      calendlyEnabled:draft.calendlyEnabled,
    })}));
    setEditingExperienceItem(null);
    flash("Experience item updated");
  };

  const addExperienceItem=async(draft)=>{
    if(guardLocked())return;
    const {data,error}=await sb.from("deal_experience_items").insert({
      deal_id:deal.id,
      created_by:session.user.id,
      phase:draft.phase,
      task:draft.task,
      owner_name:draft.owner||null,
      buyer_owner_label:draft.buyerOwner||null,
      due_date:draft.dueDate||null,
      status:"pending",
      notes:draft.notes||null,
      approval_required:!!draft.approvalRequired,
      calendly_enabled:!!draft.calendlyEnabled,
      sort_order:deal.experienceItems.length,
    }).select().single();
    if(error||!data){flash((error&&error.message)||"Couldn't add experience item");return;}
    const mapped={id:data.id,phase:data.phase,task:data.task,owner:data.owner_name,buyerOwner:data.buyer_owner_label,dueDate:data.due_date,status:data.status,notes:data.notes,approvalRequired:data.approval_required,calendlyEnabled:data.calendly_enabled};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,experienceItems:[...d.experienceItems,mapped]}));
    setNewExperienceItem({phase:"Kickoff & Intro",task:"",owner:"",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false,calendlyEnabled:false});
    setShowAddExperience(null);
    flash("Experience item added");
  };

  // Manual, reversible per-deal toggle (0028) -- which sequence is currently shown/editable.
  // guardLocked() here is purely for a consistent client-side billing message; the DB's
  // existing enforce_org_not_locked trigger already covers this at the deals-update layer.
  const toggleSequenceView=async(view)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deals").update({active_sequence_view:view}).eq("id",deal.id);
    if(error){flash(error.message||"Couldn't switch view");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,activeSequenceView:view}));
  };

  // Executive Summary / Discovery are just JSONB columns on deals -- editing them is a
  // plain deals update, already permitted by the existing can_manage_deal-keyed
  // deals_update RLS policy (0003), same boundary every other mutation here relies on.
  const updateExecSummary=async(newExecSummary)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deals").update({exec_summary:newExecSummary}).eq("id",deal.id);
    if(error){flash("Couldn't save changes");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,execSummary:newExecSummary}));
    flash("Executive Summary updated");
  };

  // Simple, clean document: header, then Problem/Key Challenges/Solutions with manual
  // line-wrapping and page breaks -- no library beyond jsPDF itself needed for content
  // this straightforward.
  // Redesigned per exec-summary-mockup.pdf (approved as final design) -- same underlying
  // execSummary.problem/challenges/solutions fields as before, only the visual layout and
  // two section labels ("Business Objective"/"Solution") change.
  const downloadExecSummaryPdf=()=>{
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF();
    const pageWidth=doc.internal.pageSize.getWidth();
    const pageHeight=doc.internal.pageSize.getHeight();
    const margin=20;
    const maxWidth=pageWidth-margin*2;
    const rightX=pageWidth-margin;

    // -- Header band --
    const headerH=44;
    doc.setFillColor(27,31,35); // P.ink
    doc.rect(0,0,pageWidth,headerH,"F");
    doc.setFont(undefined,"normal");doc.setFontSize(9);doc.setTextColor(160,164,168);
    doc.text("myBivy  ·  provided by SRENE.io",margin,16);
    doc.setFont(undefined,"bold");doc.setFontSize(20);doc.setTextColor(255,255,255);
    doc.text(deal.company,margin,30);

    // Match the primary contact against stakeholders by name for role/department -- name
    // alone, no role line, if nothing matches.
    const matched=(deal.stakeholders||[]).find(s=>s.name&&deal.contact&&s.name.toLowerCase()===deal.contact.toLowerCase());
    if(deal.contact){
      doc.setFont(undefined,"bold");doc.setFontSize(8);doc.setTextColor(244,242,237); // P.chalk
      doc.text("EVALUATION BY:",rightX,14,{align:"right"});
      doc.setFont(undefined,"bold");doc.setFontSize(12);doc.setTextColor(255,255,255);
      doc.text(deal.contact,rightX,22,{align:"right"});
      const roleLine=matched?[matched.role,matched.bu].filter(Boolean).join(", "):"";
      if(roleLine){
        doc.setFont(undefined,"normal");doc.setFontSize(9.5);doc.setTextColor(214,212,207);
        doc.text(roleLine,rightX,29,{align:"right"});
      }
    }

    let y=headerH+16;
    const ensureRoom=h=>{if(y+h>pageHeight-margin){doc.addPage();y=margin;}};
    const sectionBar=title=>{
      ensureRoom(16);
      doc.setFillColor(214,95,60); // P.accent
      doc.rect(0,y-7,pageWidth,13,"F");
      doc.setFont(undefined,"bold");doc.setFontSize(11);doc.setTextColor(255,255,255);
      doc.text(title.toUpperCase(),margin,y+2);
      y+=20;
      doc.setTextColor(37,42,46); // P.text
    };
    const addParagraph=text=>{
      doc.setFont(undefined,"normal");doc.setFontSize(10.5);
      const lines=doc.splitTextToSize(text,maxWidth);
      ensureRoom(lines.length*5.5);
      doc.text(lines,margin,y);
      y+=lines.length*5.5+10;
    };
    // Bullet is a drawn dot (terracotta), not a text character, per the mockup.
    const addDotBullets=items=>{
      doc.setFont(undefined,"normal");doc.setFontSize(10.5);
      items.forEach(item=>{
        const lines=doc.splitTextToSize(item,maxWidth-10);
        ensureRoom(lines.length*5.5+4);
        doc.setFillColor(214,95,60);
        doc.circle(margin+2,y-1.5,1.3,"F");
        doc.text(lines,margin+10,y);
        y+=lines.length*5.5+6;
      });
      y+=4;
    };

    sectionBar("Business Objective");
    addParagraph(deal.execSummary?.problem||"");
    if((deal.execSummary?.challenges||[]).length){
      sectionBar("Key Challenges");
      addDotBullets(deal.execSummary.challenges);
    }
    if((deal.execSummary?.solutions||[]).length){
      sectionBar("Solution");
      addParagraph(deal.execSummary.solutions.join(", "));
    }

    // -- Footer: rule, then rep contact block --
    ensureRoom(30);
    y+=4;
    doc.setDrawColor(226,224,218);
    doc.line(margin,y,pageWidth-margin,y);
    y+=10;
    doc.setFont(undefined,"bold");doc.setFontSize(11);doc.setTextColor(37,42,46);
    doc.text(deal.repProfile?.name||"",margin,y);
    y+=6;
    const titleOrgLine=[deal.repProfile?.title,deal.orgName].filter(Boolean).join(", ");
    if(titleOrgLine){
      doc.setFont(undefined,"normal");doc.setFontSize(9.5);doc.setTextColor(107,113,120);
      doc.text(titleOrgLine,margin,y);
      y+=6;
    }
    const contactLine=[deal.repProfile?.email,deal.repProfile?.phone].filter(Boolean).join("  ·  ");
    if(contactLine){
      doc.setFont(undefined,"normal");doc.setFontSize(9.5);doc.setTextColor(107,113,120);
      doc.text(contactLine,margin,y);
    }

    doc.save(`${deal.company.replace(/[^a-zA-Z0-9]+/g,"-")}-executive-summary.pdf`);
  };
  const updateDiscovery=async(newDiscovery)=>{
    if(guardLocked())return;
    const {error}=await sb.from("deals").update({discovery:newDiscovery}).eq("id",deal.id);
    if(error){flash("Couldn't save changes");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,discovery:newDiscovery}));
    flash("Discovery updated");
  };

  // Writes one MEDDPIC field as a stored override -- every other field keeps deriving
  // from Discovery/Stakeholders/Action Plan exactly as before, untouched.
  const updateMeddpicField=async(key,text)=>{
    if(guardLocked())return;
    const newMeddpic={...deal.meddpic,[key]:text};
    const {error}=await sb.from("deals").update({meddpic:newMeddpic}).eq("id",deal.id);
    if(error){flash("Couldn't save changes");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,meddpic:newMeddpic}));
    flash("MEDDPIC updated");
  };

  const addStakeholder=async(draft)=>{
    if(guardLocked())return;
    const {data,error}=await sb.from("stakeholders").insert({
      deal_id:deal.id,created_by:session.user.id,name:draft.name,role_title:draft.role,
      designation:draft.designation,engagement_score:50,business_unit:draft.bu||null,
      email:draft.email||null,linkedin_url:draft.linkedin||null,reports_to:draft.reportsTo,
      approval_required:!!draft.approvalRequired,
    }).select().single();
    if(error||!data){flash("Couldn't add stakeholder");return;}
    const mapped={id:data.id,name:data.name,role:data.role_title,designation:data.designation,engagement:data.engagement_score,lastSeen:"Just added",initials:initialsOf(data.name),bu:data.business_unit,email:data.email,approvalRequired:data.approval_required,docsViewed:[],linkedin:data.linkedin_url,reportsTo:data.reports_to};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,stakeholders:[...d.stakeholders,mapped]}));
    setShowStakeholderModal(false);
    flash("Stakeholder added");
  };

  const updateStakeholder=async(id,draft)=>{
    if(guardLocked())return;
    const {error}=await sb.from("stakeholders").update({
      name:draft.name,role_title:draft.role,designation:draft.designation,business_unit:draft.bu||null,
      email:draft.email||null,linkedin_url:draft.linkedin||null,reports_to:draft.reportsTo,
      approval_required:!!draft.approvalRequired,
    }).eq("id",id);
    if(error){flash("Couldn't update stakeholder");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,stakeholders:d.stakeholders.map(s=>s.id!==id?s:{
      ...s,name:draft.name,role:draft.role,designation:draft.designation,bu:draft.bu,
      email:draft.email,linkedin:draft.linkedin,reportsTo:draft.reportsTo,approvalRequired:draft.approvalRequired,
    })}));
    setEditingStakeholder(null);
    flash("Stakeholder updated");
  };

  const deleteStakeholder=async(id)=>{
    const {error}=await sb.from("stakeholders").delete().eq("id",id);
    if(error){flash("Couldn't remove stakeholder");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{
      ...d,
      // Anyone who reported to the removed stakeholder becomes a root in the org chart
      // rather than pointing at a now-nonexistent id.
      stakeholders:d.stakeholders.filter(s=>s.id!==id).map(s=>s.reportsTo===id?{...s,reportsTo:null}:s),
    }));
    flash("Stakeholder removed");
  };

  // File-type/size limits are enforced for real by the deal-documents bucket's
  // allowed_mime_types/file_size_limit (0012_deal_documents.sql) -- this check is just
  // instant client-side feedback before the round trip, not the actual defense.
  const uploadDocument=async(file)=>{
    const fileType=ALLOWED_DOC_MIME[file.type];
    if(!fileType){flash("That file type isn't supported.");return;}
    if(file.size>26214400){flash("File is too large (25MB max).");return;}
    const path=`${orgId}/${deal.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const {error:upErr}=await sb.storage.from("deal-documents").upload(path,file,{contentType:file.type});
    if(upErr){flash("Upload failed");return;}
    const {data,error:insErr}=await sb.from("documents").insert({
      deal_id:deal.id,created_by:session.user.id,title:file.name,file_type:fileType,
      category:"General",storage_path:path,
    }).select().single();
    if(insErr||!data){flash("Couldn't save file record");return;}
    const mapped={id:data.id,title:data.title,type:data.file_type,uploaded:shortDate(data.created_at),category:data.category,storagePath:data.storage_path,views:0,viewers:[],lastViewed:"Not yet viewed"};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,content:[...d.content,mapped]}));
    flash("File added");
  };

  // "Add Link" counterpart to uploadDocument -- same documents insert, but no Storage
  // upload: is_embed:true and embed_url carry the converted viewer URL, storage_path stays
  // null. {title,fileType,embedUrl} is exactly what parseGoogleDocUrl + the modal's own
  // title field produce (see AddEmbedModal).
  const addEmbedDocument=async({title,fileType,embedUrl})=>{
    if(guardLocked())return;
    const {data,error:insErr}=await sb.from("documents").insert({
      deal_id:deal.id,created_by:session.user.id,title,file_type:fileType,
      category:"General",is_embed:true,embed_url:embedUrl,
    }).select().single();
    if(insErr||!data){flash("Couldn't save link");return;}
    const mapped={id:data.id,title:data.title,type:data.file_type,uploaded:shortDate(data.created_at),category:data.category,storagePath:null,isEmbed:true,embedUrl:data.embed_url,views:0,viewers:[],lastViewed:"Not yet viewed"};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,content:[...d.content,mapped]}));
    setShowAddEmbed(false);
    flash("Link added");
  };

  // "+ Recording" counterpart to addEmbedDocument -- Zoom recording pages set
  // X-Frame-Options and refuse to embed, so this reuses the plain 'link' storage shape
  // (raw URL in storage_path, is_embed:false) instead of the embed_url/iframe path above.
  const addRecordingDocument=async({title,url})=>{
    if(guardLocked())return;
    const {data,error:insErr}=await sb.from("documents").insert({
      deal_id:deal.id,created_by:session.user.id,title,file_type:"video",
      category:"General",is_embed:false,storage_path:url,
    }).select().single();
    if(insErr||!data){flash("Couldn't save recording");return;}
    const mapped={id:data.id,title:data.title,type:data.file_type,uploaded:shortDate(data.created_at),category:data.category,storagePath:data.storage_path,isEmbed:false,views:0,viewers:[],lastViewed:"Not yet viewed"};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,content:[...d.content,mapped]}));
    setShowAddRecording(false);
    flash("Recording added");
  };

  // Signed URL minted on demand (private bucket, so there's no permanent public URL to
  // store) -- the necessary difference from the org-logos public-bucket flow in
  // SettingsModal, which bakes one URL in at upload time.
  // Best-effort: a logging failure must never block the prospect from reading their
  // document. No-ops immediately for a rep (viewMode "rep" or the local preview-as-
  // prospect toggle) since prospectVisit is only ever set via the real, RPC-backed
  // prospect login flow below.
  const logDocumentView=async f=>{
    if(!prospectVisit)return;
    const {data:viewerName,error}=await sb.rpc("log_document_view",{p_visit_id:prospectVisit.id,p_document_id:f.id});
    if(error)return;
    setDeals(prev=>prev.map(d=>d.id!==prospectVisit.dealId?d:{...d,content:d.content.map(c=>c.id!==f.id?c:{
      ...c,
      views:(c.views||0)+1,
      viewers:Array.from(new Set([...(c.viewers||[]),viewerName])),
      lastViewed:`${viewerName} · just now`,
    })}));
  };

  const openDocument=async f=>{
    if(f.isEmbed){setShowEmbedDoc(f);logDocumentView(f);return;}
    if(!f.storagePath){flash("File not available");return;}
    if(f.type==="link"||f.type==="video"){window.open(f.storagePath,"_blank","noopener");logDocumentView(f);return;}
    const {data,error}=await sb.storage.from("deal-documents").createSignedUrl(f.storagePath,300);
    if(error||!data){flash("Couldn't open file");return;}
    window.open(data.signedUrl,"_blank","noopener");
    logDocumentView(f);
  };

  const repTabs=[["map","Action Plan"],["summary","Executive Summary"],["discovery","Discovery"],["stakeholders","Stakeholders"],["content","Content"],["meddpic","MEDDPIC"],["analytics","Analytics"]];
  const prosTabs=[["welcome","Welcome"],["summary","Executive Summary"],["map","Action Plan"],["discovery","Discovery"],["content","Resources"],["stakeholders","Team"]];
  const tabs=viewMode==="prospect"?prosTabs:repTabs;

  const runAI=async(mode,custom)=>{setAiLoading(true);setAiText("");setAiOpen(true);setAiMode(mode);
    const phases=deal.includeTrialSessions?PHASES_ALL:PHASES_NO_TRIAL;
    const visItems=deal.mapItems.filter(t=>phases.includes(t.phase));
    const done=visItems.filter(t=>t.status==="complete").length;
    const ctx=`Deal: ${deal.title} | ${deal.company} | Stage: ${deal.stage} | Value: ${deal.value}\nIndustry: ${deal.industry}\nStakeholders: ${deal.stakeholders.map(s=>`${s.name} (${s.role}, ${s.designation})`).join("; ")}\nOutcomes: ${deal.discovery.topOutcomes.join("; ")}\nChallenges: ${deal.discovery.challenges.join("; ")}\nMAP: ${done}/${visItems.length} complete`;
    const SYS="You are an elite enterprise sales coach for CPG digital commerce. Be sharp, direct, tactical. Use ## headers, **bold**, - bullets. No fluff.";
    const PR={brief:`Write a deal brief. Score health 1-10, assess champion, list top 3 risks, 3 specific next actions.\n\n${ctx}`,bizcase:`Build a champion-ready internal business case. Include: Executive Summary, Problem with metrics, Solution fit, ROI (CPG benchmarks), Risk of Inaction, Timeline.\n\n${ctx}`,nextsteps:`5 tactical next steps this week. For each: who to contact, what to say, why it matters.\n\n${ctx}`,email:`Draft follow-up email to ${deal.stakeholders[0]?.name}. Reference their outcomes. Subject + body. Max 150 words.\n\n${ctx}`,chat:custom||""};
    try{setAiText(await callClaude(SYS,PR[mode]+(mode==="chat"?`\n\nDeal:\n${ctx}`:""),1200));}catch{setAiText("Unable to reach AI. Please try again.");}
    setAiLoading(false);};

  const inpS={border:`1px solid ${P.border}`,borderRadius:6,padding:"8px 10px",fontSize:12,color:P.text,background:P.surface,fontFamily:"inherit",outline:"none"};

  const LoadingScreen=()=><div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:P.textMute,fontSize:13}}>Loading…</div>;

  if(initError){
    return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:24,textAlign:"center",fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <div style={{fontSize:16,fontWeight:700,color:P.text}}>Couldn't load myBivy</div>
      <div style={{fontSize:13,color:P.textSec,maxWidth:480,fontFamily:"monospace",whiteSpace:"pre-wrap"}}>{initError}</div>
      <button onClick={()=>window.location.reload()} style={{padding:"10px 20px",background:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Reload</button>
    </div>;
  }

  // Real external prospect, reached via /d/{share_slug}: no picker, no auth gate, no
  // branding until the access code is verified server-side.
  if(prospectShareSlug){
    if(!prospectAuth[prospectShareSlug]){
      return <div style={{fontFamily:"'Inter','Segoe UI',sans-serif"}}><style>{CSS}</style>
        <ProspectLogin shareSlug={prospectShareSlug} onSuccess={async mappedDeal=>{
          setDeals([mappedDeal]);
          setActiveId(mappedDeal.id);
          setProspectAuth(p=>({...p,[prospectShareSlug]:true}));
          // stageLabels/postSignatureStageLabels are otherwise only ever set by the rep-only
          // org-loading effect above -- without this, a prospect always saw the raw
          // DEFAULT_STAGE_LABELS initial state, never an org's actual renamed labels, for
          // either sequence. get_deal_for_prospect (0028) now returns both label maps
          // directly on the deal payload for exactly this reason.
          setStageLabels({...DEFAULT_STAGE_LABELS,...(mappedDeal.prospectStageLabels||{})});
          setPostSignatureStageLabels({...DEFAULT_POST_SIGNATURE_STAGE_LABELS,...(mappedDeal.prospectPostSignatureStageLabels||{})});
          // Starts the one deal_visits row this browser session owns. Best-effort --
          // a failure here must never block the prospect from seeing their deal room.
          const {data:visitId,error}=await sb.rpc("start_deal_visit",{p_deal_id:mappedDeal.id});
          if(!error&&visitId)setProspectVisit({id:visitId,dealId:mappedDeal.id});
        }}/>
      </div>;
    }
  } else {
    // Rep path: auth, then org bootstrap, then real data load.
    if(session===undefined)return <LoadingScreen/>;
    // Checked before isPasswordRecovery/AuthGate -- a fresh teammate landing on ?activate=
    // link hasn't verified their code yet, so no PASSWORD_RECOVERY event exists to catch
    // and there's nothing for the normal sign-in form to do with a one-time code anyway.
    if(showActivateScreen)return <ActivateTeammate initialEmail={ACTIVATE_EMAIL} onVerified={()=>{setActivatingViaCode(true);setShowActivateScreen(false);}}/>;
    if(isPasswordRecovery)return <ResetPassword mode={activatingViaCode?"activate":"reset"} onDone={()=>{setIsPasswordRecovery(false);setActivatingViaCode(false);}}/>;
    if(session===null)return <AuthGate/>;
    if(needsOrgSetup)return <NameYourOrg onDone={()=>{setNeedsOrgSetup(false);setRefreshKey(k=>k+1);}}/>;
    if(loadingDeals)return <LoadingScreen/>;
  }

  // Hoisted so both the zero-deal empty state and the main deal-view return below can share
  // the exact same sidebar -- it only ever reads deals/activeId/viewMode/isLocked/
  // dealRoomLimit/myProfile/myRole/session, nothing that requires the singular `deal` (below)
  // to exist. See the sidebar's own inline comment for why it's hidden for a real prospect.
  const sidebarJsx = !prospectShareSlug && <div style={{width:264,background:P.ink,display:"flex",flexDirection:"column",flexShrink:0,padding:"24px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 4px 22px"}}>
        <div style={{width:36,height:36,borderRadius:9,background:"rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
        <div><div className="headline" style={{fontSize:19,color:"#fff",lineHeight:1}}>myBivy</div><div className="mono" style={{fontSize:9.5,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginTop:3}}>By SRENE</div></div>
      </div>
      <div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:9,padding:3,marginBottom:20}}>
        {[["rep","Sales Rep"],["prospect","Prospect"]].map(([v,l])=>(
          <button key={v} onClick={()=>{setViewMode(v);setTab(v==="prospect"?"welcome":"map");}} style={{flex:1,padding:"8px 0",fontSize:12.5,fontWeight:600,color:viewMode===v?"#fff":"rgba(255,255,255,0.5)",background:viewMode===v?P.accent:"transparent",border:"none",borderRadius:7,cursor:"pointer"}}>{l}</button>))}
      </div>
      {/* Manager drill-in banner -- only ever shown after clicking a rep in the Team
          Overview (setManagerViewRep), never by any other path. Reassignment lives here
          (operating on whichever deal is currently active) as the spec's second suggested
          entry point, alongside EditDealModal's "Assigned To" field ("from the deal's
          settings, or directly from the Manager Overview when handing off an account"). */}
      {/* Solid accent-orange background (not the subtle white-on-ink tint every other
          sidebar panel uses) -- this banner is the ONLY way back out of a manager drill-in,
          and Mark missed it entirely against the low-contrast original, mistaking "stuck in
          drill-in" for a bug. Loud on purpose. */}
      {managerViewRep&&<div style={{background:P.accent,borderRadius:9,padding:"10px 12px",marginBottom:16}}>
        <div style={{fontSize:10.5,letterSpacing:"0.04em",textTransform:"uppercase",color:"rgba(255,255,255,0.85)",marginBottom:5}}>Viewing as manager</div>
        <div style={{fontSize:13.5,fontWeight:700,color:"#fff",marginBottom:9}}>{managerViewRep.name}'s deals</div>
        {deal&&orgMembers.length>0&&<div style={{marginBottom:9}}>
          <div style={{fontSize:10.5,color:"rgba(255,255,255,0.85)",marginBottom:4}}>Reassign "{deal.company}" to</div>
          {/* Bug 2 fix: this select only stages a choice now (setPendingReassign), it never
              commits directly. A pending choice for a DIFFERENT deal than the one currently
              active is cleared below (see the pendingReassign-clearing effect) rather than
              silently carried over and applied to the wrong deal. */}
          <select value={pendingReassign?.dealId===deal.id?pendingReassign.newRepId:deal.assignedTo} onChange={e=>{
            const rep=orgMembers.find(m=>m.user_id===e.target.value);
            setPendingReassign({dealId:deal.id,newRepId:e.target.value,newRepName:rep?.profile?.full_name||rep?.profile?.email||"Unnamed"});
          }} style={{width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid rgba(0,0,0,0.18)",background:"rgba(0,0,0,0.15)",color:"#fff",fontSize:11.5}}>
            {/* Same stale-assignment guard as EditDealModal's identical control -- see
                that comment for why this fallback option is needed. */}
            {!orgMembers.some(m=>m.user_id===deal.assignedTo)&&<option value={deal.assignedTo} style={{color:"#000"}}>Former team member</option>}
            {orgMembers.map(m=><option key={m.user_id} value={m.user_id} style={{color:"#000"}}>{m.profile?.full_name||m.profile?.email||"Unnamed"}</option>)}
          </select>
          {pendingReassign?.dealId===deal.id&&<div style={{marginTop:8,padding:"8px 10px",background:"rgba(0,0,0,0.18)",borderRadius:6}}>
            <div style={{fontSize:11.5,color:"#fff",marginBottom:8}}>Move "{deal.company}" to {pendingReassign.newRepName}?</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{reassignDeal(pendingReassign.dealId,pendingReassign.newRepId);setPendingReassign(null);}} style={{flex:1,padding:"6px 0",background:"#fff",border:"none",borderRadius:5,color:P.accentMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>Confirm</button>
              <button onClick={()=>setPendingReassign(null)} style={{flex:1,padding:"6px 0",background:"none",border:"1px solid rgba(255,255,255,0.4)",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>}
        </div>}
        {/* Bug 3 fix: a direct, always-available way back to the manager's OWN account,
            not just to Team Overview (which is one hop further, and was the actual source
            of the "stuck bouncing between two screens" report -- the exit control people
            were looking for was never a screen away, it just wasn't obvious this was it). */}
        <button onClick={()=>setManagerViewRep(null)} style={{width:"100%",padding:"7px 0",marginBottom:6,background:"rgba(0,0,0,0.28)",border:"none",borderRadius:6,color:"#fff",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>← Exit to my account</button>
        <button onClick={()=>{setManagerViewRep(null);setShowManagerOverview(true);}} style={{width:"100%",padding:"7px 0",background:"rgba(0,0,0,0.18)",border:"none",borderRadius:6,color:"#fff",fontSize:11.5,fontWeight:600,cursor:"pointer"}}>Back to Team Overview</button>
      </div>}
      <div style={{flex:1,overflowY:"auto"}}>
        <div className="mono" style={{fontSize:10.5,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.35)",marginBottom:12,padding:"0 6px"}}>Active Deals</div>
        {visibleDeals.map(d=>{
          // A deal with zero Action Plan tasks divided by zero here -- NaN% is an
          // invisible, zero-width bar regardless of selection, which read as "the
          // highlight is broken" for whichever deal happened to have no tasks yet.
          const dp=d.mapItems.length?Math.round(d.mapItems.filter(t=>t.status==="complete").length/d.mapItems.length*100):0;
          const isA=d.id===activeId;const dFlags=riskFlags(d);const dotColor=RISK_DOT_COLOR[dFlags[0]?.severity||"on"];
          // Deal mapping completeness -- only surfaced during a manager drill-in (spec:
          // "a compact per-deal indicator in the rep drill-in view"), never in a rep's own
          // normal list, where it'd just be noise on every deal, every day.
          const mc=managerViewRep?mappingCompleteness(d):null;
          return(
          <div key={d.id} className="hd" onClick={()=>{setActiveId(d.id);setAiOpen(false);setAiText("");setTab(viewMode==="prospect"?"welcome":"map");}} style={{padding:"10px 8px",borderRadius:8,background:isA?"rgba(255,255,255,0.07)":"transparent",marginBottom:2,transition:"all .12s"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {d.risk&&<div title={dFlags[0]?.label||"On track"} style={{width:7,height:7,borderRadius:"50%",background:dotColor,flexShrink:0}}/>}
              <div style={{minWidth:0,flex:1}}><div style={{fontSize:13.5,fontWeight:600,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.company}</div><div className="mono" style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:1}}>{d.value}</div></div>
            </div>
            <div style={{marginTop:7}}><div style={{height:3,background:"rgba(255,255,255,0.12)",borderRadius:99,overflow:"hidden"}}><div style={{width:`${dp}%`,height:"100%",background:isA?P.accent:"rgba(255,255,255,0.4)",borderRadius:99}}/></div></div>
            {mc&&<div title={`Stakeholders ${mc.areas.stakeholders?"✓":"✗"} · MEDDPIC ${mc.meddpicFilled}/7 · Discovery ${mc.areas.discovery?"✓":"✗"} · Tasks ${mc.areas.tasks?"✓":"✗"}`} style={{marginTop:6,fontSize:10.5,color:mc.completeCount===4?"rgba(160,220,190,0.85)":"rgba(255,255,255,0.4)"}}>{mc.completeCount} of 4 mapping areas complete</div>}
          </div>);})}
        {/* Client-side checks only for a clean UX -- the real enforcement is the
            enforce_deal_room_limit and enforce_org_not_locked triggers (0017/0018), which
            fire regardless of this. Hidden entirely during a manager drill-in -- creating
            a deal here would silently assign it to the manager, not the rep being viewed,
            which isn't what "viewing their bivy" should ever do. */}
        {managerViewRep?null:isLocked?
          <div style={{marginTop:8,padding:11,fontSize:12,color:"rgba(255,255,255,0.5)",textAlign:"center",lineHeight:1.5}}>Your trial has ended — upgrade to create deal rooms</div>
        :deals.length>=dealRoomLimit?
          <div style={{marginTop:8,padding:11,fontSize:12,color:"rgba(255,255,255,0.5)",textAlign:"center",lineHeight:1.5}}>You've reached your plan's limit of {dealRoomLimit} deal rooms</div>
        :<button onClick={()=>setShowCreator(true)} style={{width:"100%",marginTop:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:11,border:"1.5px dashed rgba(255,255,255,0.25)",borderRadius:9,background:"transparent",color:"rgba(255,255,255,0.85)",fontSize:13.5,fontWeight:600,cursor:"pointer"}}>+ New Deal Room</button>}
      </div>
      <div style={{paddingTop:12,marginTop:12,borderTop:"1px solid rgba(255,255,255,0.08)",display:"flex",flexWrap:"wrap",alignItems:"center",rowGap:8,columnGap:10}}>
        {myProfile?.photo?
          <img src={myProfile.photo} alt={myProfile.name} style={{width:34,height:34,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
        :<div style={{width:34,height:34,borderRadius:"50%",background:P.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff",flexShrink:0}}>{myProfile?.initials||"?"}</div>}
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{myProfile?.name||session?.user?.email||"…"}</div>{myProfile?.title&&<div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:1}}>{myProfile.title}</div>}</div>
        {/* DEFAULT (flagged, guardrail #2 from the spec): gated on role AND
            orgMembers.length>1, not role alone -- a solo Single-tier org never mounts
            this button (or fetches orgMembers at all, see that effect above), so it has
            zero blast radius for every existing paying customer. */}
        {/* DEFAULT (Team Admin/Manager Rework): gated on is_manager, not role/orgMembers-count
            alone -- Admin only sees this after toggling View as Manager (which sets real
            is_manager=true on their own row), a plain Rep never sees it at all. */}
        {isManager&&orgMembers.length>1&&!managerViewRep&&<button onClick={()=>setShowManagerOverview(true)} title="Team Overview" style={{background:"none",border:"none",color:"rgba(255,255,255,0.75)",fontSize:11,fontWeight:600,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:15}}>👥</span>Team</button>}
        {/* View as Manager: a real permission grant (flips is_manager on the Admin's own
            row), not a client-side display toggle -- see toggleViewAsManager. Admin-only;
            hidden entirely during a manager drill-in to avoid stacking two different
            "acting as" states at once. */}
        {isAdmin&&!managerViewRep&&<button onClick={toggleViewAsManager} title={isManager?"Exit Manager view":"View as Manager"} style={{background:isManager?"rgba(214,95,60,0.25)":"none",border:isManager?"1px dashed rgba(214,95,60,0.6)":"none",borderRadius:6,padding:isManager?"3px 8px":0,color:isManager?"#fff":"rgba(255,255,255,0.75)",fontSize:11,fontWeight:600,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",gap:5}}>{isManager?"Exit Manager view":"View as Manager"}</button>}
        {/* Settings is never role-gated at the sidebar level -- every signed-in person needs
            a way to reach their own profile (My Profile never gated, see SettingsModal),
            regardless of is_admin/is_manager. The modal itself gates Team/General/Billing on
            isAdmin internally. */}
        <button onClick={()=>setShowSettings(true)} title="Settings" style={{background:"none",border:"none",color:"rgba(255,255,255,0.75)",fontSize:11,fontWeight:600,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:21}}>⚙</span>Settings</button>
        <button onClick={()=>sb.auth.signOut()} title="Sign out" style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:11,fontWeight:600,cursor:"pointer",flexShrink:0}}>Sign out</button>
      </div>
    </div>;

  // Team Admin/Manager Rework, visual layer: on a real Team org, Admin and Manager land on
  // their own dedicated full-page screens unconditionally -- no shared sidebar/tab nav with
  // Rep (spec B1) -- checked before everything else below so it wins regardless of whether
  // a `deal` happens to be selected. isTeamOrg is the gate, not isAdmin/isManager alone: a
  // solo org's owner carries both flags true too (0040's solo-safety fix) and must keep
  // seeing their ordinary bivy, which is why this whole branch is skipped entirely for solo.
  if(isTeamOrg&&isManager){
    return <TeamOverviewScreen members={orgMembers} deals={deals} onReassign={reassignDeal}
      impersonating={isAdmin} onToggleImpersonate={toggleViewAsManager}
      avatarInitials={myProfile?.initials||"?"}/>;
  }
  if(isTeamOrg&&isAdmin){
    return <>
      <AdminPortalScreen orgId={orgId} myUserId={session?.user?.id} planTier={planTier}
        subscriptionStatus={subscriptionStatus} currentPeriodEnd={currentPeriodEnd} hasStripeSubscription={hasStripeSubscription}
        onToggleImpersonate={toggleViewAsManager} onOpenGeneralSettings={()=>setShowSettings(true)}/>
      {showSettings&&<SettingsModal orgId={orgId} myUserId={session?.user?.id} myRole={myRole} isAdmin={isAdmin} isTeamOrg={isTeamOrg} onClose={()=>setShowSettings(false)}/>}
    </>;
  }

  if(!deal){
    // Signed in, org resolved, but zero deals yet -- the old render tree below assumes a
    // deal always exists, so this has to be its own early return rather than patched
    // field-by-field into every downstream reference. This is also the true first-login
    // moment the welcome overlay is meant for (0023) -- it belongs here, not in the main
    // deal-view render tree further below, which this branch returns before ever reaching.
    // Renders the same sidebarJsx as the main view (not a bare centered message) so a
    // first-time user actually sees they're inside the app -- myBivy branding, their (empty)
    // Active Deals list, settings -- not a blank page with no chrome.
    //
    // Also reached mid-drill-in if the rep a manager clicked into has zero assigned deals
    // -- managerViewRep is checked below to swap in manager-appropriate copy and hide the
    // "+ New Deal Room" button (creating one here would assign it to the manager, not the
    // rep being viewed).
    return <div style={{fontFamily:"'Inter','Segoe UI',sans-serif",background:P.bg,minHeight:"100vh",display:"flex",color:P.text}}><style>{CSS}</style>
      {sidebarJsx}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:24}}>
        <div style={{fontSize:16,fontWeight:700,color:P.text}}>{managerViewRep?`${managerViewRep.name} has no deal rooms yet`:"No deal rooms yet"}</div>
        {!managerViewRep&&<div style={{fontSize:13,color:P.textSec,maxWidth:420,textAlign:"center",lineHeight:1.6}}>A bivy is a mutual success planning workspace you share with a prospect, next steps, shared content, and action items you both stay aligned on.</div>}
        {managerViewRep?
          <button onClick={()=>{setManagerViewRep(null);setShowManagerOverview(true);}} style={{padding:"10px 20px",background:"none",border:`1px solid ${P.border}`,borderRadius:8,color:P.textSec,fontSize:13,fontWeight:600,cursor:"pointer"}}>← Back to Team Overview</button>
        :<button onClick={()=>setShowCreator(true)} style={{padding:"10px 20px",background:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ New Deal Room</button>}
      </div>
      {showCreator&&<DealCreator onSave={createDeal} onImport={importDeals} onClose={()=>setShowCreator(false)} stageLabels={stageLabels}/>}
      {showSettings&&<SettingsModal orgId={orgId} myUserId={session?.user?.id} myRole={myRole} isAdmin={isAdmin} isTeamOrg={isTeamOrg} onClose={()=>setShowSettings(false)}/>}
      {showWelcome&&viewMode==="rep"&&<WelcomeOverlay onDone={dismissWelcome}/>}
    </div>;
  }

  // Sequence-aware: which sequence is currently toggled on for this deal (0028) decides
  // which phase set/item array everything below reads from. Deliberately does NOT touch
  // computeDealStatus, runAI's context builder, or ProcessTimeline's own (now-parameterized)
  // computation -- those three stay pre-signature-only by design, per the toggle spec.
  const isPostSig=deal.activeSequenceView==="post_signature";
  const phases=isPostSig?PHASES_POST_SIGNATURE:(deal.includeTrialSessions?PHASES_ALL:PHASES_NO_TRIAL);
  const visItems=(isPostSig?deal.experienceItems:deal.mapItems).filter(t=>phases.includes(t.phase));
  const itemLabel=isPostSig?"Experience":"Task";
  const done=visItems.filter(t=>t.status==="complete").length;
  const pct=Math.round(done/(visItems.length||1)*100);
  // Bundles everything the tab==="map" render block needs so it can read seq.* instead of
  // duplicating the phase-group/add-form JSX twice for the two sequences.
  const seq=isPostSig
    ? {itemLabel,stageDefs:POST_SIGNATURE_STAGE_DEFS,curStageLabels:postSignatureStageLabels,defaultLabels:DEFAULT_POST_SIGNATURE_STAGE_LABELS,
       addFn:addExperienceItem,updateFn:updateExperienceItem,updateStatusFn:updateExperienceStatus,deleteFn:deleteExperienceItem,
       newDraft:newExperienceItem,setNewDraft:setNewExperienceItem,showAdd:showAddExperience,setShowAdd:setShowAddExperience,
       editing:editingExperienceItem,setEditing:setEditingExperienceItem}
    : {itemLabel,stageDefs:STAGE_DEFS,curStageLabels:stageLabels,defaultLabels:DEFAULT_STAGE_LABELS,
       addFn:addTask,updateFn:updateTask,updateStatusFn:updateTaskStatus,deleteFn:deleteTask,
       newDraft:newTask,setNewDraft:setNewTask,showAdd:showAddTask,setShowAdd:setShowAddTask,
       editing:editingTask,setEditing:setEditingTask};

  // Rep's own "Prospect" preview toggle -- viewMode==="prospect" here is always a rep with a
  // real authenticated session and org membership looking at their own deal for convenience,
  // never a real external buyer (that's the entirely separate prospectShareSlug branch above,
  // which does its own ProspectLogin gate at the top of this function). No login/access-code
  // check belongs here; just render the prospect-facing content directly.

  return <div style={{fontFamily:"'Inter','Segoe UI',sans-serif",background:P.bg,minHeight:"100vh",display:"flex",color:P.text}}>
    <style>{CSS}</style>

    {/* SIDEBAR -- hidden entirely for a real prospect on a share link: no picker into
        other org deals, no rep/prospect toggle they could flip to see edit controls. Shared
        with the zero-deal empty state above via the hoisted sidebarJsx. */}
    {sidebarJsx}
    {showSettings&&<SettingsModal orgId={orgId} myUserId={session?.user?.id} myRole={myRole} isAdmin={isAdmin} onClose={()=>setShowSettings(false)}/>}
    {showWelcome&&viewMode==="rep"&&<WelcomeOverlay onDone={dismissWelcome}/>}
    {showShare&&<ShareModal deal={deal} onClose={()=>setShowShare(false)} forProspect={viewMode==="prospect"}/>}
    {showAddEmbed&&<AddEmbedModal onSave={addEmbedDocument} onClose={()=>setShowAddEmbed(false)}/>}
    {showAddRecording&&<AddRecordingModal onSave={addRecordingDocument} onClose={()=>setShowAddRecording(false)}/>}
    {showEmbedDoc&&<EmbedModal doc={showEmbedDoc} onClose={()=>setShowEmbedDoc(null)}/>}
    {showDeleteDeal&&<DeleteDealModal deal={deal} onClose={()=>setShowDeleteDeal(false)} onConfirm={()=>deleteDeal(deal.id)}/>}
    {showEditDeal&&<EditDealModal deal={deal} members={orgMembers} canReassign={myRole==="owner"||myRole==="admin"} onClose={()=>setShowEditDeal(false)} onSave={updateDealInfo}/>}

    {/* MAIN */}
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{background:P.surface,borderBottom:`1px solid ${P.border}`,padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:42,height:42,borderRadius:9,background:P.accentLight,display:"flex",alignItems:"center",justifyContent:"center"}}><span className="headline" style={{fontSize:15,color:P.accentMid}}>{deal.logo}</span></div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span className="headline" style={{fontSize:18,color:P.text}}>{deal.company}</span>
              <span style={{fontSize:12,color:P.textMute}}>·</span>
              <span style={{fontSize:13,color:P.textSec,fontWeight:500}}>{deal.title}</span>
              {viewMode==="rep"&&<button onClick={()=>setShowEditDeal(true)} title="Edit Deal" style={{background:"none",border:"none",color:P.textMute,fontSize:12,cursor:"pointer",padding:2}}>✎</button>}
              {/* Only a rep's own preview toggle, never a real prospect (prospectShareSlug
                  is truthy only on the real /d/{slug} route) -- a real buyer should never
                  see a badge that reads like an internal reminder. */}
              {!prospectShareSlug&&viewMode==="prospect"&&<span style={{padding:"2px 8px",background:P.greenBg,border:`1px solid ${P.greenBorder}`,borderRadius:20,fontSize:10,fontWeight:700,color:P.green}}>PROSPECT VIEW</span>}
            </div>
            <div style={{display:"flex",gap:14,marginTop:3}}>{[deal.industry,deal.value,deal.closeDate?`Close ${deal.closeDate}`:null,deal.contact].filter(Boolean).map((v,i)=><span key={i} style={{fontSize:11,color:P.textMute}}>{v}</span>)}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"center"}}>
          {/* "Contributors" -- everyone whose created_by shows up anywhere on this deal
              (the deal itself, or any stakeholder/task/document under it), not
              stakeholders. Tooltip says what they actually did, not just their name, so
              it's self-evident on hover without a click-through to a tab that wouldn't
              quite fit (contributors aren't necessarily stakeholders). */}
          {(deal.contributors||[]).length>0&&<div style={{display:"flex"}}>
            {deal.contributors.slice(0,3).map((c,i)=>(
              <div key={c.id} title={`${c.name} — touched ${c.count} item${c.count===1?"":"s"} on this deal`} style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11.5,fontWeight:700,color:"#fff",border:`2px solid ${P.surface}`,marginLeft:i===0?0:-9,background:[P.accent,P.green,P.ink,"#8A9099"][i%4]}} className="headline">{c.initials}</div>
            ))}
            {deal.contributors.length>3&&<div title={deal.contributors.slice(3).map(c=>c.name).join(", ")} style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",border:`2px solid ${P.surface}`,marginLeft:-9,background:"#8A9099"}}>+{deal.contributors.length-3}</div>}
          </div>}
          {/* Primary status: pace-vs-close-date (computeDealStatus), not the old
              risk-signal pill -- same calculation feeds the Analytics Deal Health
              headline below, so the two can never disagree. */}
          {(()=>{const ds=computeDealStatus(deal);const c={"on-track":{text:P.green,bg:P.greenBg,dot:P.green},watch:{text:P.amber,bg:P.amberBg,dot:RISK_DOT_COLOR.risk},"at-risk":{text:P.red,bg:P.redBg,dot:P.red},unknown:{text:P.textMute,bg:P.bg,dot:P.textMute}}[ds.status];return(
            <div title={ds.status!=="unknown"?`${ds.elapsedPct}% of the way to close date`:undefined} style={{display:"inline-flex",alignItems:"center",gap:6,background:c.bg,color:c.text,fontSize:12.5,fontWeight:700,padding:"6px 13px 6px 9px",borderRadius:100}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:c.dot}}/>{ds.label}
            </div>
          );})()}
          {/* Real score (computeEngagementScore) -- the stored deals.engagement_score
              column is always the static default of 50, never updated by anything, so
              it's no longer read here at all. */}
          {(()=>{const eng=computeEngagementScore(deal);return(
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:20}}>
            <span className="mono" style={{fontSize:10,color:P.textMute,fontWeight:600}}>ENGAGEMENT</span>
            <div style={{width:50,height:4,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${eng}%`,height:"100%",background:eng>60?P.green:P.amber,borderRadius:99}}/></div>
            <span style={{fontSize:11,fontWeight:800,color:eng>60?P.green:P.amber}}>{eng}%</span>
          </div>
          );})()}
          {viewMode==="rep"&&<>
            <button onClick={()=>setShowShare(true)} className="hv" style={{padding:"7px 14px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.04em"}}>↗ Share</button>
            {/* Was two buttons opening the same panel (Deal Brief auto-generated content,
                AI Coach just toggled it open blank) -- one button now, keeping Deal
                Brief's behavior under the more accurate "AI Coach" label. */}
            <button onClick={()=>runAI("brief")} className="hv" style={{padding:"7px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.04em"}}>✦ AI Coach</button>
            <button onClick={()=>setShowDeleteDeal(true)} title="Delete Deal Room" style={{padding:"7px 10px",background:"none",border:"none",color:P.textMute,fontSize:11,fontWeight:700,cursor:"pointer"}}>🗑</button>
          </>}
        </div>
      </div>
      {/* Tabs */}
      <div style={{background:P.surface,borderBottom:`1px solid ${P.border}`,padding:"0 24px",display:"flex",alignItems:"center",flexShrink:0}}>
        {tabs.map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{padding:"12px 16px",background:"none",border:"none",borderBottom:`2px solid ${tab===k?P.accent:"transparent"}`,color:tab===k?P.accent:P.textSec,fontSize:13,fontWeight:tab===k?700:400,cursor:"pointer",marginBottom:-1}}>{l}</button>)}
        {tab==="map"&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:P.textMute}}>{done}/{visItems.length}</span><div style={{width:80,height:5,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:P.accent,borderRadius:99}}/></div><span style={{fontSize:11,fontWeight:800,color:P.accent}}>{pct}%</span></div>}
      </div>
      {/* Trial-ended / payment-failed banner -- rep-side only, never shown to
          viewMode==="prospect" (soft lock never touches prospect share links). Purely a UX
          heads-up: guardLocked() (called from every create/edit mutation) and the
          enforce_org_not_locked trigger (0018) are the actual gates, this banner just
          explains why those are about to say no. */}
      {viewMode==="rep"&&isLocked&&<div style={{background:P.redBg,borderBottom:`1px solid ${P.redBorder}`,padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexShrink:0}}>
        <span style={{fontSize:12.5,color:P.red,fontWeight:600}}>{subscriptionStatus==="past_due"?"Payment failed — update billing to keep editing.":"Your trial has ended — upgrade to keep editing."}</span>
        <button onClick={()=>{setShowSettings(true);}} style={{padding:"6px 14px",background:P.red,border:"none",borderRadius:6,color:"#fff",fontSize:11.5,fontWeight:700,cursor:"pointer",flexShrink:0}}>Upgrade</button>
      </div>}
      {/* Body */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{flex:1,overflowY:"auto",padding:"22px 24px"}} className="fade">

          {/* WELCOME */}
          {tab==="welcome"&&viewMode==="prospect"&&<div style={{maxWidth:800}}>
            <div style={{background:`linear-gradient(135deg,${P.accent} 0%,${P.accentMid} 100%)`,borderRadius:16,padding:"32px 36px",marginBottom:24,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",right:-20,top:-20,width:180,height:180,borderRadius:"50%",background:"rgba(255,255,255,0.06)"}}/>
              <div style={{width:52,height:52,borderRadius:12,background:"rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16}}><span className="headline" style={{fontSize:18,color:"#fff"}}>{deal.logo}</span></div>
              <div className="headline" style={{fontSize:24,color:"#fff",marginBottom:8}}>Welcome, {deal.company}</div>
              <div style={{fontSize:14,color:"rgba(255,255,255,0.85)",lineHeight:1.7,maxWidth:560}}>{deal.welcomeMsg}</div>
            </div>
            {/* AE Profile Card -- the deal's actual creator, not the currently-logged-in
                viewer (a manager previewing a teammate's deal should see that teammate
                here, not themselves). Optional fields (title/phone/LinkedIn) a rep hasn't
                filled in yet are simply omitted, never shown blank. */}
            {deal.repProfile&&<div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"22px 24px",marginBottom:20,display:"flex",gap:20}}>
              {deal.repProfile.photo?
                <img src={deal.repProfile.photo} alt={deal.repProfile.name} style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",border:`3px solid ${P.border}`,flexShrink:0,boxShadow:"0 2px 12px rgba(0,0,0,0.12)"}}/>
              :<div style={{width:72,height:72,borderRadius:"50%",background:`linear-gradient(135deg,${P.accent},${P.accentMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,color:"#fff",flexShrink:0}}>{deal.repProfile.initials}</div>}
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:800,color:P.text,marginBottom:2}}>{deal.repProfile.name}</div>
                {(deal.repProfile.title||deal.orgName)&&<div style={{fontSize:12,color:P.textSec,marginBottom:1}}>{[deal.repProfile.title,deal.orgName].filter(Boolean).join(" at ")}</div>}
                <div style={{fontSize:12,color:P.textMute,marginBottom:1}}>{deal.repProfile.email}</div>
                {deal.repProfile.phone&&<div style={{fontSize:12,color:P.textMute,marginBottom:14}}>{deal.repProfile.phone}</div>}
                <div style={{fontSize:13,color:P.textSec,lineHeight:1.65,marginBottom:16}}>
                  Hi Team,<br/><br/>This room is for us to collaborate and stay aligned as our partnership progresses.
                  <div style={{marginTop:10}}>
                    {["It will contain all relevant resources and next steps","Feel free to share this URL to keep colleagues in the loop","Reach out to me directly to keep key discussions organized"].map((it,i)=>(
                      <div key={i} style={{display:"flex",gap:8,marginBottom:6}}><span style={{color:P.green,fontWeight:700,flexShrink:0}}>✓</span><span>{it}</span></div>))}
                  </div>
                  <div style={{marginTop:10}}>Looking forward to working with you on your goals!</div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  {deal.repProfile.linkedin&&<a href={deal.repProfile.linkedin} target="_blank" rel="noopener noreferrer" style={{padding:"7px 16px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:"#0A66C2",fontSize:12,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:5}}>{LI_SVG}LinkedIn</a>}
                  <button onClick={()=>setShowShare(true)} style={{padding:"7px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Share Room</button>
                </div>
              </div>
            </div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
              {[{label:"License Amount",val:deal.value,color:P.accent},{label:"Target Close",val:deal.closeDate,color:P.amber},{label:`${itemLabel} Complete`,val:`${done}/${visItems.length}`,color:P.green},{label:"Stakeholders",val:deal.stakeholders.length,color:P.purple}].map(({label,val,color})=>(
                <div key={label} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"16px 18px",borderTop:`3px solid ${color}`}}>
                  <div style={{fontSize:10,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{label}</div>
                  <div style={{fontSize:18,fontWeight:800,color}}>{val}</div>
                </div>))}
            </div>
          </div>}

          {/* EXEC SUMMARY */}
          {tab==="summary"&&<div style={{maxWidth:820}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div className="headline" style={{fontSize:22,color:P.text}}>Executive Summary</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={downloadExecSummaryPdf} style={{padding:"8px 16px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>↓ Download PDF</button>
                {viewMode==="rep"&&<button onClick={()=>runAI("bizcase")} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✦ AI Refresh</button>}
              </div>
            </div>
            {[
              {key:"problem",title:"Business Objective",type:"text"},
              {key:"challenges",title:"Key Challenges",type:"list"},
              {key:"solutions",title:"Solutions",type:"list"},
            ].map(({key,title,type})=>{
              const editing=editingSummarySection===key;
              const value=deal.execSummary?.[key];
              return (<div key={key} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"22px 26px",marginBottom:16,boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:16,fontWeight:800,color:P.text}}>{title}</div>
                  {viewMode==="rep"&&(editing?<div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{const finalValue=type==="list"&&execListRef.current?execListRef.current.flush():summarySectionDraft;updateExecSummary({...deal.execSummary,[key]:finalValue});setEditingSummarySection(null);}} style={{padding:"6px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                    <button onClick={()=>setEditingSummarySection(null)} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  </div>:<button onClick={()=>{setSummarySectionDraft(type==="list"?(value||[]):(value||""));setEditingSummarySection(key);}} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>)}
                </div>
                {editing?(type==="list"?
                  <EditableList ref={execListRef} items={summarySectionDraft} onChange={setSummarySectionDraft}/>
                :<textarea value={summarySectionDraft} onChange={e=>setSummarySectionDraft(e.target.value)} style={{width:"100%",height:120,border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",lineHeight:1.6,resize:"vertical",outline:"none"}}/>)
                :(type==="list"?
                  <ol style={{paddingLeft:20}}>{(value||[]).map((item,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:6}}>{item}</li>)}</ol>
                :(value||"").split("\n\n").map((para,i)=><p key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:8}}>{para}</p>))}
              </div>);
            })}
          </div>}

          {/* ACTION PLAN */}
          {tab==="map"&&<div>
            {/* Manual, reversible per-deal toggle (0028) -- rep-only, never shown to a
                prospect (a real prospect only ever sees whichever sequence's ProcessTimeline/
                item list results from deal.activeSequenceView, set by the rep). No real-time
                push to an already-open prospect tab exists in this app (confirmed -- fetch-
                on-load only, everywhere), so the copy below is an explicit, stated limitation
                rather than a silently shipped gap. */}
            {viewMode==="rep"&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
              <div style={{display:"flex",background:P.bg,border:`1px solid ${P.border}`,borderRadius:9,padding:3}}>
                {[["pre_signature","Close Sequence"],["post_signature","Post-Signature"]].map(([v,l])=>(
                  <button key={v} onClick={()=>toggleSequenceView(v)} style={{padding:"7px 14px",fontSize:12.5,fontWeight:600,color:deal.activeSequenceView===v?"#fff":P.textSec,background:deal.activeSequenceView===v?P.accent:"transparent",border:"none",borderRadius:7,cursor:"pointer"}}>{l}</button>
                ))}
              </div>
              <span style={{fontSize:11.5,color:P.textMute,fontStyle:"italic"}}>Prospect sees this after their next page refresh — not instantly.</span>
            </div>}
            <ProcessTimeline deal={deal} stageLabels={seq.curStageLabels} stageDefs={seq.stageDefs} defaultLabels={seq.defaultLabels} items={visItems} phases={phases} inverted={isPostSig}/>
            {phases.map(phase=>{
              const items=visItems.filter(t=>t.phase===phase);
              return <div key={phase} style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 4px"}}>
                  <span className="mono" style={{fontSize:11.5,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:P.textMute}}>{phaseDisplayLabelFor(phase,seq.curStageLabels,seq.stageDefs,seq.defaultLabels)}</span>
                  <span style={{fontSize:12.5,color:P.textMute}}>{items.filter(t=>t.status==="complete").length} of {items.length} complete</span>
                </div>
                <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,overflow:"hidden",boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"}}>
                  {items.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 100px 150px 100px 110px",padding:"7px 16px",background:P.bg,borderBottom:`1px solid ${P.border}`}}>
                    {[seq.itemLabel,"Seller","Buyer Owner","Due Date","Status"].map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.07em"}}>{h}</div>)}
                  </div>}
                  {items.length===0&&<div style={{padding:"16px",fontSize:12.5,color:P.textMute,fontStyle:"italic"}}>{isPostSig?"No experience items yet in this phase":"No tasks yet in this phase"}</div>}
                  {items.map((task,i)=>{const sc=STATUS_CFG[task.status];return(
                    <div key={task.id} className="hr" style={{display:"grid",gridTemplateColumns:"1fr 100px 150px 100px 110px",padding:"11px 16px",borderBottom:i<items.length-1?`1px solid ${P.bg}`:"none",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                        {viewMode==="rep"?
                          <button onClick={()=>seq.setEditing(task)} title={`Edit ${seq.itemLabel.toLowerCase()}`} style={{width:20,height:20,padding:0,borderRadius:"50%",border:task.status==="complete"?"none":`1.5px solid ${P.border}`,background:task.status==="complete"?P.ink:P.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1,cursor:"pointer"}}>{task.status==="complete"&&<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>}</button>
                        :<div style={{width:20,height:20,borderRadius:"50%",border:task.status==="complete"?"none":`1.5px solid ${P.border}`,background:task.status==="complete"?P.ink:P.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>{task.status==="complete"&&<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>}</div>}
                        <div>
                          <div style={{fontSize:13,color:task.status==="complete"?P.textMute:P.text,textDecoration:task.status==="complete"?"line-through":"none",fontWeight:500}}>{task.task}</div>
                          {task.notes&&<div style={{fontSize:11,color:P.textMute,marginTop:2,fontStyle:"italic"}}>{task.notes}</div>}
                          {task.approvalRequired&&<span style={{fontSize:9,fontWeight:700,color:P.red,textTransform:"uppercase",letterSpacing:"0.06em"}}>Approval Required</span>}
                          {/* Prospect-facing only -- a rep doesn't need to book a meeting
                              with themselves. Reuses the rep's own profiles.calendly_url
                              (0025) as the booking link; calendlyEnabled just marks which
                              tasks surface it. */}
                          {viewMode==="prospect"&&task.calendlyEnabled&&deal.repProfile?.calendly&&
                            <button onClick={()=>window.Calendly&&window.Calendly.initPopupWidget({url:deal.repProfile.calendly})} style={{display:"block",marginTop:4,padding:0,background:"none",border:"none",color:P.accent,fontSize:11,fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>Schedule this</button>}
                        </div>
                      </div>
                      <div style={{fontSize:12,color:P.textSec}}>{task.owner}</div>
                      <div style={{fontSize:12,color:P.textSec}}>{task.buyerOwner}</div>
                      <div style={{fontSize:11,color:P.textMute}}>{task.dueDate}</div>
                      {viewMode==="rep"?<select value={task.status} onChange={e=>seq.updateStatusFn(task.id,e.target.value)} style={{background:sc.bg,border:`1px solid ${sc.border}`,color:sc.text,borderRadius:5,padding:"4px 6px",fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}><option value="complete">Complete</option><option value="in-progress">In Progress</option><option value="pending">Pending</option></select>
                      :<div style={{padding:"3px 8px",borderRadius:4,background:sc.bg,border:`1px solid ${sc.border}`,color:sc.text,fontSize:11,fontWeight:700,textAlign:"center"}}>{sc.label}</div>}
                    </div>);})}
                  {viewMode==="rep"&&(seq.showAdd===phase?<div style={{padding:16,borderTop:items.length>0?`1px solid ${P.bg}`:"none"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                      <input placeholder={isPostSig?"Experience name":"Task name"} value={seq.newDraft.task} onChange={e=>seq.setNewDraft({...seq.newDraft,task:e.target.value})} style={inpS}/>
                      <input placeholder="Buyer owner" value={seq.newDraft.buyerOwner} onChange={e=>seq.setNewDraft({...seq.newDraft,buyerOwner:e.target.value})} style={inpS}/>
                      <input type="date" value={seq.newDraft.dueDate} onChange={e=>seq.setNewDraft({...seq.newDraft,dueDate:e.target.value})} style={inpS}/>
                    </div>
                    <div style={{marginBottom:8}}>
                      <input placeholder="Notes" value={seq.newDraft.notes} onChange={e=>seq.setNewDraft({...seq.newDraft,notes:e.target.value})} style={{...inpS,width:"100%"}}/>
                    </div>
                    <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
                      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={seq.newDraft.approvalRequired} onChange={e=>seq.setNewDraft({...seq.newDraft,approvalRequired:e.target.checked})}/>Approval Required</label>
                      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:deal.repProfile?.calendly?P.textSec:P.textMute,cursor:deal.repProfile?.calendly?"pointer":"not-allowed"}}>
                        <input type="checkbox" checked={seq.newDraft.calendlyEnabled} disabled={!deal.repProfile?.calendly} onChange={e=>seq.setNewDraft({...seq.newDraft,calendlyEnabled:e.target.checked})}/>Enable Scheduling
                      </label>
                      {!deal.repProfile?.calendly&&<span style={{fontSize:11,color:P.textMute}}>Set your scheduling link in Settings first</span>}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{if(!seq.newDraft.task.trim())return;seq.addFn(seq.newDraft);seq.setShowAdd(null);}} style={{padding:"8px 18px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Add {seq.itemLabel}</button>
                      <button onClick={()=>seq.setShowAdd(null)} style={{padding:"8px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,cursor:"pointer"}}>Cancel</button>
                    </div>
                  </div>:<button onClick={()=>{seq.setNewDraft(t=>({...t,phase}));seq.setShowAdd(phase);}} style={{width:"100%",padding:10,background:"none",border:"none",borderTop:items.length>0?`1px solid ${P.bg}`:"none",color:P.textMute,fontSize:12,cursor:"pointer"}} onMouseOver={e=>e.currentTarget.style.color=P.accent} onMouseOut={e=>e.currentTarget.style.color=P.textMute}>+ Add {seq.itemLabel}</button>)}
                </div>
              </div>;})}
            {seq.editing&&<TaskModal
              task={seq.editing}
              phases={phases}
              itemLabel={seq.itemLabel}
              onClose={()=>seq.setEditing(null)}
              onSave={draft=>seq.updateFn(seq.editing.id,draft)}
              onDelete={()=>{seq.deleteFn(seq.editing.id);seq.setEditing(null);}}
              calendlyAvailable={!!deal.repProfile?.calendly}
            />}
          </div>}

          {/* DISCOVERY */}
          {tab==="discovery"&&<div style={{maxWidth:860}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div className="headline" style={{fontSize:22,color:P.text}}>Business Outcomes & Value Identification</div><div style={{fontSize:13,color:P.textSec,marginTop:3}}>{deal.company} · {deal.industry}</div></div>
              {viewMode==="rep"&&<div style={{display:"flex",gap:8}}>
                {editingDiscovery?<>
                  <button onClick={()=>{
                    const finalDraft={...discoveryDraft,goals:{...discoveryDraft.goals}};
                    Object.entries(discoveryListRefs.current).forEach(([refKey,inst])=>{
                      if(!inst)return;
                      if(refKey.startsWith("goal:")){finalDraft.goals[refKey.slice(5)]=inst.flush();}
                      else{finalDraft[refKey]=inst.flush();}
                    });
                    updateDiscovery(finalDraft);setEditingDiscovery(false);
                  }} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setEditingDiscovery(false)} style={{padding:"8px 16px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                </>:<>
                  <button onClick={()=>{setDiscoveryDraft({summary:deal.discovery.summary||"",corporateStrategy:deal.discovery.corporateStrategy||[],topOutcomes:deal.discovery.topOutcomes||[],challenges:deal.discovery.challenges||[],jobsToBeDone:deal.discovery.jobsToBeDone||[],primaryUseCase:deal.discovery.primaryUseCase||"",goals:{...deal.discovery.goals}});setEditingDiscovery(true);}} style={{padding:"8px 16px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>runAI("bizcase")} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✦ Build Business Case</button>
                </>}
              </div>}
            </div>
            {editingDiscovery?<>
              <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"16px 18px",marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Discovery Summary</div>
                <textarea value={discoveryDraft.summary} onChange={e=>setDiscoveryDraft(d=>({...d,summary:e.target.value}))} style={{width:"100%",height:70,border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",lineHeight:1.6,resize:"vertical",outline:"none"}}/>
              </div>
              {[{key:"corporateStrategy",title:"Corporate Strategy & Growth Initiatives"},{key:"topOutcomes",title:"Top Business Outcomes"},{key:"challenges",title:"Current Challenges"},{key:"jobsToBeDone",title:"Jobs to Be Done"}].map(({key,title})=>(
                <div key={key} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"14px 18px",marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:P.text,marginBottom:10}}>{title}</div>
                  <EditableList ref={el=>discoveryListRefs.current[key]=el} items={discoveryDraft[key]} onChange={v=>setDiscoveryDraft(d=>({...d,[key]:v}))}/>
                </div>
              ))}
              <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"16px 18px",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Primary Use Case</div>
                <textarea value={discoveryDraft.primaryUseCase} onChange={e=>setDiscoveryDraft(d=>({...d,primaryUseCase:e.target.value}))} style={{width:"100%",height:70,border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",lineHeight:1.6,resize:"vertical",outline:"none"}}/>
              </div>
              <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"16px 18px"}}>
                <div style={{fontSize:13,fontWeight:700,color:P.text,marginBottom:12}}>Priority Goals & Objectives</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
                  {GOAL_PERIODS.map(period=>(
                    <div key={period}>
                      <div style={{fontSize:10,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>{period}</div>
                      <EditableList ref={el=>discoveryListRefs.current["goal:"+period]=el} items={discoveryDraft.goals[period]} onChange={v=>setDiscoveryDraft(d=>({...d,goals:{...d.goals,[period]:v}}))}/>
                    </div>
                  ))}
                </div>
              </div>
            </>:<>
              {deal.discovery.summary&&<div style={{background:`linear-gradient(135deg,${P.accentLight},#EEF6FF)`,border:`1px solid #F0C9B7`,borderRadius:12,padding:"18px 22px",marginBottom:16,borderLeft:`4px solid ${P.accent}`}}>
                <div style={{fontSize:11,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Discovery Summary</div>
                <p style={{fontSize:13,color:P.textSec,lineHeight:1.75}}>{deal.discovery.summary}</p>
              </div>}
              {[{key:"st",title:"Corporate Strategy & Growth Initiatives",icon:"◈",items:deal.discovery.corporateStrategy,color:P.accent,bg:P.accentLight,border:"#F0C9B7"},
                {key:"ou",title:"Top Business Outcomes",icon:"◉",items:deal.discovery.topOutcomes,color:P.green,bg:P.greenBg,border:P.greenBorder},
                {key:"ch",title:"Current Challenges",icon:"◌",items:deal.discovery.challenges,color:P.red,bg:P.redBg,border:P.redBorder},
                {key:"jb",title:"Jobs to Be Done",icon:"◎",items:deal.discovery.jobsToBeDone,color:P.purple,bg:P.purpleBg,border:P.purpleBorder}
              ].map(({key,title,icon,items,color,bg,border})=>(
                <div key={key} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,overflow:"hidden",marginBottom:12}}>
                  <div style={{padding:"13px 18px",background:bg,borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                    <span style={{color,fontSize:16}}>{icon}</span><span style={{fontSize:13,fontWeight:700,color}}>{title}</span>
                    <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color,background:P.surface,border:`1px solid ${border}`,borderRadius:10,padding:"1px 8px"}}>{items.length}</span>
                  </div>
                  <div style={{padding:"8px 18px 14px"}}>
                    {items.map((item,i)=><div key={i} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:i<items.length-1?`1px solid ${P.bg}`:"none",alignItems:"flex-start"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:color,marginTop:6,flexShrink:0}}/><span style={{fontSize:13,color:P.textSec,lineHeight:1.5}}>{item}</span>
                    </div>)}
                  </div>
                </div>))}
              <div style={{background:`linear-gradient(135deg,${P.accentLight},#EEF6FF)`,border:`1px solid #F0C9B7`,borderRadius:10,padding:"18px 20px",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Primary Use Case</div>
                <p style={{fontSize:13,color:P.textSec,lineHeight:1.75}}>{deal.discovery.primaryUseCase}</p>
              </div>
              <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,overflow:"hidden"}}>
                <div style={{padding:"13px 18px",borderBottom:`1px solid ${P.border}`,fontSize:13,fontWeight:700,color:P.text}}>Priority Goals & Objectives</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr"}}>
                  {GOAL_PERIODS.map((period,i,arr)=>{const goals=deal.discovery.goals?.[period]||[];return(
                    <div key={period} style={{padding:"16px 18px",borderRight:i<arr.length-1?`1px solid ${P.border}`:"none"}}>
                      <div style={{fontSize:10,fontWeight:800,color:[P.accent,P.green,P.purple][i],textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>{period}</div>
                      {goals.map((g,j)=><div key={j} style={{display:"flex",gap:8,marginBottom:7}}><div style={{width:5,height:5,borderRadius:"50%",background:[P.accentMid,P.green,P.purple][i],marginTop:6,flexShrink:0}}/><span style={{fontSize:12,color:P.textSec,lineHeight:1.5}}>{g}</span></div>)}
                    </div>);})}
                </div>
              </div>
            </>}
          </div>}

          {/* CONTENT */}
          {tab==="content"&&<div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:13,color:P.textSec}}>{deal.content.length} files · {deal.content.reduce((a,c)=>a+c.views,0)} total views</div>
              {viewMode==="rep"&&<div style={{display:"flex",gap:8}}>
                <button onClick={()=>setShowAddEmbed(true)} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 14px",border:`1px solid ${P.border}`,borderRadius:6,background:"none",color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}><GoogleDocIcon/>+ Google Doc</button>
                <button onClick={()=>setShowAddRecording(true)} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 14px",border:`1px solid ${P.border}`,borderRadius:6,background:"none",color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}><ZoomIcon/>+ Recording</button>
                <label style={{padding:"6px 14px",background:P.accent,borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add File
                  <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*" onChange={e=>e.target.files[0]&&uploadDocument(e.target.files[0])} style={{display:"none"}}/>
                </label>
              </div>}
            </div>
            <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
              {["All",...new Set(deal.content.map(c=>c.category))].map(cat=>(
                <span key={cat} onClick={()=>setSelCat(cat)} style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${selCat===cat?P.accent:P.border}`,background:selCat===cat?P.accentLight:P.surface,color:selCat===cat?P.accent:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>{cat}</span>))}
            </div>
            <div style={{display:"grid",gap:8}}>
              {deal.content.filter(f=>selCat==="All"||f.category===selCat).map(f=>{const fi=FILE_ICON[f.type]||FILE_ICON.link;return(
                <div key={f.id} className="hr" style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"14px 18px",display:"flex",alignItems:"center",gap:14}}>
                  <div style={{width:40,height:40,borderRadius:8,background:fi.c+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:fi.c,flexShrink:0}}>{fi.icon}</div>
                  <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:P.text}}>{f.title}</div><div style={{display:"flex",gap:10,marginTop:3}}><span style={{fontSize:11,color:P.textMute,textTransform:"uppercase",fontWeight:600,letterSpacing:"0.05em"}}>{f.type}</span><span style={{fontSize:11,color:P.textMute}}>· {f.category} · Added {f.uploaded}</span></div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:11,color:P.textMute,marginBottom:3}}>{f.lastViewed}</div>
                    <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"}}>
                      {f.viewers.slice(0,3).map((v,i)=><div key={i} style={{width:22,height:22,borderRadius:"50%",background:P.accentLight,border:`1px solid ${P.accent}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:P.accent}}>{v.split(" ").map(n=>n[0]).join("")}</div>)}
                      <span style={{fontSize:11,color:f.views>0?P.accent:P.textMute,fontWeight:700}}>{f.views>0?`${f.views} views`:"Not viewed"}</span>
                    </div>
                  </div>
                  <button onClick={()=>openDocument(f)} style={{padding:"7px 14px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>Open →</button>
                </div>);})}
            </div>
          </div>}

          {/* STAKEHOLDERS */}
          {tab==="stakeholders"&&<div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:13,color:P.textSec}}>{deal.stakeholders.length} stakeholders mapped</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setOrgView(!orgView)} style={{padding:"6px 14px",background:orgView?P.accentLight:P.surface,border:`1px solid ${orgView?P.accentMid:P.border}`,borderRadius:6,color:orgView?P.accent:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>{orgView?"List View":"Org Chart"}</button>
                {viewMode==="rep"&&<button onClick={()=>runAI("nextsteps")} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>✦ Engagement Strategy</button>}
                {viewMode==="rep"&&<button onClick={()=>setShowStakeholderModal(true)} style={{padding:"6px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add Stakeholder</button>}
              </div>
            </div>
            {orgView?<div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"32px 24px",overflowX:"auto"}}>
              <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:24}}>Organizational Structure</div>
              <div style={{display:"flex",gap:40,justifyContent:"center",minWidth:"fit-content"}}>
                {deal.stakeholders.filter(s=>!s.reportsTo||!deal.stakeholders.find(x=>x.id===s.reportsTo)).map(root=><OrgNode key={root.id} s={root} all={deal.stakeholders} depth={0} viewMode={viewMode}/>)}
              </div>
            </div>:<div style={{display:"grid",gap:10}}>
              {deal.stakeholders.map(s=>{const dc=DESIG_CFG[s.designation]||DESIG_CFG.influencer;const ec=s.engagement>60?P.green:s.engagement>30?P.amber:P.red;return(
                <div key={s.id} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"18px 20px",display:"flex",alignItems:"center",gap:16}}>
                  <div className="headline" style={{width:48,height:48,borderRadius:"50%",background:P.accentLight,border:`2px solid ${P.ropeBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:P.accentMid,flexShrink:0}}>{s.initials}</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}><span style={{fontSize:15,fontWeight:700,color:P.text}}>{s.name}</span>{viewMode==="rep"&&<Badge label={dc.label} color={dc.color} bg={dc.bg} border={dc.border}/>}{s.approvalRequired&&<Badge label="Approval Required" color={P.red} bg={P.redBg} border={P.redBorder}/>}</div>
                    <div style={{fontSize:12,color:P.textSec,marginBottom:3}}>{s.role} · <span style={{color:P.textMute}}>{s.bu}</span></div>
                    {s.docsViewed.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}><span style={{fontSize:10,color:P.textMute,fontWeight:600,marginTop:2}}>Viewed:</span>{s.docsViewed.map((d,i)=><span key={i} style={{fontSize:10,padding:"1px 7px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:10,color:P.textSec}}>{d}</span>)}</div>}
                    <div style={{display:"flex",alignItems:"center",gap:16}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:10,color:P.textMute,fontWeight:600}}>ENGAGEMENT</span><div style={{width:70,height:4,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${s.engagement}%`,height:"100%",background:ec,borderRadius:99}}/></div><span style={{fontSize:11,fontWeight:800,color:ec}}>{s.engagement}%</span></div>
                      <span style={{fontSize:11,color:P.textMute}}>Last seen {s.lastSeen}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexDirection:"column",alignItems:"flex-end"}}>
                    <a href={s.linkedin} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#EBF5FF",border:"1px solid #F0C9B7",borderRadius:6,color:"#0A66C2",fontSize:11,fontWeight:700,textDecoration:"none"}}>{LI_SVG}LinkedIn</a>
                    {viewMode==="rep"&&<button onClick={()=>{setChatInput(`How do I engage ${s.name} (${s.role}, ${s.designation})?`);setAiOpen(true);}} style={{padding:"5px 10px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Coach me</button>}
                    {viewMode==="rep"&&<div style={{display:"flex",gap:8}}>
                      <button onClick={()=>setEditingStakeholder(s)} style={{background:"none",border:"none",color:P.textMute,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>
                      <button onClick={()=>deleteStakeholder(s.id)} style={{background:"none",border:"none",color:P.red,fontSize:11,fontWeight:600,cursor:"pointer"}}>Remove</button>
                    </div>}
                  </div>
                </div>);})}
            </div>}
            {(showStakeholderModal||editingStakeholder)&&<StakeholderModal
              editing={editingStakeholder}
              allStakeholders={deal.stakeholders}
              onClose={()=>{setShowStakeholderModal(false);setEditingStakeholder(null);}}
              onSave={draft=>editingStakeholder?updateStakeholder(editingStakeholder.id,draft):addStakeholder(draft)}
            />}
          </div>}

          {/* MEDDPIC -- derived by default from Discovery/Stakeholders/Action Plan, but any
              section can be edited into a stored override (deal.meddpic[key]); untouched
              sections keep auto-deriving forever, exactly as before. Rep-only, like
              Analytics -- a buyer should never see their own economic-buyer/champion/pain
              analysis laid out via sales methodology. */}
          {tab==="meddpic"&&viewMode==="rep"&&<div style={{maxWidth:820}}>
            <div className="headline" style={{fontSize:22,color:P.text,marginBottom:6}}>MEDDPIC</div>
            <div style={{fontSize:13,color:P.textMute,marginBottom:20,lineHeight:1.6}}>Auto-derived from Discovery, Stakeholders, and Action Plan — edit a section below to override it, or edit those tabs to update the rest.</div>
            {(()=>{
              const champions=deal.stakeholders.filter(s=>s.designation==="champion");
              const decisionMakers=deal.stakeholders.filter(s=>s.designation==="decision-maker");
              const paperProcessTasks=deal.mapItems.filter(t=>t.phase==="Paper Process");
              const cardStyle={background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"20px 24px",marginBottom:14,boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"};
              const letterStyle={width:32,height:32,borderRadius:8,background:P.accentLight,color:P.accentMid,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0};
              const empty=<div style={{fontSize:13,color:P.textMute,fontStyle:"italic"}}>Not enough data yet</div>;
              const StakeholderList=list=>list.length?<div style={{display:"flex",flexDirection:"column",gap:6}}>{list.map(s=><div key={s.id} style={{fontSize:13,color:P.textSec}}><strong style={{color:P.text}}>{s.name}</strong>{s.role?` — ${s.role}`:""}</div>)}</div>:<div style={{fontSize:13,color:P.textMute,fontStyle:"italic"}}>Not yet identified</div>;
              const Section=({letter,title,mkey,derived,derivedPlainText})=>{
                const override=deal.meddpic?.[mkey];
                const editing=editingMeddpicSection===mkey;
                return (<div style={cardStyle}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div className="headline" style={letterStyle}>{letter}</div>
                      <div style={{fontSize:15,fontWeight:700,color:P.text}}>{title}</div>
                    </div>
                    {editing?<div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{updateMeddpicField(mkey,meddpicSectionDraft);setEditingMeddpicSection(null);}} style={{padding:"6px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                      <button onClick={()=>setEditingMeddpicSection(null)} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                    </div>:<button onClick={()=>{setMeddpicSectionDraft(override||derivedPlainText||"");setEditingMeddpicSection(mkey);}} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>}
                  </div>
                  {editing?
                    <textarea value={meddpicSectionDraft} onChange={e=>setMeddpicSectionDraft(e.target.value)} style={{width:"100%",height:90,border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",lineHeight:1.6,resize:"vertical",outline:"none"}}/>
                  :override?
                    override.split("\n").map((line,i)=><p key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:4}}>{line}</p>)
                  :derived}
                </div>);
              };
              return (<>
                <Section letter="M" title="Metrics" mkey="metrics"
                  derivedPlainText={[...(deal.discovery.topOutcomes||[]),...GOAL_PERIODS.flatMap(p=>deal.discovery.goals?.[p]||[])].join("\n")}
                  derived={<>
                    {(deal.discovery.topOutcomes||[]).length>0&&<ol style={{paddingLeft:20,marginBottom:10}}>{deal.discovery.topOutcomes.map((o,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:4}}>{o}</li>)}</ol>}
                    {GOAL_PERIODS.some(p=>(deal.discovery.goals?.[p]||[]).length)?
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                        {GOAL_PERIODS.map(period=>(<div key={period}>
                          <div className="mono" style={{fontSize:10,fontWeight:600,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{period}</div>
                          {(deal.discovery.goals?.[period]||[]).map((g,i)=><div key={i} style={{fontSize:12,color:P.textSec,marginBottom:3}}>· {g}</div>)}
                        </div>))}
                      </div>
                    :!(deal.discovery.topOutcomes||[]).length&&empty}
                  </>}/>
                <Section letter="E" title="Economic Buyer" mkey="economicBuyer" derived={StakeholderList(decisionMakers)} derivedPlainText={decisionMakers.map(s=>`${s.name}${s.role?` — ${s.role}`:""}`).join("\n")}/>
                <Section letter="D" title="Decision Criteria" mkey="decisionCriteria" derived={empty} derivedPlainText=""/>
                <Section letter="D" title="Decision Process" mkey="decisionProcess" derived={empty} derivedPlainText=""/>
                <Section letter="P" title="Paper Process" mkey="paperProcess"
                  derivedPlainText={paperProcessTasks.map(t=>t.task).join("\n")}
                  derived={paperProcessTasks.length?<div style={{display:"flex",flexDirection:"column",gap:6}}>{paperProcessTasks.map(t=><div key={t.id} style={{fontSize:13,color:P.textSec,display:"flex",alignItems:"center",gap:8}}><span style={{width:6,height:6,borderRadius:"50%",background:t.status==="complete"?P.green:P.border,flexShrink:0}}/>{t.task}</div>)}</div>:empty}/>
                <Section letter="I" title="Identify Pain" mkey="identifyPain"
                  derivedPlainText={(deal.discovery.challenges||[]).join("\n")}
                  derived={(deal.discovery.challenges||[]).length?<ol style={{paddingLeft:20}}>{deal.discovery.challenges.map((c,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:4}}>{c}</li>)}</ol>:empty}/>
                <Section letter="C" title="Champion" mkey="champion" derived={StakeholderList(champions)} derivedPlainText={champions.map(s=>`${s.name}${s.role?` — ${s.role}`:""}`).join("\n")}/>
              </>);
            })()}
          </div>}

          {/* ANALYTICS */}
          {tab==="analytics"&&viewMode==="rep"&&<div style={{maxWidth:900}}>
            <div className="headline" style={{fontSize:20,color:P.text,marginBottom:20}}>Analytics</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:24}}>
              {[{label:"Room Visits",val:deal.activityLog.reduce((a,d)=>a+d.entries.length,0),sub:"Total stakeholder visits",color:P.accent},
                {label:"Interactions",val:deal.activityLog.reduce((a,d)=>a+d.entries.reduce((b,e)=>b+e.actions.length,0),0),sub:"Documents viewed / actions",color:P.purple},
                {label:"Total Time",val:`${deal.activityLog.reduce((a,d)=>a+d.entries.reduce((b,e)=>{const m=parseInt(e.duration);return b+(isNaN(m)?0:m);},0),0)} min`,sub:"Cumulative engagement time",color:P.teal}
              ].map(({label,val,sub,color})=>(
                <div key={label} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"18px 20px",borderTop:`3px solid ${color}`}}>
                  <div style={{fontSize:10,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{label}</div>
                  <div style={{fontSize:26,fontWeight:800,color,marginBottom:3}}>{val}</div>
                  <div style={{fontSize:11,color:P.textMute}}>{sub}</div>
                </div>))}
            </div>
            <div style={{marginBottom:24}}>
              <div style={{fontSize:13,fontWeight:700,color:P.text,marginBottom:12}}>Deal Health</div>
              {/* Headline is the exact same computeDealStatus() call the header pill
                  uses -- one source of truth, they can never disagree. Secondary flags
                  (buyer-side engagement, a genuinely different axis from pace-vs-close-
                  date) list below when risk-signal data has loaded. */}
              {(()=>{const ds=computeDealStatus(deal);const c={"on-track":{text:P.green,bg:P.greenBg,border:P.greenBorder},watch:{text:P.amber,bg:P.amberBg,border:P.amberBorder},"at-risk":{text:P.red,bg:P.redBg,border:P.redBorder},unknown:{text:P.textMute,bg:P.bg,border:P.border}}[ds.status];return(
                <div style={{display:"flex",alignItems:"center",gap:10,background:c.bg,border:`1px solid ${c.border}`,borderRadius:10,padding:"14px 18px"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:c.text,flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:600,color:c.text}}>{ds.label}{ds.status!=="unknown"?` — ${ds.elapsedPct}% of the way to close date`:""}</span>
                </div>
              );})()}
              {deal.risk&&riskFlags(deal).length>0&&<div style={{display:"grid",gap:8,marginTop:8}}>
                {riskFlags(deal).map(f=>(
                  <div key={f.key} style={{display:"flex",alignItems:"center",gap:12,background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"14px 18px"}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:RISK_DOT_COLOR[f.severity],flexShrink:0}}/>
                    <div><div style={{fontSize:13,fontWeight:700,color:P.text}}>{f.label}</div><div style={{fontSize:12,color:P.textSec,marginTop:1}}>{f.reason}</div></div>
                  </div>
                ))}
              </div>}
            </div>
            <div style={{fontSize:13,fontWeight:700,color:P.text,marginBottom:12}}>Activity Log</div>
            {deal.activityLog.map(day=>(
              <div key={day.date} style={{marginBottom:20}}>
                <div style={{fontSize:12,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>{day.date}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,overflow:"hidden"}}>
                    {day.entries.map((entry,i)=>(
                      <div key={i} onClick={()=>setActiveLog(activeLog===`${day.date}-${i}`?null:`${day.date}-${i}`)} style={{padding:"14px 16px",borderBottom:i<day.entries.length-1?`1px solid ${P.bg}`:"none",cursor:"pointer",background:activeLog===`${day.date}-${i}`?P.accentLight:"transparent"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:P.accentLight,border:`2px solid ${P.accentMid}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:P.accent,flexShrink:0}}>{entry.person.split(" ").map(n=>n[0]).join("")}</div>
                          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,color:P.text}}>{entry.person} <span style={{fontWeight:400,color:P.textMute,fontSize:11}}>entered</span></div><div style={{fontSize:11,color:P.textMute}}>{entry.email} · {entry.location} · {entry.time}</div></div>
                          <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:14,fontWeight:800,color:P.text}}>{entry.duration}</div><div style={{fontSize:10,color:P.textMute}}>Time spent</div></div>
                        </div>
                      </div>))}
                  </div>
                  <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,overflow:"hidden"}}>
                    {(()=>{const idx=day.entries.findIndex((_,i)=>activeLog===`${day.date}-${i}`);const entry=idx>=0?day.entries[idx]:day.entries[0];return(
                      <div><div style={{padding:"12px 16px",borderBottom:`1px solid ${P.border}`,background:P.bg,display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:28,height:28,borderRadius:"50%",background:P.accentLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:P.accent}}>{entry.person.split(" ").map(n=>n[0]).join("")}</div>
                        <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:P.text}}>{entry.person} <span style={{fontWeight:400,color:P.textMute}}>entered</span></div><div style={{fontSize:10,color:P.textMute}}>{entry.email} · {entry.time}</div></div>
                        <div style={{fontSize:13,fontWeight:800,color:P.text}}>{entry.duration}</div>
                      </div>
                      {entry.actions.map((act,j)=>(
                        <div key={j} style={{padding:"12px 16px",borderBottom:j<entry.actions.length-1?`1px solid ${P.bg}`:"none",display:"flex",alignItems:"flex-start",gap:10}}>
                          <div style={{width:28,height:28,borderRadius:6,background:P.tealBg,border:`1px solid ${P.tealBorder}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:12}}>👁</span></div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:12,fontWeight:600,color:P.text}}>Viewed "{act.item}"</div>
                            <div style={{marginTop:6,background:P.bg,borderRadius:6,padding:"8px 10px",border:`1px solid ${P.border}`}}>
                              <div style={{fontSize:10,color:P.textMute,marginBottom:4}}>Document preview</div>
                              {[90,70,80].map((w,k)=><div key={k} style={{height:6,background:P.border,borderRadius:3,marginBottom:4,width:`${w}%`}}/>)}
                            </div>
                          </div>
                          <span style={{fontSize:11,color:P.textMute,flexShrink:0}}>{act.time}</span>
                        </div>))}
                      </div>);})()} 
                  </div>
                </div>
              </div>))}
            <div style={{fontSize:13,fontWeight:700,color:P.text,marginBottom:12,marginTop:8}}>Stakeholder Engagement</div>
            <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,overflow:"hidden"}}>
              {deal.stakeholders.map((s,i)=>{const ec=s.engagement>60?P.green:s.engagement>30?P.amber:P.red;return(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 18px",borderBottom:i<deal.stakeholders.length-1?`1px solid ${P.bg}`:"none"}}>
                  <div className="headline" style={{width:32,height:32,borderRadius:"50%",background:P.accentLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:P.accentMid}}>{s.initials}</div>
                  <div style={{width:150}}><div style={{fontSize:13,fontWeight:600,color:P.text}}>{s.name}</div><div style={{fontSize:11,color:P.textMute}}>{s.role}</div></div>
                  <div style={{flex:1,height:8,background:P.bg,borderRadius:99,overflow:"hidden"}}><div style={{width:`${s.engagement}%`,height:"100%",background:ec,borderRadius:99}}/></div>
                  <span style={{fontSize:13,fontWeight:800,color:ec,width:36,textAlign:"right"}}>{s.engagement}%</span>
                  <span style={{fontSize:11,color:P.textMute,width:80}}>{s.lastSeen}</span>
                </div>);})}
            </div>
          </div>}

        </div>

        {/* AI PANEL */}
        {aiOpen&&viewMode==="rep"&&<div style={{width:390,background:P.surface,borderLeft:`1px solid ${P.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{padding:"13px 16px",borderBottom:`1px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:P.bg}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:8,height:8,borderRadius:"50%",background:aiLoading?P.amber:P.accent}}/><span className="headline" style={{fontSize:14,color:P.text}}>AI Deal Coach</span></div>
            <button onClick={()=>setAiOpen(false)} style={{background:"none",border:"none",color:P.textMute,cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
          </div>
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${P.border}`,display:"flex",flexWrap:"wrap",gap:5}}>
            {[["brief","Deal Brief"],["bizcase","Business Case"],["nextsteps","Next Steps"],["email","Follow-up Email"]].map(([m,l])=>(
              <button key={m} onClick={()=>runAI(m)} style={{padding:"4px 11px",borderRadius:4,border:`1px solid ${aiMode===m&&aiText?P.accent:P.border}`,background:aiMode===m&&aiText?P.accentLight:"transparent",color:aiMode===m&&aiText?P.accent:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>{l}</button>))}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"14px 16px"}}>
            {aiLoading?<div className="shim" style={{display:"flex",flexDirection:"column",gap:8}}>{[95,78,88,62,90,70].map((w,i)=><div key={i} style={{height:11,width:`${w}%`}}/>)}</div>
            :aiText?<div style={{fontSize:13,color:P.textSec,lineHeight:1.7}} dangerouslySetInnerHTML={{__html:renderMD(aiText)}}/>
            :<div style={{color:P.textMute,fontSize:12,textAlign:"center",paddingTop:40}}>Select a quick action or ask a question</div>}
          </div>
          <div style={{padding:"11px 12px",borderTop:`1px solid ${P.border}`}}>
            <div style={{display:"flex",gap:6}}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&chatInput.trim()){runAI("chat",chatInput);setChatInput("");}}} placeholder="Ask about this deal..." style={{flex:1,border:`1px solid ${P.border}`,borderRadius:6,padding:"8px 10px",fontSize:12,color:P.text,background:P.bg}}/>
              <button onClick={()=>{if(chatInput.trim()){runAI("chat",chatInput);setChatInput("");}}} style={{padding:"8px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700}}>→</button>
            </div>
          </div>
        </div>}
      </div>
    </div>

    {showCreator&&<DealCreator onSave={createDeal} onImport={importDeals} onClose={()=>setShowCreator(false)} stageLabels={stageLabels}/>}
    {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:P.text,borderRadius:8,padding:"10px 20px",fontSize:12,color:"#fff",fontWeight:600,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",zIndex:999}}>{toast} ✓</div>}
  </div>;
}

// Catches any render-time exception in the tree below and shows a real, visible message
// instead of an unhandled crash leaving a blank white page with no clue why.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("DealRoom crashed:", error, info); }
  render() {
    if (this.state.error) {
      return React.createElement("div", {
        style: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", fontFamily: "'Inter','Segoe UI',sans-serif" }
      },
        React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "#252A2E" } }, "Something went wrong"),
        React.createElement("div", { style: { fontSize: 13, color: "#6B7178", maxWidth: 480, fontFamily: "monospace", whiteSpace: "pre-wrap" } }, String(this.state.error && this.state.error.message || this.state.error)),
        React.createElement("button", {
          onClick: () => window.location.reload(),
          style: { padding: "10px 20px", background: "#D65F3C", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
        }, "Reload")
      );
    }
    return this.props.children;
  }
}

// Named distinctly from the DealRoom function itself -- assigning globalThis.DealRoom
// here would overwrite that same top-level binding (classic script, not a module, so
// they're the same global property), making this wrapper self-referential and causing
// infinite recursion the moment React actually renders it.
globalThis.DealRoomMount = () => React.createElement(ErrorBoundary, null,
  React.createElement(DealRoom, { prospectShareSlug: PROSPECT_ROUTE })
);
