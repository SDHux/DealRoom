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
  };
}

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

const DealCreator = ({onSave,onClose}) => {
  const [step,setStep]=useState(1);const [mode,setMode]=useState(null);const [tx,setTx]=useState("");const [loading,setLoading]=useState(false);
  const blank={company:"",contact:"",title:"",value:"",closeDate:"",industry:"",logo:"",color:"#1A4FBA",accessCode:"",includeTrialSessions:true,welcomeMsg:"",execSummary:{problem:"",challenges:[],solutions:[]},discovery:{summary:"",corporateStrategy:[],topOutcomes:[],challenges:[],jobsToBeDone:[],primaryUseCase:"",goals:{"90 Days":[],"1 Year":[],"Beyond":[]}},stakeholders:[],mapItems:[],content:[],activityLog:[]};
  const [draft,setDraft]=useState(blank);
  const gen=async()=>{setLoading(true);const res=await callClaude("You are an enterprise sales AI. Return ONLY valid JSON no markdown.",`Extract: company,contact,title,value,industry,accessCode(6-char uppercase),welcomeMsg(2 sentences),execSummary.problem(2 paragraphs),execSummary.challenges(array 4),execSummary.solutions(array 4),discovery.summary(2 sentences),discovery.corporateStrategy(array 3),discovery.topOutcomes(array 3),discovery.challenges(array 4),discovery.jobsToBeDone(array 3),discovery.primaryUseCase,discovery.goals({"90 Days":[],"1 Year":[],"Beyond":[]}),stakeholders(array:name,role,designation,bu,linkedin).\n\n${tx}`,2000);
    try{const p=JSON.parse(res.replace(/```json|```/g,"").trim());const init=n=>n.split(" ").map(x=>x[0]).join("").toUpperCase().slice(0,2);setDraft(v=>({...v,...p,logo:(p.company||"").slice(0,2).toUpperCase(),execSummary:p.execSummary||v.execSummary,discovery:{...v.discovery,...(p.discovery||{})},stakeholders:(p.stakeholders||[]).map((s,i)=>({id:`s${i+1}`,...s,initials:init(s.name||""),engagement:50,lastSeen:"Just added",approvalRequired:s.designation==="decision-maker"||s.designation==="blocker",docsViewed:[],reportsTo:null})),mapItems:["Value Alignment","Business Case","Paper Process"].map((ph,pi)=>({id:pi*10+1,phase:ph,task:`${ph} Kickoff`,owner:"Mark H.",buyerOwner:p.contact||"",dueDate:"",status:"pending",notes:"",approvalRequired:false})),activityLog:[]}));setStep(3);}catch{setStep(3);}setLoading(false);};
  const inp={width:"100%",border:`1px solid ${P.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"};
  const lbl={fontSize:11,fontWeight:700,color:P.textSec,letterSpacing:"0.04em",textTransform:"uppercase",display:"block",marginBottom:5};
  return (<div style={{position:"fixed",inset:0,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:P.surface,borderRadius:16,width:680,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.16)"}}>
      <div style={{padding:"20px 24px 16px",borderBottom:`1px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div className="headline" style={{fontSize:19,color:P.text}}>Create Deal Room</div><div style={{fontSize:12,color:P.textSec,marginTop:2}}>Step {step} of 3 · {["Choose Method","AI Generation","Review & Save"][step-1]}</div></div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:P.textMute,cursor:"pointer"}}>×</button>
      </div>
      <div style={{padding:24}}>
        {step===1&&<div><div style={{fontSize:14,color:P.textSec,marginBottom:20}}>How would you like to create this deal room?</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[{key:"transcript",icon:"🎙️",title:"From Transcript / Notes",desc:"Paste call notes. AI extracts all deal details automatically."},{key:"manual",icon:"✏️",title:"Build Manually",desc:"Enter deal details step by step with full control."}].map(o=>(
              <div key={o.key} onClick={()=>{setMode(o.key);setStep(o.key==="transcript"?2:3);}} style={{border:`2px solid ${P.border}`,borderRadius:10,padding:20,cursor:"pointer"}} onMouseOver={e=>{e.currentTarget.style.borderColor=P.accent;e.currentTarget.style.background=P.accentLight;}} onMouseOut={e=>{e.currentTarget.style.borderColor=P.border;e.currentTarget.style.background=P.surface;}}>
                <div style={{fontSize:28,marginBottom:10}}>{o.icon}</div><div style={{fontSize:14,fontWeight:700,color:P.text,marginBottom:6}}>{o.title}</div><div style={{fontSize:12,color:P.textSec,lineHeight:1.5}}>{o.desc}</div>
              </div>))}
          </div>
        </div>}
        {step===2&&<div><div style={{fontSize:13,color:P.textSec,marginBottom:18,lineHeight:1.6}}>Paste discovery notes, LinkedIn profiles, or any context. AI builds the full deal room.</div>
          <textarea value={tx} onChange={e=>setTx(e.target.value)} placeholder="Paste transcript or context here..." style={{...inp,height:220,resize:"vertical",lineHeight:1.6,marginBottom:16}}/>
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
  const [tab,setTab]=useState(prospectShareSlug?"welcome":"map");
  const [aiOpen,setAiOpen]=useState(false);
  const [aiMode,setAiMode]=useState(null);
  const [aiText,setAiText]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [chatInput,setChatInput]=useState("");
  const [showCreator,setShowCreator]=useState(false);
  const [showAddTask,setShowAddTask]=useState(false);
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
      const [{data:viewStats},{data:visits},{data:contributors}]=await Promise.all([
        allDocIds.length?sb.from("document_view_stats").select("*").in("document_id",allDocIds):{data:[]},
        allDealIds.length?sb.from("deal_visits").select("*, deal_visit_actions(*)").in("deal_id",allDealIds).order("started_at",{ascending:false}):{data:[]},
        // profiles has no direct FK to deals/stakeholders/etc, so this can't be embedded in
        // the main deals query -- same merge-in-JS pattern SettingsModal uses for members.
        allContributorIds.length?sb.from("profiles").select("id,email,full_name").in("id",allContributorIds):{data:[]},
      ]);
      if(cancelled)return;

      const statsByDoc=Object.fromEntries((viewStats||[]).map(v=>[v.document_id,v]));
      const visitsByDeal={};
      (visits||[]).forEach(v=>{(visitsByDeal[v.deal_id]=visitsByDeal[v.deal_id]||[]).push(v);});
      const profileById=Object.fromEntries((contributors||[]).map(p=>[p.id,p]));

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

  const deal=deals.find(d=>d.id===activeId);
  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),2800);};

  const createDeal=async(draft)=>{
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
    if(error||!newDeal){flash("Couldn't create deal room");return;}

    if((draft.stakeholders||[]).length){
      await sb.from("stakeholders").insert(draft.stakeholders.map(s=>({
        deal_id:newDeal.id,created_by:session.user.id,name:s.name,role_title:s.role,
        designation:s.designation,engagement_score:s.engagement??50,business_unit:s.bu||null,
        approval_required:!!s.approvalRequired,linkedin_url:s.linkedin||null,
      })));
    }
    if((draft.mapItems||[]).length){
      await sb.from("deal_tasks").insert(draft.mapItems.map((t,i)=>({
        deal_id:newDeal.id,created_by:session.user.id,phase:t.phase,task:t.task,
        owner_name:t.owner||null,buyer_owner_label:t.buyerOwner||null,due_date:t.dueDate||null,
        status:t.status||"pending",notes:t.notes||null,approval_required:!!t.approvalRequired,sort_order:i,
      })));
    }

    setShowCreator(false);
    flash("Deal room created!");
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
    setShowAddTask(false);
    flash("Task added");
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
  const openDocument=async f=>{
    if(!f.storagePath){flash("File not available");return;}
    if(f.type==="link"){window.open(f.storagePath,"_blank","noopener");return;}
    const {data,error}=await sb.storage.from("deal-documents").createSignedUrl(f.storagePath,300);
    if(error||!data){flash("Couldn't open file");return;}
    window.open(data.signedUrl,"_blank","noopener");
  };

  const repTabs=[["map","Action Plan"],["summary","Executive Summary"],["discovery","Discovery"],["content","Content"],["stakeholders","Stakeholders"],["analytics","Analytics"]];
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
        <ProspectLogin shareSlug={prospectShareSlug} onSuccess={mappedDeal=>{
          setDeals([mappedDeal]);
          setActiveId(mappedDeal.id);
          setProspectAuth(p=>({...p,[prospectShareSlug]:true}));
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
      {showCreator&&<DealCreator onSave={createDeal} onClose={()=>setShowCreator(false)}/>}
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
        {deals.map(d=>{const dp=Math.round(d.mapItems.filter(t=>t.status==="complete").length/d.mapItems.length*100);const isA=d.id===activeId;return(
          <div key={d.id} className="hd" onClick={()=>{setActiveId(d.id);setAiOpen(false);setAiText("");setTab(viewMode==="prospect"?"welcome":"map");}} style={{padding:"10px 8px",borderRadius:8,background:isA?"rgba(255,255,255,0.07)":"transparent",marginBottom:2,transition:"all .12s"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
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
          {deal.contributors.length>0&&<div style={{display:"flex"}}>
            {deal.contributors.slice(0,3).map((c,i)=>(
              <div key={c.id} title={c.name} style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11.5,fontWeight:700,color:"#fff",border:`2px solid ${P.surface}`,marginLeft:i===0?0:-9,background:[P.accent,P.green,P.ink,"#8A9099"][i%4]}} className="headline">{c.initials}</div>
            ))}
            {deal.contributors.length>3&&<div style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",border:`2px solid ${P.surface}`,marginLeft:-9,background:"#8A9099"}}>+{deal.contributors.length-3}</div>}
          </div>}
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:20}}>
            <span className="mono" style={{fontSize:10,color:P.textMute,fontWeight:600}}>ENGAGEMENT</span>
            <div style={{width:50,height:4,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${deal.engagement}%`,height:"100%",background:deal.engagement>60?P.green:P.amber,borderRadius:99}}/></div>
            <span style={{fontSize:11,fontWeight:800,color:deal.engagement>60?P.green:P.amber}}>{deal.engagement}%</span>
          </div>
          {viewMode==="rep"&&<>
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
              {viewMode==="rep"&&<button onClick={()=>runAI("bizcase")} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✦ AI Refresh</button>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:P.surface,border:`1px solid ${P.border}`,borderRadius:"8px 8px 0 0",borderBottom:"none"}}>
              {["File","Edit","Insert","Format","Table"].map(m=><span key={m} style={{fontSize:12,color:P.textSec,cursor:"pointer",padding:"2px 6px"}}>{m}</span>)}
              <div style={{flex:1}}/>
              {["B","I","U"].map(f=><span key={f} style={{fontSize:12,fontWeight:700,color:P.textSec,cursor:"pointer",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:3,border:`1px solid ${P.border}`}}>{f}</span>)}
            </div>
            <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:"0 0 12px 12px",padding:"28px 32px"}}>
              <div style={{marginBottom:24}}><div style={{fontSize:16,fontWeight:800,color:P.text,marginBottom:10}}>The Problem</div>{(deal.execSummary?.problem||"").split("\n\n").map((para,i)=><p key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:8}}>{para}</p>)}</div>
              <div style={{marginBottom:24}}><div style={{fontSize:16,fontWeight:800,color:P.text,marginBottom:10}}>Key Challenges</div><ol style={{paddingLeft:20}}>{(deal.execSummary?.challenges||[]).map((c,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:6}}>{c}</li>)}</ol></div>
              <div><div style={{fontSize:16,fontWeight:800,color:P.text,marginBottom:10}}>Solutions</div><ol style={{paddingLeft:20}}>{(deal.execSummary?.solutions||[]).map((s,i)=><li key={i} style={{fontSize:13,color:P.textSec,lineHeight:1.75,marginBottom:6}}>{s}</li>)}</ol></div>
            </div>
            <div style={{display:"flex",gap:16,padding:"12px 16px",background:P.bg,borderTop:`1px solid ${P.border}`,alignItems:"center"}}>
              <button onClick={()=>runAI("bizcase")} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"none",border:`1px solid ${P.border}`,borderRadius:5,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>✦ AI</button>
              <span style={{fontSize:11,color:P.textMute}}>💬 {viewMode==="rep"?"4 Comments":"2 Comments"}</span>
              <span style={{fontSize:11,color:P.textMute}}>↗ Share</span>
            </div>
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
                  <div style={{display:"grid",gridTemplateColumns:`1fr 100px 150px 100px 110px${viewMode==="rep"?" 26px":""}`,padding:"7px 16px",background:P.bg,borderBottom:`1px solid ${P.border}`}}>
                    {["Task","Seller","Buyer Owner","Due Date","Status"].concat(viewMode==="rep"?[""]:[]).map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.07em"}}>{h}</div>)}
                  </div>
                  {items.map((task,i)=>{const sc=STATUS_CFG[task.status];return(
                    <div key={task.id} className="hr" style={{display:"grid",gridTemplateColumns:`1fr 100px 150px 100px 110px${viewMode==="rep"?" 26px":""}`,padding:"11px 16px",borderBottom:i<items.length-1?`1px solid ${P.bg}`:"none",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                        <div style={{width:20,height:20,borderRadius:"50%",border:task.status==="complete"?"none":`1.5px solid ${P.border}`,background:task.status==="complete"?P.ink:P.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>{task.status==="complete"&&<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.3 2.3L8.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>}</div>
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
                      {viewMode==="rep"&&<button onClick={()=>deleteTask(task.id)} style={{background:"none",border:"none",color:P.textMute,cursor:"pointer",fontSize:14}}>×</button>}
                    </div>);})}
                </div>
              </div>;})}
            {viewMode==="rep"&&(showAddTask?<div style={{background:P.surface,border:`1px solid ${P.accentMid}50`,borderRadius:10,padding:16,marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>New Task</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                <input placeholder="Task name" value={newTask.task} onChange={e=>setNewTask({...newTask,task:e.target.value})} style={inpS}/>
                <input placeholder="Buyer owner" value={newTask.buyerOwner} onChange={e=>setNewTask({...newTask,buyerOwner:e.target.value})} style={inpS}/>
                <input type="date" value={newTask.dueDate} onChange={e=>setNewTask({...newTask,dueDate:e.target.value})} style={inpS}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                <select value={newTask.phase} onChange={e=>setNewTask({...newTask,phase:e.target.value})} style={inpS}>{phases.map(ph=><option key={ph}>{ph}</option>)}</select>
                <input placeholder="Notes" value={newTask.notes} onChange={e=>setNewTask({...newTask,notes:e.target.value})} style={inpS}/>
                <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:P.textSec,cursor:"pointer"}}><input type="checkbox" checked={newTask.approvalRequired} onChange={e=>setNewTask({...newTask,approvalRequired:e.target.checked})}/>Approval Required</label>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{if(!newTask.task.trim())return;addTask(newTask);}} style={{padding:"8px 18px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Add Task</button>
                <button onClick={()=>setShowAddTask(false)} style={{padding:"8px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>:<button onClick={()=>setShowAddTask(true)} style={{width:"100%",padding:10,background:"none",border:`1.5px dashed ${P.border}`,borderRadius:8,color:P.textMute,fontSize:12,cursor:"pointer"}} onMouseOver={e=>{e.currentTarget.style.borderColor=P.accent;e.currentTarget.style.color=P.accent;}} onMouseOut={e=>{e.currentTarget.style.borderColor=P.border;e.currentTarget.style.color=P.textMute;}}>+ Add Task</button>)}
          </div>}

          {/* DISCOVERY */}
          {tab==="discovery"&&<div style={{maxWidth:860}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div className="headline" style={{fontSize:22,color:P.text}}>Business Outcomes & Value Identification</div><div style={{fontSize:13,color:P.textSec,marginTop:3}}>{deal.company} · {deal.industry}</div></div>
              {viewMode==="rep"&&<button onClick={()=>runAI("bizcase")} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✦ Build Business Case</button>}
            </div>
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
                {Object.entries(deal.discovery.goals).map(([period,goals],i,arr)=>(
                  <div key={period} style={{padding:"16px 18px",borderRight:i<arr.length-1?`1px solid ${P.border}`:"none"}}>
                    <div style={{fontSize:10,fontWeight:800,color:[P.accent,P.green,P.purple][i],textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>{period}</div>
                    {goals.map((g,j)=><div key={j} style={{display:"flex",gap:8,marginBottom:7}}><div style={{width:5,height:5,borderRadius:"50%",background:[P.accentMid,P.green,P.purple][i],marginTop:6,flexShrink:0}}/><span style={{fontSize:12,color:P.textSec,lineHeight:1.5}}>{g}</span></div>)}
                  </div>))}
              </div>
            </div>
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
                  </div>
                </div>);})}
            </div>}
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

    {showCreator&&<DealCreator onSave={createDeal} onClose={()=>setShowCreator(false)}/>}
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
