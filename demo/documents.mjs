// The sample documents demo deal rooms link to (built into /demo-assets by build.mjs).
// Static files, so no absolute dates -- everything reads as "week 1", "day 30", etc.
import { DEALS } from "./content.mjs";
const deal = k => DEALS.find(d => d.key === k);
const money = n => "$" + Math.round(n).toLocaleString("en-US");
const pill = (cls, t) => ({ html: `<span class="pill ${cls}">${t}</span>` });
const statusPill = s => s === "complete" ? pill("g", "Complete") : s === "in-progress" ? pill("a", "In progress") : pill("n", "Planned");

// ── PDFs ───────────────────────────────────────────────────────────────────────────────────
const halvorsen = deal("halvorsen"), castellan = deal("castellan"), meridian = deal("meridian");

export const DOCS = [
  {
    file: "ridgeline-security-overview.pdf", title: "Security & Compliance Overview", sub: "How Ridgeline protects operational and regulated data.", tag: "Trust & Security",
    blocks: [
      { kpis: [["SOC 2 Type II", "Annual audit, report available under NDA"], ["99.9%", "Contractual uptime SLA"], ["AES-256", "Encryption at rest; TLS 1.2+ in transit"]] },
      { h: "Certifications and frameworks" },
      { table: [["Framework", "Status", "Notes"],
        ["SOC 2 Type II", pill("g", "Current"), "Security, Availability, Confidentiality. Audited annually by an independent CPA firm."],
        ["HITRUST r2", pill("a", "In progress"), "Assessment underway; interim HITRUST-aligned control mapping available."],
        ["HIPAA", pill("g", "Supported"), "Business Associate Agreement available for healthcare customers."],
        ["ISO 27001", pill("n", "Aligned"), "ISMS aligned to ISO 27001:2022; certification on the roadmap."],
        ["GDPR / CCPA", pill("g", "Supported"), "Data Processing Addendum and subprocessor list available."]] },
      { h: "Data protection" },
      { ul: ["Customer data hosted in U.S. regions only (primary and disaster-recovery regions in separate geographies)",
        "Logical tenant isolation with per-customer encryption keys",
        "Read-only connectors by default; write-back is opt-in per integration",
        "Configurable data retention, from 90 days to 7 years, with verified deletion on request"] },
      { h: "Identity and access" },
      { ul: ["SSO via SAML 2.0 or OIDC (Okta, Microsoft Entra ID, Google Workspace)", "SCIM user provisioning and deprovisioning",
        "Role-based access down to site, plant, or region", "MFA enforced for all Ridgeline personnel with production access"] },
      { h: "Operations and resilience" },
      { table: [["Control", "Commitment"],
        ["Availability", "99.9% monthly uptime SLA with service credits"],
        ["Backups", "Continuous; point-in-time restore for 35 days"],
        ["Recovery objectives", "RPO 1 hour, RTO 4 hours"],
        ["Penetration testing", "Annual third-party test plus continuous automated scanning; summary available under NDA"],
        ["Incident response", "24/7 on-call; customer notification within 48 hours of a confirmed incident"]] },
      { h: "Subprocessors" },
      { table: [["Subprocessor", "Purpose", "Location"],
        ["Cloud infrastructure provider", "Hosting, storage, compute", "United States"],
        ["Email delivery provider", "Alert and notification email", "United States"],
        ["Support desk platform", "Customer support tickets", "United States"]] },
    ],
  },
  {
    file: "customer-story-regional-3pl.pdf", title: "Regional 3PL cuts carrier chargebacks 34% in its first peak", sub: "A nine-site third-party logistics provider in the Southeast", tag: "Customer Story",
    blocks: [
      { kpis: [["34%", "fewer carrier chargebacks, peak over peak"], ["22 min", "average time to resolve a dock exception"], ["7 weeks", "from kickoff to all nine sites live"]] },
      { h: "The challenge" },
      { p: "The company ran nine sites on two WMS platforms. Exceptions (late trailers, short picks, missed carrier cutoffs) were reported in a spreadsheet that a network analyst rebuilt every morning. By the time a site leader saw a problem, the truck had already left or the chargeback was already on its way." },
      { h: "The approach" },
      { ul: ["Connected both WMS platforms and the TMS in the first two weeks, with no custom integration work from IT",
        "Configured exception rules for carrier cutoffs, short picks, and dock congestion, each routed to the owning site lead",
        "Captured how the three most experienced site leads resolved common exceptions and turned it into playbooks",
        "Replaced the morning network report with a live dashboard for the COO's daily stand-up"] },
      { h: "The results" },
      { table: [["Metric", "Before", "After first peak"], ["Carrier chargebacks", "$286K", "$189K"], ["Avg. exception resolution time", "3.1 hours", "22 minutes"], ["Morning report prep", "2 hours/day", "Eliminated"], ["On-time outbound", "91.4%", "96.8%"]] },
      { quote: "We used to learn about a missed cutoff from the carrier invoice. Now the site lead gets it ninety minutes out with the fix already suggested.", by: "VP of Operations" },
    ],
  },
  {
    file: "customer-story-precision-manufacturer.pdf", title: "Precision manufacturer lifts on-time delivery to 96%", sub: "A three-plant discrete manufacturer serving automotive and aerospace OEMs", tag: "Customer Story",
    blocks: [
      { kpis: [["88% → 96%", "on-time delivery in two quarters"], ["18%", "less unplanned downtime"], ["10 weeks", "to all three plants live"]] },
      { h: "The challenge" },
      { p: "Production data lived in the MES, the ERP, and a nightly spreadsheet. Plant managers saw scrap and downtime the next morning, and two OEM customers had opened corrective action requests over late deliveries." },
      { h: "The approach" },
      { ul: ["Native connectors to the plants' MES and ERP, live in the first three weeks", "Shift-level OEE, scrap, and downtime views for every line", "Alerts to line supervisors when scrap or downtime crossed agreed thresholds during the shift", "A weekly OTD scorecard shared directly with OEM customer quality teams"] },
      { h: "The results" },
      { table: [["Metric", "Before", "After two quarters"], ["On-time delivery", "88%", "96%"], ["Unplanned downtime", "7.9%", "6.5%"], ["OEE", "62%", "68%"], ["OEM corrective actions open", "2", "0"]] },
      { quote: "The first week we had shift-level scrap alerts, a supervisor caught a tooling issue at 10 a.m. that used to cost us a full shift of parts.", by: "Plant Manager" },
    ],
  },
  {
    file: "ridgeline-implementation-methodology.pdf", title: "Implementation Methodology", sub: "Live in eight weeks, with value proven by day 30.", tag: "Customer Success",
    blocks: [
      { h: "The eight-week path" },
      { table: [["Phase", "Weeks", "What happens", "Exit criteria"],
        ["Kickoff", "1", "Executive kickoff, success metrics, rollout plan, weekly cadence", "Signed-off success plan"],
        ["Requirements", "2–3", "Data access, hierarchy mapping, alert rules, roles and permissions", "Requirements sign-off"],
        ["Configure", "3–6", "Connectors live, dashboards and rules configured, data validated", "Validation passed by customer IT"],
        ["Train", "6–7", "Train-the-trainer, role-based sessions, quick-reference guides", "Trainers certified"],
        ["Go live", "8", "Cutover, hypercare, daily check-ins for two weeks", "Go-live approval"],
        ["Value review", "Day 30", "Measure against baseline with the executive sponsor", "Value report delivered"]] },
      { h: "Who's involved" },
      { table: [["Ridgeline", "Your team"], ["Implementation Lead: owns the plan and the timeline", "Executive sponsor: sets goals, clears roadblocks"], ["Solutions Engineer: connectors and data validation", "Project lead: day-to-day decisions and coordination"], ["Customer Success Manager: adoption and value reviews", "IT contact: data access and SSO"], ["Security team: questionnaires and reviews", "Trainers: champions who teach their teams"]] },
      { h: "What we ask of you" },
      { ul: ["A named project lead with about four hours a week during configuration", "Read-only access to source systems in week two", "A baseline for two or three success metrics before go-live"] },
    ],
  },
  {
    file: "halvorsen-discovery-recap.pdf", title: "Discovery Recap", sub: "Halvorsen Logistics · Network visibility and exception management", for: "Halvorsen Logistics",
    blocks: [
      { h: "What we heard" }, { p: halvorsen.discovery.summary },
      { h: "Current challenges" }, { ul: halvorsen.execSummary.challenges },
      { h: "What success looks like" },
      { table: [["Horizon", "Goals"], ...Object.entries(halvorsen.discovery.goals).map(([k, v]) => [k, v.join("; ")])] },
      { h: "Proposed two-site evaluation" },
      { table: [["Item", "Proposal"], ["Sites", "Columbus, OH and Memphis, TN"], ["Duration", "30 days after connectors are live"], ["Systems", "Both WMS instances at those sites, plus TMS carrier data"], ["Success measures", "Chargebacks from missed cutoffs; time to resolve dock exceptions; hours spent on the morning report"], ["Team", "Dana Whitfield (sponsor), Carla Nguyen, Leon Fischer, Raj Patel; Alex Morgan and Nina Castro from Ridgeline"]] },
      { h: "Next steps" },
      { table: [["Step", "Owner", "Status"], ...halvorsen.tasks.slice(1, 6).map(t => [t.task, t.buyer ? `${t.owner} / ${t.buyer}` : t.owner, statusPill(t.status)])] },
    ],
  },
  {
    file: "brightwater-week1-pilot-readout.pdf", title: "Week 1 Pilot Readout", sub: "Brightwater Health Partners · St. Anne's 4 West and 5 East", for: "Brightwater Health Partners",
    blocks: [
      { kpis: [["4.3 hrs", "discharge-to-departure (baseline 5.2)"], ["19%", "discharges before noon (baseline 14%)"], ["4.5 hrs", "nurse manager time chasing status per week (baseline 6.0)"]] },
      { h: "Progress against success criteria" },
      { table: [["Criterion", "Baseline", "Target", "Week 1", "Trend"], ["Discharge-to-departure time", "5.2 hrs", "< 3.5 hrs", "4.3 hrs", pill("a", "On pace")], ["Discharges before noon", "14%", "30%", "19%", pill("a", "On pace")], ["Nurse manager hours on status", "6.0/wk", "< 3.0/wk", "4.5/wk", pill("g", "Ahead")]] },
      { h: "What's working" },
      { ul: ["Charge nurses on 4 West are using the discharge board at morning huddle", "Pharmacy receives discharge medication requests automatically on order sign", "House supervisors can see pending discharges for both units in one view"] },
      { h: "Open issues" },
      { table: [["Issue", "Owner", "Plan"], ["Transport handoff not yet live on 5 East", "Marco Diaz / Nina Castro", "Interface mapping fix scheduled; live before the week 2 readout"], ["ADT feed latency averaging 4 minutes", "Marco Diaz", "Moving to real-time HL7 feed in the test environment"], ["InfoSec risk assessment in review", "Kevin Walsh / Ridgeline Security", "Written responses and pen-test summary due Friday"]] },
      { h: "Week 2 focus" },
      { ul: ["Turn on transport handoff for 5 East", "Add environmental services to the discharge milestones", "Close the InfoSec questions on data retention and Azure AD SSO"] },
    ],
  },
  {
    file: "castellan-proposal.pdf", title: "Proposal & Pricing Options", sub: "Castellan Manufacturing · Plant floor visibility across four plants", for: "Castellan Manufacturing",
    blocks: [
      { h: "Executive summary" }, { p: castellan.execSummary.problem.split("\n\n")[0] },
      { h: "What we'll deliver" }, { ul: castellan.execSummary.solutions },
      { h: "Expected impact" },
      { table: [["Outcome", "Target", "Annual value"], ["Unplanned downtime reduction", "20%", "$420,000"], ["Nightly Excel roll-up eliminated", "30 analyst hours/week", "$85,800"], ["OEM late-delivery penalties avoided", "OTD back to 95%", "$150,000"], ["Total annual value", "", "$655,800"]], num: [2], totalLast: true },
      { h: "Pricing options" },
      { table: [["", "Option A: all four plants", "Option B: phased"], ["Year 1 subscription", "$148,500 (4 plants)", "$96,000 (Dayton, Toledo)"], ["Year 2 subscription", "$148,500", "$148,500 (all four plants)"], ["Implementation (fixed fee)", "$24,000", "$16,000 in year 1, $8,000 in year 2"], ["Three-year total", "$469,500", "$417,000"], ["Payback", "3.2 months", "2.9 months"]] },
      { note: "Pricing assumes a three-year term, annual billing in advance, net 30, and a 5% cap on renewal increases. Valid for 30 days." },
      { h: "Why Ridgeline" },
      { ul: ["Native Rockwell MES and Epicor ERP connectors (no custom build, unlike the stalled in-house project)", "Two plants live in eight weeks on a fixed-fee implementation", "References available from two discrete manufacturers of similar size"] },
    ],
  },
  {
    file: "castellan-implementation-plan.pdf", title: "Phase 1 Implementation Plan", sub: "Castellan Manufacturing · Dayton and Toledo plants", for: "Castellan Manufacturing",
    blocks: [
      { table: [["Week", "Milestone", "Ridgeline", "Castellan"],
        ["1", "Kickoff; success metrics confirmed", "Implementation Lead", "Michelle Park, Eric Sato"],
        ["2", "MES and ERP read access; line and asset hierarchy", "Solutions Engineer", "Jenna Kowalski"],
        ["3", "Connectors live in Dayton; data validation begins", "Solutions Engineer", "Jenna Kowalski"],
        ["4", "Scrap and downtime thresholds agreed per line", "Implementation Lead", "Eric Sato, line supervisors"],
        ["5", "Toledo connectors live; dashboards configured", "Solutions Engineer", "Toledo plant manager"],
        ["6", "Supervisor and plant manager training", "Customer Success", "Plant trainers"],
        ["7", "Parallel run against the nightly roll-up", "Implementation Lead", "Operations analysts"],
        ["8", "Go live at both plants; roll-up retired", "Implementation Lead", "Michelle Park"]] },
      { h: "Success measures at day 30" },
      { ul: ["Shift-level OEE, scrap, and downtime visible for every Dayton and Toledo line", "Supervisors acknowledge 90% of alerts within 15 minutes", "Nightly Excel roll-up retired at both plants"] },
      { h: "Risks and mitigations" },
      { table: [["Risk", "Mitigation"], ["IT capacity during the ERP patch window", "Read-only connectors; no changes on the Castellan side"], ["Supervisor adoption", "Alerts go to existing radios and phones; champions named on each shift"]] },
    ],
  },
  {
    file: "meridian-final-proposal.pdf", title: "Final Proposal", sub: "Meridian Credit Union · Member service operations", for: "Meridian Credit Union",
    blocks: [
      { h: "Summary" }, { p: meridian.execSummary.problem.split("\n\n")[0] },
      { h: "Scope" }, { ul: meridian.execSummary.solutions },
      { h: "Investment" },
      { table: [["Item", "Year 1", "Year 2", "Year 3"], ["Ops Cloud subscription (contact center + 21 branches)", "$96,000", "$96,000", "$96,000"], ["Symitar connector", "Included", "Included", "Included"], ["Implementation and training", "Included", "—", "—"], ["Total", "$96,000", "$96,000", "$96,000"]], num: [1, 2, 3], totalLast: true },
      { note: "Three-year total of $288,000, inside the $300,000 budget line. Annual billing in advance, net 30." },
      { h: "Timeline" },
      { table: [["Milestone", "Timing"], ["Contract signed", "Week 0"], ["Contact center live on the unified queue", "Week 6"], ["SLA reporting to leadership", "Week 8"], ["All 21 branches live", "Week 14"]] },
      { h: "Expected outcomes" }, { ul: meridian.discovery.topOutcomes },
    ],
  },
  {
    file: "meridian-third-party-risk-packet.pdf", title: "Third-Party Risk Due Diligence Packet", sub: "Prepared for Meridian Credit Union's vendor management program", for: "Meridian Credit Union",
    blocks: [
      { h: "Vendor profile" },
      { table: [["Item", "Detail"], ["Legal name", "Ridgeline Software, Inc. (fictional)"], ["Service", "Ridgeline Ops Cloud (SaaS)"], ["Data classification", "Confidential member request data; no card or core-account credentials stored"], ["Hosting", "U.S. regions only"]] },
      { h: "Control summary" },
      { table: [["Area", "Evidence provided"], ["Information security program", "SOC 2 Type II report (under NDA); security policies index"], ["Business continuity", "BCP/DR plan summary; annual DR test results"], ["Access management", "SSO/SCIM support; quarterly access reviews"], ["Vendor management", "Subprocessor list and monitoring process"], ["Insurance", "Cyber liability and E&O certificates of insurance"], ["Financial condition", "Audited financial statements available under NDA"]] },
      { h: "Mapping to NCUA third-party guidance" },
      { table: [["Guidance area", "How it's addressed"], ["Risk assessment", "Completed questionnaire and control summary above"], ["Due diligence", "SOC 2 report, financials, insurance, references"], ["Contract provisions", "Audit rights, data ownership, breach notification in the MSA"], ["Ongoing oversight", "Annual SOC 2 refresh; quarterly service reviews"]] },
    ],
  },
  {
    file: "oakline-kickoff-deck.pdf", landscape: true, title: "Kickoff: Oakline Store Operations Rollout", sub: "Welcome to Ridgeline. Here's how we get all 180 stores live.", for: "Oakline Retail Group",
    blocks: [
      { kpis: [["180", "stores in scope"], ["3", "regional rollout waves"], ["< 5%", "out-of-stock target, chain-wide"], ["6 hrs", "back per district manager each week"]] },
      { h: "Rollout waves" },
      { table: [["Wave", "Region", "Stores", "Configure", "Go live"], ["1", "Southeast", "62", "Weeks 1–3", "Week 4"], ["2", "Central", "58", "Weeks 5–7", "Week 8"], ["3", "Northeast", "60", "Weeks 9–11", "Week 12"]] },
      { h: "Team" },
      { table: [["Oakline", "Role", "Ridgeline", "Role"], ["Rachel Summers", "Executive sponsor", "Alex Morgan", "Account lead"], ["Jason Albright", "Project owner", "Ben Ortiz", "Implementation Lead"], ["Aisha Grant", "IT and data", "Nina Castro", "Solutions Engineer"], ["Kate Donnelly", "Training", "Hannah Price", "Customer Success"]] },
      { h: "Governance" },
      { ul: ["Weekly working session, Tuesdays, 45 minutes (Jason, Aisha, Kate, Ben, Hannah)", "Monthly steering review with Rachel and Alex", "Shared action plan in this deal room; status updated after every session"] },
      { h: "Next 30 days" },
      { ul: ["Store hierarchy and district mapping", "Manhattan WMS and Oracle Retail read access", "Out-of-stock alert thresholds by category", "Southeast configuration and data validation", "Train-the-trainer session with Kate's team"] },
    ],
  },
  {
    file: "oakline-pilot-results.pdf", title: "Pilot Results Summary", sub: "Oakline Retail Group · 12-store, four-week pilot", for: "Oakline Retail Group",
    blocks: [
      { kpis: [["7.8% → 5.1%", "out-of-stocks on top-selling SKUs"], ["71% → 93%", "on-time store task completion"], ["5.5 hrs", "saved per district manager per week"]] },
      { h: "Store-level results" },
      { table: [["Store", "District", "OOS before", "OOS after", "Task completion"],
        ["#104 Buckhead", "Atlanta", "8.4%", "5.0%", "95%"], ["#117 Marietta", "Atlanta", "7.1%", "4.6%", "94%"], ["#122 Decatur", "Atlanta", "8.9%", "5.8%", "91%"],
        ["#206 Charlotte South", "Charlotte", "7.6%", "5.2%", "93%"], ["#211 Ballantyne", "Charlotte", "6.9%", "4.4%", "96%"], ["#219 Concord", "Charlotte", "8.2%", "5.6%", "90%"],
        ["#305 Nashville West", "Nashville", "7.4%", "4.9%", "94%"], ["#309 Franklin", "Nashville", "7.9%", "5.3%", "92%"], ["#314 Murfreesboro", "Nashville", "8.6%", "5.7%", "90%"],
        ["#402 Orlando North", "Orlando", "7.2%", "4.8%", "95%"], ["#408 Winter Park", "Orlando", "7.5%", "5.0%", "93%"], ["#415 Kissimmee", "Orlando", "8.0%", "5.4%", "92%"]] },
      { quote: "The district managers stopped building spreadsheets on Monday and started walking stores with the list of what actually needs fixing.", by: "Jason Albright, VP Store Operations" },
      { h: "Recommendation" }, { p: "Proceed with a chain-wide rollout in three regional waves, starting with the Southeast, where 5 of the 12 pilot stores are located." },
    ],
  },
  {
    file: "oakline-order-form-executed.pdf", title: "Order Form", sub: "Ridgeline Ops Cloud · Oakline Retail Group", for: "Oakline Retail Group",
    blocks: [
      `<div class="stamp">EXECUTED</div>`,
      { table: [["Customer", "Oakline Retail Group"], ["Subscription term", "36 months from the order start date"], ["Billing", "Annually in advance, net 30"], ["Governing agreement", "Ridgeline Master Subscription Agreement (executed alongside this order)"]] },
      { h: "Products and services" },
      { table: [["Item", "Qty", "Unit price", "Annual amount"], ["Ops Cloud: Store Operations", "180 stores", "$1,250 / store / yr", "$225,000"], ["Implementation and training (year 1 only)", "1", "$40,000", "$40,000"], ["Year 1 total", "", "", "$265,000"]], num: [3], totalLast: true },
      { p: "Years 2 and 3: $225,000 per year. Renewal increases capped at 5%." },
      `<div class="sig"><div><div class="s">Rachel Summers</div>Rachel Summers, Chief Operating Officer<br>Oakline Retail Group</div><div><div class="s">Elaine Brooks</div>Elaine Brooks, Chief Revenue Officer<br>Ridgeline Software</div></div>`,
    ],
  },
];

// ── Spreadsheets (openpyxl via office.py). Cells starting with "=" are live formulas. ──────
export const SHEETS = [
  {
    file: "brightwater-capacity-roi-model.xlsx", title: "Capacity ROI Model",
    sheets: [
      { name: "Assumptions", widths: [44, 16, 40], rows: [
        ["Brightwater Health Partners · Capacity ROI Model", null, null],
        ["Input", "Value", "Source"],
        ["Licensed med-surg beds (3 hospitals)", 820, "Brightwater bed census"],
        ["Average discharges per day", 164, "12-month ADT average"],
        ["Discharge-to-departure hours today", 5.2, "Pilot baseline"],
        ["Target discharge-to-departure hours", 3.5, "Agreed success criteria"],
        ["Contribution margin per surgical case", 2400, "Finance estimate"],
        ["Share of freed bed-hours converted to surgical cases", 0.08, "Conservative planning assumption"],
        ["Average inpatient length of stay (hours)", 110, "Finance"],
        ["Cost per ED boarding hour", 65, "Finance estimate (diversion and staffing)"],
        ["ED boarding hours per year today", 41000, "Quality dashboard"],
        ["Expected reduction in boarding hours", 0.2, "Year-one goal"],
        ["Nurse managers", 38, "Nursing"],
        ["Hours saved per nurse manager per week", 3, "Pilot target"],
        ["Loaded hourly cost, nurse manager", 78, "HR"],
        ["Annual Ops Cloud subscription", 212000, "Ridgeline proposal"],
      ] },
      { name: "ROI", widths: [44, 18, 18, 18], rows: [
        ["Annual value", "Year 1", "Year 2", "Year 3"],
        ["Bed-hours freed per year", "=Assumptions!B4*(Assumptions!B5-Assumptions!B6)*365", "=B2", "=B2"],
        ["Added surgical cases", "=B2*Assumptions!B8/Assumptions!B9", "=B3*1.1", "=C3*1.1"],
        ["Surgical contribution margin", "=B3*Assumptions!B7", "=C3*Assumptions!B7", "=D3*Assumptions!B7"],
        ["ED boarding cost avoided", "=Assumptions!B11*Assumptions!B12*Assumptions!B10", "=B5", "=B5"],
        ["Nurse manager time recovered", "=Assumptions!B13*Assumptions!B14*48*Assumptions!B15", "=B6", "=B6"],
        ["Total value", "=SUM(B4:B6)", "=SUM(C4:C6)", "=SUM(D4:D6)"],
        ["Ops Cloud cost", "=Assumptions!B16", "=Assumptions!B16", "=Assumptions!B16"],
        ["Net benefit", "=B7-B8", "=C7-C8", "=D7-D8"],
        ["ROI", "=B9/B8", "=C9/C8", "=D9/D8"],
        ["Payback (months)", "=B8/(B7/12)", null, null],
      ], money: ["B4:D9"], pct: ["B10:D10"], dec: ["B11"], int: ["B2:D3"] },
    ],
  },
  {
    file: "castellan-business-case.xlsx", title: "Business Case & ROI Model",
    sheets: [
      { name: "Assumptions", widths: [46, 16, 36], rows: [
        ["Castellan Manufacturing · Business Case", null, null],
        ["Input", "Value", "Source"],
        ["Unplanned downtime cost per year", 2100000, "Castellan Finance"],
        ["Expected downtime reduction", 0.2, "Customer story benchmark"],
        ["Analyst hours per week on the nightly roll-up", 30, "Operations"],
        ["Loaded analyst cost per hour", 55, "Finance"],
        ["OEM late-delivery penalties per year", 150000, "Customer contracts"],
        ["Share of penalties avoided at 95% OTD", 1, "Planning assumption"],
        ["Annual subscription (Option A)", 148500, "Ridgeline proposal"],
        ["Implementation fee (one time)", 24000, "Ridgeline proposal"],
      ] },
      { name: "Three-Year ROI", widths: [40, 16, 16, 16, 16], rows: [
        ["", "Year 1", "Year 2", "Year 3", "Total"],
        ["Downtime savings", "=Assumptions!B3*Assumptions!B4", "=B2", "=B2", "=SUM(B2:D2)"],
        ["Analyst time recovered", "=Assumptions!B5*Assumptions!B6*52", "=B3", "=B3", "=SUM(B3:D3)"],
        ["Penalties avoided", "=Assumptions!B7*Assumptions!B8", "=B4", "=B4", "=SUM(B4:D4)"],
        ["Total value", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)", "=SUM(E2:E4)"],
        ["Subscription", "=Assumptions!B9", "=Assumptions!B9", "=Assumptions!B9", "=SUM(B6:D6)"],
        ["Implementation", "=Assumptions!B10", 0, 0, "=SUM(B7:D7)"],
        ["Total cost", "=B6+B7", "=C6+C7", "=D6+D7", "=SUM(E6:E7)"],
        ["Net benefit", "=B5-B8", "=C5-C8", "=D5-D8", "=E5-E8"],
        ["ROI", "=B9/B8", "=C9/C8", "=D9/D8", "=E9/E8"],
        ["Payback (months)", "=B8/(B5/12)", null, null, null],
      ], money: ["B2:E9"], pct: ["B10:E10"], dec: ["B11"] },
    ],
  },
  {
    file: "oakline-implementation-plan.xlsx", title: "Implementation Plan & Timeline",
    sheets: [
      { name: "Plan", widths: [8, 44, 18, 26, 10, 10, 14], rows: [
        ["#", "Task", "Workstream", "Owner", "Start wk", "End wk", "Status"],
        [1, "Executive kickoff", "Kickoff", "Alex Morgan / Rachel Summers", 1, 1, "Complete"],
        [2, "Success metrics and rollout waves confirmed", "Kickoff", "Hannah Price / Jason Albright", 1, 1, "Complete"],
        [3, "Store hierarchy and district mapping", "Requirements", "Ben Ortiz / Aisha Grant", 1, 2, "Complete"],
        [4, "Manhattan WMS and Oracle Retail read access", "Requirements", "Ben Ortiz / Aisha Grant", 2, 2, "Complete"],
        [5, "Out-of-stock alert thresholds by category", "Requirements", "Ben Ortiz / Luis Moreno", 2, 2, "Complete"],
        [6, "Configure Southeast region (62 stores)", "Implementation", "Ben Ortiz", 2, 3, "In progress"],
        [7, "Data validation with IT Applications", "Implementation", "Aisha Grant", 3, 3, "In progress"],
        [8, "Pilot-store cutover to production", "Implementation", "Ben Ortiz / Jason Albright", 3, 3, "Planned"],
        [9, "Train-the-trainer session", "Training", "Hannah Price / Kate Donnelly", 3, 3, "Planned"],
        [10, "District manager training, Southeast", "Training", "Kate Donnelly", 4, 4, "Planned"],
        [11, "Southeast go-live", "Go live", "Ben Ortiz / Jason Albright", 4, 4, "Planned"],
        [12, "Configure Central region (58 stores)", "Wave 2", "Ben Ortiz", 5, 7, "Planned"],
        [13, "Central go-live", "Wave 2", "Jason Albright", 8, 8, "Planned"],
        [14, "Configure Northeast region (60 stores)", "Wave 3", "Ben Ortiz", 9, 11, "Planned"],
        [15, "Northeast go-live", "Wave 3", "Jason Albright", 12, 12, "Planned"],
        [16, "30-day value review", "Value", "Hannah Price / Rachel Summers", 8, 8, "Planned"],
      ], gantt: { startCol: 5, endCol: 6, weeks: 12 } },
    ],
  },
];

// ── Word documents (HTML -> .docx via macOS textutil) ────────────────────────────────────────
const brightwater = deal("brightwater");
export const WORD_DOCS = [
  {
    file: "brightwater-pilot-success-criteria.docx", title: "Pilot Success Criteria & Scorecard",
    html: `<h1 style="color:#16324F">Pilot Success Criteria &amp; Scorecard</h1>
<p><b>Brightwater Health Partners × Ridgeline Software</b><br>Pilot units: St. Anne's 4 West and 5 East · Duration: 4 weeks</p>
<h2 style="color:#16324F">Purpose</h2>
<p>${brightwater.discovery.primaryUseCase} This document defines what "success" means before the pilot starts, so the go/no-go decision is made against numbers everyone agreed to up front.</p>
<h2 style="color:#16324F">Success criteria</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr style="background:#16324F;color:#ffffff"><th>Criterion</th><th>Baseline</th><th>Target</th><th>How measured</th><th>Owner</th></tr>
<tr><td>Discharge-to-departure time</td><td>5.2 hours</td><td>Under 3.5 hours</td><td>ADT discharge order to departure timestamp</td><td>Samantha Cole</td></tr>
<tr><td>Discharges before noon</td><td>14%</td><td>30%</td><td>Share of discharges with departure before 12:00</td><td>Tanya Ellis</td></tr>
<tr><td>Nurse manager time chasing status</td><td>6.0 hrs/week</td><td>Under 3.0 hrs/week</td><td>Weekly self-reported time log</td><td>Tanya Ellis</td></tr>
</table>
<p><b>Decision rule:</b> the pilot succeeds if at least two of the three criteria reach target by the final readout, and InfoSec completes its risk assessment with no high findings.</p>
<h2 style="color:#16324F">Scope</h2>
<ul><li>Read-only Epic ADT feed in the test environment, then production after InfoSec sign-off</li><li>Discharge milestones: order signed, medications ready, transport requested, education complete, departed</li><li>Automated handoffs to transport and pharmacy</li></ul>
<h2 style="color:#16324F">Out of scope</h2>
<ul><li>Write-back to Epic</li><li>Perioperative scheduling</li><li>Units outside 4 West and 5 East</li></ul>
<h2 style="color:#16324F">Timeline and readouts</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr style="background:#16324F;color:#ffffff"><th>Week</th><th>Milestone</th></tr>
<tr><td>0</td><td>Kickoff, baseline confirmed, ADT feed connected in test</td></tr>
<tr><td>1</td><td>Week 1 readout (Samantha, Tanya, Alex)</td></tr>
<tr><td>2</td><td>Week 2 readout; InfoSec responses delivered</td></tr>
<tr><td>4</td><td>Final readout to the Capacity Steering Committee; go/no-go</td></tr>
</table>
<p><i>Sample document for the myBivy demo workspace. All organizations and people are fictional.</i></p>`,
  },
  {
    file: "meridian-msa-redline-v2.docx", title: "Master Subscription Agreement — Redline v2",
    html: `<h1 style="color:#16324F">Master Subscription Agreement</h1>
<p><b>Ridgeline Software, Inc. and Meridian Credit Union</b><br>Redline v2: Meridian Legal comments on Ridgeline v1. Deletions shown struck through; insertions underlined in blue.</p>
<h2>4. Fees and Payment</h2>
<p>4.1 Customer will pay the fees in each Order Form annually in advance within <s style="color:#b91c1c">thirty (30)</s> <u style="color:#1d4ed8">forty-five (45)</u> days of the invoice date.</p>
<p>4.3 Ridgeline may increase fees on renewal by no more than <s style="color:#b91c1c">seven percent (7%)</s> <u style="color:#1d4ed8">five percent (5%)</u> per year.</p>
<p style="background:#fef9c3">[Meridian Legal – S. Delaney: 45-day terms are standard for our vendor program. Please confirm.]</p>
<h2>7. Data Protection</h2>
<p>7.2 Ridgeline will notify Customer of a Security Incident affecting Customer Data without undue delay and in any event within <s style="color:#b91c1c">seventy-two (72)</s> <u style="color:#1d4ed8">forty-eight (48)</u> hours of confirmation.</p>
<p>7.5 <u style="color:#1d4ed8">Upon reasonable notice and no more than once per year, Customer or its regulators, including the NCUA, may audit Ridgeline's compliance with this Section 7.</u></p>
<p style="background:#fef9c3">[Meridian Legal – S. Delaney: regulator audit right is required under our third-party risk policy.]</p>
<p style="background:#dbeafe">[Ridgeline Legal: 48-hour notification accepted. Audit right accepted for regulators; for Customer audits, propose reliance on the SOC 2 Type II report plus one on-site review per year at Customer's cost.]</p>
<h2>9. Limitation of Liability</h2>
<p>9.1 Each party's aggregate liability will not exceed the fees paid in the <s style="color:#b91c1c">twelve (12)</s> <u style="color:#1d4ed8">twenty-four (24)</u> months preceding the claim<u style="color:#1d4ed8">, except that for breaches of Section 7 the cap will be three times (3x) such fees</u>.</p>
<p style="background:#fef9c3">[Meridian Legal – S. Delaney: super-cap for data breaches is a must-have.]</p>
<p style="background:#dbeafe">[Ridgeline Legal: open. Counter at 2x fees for Section 7 with a 12-month base cap. Needs a call.]</p>
<h2>Open items</h2>
<ol><li>Payment terms: 30 vs. 45 days</li><li>Data-breach super-cap: 3x (Meridian) vs. 2x (Ridgeline counter)</li><li>Scope of customer audit right</li></ol>
<p><i>Sample document for the myBivy demo workspace. All organizations and people are fictional.</i></p>`,
  },
];

// ── Platform overview deck (python-pptx via office.py) ────────────────────────────────────────
export const DECK = {
  file: "ridgeline-platform-overview.pptx",
  slides: [
    { title: "Ridgeline Ops Cloud", sub: "Operations intelligence for teams that can't afford to find out tomorrow", kind: "title" },
    { title: "Operations teams find out too late", bullets: ["Data is spread across WMS, MES, ERP, EHR, and spreadsheets", "Exceptions surface in next-day reports, after the cost is already incurred", "The fix lives in a few experienced people's heads", "Custom data projects take quarters, and many stall"] },
    { title: "What Ops Cloud does", bullets: ["Connect: pre-built connectors to the systems you already run", "Detect: rules and forecasts that flag exceptions while there's still time to act", "Route: the right person gets the alert, with context and a recommended fix", "Prove: live dashboards and value reports for leadership"] },
    { title: "How it works", bullets: ["120+ connectors: Manhattan, Blue Yonder, Rockwell, Epicor, Oracle, Epic ADT, Symitar, McLeod and more", "Read-only by default; live in weeks with no custom build", "Role-based views from line supervisor to COO", "Mobile alerts, email, and Teams/Slack routing"] },
    { title: "Results customers see", bullets: ["34% fewer carrier chargebacks (regional 3PL)", "On-time delivery 88% → 96% (precision manufacturer)", "Out-of-stocks 7.8% → 5.1% in a 12-store pilot (specialty retailer)", "Discharge-to-departure time down 17% in week one (health system pilot)"] },
    { title: "Security and trust", bullets: ["SOC 2 Type II; HITRUST r2 in progress; BAA available", "SSO (SAML/OIDC) and SCIM; U.S.-only data residency", "99.9% uptime SLA; annual third-party penetration test"] },
    { title: "Getting started", bullets: ["Weeks 1–3: kickoff, requirements, data access", "Weeks 3–6: connectors live, rules and dashboards configured", "Weeks 6–8: training and go-live", "Day 30: value review against your baseline"] },
  ],
};

// ── Recording pages ─────────────────────────────────────────────────────────────────────────────
export const RECORDINGS = [
  {
    file: "recording-halvorsen-discovery.html", title: "Halvorsen Logistics: Discovery Call", duration: "47:12",
    meta: "Dana Whitfield, Carla Nguyen, Leon Fischer (Halvorsen) · Alex Morgan (Ridgeline)",
    summary: ["Halvorsen runs 14 sites on three WMS instances; the network report is rebuilt by hand every morning.", "Missed carrier cutoffs drove $410K in chargebacks last year, and peak season is the worry.", "Dana wants a two-site evaluation (Columbus and Memphis) before the December budget lock.", "IT (Raj Patel) is tied up with the ERP upgrade, so no custom integration work is possible."],
    moments: [["03:40", "Dana describes a missed cutoff at Memphis that cost $38K in one week"], ["12:15", "Carla walks through the twice-daily exception spreadsheet"], ["21:02", "Leon estimates 60% of chargebacks come from three carriers"], ["33:48", "Dana: \"If it needs IT, it won't happen before peak.\""], ["41:30", "Agreement on a two-site evaluation and the next technical call"]],
    transcript: [["Dana Whitfield", "Our best site leads know exactly what to do when a trailer's late. The problem is they find out when it's already too late to do it."], ["Alex Morgan", "What does it cost you when that happens?"], ["Leon Fischer", "Last year it was a little over four hundred thousand in chargebacks, and that's just what we could attribute to missed cutoffs."], ["Dana Whitfield", "And none of it shows up in one place. Carla's team rebuilds the network view every morning by hand."]],
    actions: ["Alex: send the discovery recap and proposed evaluation scope", "Leon: pull 90 days of chargeback data for Columbus and Memphis", "Nina Castro: technical fit call with Raj on WMS connectors"],
  },
  {
    file: "recording-castellan-demo.html", title: "Castellan Manufacturing: Plant-Floor Demo", duration: "58:30",
    meta: "Michelle Park, Eric Sato, two line supervisors (Castellan) · Alex Morgan, Nina Castro (Ridgeline)",
    summary: ["Demo built on a sample of Dayton line data: OEE, scrap, and downtime by shift.", "Supervisors reacted most to in-shift scrap alerts routed to their radios and phones.", "Eric asked how thresholds are set per line; Nina showed per-asset rules.", "Michelle wants a proposal with a phased option (two plants first)."],
    moments: [["05:10", "Live OEE by line for the Dayton plant"], ["18:45", "Scrap spike alert on Line 4 during second shift"], ["27:20", "Supervisor: \"That would have saved us Tuesday.\""], ["39:05", "Per-asset downtime rules and escalation"], ["52:40", "Michelle asks for pricing with a phased option"]],
    transcript: [["Line supervisor", "Right now I find out about scrap from the morning report. By then the tooling's already been running bad for six hours."], ["Nina Castro", "Here's the same line with a threshold at 3%. The alert goes to whoever's on shift, with the last twenty minutes of readings attached."], ["Eric Sato", "Can we set it differently for Line 2? That press always runs hotter."], ["Nina Castro", "Yes, rules are per asset. You can tune them without calling us."]],
    actions: ["Alex: proposal with Option A (all plants) and Option B (phased)", "Nina: connector deep dive with Jenna Kowalski (IT)", "Michelle: share OTD baseline with Finance for the business case"],
  },
  {
    file: "recording-oakline-kickoff.html", title: "Oakline Retail Group: Implementation Kickoff", duration: "52:04",
    meta: "Rachel Summers, Jason Albright, Aisha Grant, Kate Donnelly (Oakline) · Alex Morgan, Ben Ortiz, Hannah Price (Ridgeline)",
    summary: ["Confirmed the three-wave rollout, starting with the Southeast (62 stores).", "Success metrics: out-of-stocks under 5%, 95% task completion, 6 hours back per district manager.", "Aisha will provide Manhattan WMS and Oracle Retail read access this week.", "Kate's team will run training using a train-the-trainer model."],
    moments: [["02:30", "Rachel on why in-stock performance is the top priority this year"], ["14:10", "Ben walks through the 12-week rollout plan"], ["25:45", "Aisha raises the four Evergreen-converted stores' location codes"], ["38:00", "Kate and Hannah agree the training plan"], ["47:15", "Governance: weekly working session and monthly steering"]],
    transcript: [["Rachel Summers", "The pilot proved it. Now I care about two things: getting the Southeast live before the holiday reset, and not losing the district managers' momentum."], ["Ben Ortiz", "Then we configure the Southeast in the first three weeks and go live in week four, with the other regions following at four-week intervals."], ["Aisha Grant", "The four Evergreen stores still use their old location codes. We'll need a mapping before those go live."], ["Hannah Price", "We'll track that as its own item so it doesn't hold up the other 58."]],
    actions: ["Aisha: Manhattan WMS and Oracle Retail read access", "Ben: Southeast configuration plan and Evergreen code mapping", "Kate and Hannah: schedule the train-the-trainer session"],
  },
];
