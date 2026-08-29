const { useState, useEffect } = React;

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

// Transforms a Supabase `deals` row (with nested stakeholders/deal_tasks/documents from a
// PostgREST embed, or the equivalent shape from the get_deal_for_prospect RPC) into the
// exact camelCase shape the render tree below already expects. Keeping this as one pure
// function at the loading boundary means the ~700 lines of existing render code below
// don't need to change at all for the new column names.
function mapDealFromDb(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    company: row.company_name,
    contact: row.primary_contact_name,
    title: row.title,
    stage: row.stage,
    value: fmtCurrency(row.value_amount, row.currency),
    closeDate: row.close_date,
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
    })),
    content: (row.documents || []).map(d => ({
      id: d.id,
      title: d.title,
      type: d.file_type,
      uploaded: shortDate(d.created_at),
      category: d.category,
      storagePath: d.storage_path,
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

// Turns deal.risk into the ordered, human-readable flags the rep actually sees --
// sidebar dot, header pill, and the Analytics tab's Deal Health section all call this
// instead of each re-deriving severity/reason text their own way. Thresholds/rules match
// the spec exactly: no visit in 3 days ("going cold"), no task progress in 7 days
// ("stalled"), a decision-maker who's never viewed a document ("buyer disengaged").
function riskFlags(deal) {
  const r = deal.risk;
  if (!r) return [];
  const flags = [];
  if (r.goingCold) flags.push({ key: "going_cold", label: "Going Cold", severity: "cold", reason: `No prospect activity in ${r.daysSinceVisit} day${r.daysSinceVisit === 1 ? "" : "s"}` });
  if (r.stalled) flags.push({ key: "stalled", label: "Stalled", severity: "risk", reason: `No task activity in ${r.daysSinceTaskActivity} day${r.daysSinceTaskActivity === 1 ? "" : "s"}` });
  if (r.buyerDisengaged) flags.push({ key: "buyer_disengaged", label: "Buyer Disengaged", severity: "risk", reason: `${r.disengagedBuyerName}, your decision-maker, hasn't viewed any documents yet` });
  return flags;
}
// Hardcoded (not referencing P) since P isn't defined yet at this point in the file --
// "on" mirrors P.green/alpine, the other two are the mockup's own risk/cold dot colors.
const RISK_DOT_COLOR = { cold: "#8A6B63", risk: "#E0A94C", on: "#2C6E63" };

const API = "/api/ai-coach";
const callClaude = async (sys, usr, max = 1400) => {
  const r = await fetch(API, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ system:sys, max_tokens:max, messages:[{role:"user",content:usr}] })});
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

const AE = { name:"Mark Huckins", title:"Sr. Account Executive", company:"Salsify", email:"mark.huckins@gmail.com", phone:"+1-858-752-4321", linkedin:"https://linkedin.com/in/markhuckins", initials:"MH",
  photo:"https://media.licdn.com/dms/image/v2/D5603AQGEzOXSHDFOqA/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1699997107933?e=2147483647&v=beta&t=IymYW4hFsxj3t0BKhS4a9B-HxCFjzjBm1V9_QNUcbAs" };

// Fixed order, not derived from Object.keys/entries -- a JSONB blob's key order depends on
// however it was written (a different AI-extraction or import run could produce these in
// a different order), so it's not reliably chronological unless enforced here.
const GOAL_PERIODS = ["90 Days","1 Year","Beyond"];
const PHASES_ALL = ["Value Alignment","Product Demo","Trial Sessions","Business Case","Paper Process"];
const PHASES_NO_TRIAL = ["Value Alignment","Product Demo","Business Case","Paper Process"];
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
const FILE_ICON = {pptx:{icon:"▤",c:"#C55A11"},xlsx:{icon:"⊞",c:"#1D6F42"},pdf:{icon:"▪",c:"#C00000"},docx:{icon:"≡",c:"#2B579A"},image:{icon:"▧",c:"#7C3AED"},link:{icon:"⌘",c:"#6366F1"}};
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
const EditableList = ({items,onChange}) => {
  const [draft,setDraft]=useState("");
  const add=()=>{if(!draft.trim())return;onChange([...items,draft.trim()]);setDraft("");};
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
};
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
      <div style={{textAlign:"center",marginTop:18,fontSize:11,color:P.textMute}}>No code? Contact <span style={{color:P.accent,fontWeight:600}}>{AE.email}</span></div>
    </div>
  </div>);
};

const ProcessTimeline = ({deal}) => {
  const base=[{key:"alignment",label:"Alignment",desc:"Align on value, requirements, and loop in stakeholders"},{key:"demo",label:"Product Demo",desc:"Custom day-in-the-life demo tailored to your workflows"},{key:"eval",label:"Trial / Evaluation",desc:"2-week POC including team testing and integration deep dive",trialOnly:true},{key:"decision",label:"Decision",desc:"Pricing & plans, business case, executive summary and decision"},{key:"formalize",label:"Formalize",desc:"Order form, T&Cs, legal and compliance"}];
  const steps=base.filter(s=>!s.trialOnly||deal.includeTrialSessions);
  const phases=deal.includeTrialSessions?PHASES_ALL:PHASES_NO_TRIAL;
  const items=deal.mapItems.filter(t=>phases.includes(t.phase));

  // Score each step from its own underlying task phase independently -- not a raw % of
  // all tasks across the whole deal (that made unrelated later phases look done from a
  // few early completions), and not a strict left-to-right walk either (that failed to
  // show any progress at all when a rep works a later phase, like Product Demo, before
  // an earlier one has any tasks -- a real deal doesn't always fill in phases in order).
  const stepPhase=s=>s.key==="demo"?"Product Demo":s.key==="eval"?"Trial Sessions":s.key==="decision"?"Business Case":s.key==="formalize"?"Paper Process":"Value Alignment";
  const phaseStatuses=steps.map(s=>{
    const phTasks=items.filter(t=>t.phase===stepPhase(s));
    if(phTasks.length===0)return "pending";
    return phTasks.every(t=>t.status==="complete")?"complete":"active";
  });
  return (
    <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:14,padding:"28px 36px",marginBottom:24,boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"}}>
      <div style={{fontSize:13,fontWeight:600,color:P.textMute,marginBottom:28}}>Track where we are in the process at any given time</div>
      <div style={{display:"flex",alignItems:"flex-start"}}>
        {steps.map((step,i)=>{
          const isCom=phaseStatuses[i]==="complete",isAct=phaseStatuses[i]==="active";
          return (<div key={step.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",position:"relative"}}>
            {i<steps.length-1&&<div style={{position:"absolute",top:15,left:"50%",width:"100%",height:2,background:isCom?P.accent:P.border,zIndex:0}}/>}
            <div style={{width:30,height:30,borderRadius:"50%",background:isCom?P.accent:P.surface,border:`2.5px solid ${isCom||isAct?P.accent:P.border}`,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1,marginBottom:10,flexShrink:0}}>
              {isCom&&<svg width="13" height="13" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>}
            </div>
            <div style={{fontSize:12.5,fontWeight:600,color:isCom?P.text:isAct?P.accentMid:P.textMute,maxWidth:110,padding:"0 4px"}}>{step.label}</div>
          </div>);
        })}
      </div>
    </div>
  );
};

const OrgNode = ({s,all,depth=0}) => {
  const dc=DESIG_CFG[s.designation]||DESIG_CFG.influencer;
  const children=all.filter(x=>x.reportsTo===s.id);
  return (<div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
    <div style={{background:P.surface,border:`2px solid ${depth===0?P.accent:P.border}`,borderRadius:10,padding:"12px 16px",minWidth:156,textAlign:"center",boxShadow:depth===0?`0 0 0 4px ${P.accentLight}`:"0 1px 4px rgba(0,0,0,0.07)"}}>
      <div style={{width:38,height:38,borderRadius:"50%",background:P.accentLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:P.accent,margin:"0 auto 8px"}}>{s.initials}</div>
      <div style={{fontSize:12,fontWeight:700,color:P.text}}>{s.name}</div>
      <div style={{fontSize:10,color:P.textSec,marginTop:2,marginBottom:6}}>{s.role}</div>
      <Badge small label={dc.label} color={dc.color} bg={dc.bg} border={dc.border}/>
      <a href={s.linkedin} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,marginTop:8,fontSize:10,color:"#0A66C2",textDecoration:"none",fontWeight:600}}>{LI_SVG}LinkedIn</a>
    </div>
    {children.length>0&&<div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      <div style={{width:2,height:22,background:P.borderDark}}/>
      <div style={{display:"flex",gap:20}}>
        {children.map(c=><div key={c.id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:2,height:22,background:P.borderDark}}/><OrgNode s={c} all={all} depth={depth+1}/></div>)}
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

const DealCreator = ({onSave,onImport,onClose}) => {
  const [step,setStep]=useState(1);const [mode,setMode]=useState(null);const [tx,setTx]=useState("");const [loading,setLoading]=useState(false);
  const [importRows,setImportRows]=useState([]);const [importErrors,setImportErrors]=useState([]);const [importFileName,setImportFileName]=useState("");
  const [importHasStakeholderSheet,setImportHasStakeholderSheet]=useState(false);
  const [genError,setGenError]=useState("");
  const blank={company:"",contact:"",title:"",value:"",closeDate:"",industry:"",logo:"",color:"#1A4FBA",accessCode:"",includeTrialSessions:true,welcomeMsg:"",execSummary:{problem:"",challenges:[],solutions:[]},discovery:{summary:"",corporateStrategy:[],topOutcomes:[],challenges:[],jobsToBeDone:[],primaryUseCase:"",goals:{"90 Days":[],"1 Year":[],"Beyond":[]}},stakeholders:[],mapItems:[],content:[],activityLog:[]};
  const [draft,setDraft]=useState(blank);
  const downloadTemplate=()=>{
    const wb=XLSX.utils.book_new();
    const dealsSheet=XLSX.utils.aoa_to_sheet([
      IMPORT_TEMPLATE_DEAL_HEADERS,
      ["Acme Co.","Jane Doe","Renewal","50000","2026-12-31","Tech","","Great to be working with you.","Manual reporting takes hours each week","Slow onboarding; No mobile support; Manual reporting","Automated dashboards; Native mobile app; SSO","Acme Co. is a mid-market distributor modernizing its ops stack.","Consolidate point tools into one platform","Cut manual reporting time; improve forecast accuracy","Fragmented tools; no shared visibility across teams","Running a multi-stakeholder evaluation with a trackable action plan","Confirm budget and technical fit","Full team onboarded and first workflows live","Platform embedded as the team's default workflow"],
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
    let res;
    try{
      res=await callClaude("You are an enterprise sales AI. Return ONLY valid JSON no markdown.",`Extract: company,contact,title,value,industry,accessCode(6-char uppercase),welcomeMsg(2 sentences),execSummary.problem(2 paragraphs),execSummary.challenges(array 4),execSummary.solutions(array 4),discovery.summary(2 sentences),discovery.corporateStrategy(array 3),discovery.topOutcomes(array 3),discovery.challenges(array 4),discovery.jobsToBeDone(array 3),discovery.primaryUseCase,discovery.goals({"90 Days":[],"1 Year":[],"Beyond":[]}),stakeholders(array:name,role,designation,bu,linkedin).\n\n${tx}`,2000);
    }catch(e){setGenError(e.message||"AI request failed");setLoading(false);return;}
    try{
      const jsonMatch=res.match(/\{[\s\S]*\}/);
      if(!jsonMatch)throw new Error(`AI didn't return JSON. Raw response: ${res.slice(0,300)||"(empty)"}`);
      const p=JSON.parse(jsonMatch[0]);
      const init=n=>n.split(" ").map(x=>x[0]).join("").toUpperCase().slice(0,2);
      setDraft(v=>({...v,...p,logo:(p.company||"").slice(0,2).toUpperCase(),execSummary:p.execSummary||v.execSummary,discovery:{...v.discovery,...(p.discovery||{})},stakeholders:(p.stakeholders||[]).map((s,i)=>({id:`s${i+1}`,...s,initials:init(s.name||""),engagement:50,lastSeen:"Just added",approvalRequired:s.designation==="decision-maker"||s.designation==="blocker",docsViewed:[],reportsTo:null})),mapItems:["Value Alignment","Business Case","Paper Process"].map((ph,pi)=>({id:pi*10+1,phase:ph,task:`${ph} Kickoff`,owner:"Mark H.",buyerOwner:p.contact||"",dueDate:"",status:"pending",notes:"",approvalRequired:false})),activityLog:[]}));
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
          <div style={{marginBottom:14}}><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={draft.includeTrialSessions} onChange={e=>setDraft(p=>({...p,includeTrialSessions:e.target.checked}))} style={{width:14,height:14}}/>Include Trial Sessions phase in evaluation journey</label></div>
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

const AuthGate = () => {
  const [mode,setMode]=useState("signin"); // "signin" | "signup" | "check-email"
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [orgName,setOrgName]=useState(""); const [fullName,setFullName]=useState("");
  const [error,setError]=useState(""); const [loading,setLoading]=useState(false);

  const submit=async()=>{
    setLoading(true);setError("");
    try{
      if(mode==="signup"){
        const {data,error:signUpErr}=await sb.auth.signUp({email,password});
        if(signUpErr)throw signUpErr;
        if(data.session){
          // Defensive: with "Confirm email" off this branch can still fire immediately
          // (see 0010_org_invitations.sql's header comment), so check for a pending
          // invite before creating a brand-new org -- an invited teammate landing on the
          // plain signup form should join their team, not become owner of a bogus one.
          const {data:joinedOrgId,error:acceptErr}=await sb.rpc("accept_pending_invite");
          if(acceptErr)throw acceptErr;
          if(!joinedOrgId){
            const {error:rpcErr}=await sb.rpc("create_organization_with_owner",{p_org_name:orgName,p_full_name:fullName||null});
            if(rpcErr)throw rpcErr;
          }
        }else{
          setMode("check-email");
        }
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
        {mode==="signup"&&<div style={{marginBottom:14}}><label style={lbl}>Your Name</label>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Jane Doe" style={inp}/></div>}
        <div style={{marginBottom:14}}><label style={lbl}>Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@company.com" style={inp}/></div>
        <div style={{marginBottom:20}}><label style={lbl}>Password</label>
          <input value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} type="password" placeholder="••••••••" style={inp}/>
          {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}</div>
        <button onClick={submit} disabled={loading||!email||!password||(mode==="signup"&&!orgName)} style={{width:"100%",padding:"12px",background:loading||!email||!password?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>{loading?"Please wait…":mode==="signup"?"Create Workspace →":"Sign In →"}</button>
        <div style={{textAlign:"center",marginTop:18,fontSize:12,color:P.textMute}}>
          {mode==="signup"?"Already have an account? ":"New here? "}
          <span onClick={()=>{setMode(mode==="signup"?"signin":"signup");setError("");}} style={{color:P.accent,fontWeight:700,cursor:"pointer"}}>{mode==="signup"?"Sign in":"Create a workspace"}</span>
        </div>
      </>)}
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

const SettingsModal = ({orgId,myUserId,myRole,onClose}) => {
  const [tab,setTab]=useState("team");
  const [members,setMembers]=useState([]);
  const [invites,setInvites]=useState([]);
  const [org,setOrg]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [inviteEmail,setInviteEmail]=useState("");
  const [inviteRole,setInviteRole]=useState("member");
  const [orgName,setOrgName]=useState("");
  const [logoUploading,setLogoUploading]=useState(false);

  const load=async()=>{
    setLoading(true);setError("");
    const [{data:mem,error:memErr},{data:inv,error:invErr},{data:orgRow,error:orgErr}]=await Promise.all([
      sb.from("organization_members").select("id,user_id,role,created_at").eq("org_id",orgId),
      sb.from("org_invitations").select("id,email,role,created_at,expires_at").eq("org_id",orgId).is("accepted_at",null),
      sb.from("organizations").select("name,logo_url").eq("id",orgId).single(),
    ]);
    if(memErr||invErr||orgErr){setError("Couldn't load settings");setLoading(false);return;}
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
    setLoading(false);
  };
  useEffect(()=>{load();},[orgId]);

  const canManage=targetRole=>myRole==="owner"||(myRole==="admin"&&targetRole==="member");

  const sendInvite=async()=>{
    if(!inviteEmail.trim())return;
    const {error:err}=await sb.from("org_invitations").insert({org_id:orgId,email:inviteEmail.trim().toLowerCase(),role:inviteRole});
    if(err){setError(err.code==="23505"?"There's already a pending invite for that email.":"Couldn't send invite");return;}
    setInviteEmail("");setError("");
    load();
  };
  const cancelInvite=async id=>{await sb.from("org_invitations").delete().eq("id",id);load();};
  const changeRole=async(memberId,role)=>{await sb.from("organization_members").update({role}).eq("id",memberId);load();};
  const removeMember=async memberId=>{await sb.from("organization_members").delete().eq("id",memberId);load();};

  const saveOrgName=async()=>{
    const {error:err}=await sb.from("organizations").update({name:orgName}).eq("id",orgId);
    if(err){setError("Couldn't update organization name");return;}
    setError("");load();
  };

  const uploadLogo=async file=>{
    setLogoUploading(true);
    const path=`${orgId}/logo`;
    const {error:upErr}=await sb.storage.from("org-logos").upload(path,file,{upsert:true,contentType:file.type});
    if(upErr){setError("Couldn't upload logo");setLogoUploading(false);return;}
    const {data:{publicUrl}}=sb.storage.from("org-logos").getPublicUrl(path);
    const {error:rpcErr}=await sb.rpc("set_org_logo",{p_org_id:orgId,p_logo_url:publicUrl});
    if(rpcErr){setError("Couldn't save logo");setLogoUploading(false);return;}
    setLogoUploading(false);load();
  };

  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};

  return (<div style={{position:"fixed",inset:0,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:620,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{padding:"20px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div className="headline" style={{fontSize:19,color:P.text}}>Team &amp; Settings</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{padding:"14px 24px 0",display:"flex",gap:4,borderBottom:`1px solid ${P.border}`}}>
        {[["team","Team"],["general","General"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:"8px 14px",background:"none",border:"none",borderBottom:`2px solid ${tab===k?P.accent:"transparent"}`,color:tab===k?P.accent:P.textSec,fontSize:13,fontWeight:tab===k?700:400,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      <div style={{padding:24}}>
        {error&&<div style={{fontSize:12,color:P.red,marginBottom:14,padding:"8px 12px",background:P.redBg,border:`1px solid ${P.redBorder}`,borderRadius:6}}>{error}</div>}
        {loading?<div style={{color:P.textMute,fontSize:13,textAlign:"center",padding:20}}>Loading…</div>:<>
        {tab==="team"&&<div>
          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Members</div>
          {members.map(m=>(
            <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${P.bg}`}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:P.text}}>{m.fullName||m.email||"Unknown"}</div>
                <div style={{fontSize:11,color:P.textMute}}>{m.email}</div>
              </div>
              {m.user_id===myUserId?<Badge small label={m.role} color={P.accent} bg={P.accentLight} border="#F0C9B7"/>
              :canManage(m.role)?(<>
                <select value={m.role} onChange={e=>changeRole(m.id,e.target.value)} style={{...inp,width:110,padding:"5px 8px",fontSize:11}}>
                  {myRole==="owner"&&<option value="admin">admin</option>}
                  <option value="member">member</option>
                </select>
                <button onClick={()=>removeMember(m.id)} style={{background:"none",border:"none",color:P.red,fontSize:11,fontWeight:600,cursor:"pointer"}}>Remove</button>
              </>):<Badge small label={m.role} color={P.textSec} bg={P.bg} border={P.border}/>}
            </div>
          ))}

          <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",margin:"20px 0 10px"}}>Invite a teammate</div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input placeholder="teammate@company.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} style={inp}/>
            <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{...inp,width:110}}>
              {myRole==="owner"&&<option value="admin">admin</option>}
              <option value="member">member</option>
            </select>
            <button onClick={sendInvite} style={{padding:"9px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Invite</button>
          </div>
          <div style={{fontSize:11,color:P.textMute,lineHeight:1.6,marginBottom:16}}>Share this app's sign-up link with them directly -- once they sign up with this exact email, they'll join your team automatically instead of creating a new organization.</div>

          {invites.length>0&&<>
            <div style={{fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Pending invites</div>
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
        </div>}
        </>}
      </div>
    </div>
  </div>);
};

// The deal's share_slug/access_code were being generated and stored (createDeal) but
// never surfaced anywhere in the UI -- a rep had no way to actually hand a prospect their
// link without going into Supabase directly. This is that missing affordance.
const ShareModal = ({deal,onClose}) => {
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
      <div style={{fontSize:12.5,color:P.textMute,marginBottom:18,lineHeight:1.5}}>Send your prospect this link and access code. They'll use both to get into their private view of {deal.company}.</div>
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
const TaskModal = ({task,phases,onSave,onDelete,onClose}) => {
  const [draft,setDraft]=useState({task:task.task,phase:task.phase,owner:task.owner||"",buyerOwner:task.buyerOwner||"",dueDate:task.dueDate||"",status:task.status,notes:task.notes||"",approvalRequired:!!task.approvalRequired});
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,display:"block"};
  return (<div style={{position:"fixed",inset:0,background:"rgba(27,31,35,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:480,maxHeight:"85vh",overflowY:"auto",padding:24,boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <span className="headline" style={{fontSize:18,color:P.text}}>Edit Task</span>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{marginBottom:12}}><label style={lbl}>Task Name</label><input value={draft.task} onChange={e=>setDraft(d=>({...d,task:e.target.value}))} style={inp}/></div>
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
      <div style={{marginBottom:20}}><label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={draft.approvalRequired} onChange={e=>setDraft(d=>({...d,approvalRequired:e.target.checked}))}/>Approval Required</label></div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>{if(!draft.task.trim())return;onSave(draft);}} style={{flex:1,padding:"11px 20px",background:P.accent,border:"none",borderRadius:7,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Changes</button>
        <button onClick={onClose} style={{padding:"11px 18px",background:"none",border:`1px solid ${P.border}`,borderRadius:7,color:P.textSec,fontSize:13,cursor:"pointer"}}>Cancel</button>
        <button onClick={onDelete} style={{padding:"11px 18px",background:"none",border:"none",color:P.red,fontSize:13,fontWeight:600,cursor:"pointer"}}>Delete</button>
      </div>
    </div>
  </div>);
};

function DealRoom({prospectShareSlug}) {
  const [session,setSession]=useState(undefined); // undefined=checking, null=signed out, object=signed in
  const [needsOrgSetup,setNeedsOrgSetup]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const [orgId,setOrgId]=useState(null);
  const [myRole,setMyRole]=useState(null);
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
  const [showAddTask,setShowAddTask]=useState(null); // null, or the phase currently showing its Add Task form
  const [editingTask,setEditingTask]=useState(null); // null, or the task currently open in TaskModal
  // Which single Executive Summary section (if any) is being edited -- "problem" |
  // "challenges" | "solutions" | null -- so editing one section never puts the others
  // into edit mode too. summarySectionDraft holds that one section's in-progress value
  // (a string for problem, an array for challenges/solutions).
  const [editingSummarySection,setEditingSummarySection]=useState(null);
  const [summarySectionDraft,setSummarySectionDraft]=useState(null);
  const [editingDiscovery,setEditingDiscovery]=useState(false);
  const [discoveryDraft,setDiscoveryDraft]=useState(null);
  const [showStakeholderModal,setShowStakeholderModal]=useState(false);
  const [editingStakeholder,setEditingStakeholder]=useState(null);
  const [newTask,setNewTask]=useState({phase:"Value Alignment",task:"",owner:"Mark H.",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false});
  const [toast,setToast]=useState(null);
  const [orgView,setOrgView]=useState(false);
  const [activeLog,setActiveLog]=useState(null);
  const [selCat,setSelCat]=useState("All");
  const [initError,setInitError]=useState(null);

  // Rep path only: track the Supabase Auth session. Errors here (e.g. a network/CORS
  // problem reaching Supabase) are surfaced instead of leaving the app stuck silently on
  // the loading screen forever.
  useEffect(()=>{
    if(prospectShareSlug)return;
    sb.auth.getSession().then(({data})=>setSession(data.session)).catch(e=>setInitError(e.message||String(e)));
    const {data:sub}=sb.auth.onAuthStateChange((_event,s)=>setSession(s));
    return ()=>sub.subscription.unsubscribe();
  },[prospectShareSlug]);

  // Rep path only: once signed in, resolve org membership and load real deals.
  useEffect(()=>{
    if(prospectShareSlug||!session)return;
    let cancelled=false;
    (async()=>{
      setLoadingDeals(true);
      try{
      let {data:mem,error:memErr}=await sb.from("organization_members").select("org_id,role").eq("user_id",session.user.id).limit(1).maybeSingle();
      if(cancelled)return;
      if(memErr)throw memErr;
      if(!mem){
        // Right after signup, this can legitimately race the signup RPC that's still
        // creating the org/membership row -- one short retry before concluding the user
        // really does need the "name your organization" fallback screen.
        await new Promise(r=>setTimeout(r,1000));
        if(cancelled)return;
        ({data:mem,error:memErr}=await sb.from("organization_members").select("org_id,role").eq("user_id",session.user.id).limit(1).maybeSingle());
        if(cancelled)return;
        if(memErr)throw memErr;
      }
      if(!mem){
        // No membership yet -- check for a pending team invitation before concluding this
        // is a brand-new user who needs to create their own org. See accept_pending_invite
        // in 0010_org_invitations.sql for why this only auto-joins a verified email.
        const {data:joinedOrgId,error:acceptErr}=await sb.rpc("accept_pending_invite");
        if(cancelled)return;
        if(acceptErr)throw acceptErr;
        if(joinedOrgId){
          ({data:mem,error:memErr}=await sb.from("organization_members").select("org_id,role").eq("user_id",session.user.id).limit(1).maybeSingle());
          if(cancelled)return;
          if(memErr)throw memErr;
        }
      }
      if(!mem){setNeedsOrgSetup(true);setLoadingDeals(false);return;}
      setNeedsOrgSetup(false);
      setOrgId(mem.org_id);
      setMyRole(mem.role);
      const {data:rows,error:rowsErr}=await sb.from("deals").select("*, stakeholders(*), deal_tasks(*), documents(*)").eq("org_id",mem.org_id).is("archived_at",null);
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
      const allContributorIds=Array.from(new Set(mapped.flatMap(d=>d.contributorIds)));
      const [{data:viewStats},{data:visits},{data:contributors},{data:riskRows}]=await Promise.all([
        allDocIds.length?sb.from("document_view_stats").select("*").in("document_id",allDocIds):{data:[]},
        allDealIds.length?sb.from("deal_visits").select("*, deal_visit_actions(*)").in("deal_id",allDealIds).order("started_at",{ascending:false}):{data:[]},
        // profiles has no direct FK to deals/stakeholders/etc, so this can't be embedded in
        // the main deals query -- same merge-in-JS pattern SettingsModal uses for members.
        allContributorIds.length?sb.from("profiles").select("id,email,full_name").in("id",allContributorIds):{data:[]},
        allDealIds.length?sb.from("deal_risk_signals").select("*").in("deal_id",allDealIds):{data:[]},
      ]);
      if(cancelled)return;

      const statsByDoc=Object.fromEntries((viewStats||[]).map(v=>[v.document_id,v]));
      const visitsByDeal={};
      (visits||[]).forEach(v=>{(visitsByDeal[v.deal_id]=visitsByDeal[v.deal_id]||[]).push(v);});
      const profileById=Object.fromEntries((contributors||[]).map(p=>[p.id,p]));
      const riskByDeal=Object.fromEntries((riskRows||[]).map(r=>[r.deal_id,r]));

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
          return {id,name:name||"Unknown",initials:initialsOf(name)||"?"};
        }),
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

  const deal=deals.find(d=>d.id===activeId);
  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),2800);};

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
    const{ok}=await insertDeal(draft);
    if(!ok){flash("Couldn't create deal room");return;}
    setShowCreator(false);
    flash("Deal room created!");
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
    for(const draft of drafts){
      const existing=known.find(d=>d.company.toLowerCase()===draft.company.toLowerCase());
      const result=existing?await mergeDealFromImport(existing,draft):await insertDeal(draft);
      if(result.ok&&result.action==="created"){
        known.push({...draft,id:result.id,company:draft.company,stakeholders:[]});
      }
      results.push(result);
    }
    const createdCount=results.filter(r=>r.ok&&r.action==="created").length;
    const updatedCount=results.filter(r=>r.ok&&r.action==="updated").length;
    const failCount=results.filter(r=>!r.ok).length;
    setShowCreator(false);
    const parts=[];
    if(createdCount)parts.push(`${createdCount} created`);
    if(updatedCount)parts.push(`${updatedCount} updated`);
    if(failCount)parts.push(`${failCount} failed`);
    flash(parts.join(", "));
    setRefreshKey(k=>k+1);
  };

  // Task mutations: write to Supabase first, then reflect the confirmed result in local
  // state. can_manage_deal (creator or org owner/admin) already gates these at the RLS
  // layer -- a member who doesn't own this deal simply gets an error back.
  const updateTaskStatus=async(taskId,status)=>{
    const {error}=await sb.from("deal_tasks").update({status}).eq("id",taskId);
    if(error){flash("Couldn't update task");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:d.mapItems.map(t=>t.id===taskId?{...t,status}:t)}));
  };

  const deleteTask=async(taskId)=>{
    const {error}=await sb.from("deal_tasks").delete().eq("id",taskId);
    if(error){flash("Couldn't delete task");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:d.mapItems.filter(t=>t.id!==taskId)}));
  };

  // Full-field edit from TaskModal (opened via the task ring) -- mirrors
  // updateTaskStatus's shape but covers every editable field, not just status.
  const updateTask=async(taskId,draft)=>{
    const {error}=await sb.from("deal_tasks").update({
      task:draft.task,phase:draft.phase,owner_name:draft.owner||null,buyer_owner_label:draft.buyerOwner||null,
      due_date:draft.dueDate||null,status:draft.status,notes:draft.notes||null,approval_required:!!draft.approvalRequired,
    }).eq("id",taskId);
    if(error){flash("Couldn't update task");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:d.mapItems.map(t=>t.id!==taskId?t:{
      ...t,task:draft.task,phase:draft.phase,owner:draft.owner,buyerOwner:draft.buyerOwner,
      dueDate:draft.dueDate,status:draft.status,notes:draft.notes,approvalRequired:draft.approvalRequired,
    })}));
    setEditingTask(null);
    flash("Task updated");
  };

  const addTask=async(draft)=>{
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
      sort_order:deal.mapItems.length,
    }).select().single();
    if(error||!data){flash("Couldn't add task");return;}
    const mapped={id:data.id,phase:data.phase,task:data.task,owner:data.owner_name,buyerOwner:data.buyer_owner_label,dueDate:data.due_date,status:data.status,notes:data.notes,approvalRequired:data.approval_required};
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,mapItems:[...d.mapItems,mapped]}));
    setNewTask({phase:"Value Alignment",task:"",owner:"Mark H.",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false});
    setShowAddTask(null);
    flash("Task added");
  };

  // Executive Summary / Discovery are just JSONB columns on deals -- editing them is a
  // plain deals update, already permitted by the existing can_manage_deal-keyed
  // deals_update RLS policy (0003), same boundary every other mutation here relies on.
  const updateExecSummary=async(newExecSummary)=>{
    const {error}=await sb.from("deals").update({exec_summary:newExecSummary}).eq("id",deal.id);
    if(error){flash("Couldn't save changes");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,execSummary:newExecSummary}));
    flash("Executive Summary updated");
  };

  // Simple, clean document: header, then Problem/Key Challenges/Solutions with manual
  // line-wrapping and page breaks -- no library beyond jsPDF itself needed for content
  // this straightforward.
  const downloadExecSummaryPdf=()=>{
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF();
    const pageWidth=doc.internal.pageSize.getWidth();
    const pageHeight=doc.internal.pageSize.getHeight();
    const margin=20;
    const maxWidth=pageWidth-margin*2;
    let y=margin;
    const ensureRoom=lines=>{if(y+lines*6>pageHeight-margin){doc.addPage();y=margin;}};
    const addHeading=text=>{ensureRoom(10);doc.setFont(undefined,"bold");doc.setFontSize(14);doc.text(text,margin,y);y+=10;doc.setFont(undefined,"normal");doc.setFontSize(11);};
    const addParagraph=text=>{const lines=doc.splitTextToSize(text,maxWidth);ensureRoom(lines.length);doc.text(lines,margin,y);y+=lines.length*6+6;};
    const addBullets=items=>{items.forEach(item=>{const lines=doc.splitTextToSize(`•  ${item}`,maxWidth);ensureRoom(lines.length);doc.text(lines,margin,y);y+=lines.length*6+2;});y+=6;};

    doc.setFont(undefined,"bold");doc.setFontSize(18);doc.text(deal.company,margin,y);y+=8;
    doc.setFont(undefined,"normal");doc.setFontSize(11);doc.setTextColor(107,113,120);doc.text(`Executive Summary${deal.title?` — ${deal.title}`:""}`,margin,y);y+=14;
    doc.setTextColor(37,42,46);

    addHeading("The Problem");
    (deal.execSummary?.problem||"").split("\n\n").forEach(addParagraph);
    if((deal.execSummary?.challenges||[]).length){addHeading("Key Challenges");addBullets(deal.execSummary.challenges);}
    if((deal.execSummary?.solutions||[]).length){addHeading("Solutions");addBullets(deal.execSummary.solutions);}

    doc.save(`${deal.company.replace(/[^a-zA-Z0-9]+/g,"-")}-executive-summary.pdf`);
  };
  const updateDiscovery=async(newDiscovery)=>{
    const {error}=await sb.from("deals").update({discovery:newDiscovery}).eq("id",deal.id);
    if(error){flash("Couldn't save changes");return;}
    setDeals(prev=>prev.map(d=>d.id!==deal.id?d:{...d,discovery:newDiscovery}));
    flash("Discovery updated");
  };

  const addStakeholder=async(draft)=>{
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
    if(!f.storagePath){flash("File not available");return;}
    if(f.type==="link"){window.open(f.storagePath,"_blank","noopener");logDocumentView(f);return;}
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
    if(session===null)return <AuthGate/>;
    if(needsOrgSetup)return <NameYourOrg onDone={()=>{setNeedsOrgSetup(false);setRefreshKey(k=>k+1);}}/>;
    if(loadingDeals)return <LoadingScreen/>;
  }

  if(!deal){
    // Signed in, org resolved, but zero deals yet -- the old render tree below assumes a
    // deal always exists, so this has to be its own early return rather than patched
    // field-by-field into every downstream reference.
    return <div style={{fontFamily:"'Inter','Segoe UI',sans-serif",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}><style>{CSS}</style>
      <div style={{fontSize:16,fontWeight:700,color:P.text}}>No deal rooms yet</div>
      <div style={{fontSize:13,color:P.textSec}}>Create your first one to get started.</div>
      <button onClick={()=>setShowCreator(true)} style={{padding:"10px 20px",background:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ New Deal Room</button>
      {showCreator&&<DealCreator onSave={createDeal} onImport={importDeals} onClose={()=>setShowCreator(false)}/>}
    </div>;
  }

  const phases=deal.includeTrialSessions?PHASES_ALL:PHASES_NO_TRIAL;
  const visItems=deal.mapItems.filter(t=>phases.includes(t.phase));
  const done=visItems.filter(t=>t.status==="complete").length;
  const pct=Math.round(done/(visItems.length||1)*100);

  if(!prospectShareSlug&&viewMode==="prospect"&&!prospectAuth[activeId]){
    return <div style={{fontFamily:"'Inter','Segoe UI',sans-serif"}}><style>{CSS}</style>
      <div style={{display:"flex",minHeight:"100vh"}}>
        <div style={{width:264,background:P.ink,display:"flex",flexDirection:"column",flexShrink:0,padding:"24px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 4px 22px"}}>
            <div style={{width:36,height:36,borderRadius:9,background:"rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
            <div><div className="headline" style={{fontSize:18,color:"#fff",lineHeight:1}}>myBivy</div><div className="mono" style={{fontSize:9.5,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginTop:3}}>By SRENE</div></div>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:9,padding:3,marginBottom:20}}>
            {[["rep","Sales Rep"],["prospect","Prospect"]].map(([v,l])=>(
              <button key={v} onClick={()=>{setViewMode(v);setTab(v==="prospect"?"welcome":"map");}} style={{flex:1,padding:"8px 0",fontSize:12.5,fontWeight:600,color:viewMode===v?"#fff":"rgba(255,255,255,0.5)",background:viewMode===v?P.accent:"transparent",border:"none",borderRadius:7,cursor:"pointer"}}>{l}</button>))}
          </div>
          <div className="mono" style={{fontSize:10.5,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.35)",marginBottom:12,padding:"0 6px"}}>Active Deals</div>
          {deals.map(d=><div key={d.id} onClick={()=>setActiveId(d.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:8,background:d.id===activeId?"rgba(255,255,255,0.07)":"transparent",marginBottom:2,cursor:"pointer"}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:600,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.company}</div><div className="mono" style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{d.value}</div></div>
          </div>)}
        </div>
        <ProspectLogin deal={deal} onSuccess={email=>setProspectAuth(p=>({...p,[activeId]:email}))}/>
      </div>
    </div>;
  }

  return <div style={{fontFamily:"'Inter','Segoe UI',sans-serif",background:P.bg,minHeight:"100vh",display:"flex",color:P.text}}>
    <style>{CSS}</style>

    {/* SIDEBAR -- hidden entirely for a real prospect on a share link: no picker into
        other org deals, no rep/prospect toggle they could flip to see edit controls. */}
    {!prospectShareSlug&&<div style={{width:264,background:P.ink,display:"flex",flexDirection:"column",flexShrink:0,padding:"24px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 4px 22px"}}>
        <div style={{width:36,height:36,borderRadius:9,background:"rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{width:20,height:20}}>{LOGO_MARK}</div></div>
        <div><div className="headline" style={{fontSize:19,color:"#fff",lineHeight:1}}>myBivy</div><div className="mono" style={{fontSize:9.5,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginTop:3}}>By SRENE</div></div>
      </div>
      <div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:9,padding:3,marginBottom:20}}>
        {[["rep","Sales Rep"],["prospect","Prospect"]].map(([v,l])=>(
          <button key={v} onClick={()=>{setViewMode(v);setTab(v==="prospect"?"welcome":"map");}} style={{flex:1,padding:"8px 0",fontSize:12.5,fontWeight:600,color:viewMode===v?"#fff":"rgba(255,255,255,0.5)",background:viewMode===v?P.accent:"transparent",border:"none",borderRadius:7,cursor:"pointer"}}>{l}</button>))}
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        <div className="mono" style={{fontSize:10.5,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.35)",marginBottom:12,padding:"0 6px"}}>Active Deals</div>
        {deals.map(d=>{const dp=Math.round(d.mapItems.filter(t=>t.status==="complete").length/d.mapItems.length*100);const isA=d.id===activeId;const dFlags=riskFlags(d);const dotColor=RISK_DOT_COLOR[dFlags[0]?.severity||"on"];return(
          <div key={d.id} className="hd" onClick={()=>{setActiveId(d.id);setAiOpen(false);setAiText("");setTab(viewMode==="prospect"?"welcome":"map");}} style={{padding:"10px 8px",borderRadius:8,background:isA?"rgba(255,255,255,0.07)":"transparent",marginBottom:2,transition:"all .12s"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {d.risk&&<div title={dFlags[0]?.label||"On track"} style={{width:7,height:7,borderRadius:"50%",background:dotColor,flexShrink:0}}/>}
              <div style={{minWidth:0,flex:1}}><div style={{fontSize:13.5,fontWeight:600,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.company}</div><div className="mono" style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:1}}>{d.value}</div></div>
            </div>
            <div style={{marginTop:7}}><div style={{height:3,background:"rgba(255,255,255,0.12)",borderRadius:99,overflow:"hidden"}}><div style={{width:`${dp}%`,height:"100%",background:isA?P.accent:"rgba(255,255,255,0.4)",borderRadius:99}}/></div></div>
          </div>);})}
        <button onClick={()=>setShowCreator(true)} style={{width:"100%",marginTop:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:11,border:"1.5px dashed rgba(255,255,255,0.25)",borderRadius:9,background:"transparent",color:"rgba(255,255,255,0.85)",fontSize:13.5,fontWeight:600,cursor:"pointer"}}>+ New Deal Room</button>
      </div>
      <div style={{paddingTop:12,marginTop:12,borderTop:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",gap:10}}>
        <img src={AE.photo} alt={AE.name} style={{width:34,height:34,borderRadius:"50%",objectFit:"cover",flexShrink:0}} onError={e=>{e.target.outerHTML=`<div style="width:34px;height:34px;border-radius:50%;background:${P.accent};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${AE.initials}</div>`;}}/>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{AE.name}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:1}}>{AE.title}</div></div>
        {(myRole==="owner"||myRole==="admin")&&<button onClick={()=>setShowSettings(true)} title="Team & Settings" style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:14,cursor:"pointer",flexShrink:0}}>⚙</button>}
        <button onClick={()=>sb.auth.signOut()} title="Sign out" style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:11,fontWeight:600,cursor:"pointer",flexShrink:0}}>Sign out</button>
      </div>
    </div>}
    {showSettings&&<SettingsModal orgId={orgId} myUserId={session?.user?.id} myRole={myRole} onClose={()=>setShowSettings(false)}/>}
    {showShare&&<ShareModal deal={deal} onClose={()=>setShowShare(false)}/>}

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
              {viewMode==="prospect"&&<span style={{padding:"2px 8px",background:P.greenBg,border:`1px solid ${P.greenBorder}`,borderRadius:20,fontSize:10,fontWeight:700,color:P.green}}>PROSPECT VIEW</span>}
            </div>
            <div style={{display:"flex",gap:14,marginTop:3}}>{[deal.industry,deal.value,deal.closeDate?`Close ${deal.closeDate}`:null,deal.contact].filter(Boolean).map((v,i)=><span key={i} style={{fontSize:11,color:P.textMute}}>{v}</span>)}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"center"}}>
          {(deal.contributors||[]).length>0&&<div style={{display:"flex"}}>
            {deal.contributors.slice(0,3).map((c,i)=>(
              <div key={c.id} title={c.name} style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11.5,fontWeight:700,color:"#fff",border:`2px solid ${P.surface}`,marginLeft:i===0?0:-9,background:[P.accent,P.green,P.ink,"#8A9099"][i%4]}} className="headline">{c.initials}</div>
            ))}
            {deal.contributors.length>3&&<div style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",border:`2px solid ${P.surface}`,marginLeft:-9,background:"#8A9099"}}>+{deal.contributors.length-3}</div>}
          </div>}
          {deal.risk&&(()=>{const dFlags=riskFlags(deal);const top=dFlags[0];const dotColor=RISK_DOT_COLOR[top?.severity||"on"];return(
            <div title={dFlags.map(f=>f.reason).join(" · ")||undefined} style={{display:"inline-flex",alignItems:"center",gap:6,background:top?P.amberBg:P.greenBg,color:top?P.amber:P.green,fontSize:12.5,fontWeight:700,padding:"6px 13px 6px 9px",borderRadius:100}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:dotColor}}/>{top?top.label:"On Track"}
            </div>
          );})()}
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:20}}>
            <span className="mono" style={{fontSize:10,color:P.textMute,fontWeight:600}}>ENGAGEMENT</span>
            <div style={{width:50,height:4,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${deal.engagement}%`,height:"100%",background:deal.engagement>60?P.green:P.amber,borderRadius:99}}/></div>
            <span style={{fontSize:11,fontWeight:800,color:deal.engagement>60?P.green:P.amber}}>{deal.engagement}%</span>
          </div>
          {viewMode==="rep"&&<>
            <button onClick={()=>setShowShare(true)} className="hv" style={{padding:"7px 14px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.04em"}}>↗ Share</button>
            <button onClick={()=>runAI("brief")} className="hv" style={{padding:"7px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.04em"}}>✦ Deal Brief</button>
            <button onClick={()=>{setAiOpen(!aiOpen);setAiText("");}} className="hv" style={{padding:"7px 14px",background:aiOpen?P.accentLight:P.bg,border:`1px solid ${aiOpen?P.accentMid:P.border}`,borderRadius:6,color:aiOpen?P.accent:P.textSec,fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.04em"}}>AI Coach</button>
          </>}
        </div>
      </div>
      {/* Tabs */}
      <div style={{background:P.surface,borderBottom:`1px solid ${P.border}`,padding:"0 24px",display:"flex",alignItems:"center",flexShrink:0}}>
        {tabs.map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{padding:"12px 16px",background:"none",border:"none",borderBottom:`2px solid ${tab===k?P.accent:"transparent"}`,color:tab===k?P.accent:P.textSec,fontSize:13,fontWeight:tab===k?700:400,cursor:"pointer",marginBottom:-1}}>{l}</button>)}
        {tab==="map"&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:P.textMute}}>{done}/{visItems.length}</span><div style={{width:80,height:5,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:P.accent,borderRadius:99}}/></div><span style={{fontSize:11,fontWeight:800,color:P.accent}}>{pct}%</span></div>}
      </div>
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
            {/* AE Profile Card */}
            <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"22px 24px",marginBottom:20,display:"flex",gap:20}}>
              <img src={AE.photo} alt={AE.name} style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",border:`3px solid ${P.border}`,flexShrink:0,boxShadow:"0 2px 12px rgba(0,0,0,0.12)"}} onError={e=>{e.target.outerHTML=`<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,${P.accent},${P.accentMid});display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;flex-shrink:0">${AE.initials}</div>`;}} />
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:800,color:P.text,marginBottom:2}}>{AE.name}</div>
                <div style={{fontSize:12,color:P.textSec,marginBottom:1}}>{AE.title} at {AE.company}</div>
                <div style={{fontSize:12,color:P.textMute,marginBottom:1}}>{AE.email}</div>
                <div style={{fontSize:12,color:P.textMute,marginBottom:14}}>{AE.phone}</div>
                <div style={{fontSize:13,color:P.textSec,lineHeight:1.65,marginBottom:16}}>
                  Hi Team,<br/><br/>This room is for us to collaborate and stay aligned as our partnership progresses.
                  <div style={{marginTop:10}}>
                    {["It will contain all relevant resources and next steps","Feel free to share this URL to keep colleagues in the loop","Reach out to me directly to keep key discussions organized"].map((it,i)=>(
                      <div key={i} style={{display:"flex",gap:8,marginBottom:6}}><span style={{color:P.green,fontWeight:700,flexShrink:0}}>✓</span><span>{it}</span></div>))}
                  </div>
                  <div style={{marginTop:10}}>Looking forward to working with you on your goals!</div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <a href={AE.linkedin} target="_blank" rel="noopener noreferrer" style={{padding:"7px 16px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:"#0A66C2",fontSize:12,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:5}}>{LI_SVG}LinkedIn</a>
                  <a href={`mailto:${AE.email}`} style={{padding:"7px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,textDecoration:"none"}}>Reply</a>
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
              {[{label:"License Amount",val:deal.value,color:P.accent},{label:"Target Close",val:deal.closeDate,color:P.amber},{label:"Tasks Complete",val:`${done}/${visItems.length}`,color:P.green},{label:"Stakeholders",val:deal.stakeholders.length,color:P.purple}].map(({label,val,color})=>(
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
              {key:"problem",title:"The Problem",type:"text"},
              {key:"challenges",title:"Key Challenges",type:"list"},
              {key:"solutions",title:"Solutions",type:"list"},
            ].map(({key,title,type})=>{
              const editing=editingSummarySection===key;
              const value=deal.execSummary?.[key];
              return (<div key={key} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"22px 26px",marginBottom:16,boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:16,fontWeight:800,color:P.text}}>{title}</div>
                  {viewMode==="rep"&&(editing?<div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{updateExecSummary({...deal.execSummary,[key]:summarySectionDraft});setEditingSummarySection(null);}} style={{padding:"6px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                    <button onClick={()=>setEditingSummarySection(null)} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  </div>:<button onClick={()=>{setSummarySectionDraft(type==="list"?(value||[]):(value||""));setEditingSummarySection(key);}} style={{padding:"6px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>)}
                </div>
                {editing?(type==="list"?
                  <EditableList items={summarySectionDraft} onChange={setSummarySectionDraft}/>
                :<textarea value={summarySectionDraft} onChange={e=>setSummarySectionDraft(e.target.value)} style={{width:"100%",height:120,border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",lineHeight:1.6,resize:"vertical",outline:"none"}}/>)
                :(type==="list"?
                  <ol style={{paddingLeft:20}}>{(value||[]).map((item,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:6}}>{item}</li>)}</ol>
                :(value||"").split("\n\n").map((para,i)=><p key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:8}}>{para}</p>))}
              </div>);
            })}
          </div>}

          {/* ACTION PLAN */}
          {tab==="map"&&<div>
            <ProcessTimeline deal={deal}/>
            {phases.map(phase=>{
              const items=visItems.filter(t=>t.phase===phase);
              return <div key={phase} style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 4px"}}>
                  <span className="mono" style={{fontSize:11.5,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:P.textMute}}>{phase}</span>
                  <span style={{fontSize:12.5,color:P.textMute}}>{items.filter(t=>t.status==="complete").length} of {items.length} complete</span>
                </div>
                <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,overflow:"hidden",boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"}}>
                  {items.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 100px 150px 100px 110px",padding:"7px 16px",background:P.bg,borderBottom:`1px solid ${P.border}`}}>
                    {["Task","Seller","Buyer Owner","Due Date","Status"].map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.07em"}}>{h}</div>)}
                  </div>}
                  {items.length===0&&<div style={{padding:"16px",fontSize:12.5,color:P.textMute,fontStyle:"italic"}}>No tasks yet in this phase</div>}
                  {items.map((task,i)=>{const sc=STATUS_CFG[task.status];return(
                    <div key={task.id} className="hr" style={{display:"grid",gridTemplateColumns:"1fr 100px 150px 100px 110px",padding:"11px 16px",borderBottom:i<items.length-1?`1px solid ${P.bg}`:"none",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                        {viewMode==="rep"?
                          <button onClick={()=>setEditingTask(task)} title="Edit task" style={{width:20,height:20,padding:0,borderRadius:"50%",border:task.status==="complete"?"none":`1.5px solid ${P.border}`,background:task.status==="complete"?P.ink:P.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1,cursor:"pointer"}}>{task.status==="complete"&&<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>}</button>
                        :<div style={{width:20,height:20,borderRadius:"50%",border:task.status==="complete"?"none":`1.5px solid ${P.border}`,background:task.status==="complete"?P.ink:P.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>{task.status==="complete"&&<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>}</div>}
                        <div>
                          <div style={{fontSize:13,color:task.status==="complete"?P.textMute:P.text,textDecoration:task.status==="complete"?"line-through":"none",fontWeight:500}}>{task.task}</div>
                          {task.notes&&<div style={{fontSize:11,color:P.textMute,marginTop:2,fontStyle:"italic"}}>{task.notes}</div>}
                          {task.approvalRequired&&<span style={{fontSize:9,fontWeight:700,color:P.red,textTransform:"uppercase",letterSpacing:"0.06em"}}>Approval Required</span>}
                        </div>
                      </div>
                      <div style={{fontSize:12,color:P.textSec}}>{task.owner}</div>
                      <div style={{fontSize:12,color:P.textSec}}>{task.buyerOwner}</div>
                      <div style={{fontSize:11,color:P.textMute}}>{task.dueDate}</div>
                      {viewMode==="rep"?<select value={task.status} onChange={e=>updateTaskStatus(task.id,e.target.value)} style={{background:sc.bg,border:`1px solid ${sc.border}`,color:sc.text,borderRadius:5,padding:"4px 6px",fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}><option value="complete">Complete</option><option value="in-progress">In Progress</option><option value="pending">Pending</option></select>
                      :<div style={{padding:"3px 8px",borderRadius:4,background:sc.bg,border:`1px solid ${sc.border}`,color:sc.text,fontSize:11,fontWeight:700,textAlign:"center"}}>{sc.label}</div>}
                    </div>);})}
                  {viewMode==="rep"&&(showAddTask===phase?<div style={{padding:16,borderTop:items.length>0?`1px solid ${P.bg}`:"none"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                      <input placeholder="Task name" value={newTask.task} onChange={e=>setNewTask({...newTask,task:e.target.value})} style={inpS}/>
                      <input placeholder="Buyer owner" value={newTask.buyerOwner} onChange={e=>setNewTask({...newTask,buyerOwner:e.target.value})} style={inpS}/>
                      <input type="date" value={newTask.dueDate} onChange={e=>setNewTask({...newTask,dueDate:e.target.value})} style={inpS}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                      <input placeholder="Notes" value={newTask.notes} onChange={e=>setNewTask({...newTask,notes:e.target.value})} style={inpS}/>
                      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={newTask.approvalRequired} onChange={e=>setNewTask({...newTask,approvalRequired:e.target.checked})}/>Approval Required</label>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{if(!newTask.task.trim())return;addTask(newTask);setShowAddTask(null);}} style={{padding:"8px 18px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Add Task</button>
                      <button onClick={()=>setShowAddTask(null)} style={{padding:"8px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,cursor:"pointer"}}>Cancel</button>
                    </div>
                  </div>:<button onClick={()=>{setNewTask(t=>({...t,phase}));setShowAddTask(phase);}} style={{width:"100%",padding:10,background:"none",border:"none",borderTop:items.length>0?`1px solid ${P.bg}`:"none",color:P.textMute,fontSize:12,cursor:"pointer"}} onMouseOver={e=>e.currentTarget.style.color=P.accent} onMouseOut={e=>e.currentTarget.style.color=P.textMute}>+ Add Task</button>)}
                </div>
              </div>;})}
            {editingTask&&<TaskModal
              task={editingTask}
              phases={phases}
              onClose={()=>setEditingTask(null)}
              onSave={draft=>updateTask(editingTask.id,draft)}
              onDelete={()=>{deleteTask(editingTask.id);setEditingTask(null);}}
            />}
          </div>}

          {/* DISCOVERY */}
          {tab==="discovery"&&<div style={{maxWidth:860}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div className="headline" style={{fontSize:22,color:P.text}}>Business Outcomes & Value Identification</div><div style={{fontSize:13,color:P.textSec,marginTop:3}}>{deal.company} · {deal.industry}</div></div>
              {viewMode==="rep"&&<div style={{display:"flex",gap:8}}>
                {editingDiscovery?<>
                  <button onClick={()=>{updateDiscovery(discoveryDraft);setEditingDiscovery(false);}} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
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
                  <EditableList items={discoveryDraft[key]} onChange={v=>setDiscoveryDraft(d=>({...d,[key]:v}))}/>
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
                      <EditableList items={discoveryDraft.goals[period]} onChange={v=>setDiscoveryDraft(d=>({...d,goals:{...d.goals,[period]:v}}))}/>
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
                <button onClick={()=>runAI("email")} style={{padding:"6px 12px",border:`1px solid ${P.border}`,borderRadius:6,background:"none",color:P.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>✦ Draft Follow-up</button>
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
                {deal.stakeholders.filter(s=>!s.reportsTo||!deal.stakeholders.find(x=>x.id===s.reportsTo)).map(root=><OrgNode key={root.id} s={root} all={deal.stakeholders} depth={0}/>)}
              </div>
            </div>:<div style={{display:"grid",gap:10}}>
              {deal.stakeholders.map(s=>{const dc=DESIG_CFG[s.designation]||DESIG_CFG.influencer;const ec=s.engagement>60?P.green:s.engagement>30?P.amber:P.red;return(
                <div key={s.id} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"18px 20px",display:"flex",alignItems:"center",gap:16}}>
                  <div className="headline" style={{width:48,height:48,borderRadius:"50%",background:P.accentLight,border:`2px solid ${P.ropeBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:P.accentMid,flexShrink:0}}>{s.initials}</div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}><span style={{fontSize:15,fontWeight:700,color:P.text}}>{s.name}</span><Badge label={dc.label} color={dc.color} bg={dc.bg} border={dc.border}/>{s.approvalRequired&&<Badge label="Approval Required" color={P.red} bg={P.redBg} border={P.redBorder}/>}</div>
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

          {/* MEDDPIC -- fully derived, read-only, no separate edit surface or storage: if
              something here is wrong, fix it at the source (Discovery, Stakeholders, or
              Action Plan) and this tab reflects it automatically. Decision Criteria and
              Decision Process are deliberately left as "not enough data yet" -- there's no
              honest, obvious source for either yet, so guessing would be worse than
              admitting the gap. Rep-only, like Analytics -- a buyer should never see their
              own economic-buyer/champion/pain analysis laid out via sales methodology. */}
          {tab==="meddpic"&&viewMode==="rep"&&<div style={{maxWidth:820}}>
            <div className="headline" style={{fontSize:22,color:P.text,marginBottom:6}}>MEDDPIC</div>
            <div style={{fontSize:13,color:P.textMute,marginBottom:20,lineHeight:1.6}}>Auto-derived from Discovery, Stakeholders, and Action Plan -- edit those tabs to update what shows here.</div>
            {(()=>{
              const champions=deal.stakeholders.filter(s=>s.designation==="champion");
              const decisionMakers=deal.stakeholders.filter(s=>s.designation==="decision-maker");
              const paperProcessTasks=deal.mapItems.filter(t=>t.phase==="Paper Process");
              const cardStyle={background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"20px 24px",marginBottom:14,boxShadow:"0 1px 2px rgba(27,31,35,0.05), 0 12px 32px -12px rgba(27,31,35,0.16)"};
              const letterStyle={width:32,height:32,borderRadius:8,background:P.accentLight,color:P.accentMid,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0};
              const empty=<div style={{fontSize:13,color:P.textMute,fontStyle:"italic"}}>Not enough data yet</div>;
              const Section=({letter,title,children})=>(
                <div style={cardStyle}>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                    <div className="headline" style={letterStyle}>{letter}</div>
                    <div style={{fontSize:15,fontWeight:700,color:P.text}}>{title}</div>
                  </div>
                  {children}
                </div>
              );
              const StakeholderList=list=>list.length?<div style={{display:"flex",flexDirection:"column",gap:6}}>{list.map(s=><div key={s.id} style={{fontSize:13,color:P.textSec}}><strong style={{color:P.text}}>{s.name}</strong>{s.role?` — ${s.role}`:""}</div>)}</div>:<div style={{fontSize:13,color:P.textMute,fontStyle:"italic"}}>Not yet identified</div>;
              return (<>
                <Section letter="M" title="Metrics">
                  {(deal.discovery.topOutcomes||[]).length>0&&<ol style={{paddingLeft:20,marginBottom:10}}>{deal.discovery.topOutcomes.map((o,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:4}}>{o}</li>)}</ol>}
                  {GOAL_PERIODS.some(p=>(deal.discovery.goals?.[p]||[]).length)?
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                      {GOAL_PERIODS.map(period=>(<div key={period}>
                        <div className="mono" style={{fontSize:10,fontWeight:600,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{period}</div>
                        {(deal.discovery.goals?.[period]||[]).map((g,i)=><div key={i} style={{fontSize:12,color:P.textSec,marginBottom:3}}>· {g}</div>)}
                      </div>))}
                    </div>
                  :!(deal.discovery.topOutcomes||[]).length&&empty}
                </Section>
                <Section letter="E" title="Economic Buyer">{StakeholderList(decisionMakers)}</Section>
                <Section letter="D" title="Decision Criteria">{empty}</Section>
                <Section letter="D" title="Decision Process">{empty}</Section>
                <Section letter="P" title="Paper Process">
                  {paperProcessTasks.length?<div style={{display:"flex",flexDirection:"column",gap:6}}>{paperProcessTasks.map(t=><div key={t.id} style={{fontSize:13,color:P.textSec,display:"flex",alignItems:"center",gap:8}}><span style={{width:6,height:6,borderRadius:"50%",background:t.status==="complete"?P.green:P.border,flexShrink:0}}/>{t.task}</div>)}</div>:empty}
                </Section>
                <Section letter="I" title="Identify Pain">
                  {(deal.discovery.challenges||[]).length?<ol style={{paddingLeft:20}}>{deal.discovery.challenges.map((c,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:4}}>{c}</li>)}</ol>:empty}
                </Section>
                <Section letter="C" title="Champion">{StakeholderList(champions)}</Section>
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
            {deal.risk&&<div style={{marginBottom:24}}>
              <div style={{fontSize:13,fontWeight:700,color:P.text,marginBottom:12}}>Deal Health</div>
              {riskFlags(deal).length===0?
                <div style={{display:"flex",alignItems:"center",gap:10,background:P.greenBg,border:`1px solid ${P.greenBorder}`,borderRadius:10,padding:"14px 18px"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:P.green,flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:600,color:P.green}}>On track — no risk signals right now</span>
                </div>
              :<div style={{display:"grid",gap:8}}>
                {riskFlags(deal).map(f=>(
                  <div key={f.key} style={{display:"flex",alignItems:"center",gap:12,background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"14px 18px"}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:RISK_DOT_COLOR[f.severity],flexShrink:0}}/>
                    <div><div style={{fontSize:13,fontWeight:700,color:P.text}}>{f.label}</div><div style={{fontSize:12,color:P.textSec,marginTop:1}}>{f.reason}</div></div>
                  </div>
                ))}
              </div>}
            </div>}
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

    {showCreator&&<DealCreator onSave={createDeal} onImport={importDeals} onClose={()=>setShowCreator(false)}/>}
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
