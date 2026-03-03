const { useState } = React;

const API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_KEY = ""; // ← Paste your Anthropic API key here
const callClaude = async (sys, usr, max = 1400) => {
  const r = await fetch(API, { method:"POST", headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:max, system:sys, messages:[{role:"user",content:usr}] })});
  const d = await r.json(); return d.content?.[0]?.text || "";
};

const P = {
  bg:"#F7F8FA", surface:"#FFFFFF", border:"#E4E7EE", borderDark:"#CDD1DC",
  accent:"#1A4FBA", accentLight:"#EEF3FF", accentMid:"#3B6FE8",
  text:"#111827", textSec:"#4B5563", textMute:"#9CA3AF",
  green:"#059669", greenBg:"#ECFDF5", greenBorder:"#A7F3D0",
  amber:"#B45309", amberBg:"#FFFBEB", amberBorder:"#FCD34D",
  red:"#DC2626", redBg:"#FEF2F2", redBorder:"#FECACA",
  purple:"#7C3AED", purpleBg:"#F5F3FF", purpleBorder:"#DDD6FE",
  teal:"#0D9488", tealBg:"#F0FDFA", tealBorder:"#99F6E4",
};

const AE = { name:"Mark Huckins", title:"Sr. Account Executive", company:"Salsify", email:"mark.huckins@gmail.com", phone:"+1-858-752-4321", linkedin:"https://linkedin.com/in/markhuckins", initials:"MH",
  photo:"https://media.licdn.com/dms/image/v2/D5603AQGEzOXSHDFOqA/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1699997107933?e=2147483647&v=beta&t=IymYW4hFsxj3t0BKhS4a9B-HxCFjzjBm1V9_QNUcbAs" };

const PHASES_ALL = ["Value Alignment","Trial Sessions","Business Case","Paper Process"];
const PHASES_NO_TRIAL = ["Value Alignment","Business Case","Paper Process"];
const PHASE_CFG = {
  "Value Alignment":{color:P.accent,bg:P.accentLight,border:"#BFDBFE",dot:P.accentMid},
  "Trial Sessions":{color:P.teal,bg:P.tealBg,border:P.tealBorder,dot:P.teal},
  "Business Case":{color:P.purple,bg:P.purpleBg,border:P.purpleBorder,dot:P.purple},
  "Paper Process":{color:P.green,bg:P.greenBg,border:P.greenBorder,dot:P.green},
};
const STATUS_CFG = {
  complete:{text:P.green,bg:P.greenBg,border:P.greenBorder,label:"Complete"},
  "in-progress":{text:P.amber,bg:P.amberBg,border:P.amberBorder,label:"In Progress"},
  pending:{text:P.textMute,bg:"#F9FAFB",border:P.border,label:"Pending"},
};
const DESIG_CFG = {
  champion:{label:"Champion",color:P.green,bg:P.greenBg,border:P.greenBorder},
  "decision-maker":{label:"Decision Maker",color:P.accent,bg:P.accentLight,border:"#BFDBFE"},
  influencer:{label:"Influencer",color:P.purple,bg:P.purpleBg,border:P.purpleBorder},
  blocker:{label:"Blocker",color:P.red,bg:P.redBg,border:P.redBorder},
};
const FILE_ICON = {pptx:{icon:"▤",c:"#C55A11"},xlsx:{icon:"⊞",c:"#1D6F42"},pdf:{icon:"▪",c:"#C00000"},docx:{icon:"≡",c:"#2B579A"},link:{icon:"⌘",c:"#6366F1"}};

const INIT_DEALS = [
{id:1,company:"Kraft Heinz",contact:"Jennifer Mills",title:"Digital Commerce PXM Platform",stage:"Evaluation",value:"$340,000",closeDate:"2026-05-30",logo:"KH",color:"#C8102E",industry:"CPG · Food & Beverage",engagement:74,accessCode:"KH2026",includeTrialSessions:true,
welcomeMsg:"Welcome to your dedicated deal workspace with Salsify. This collaborative portal gives your team a single source of truth — track our shared milestones, review all shared materials, and stay aligned throughout your evaluation.",
execSummary:{
  problem:"Kraft Heinz is strategically scaling its digital commerce operations globally, but the team is struggling to manage product content consistently across 25+ retail endpoints. Win rates on digital shelf are declining as PDPs fall out of compliance, Buy Box share is eroding, and time-to-market for new product launches averages 6–8 weeks — 3x the industry benchmark.\n\nThe current workflow relies on spreadsheets, shared drives, and manual portal uploads, resulting in inconsistent content, significant FTE overhead, and no centralized visibility into digital shelf performance.",
  challenges:["No centralized PIM — content managed in fragmented spreadsheets and siloed systems","Data inaccuracies across 12+ retailer portals leading to lost Buy Box and content violations","New product launches take 6–8 weeks vs. 2-week industry benchmark","Syndication to Walmart, Kroger, and Amazon is manual and error-prone","Zero real-time visibility into digital shelf performance across the portfolio"],
  solutions:["Centralize all product content and digital assets in a single PXM platform with role-based access","Automate syndication to 25+ retail endpoints with retailer-specific content transformation","Reduce time-to-market from 6–8 weeks to under 2 weeks through configurable workflow automation","Enable real-time digital shelf analytics — Buy Box monitoring, content compliance, PDP health","Empower the champion team with a self-service content operations model that scales with growth"],
},
discovery:{
  summary:"Kraft Heinz is a global CPG leader managing 8,000+ SKUs across 25 retail channels. The organization is investing heavily in digital commerce growth but is held back by fragmented content operations, manual syndication workflows, and lack of real-time shelf visibility. A centralized PXM solution directly addresses their top 3 board-level priorities: accelerate eCommerce revenue growth, reduce operational costs, and improve brand integrity at shelf.",
  corporateStrategy:["Strengthen and accelerate rapid growth globally across all digital channels","Drive 20% CAGR in eCommerce net sales by 2027","Create authentic brand experiences with devoted consumers","Invest in adjacent segments — private label and D2C expansion"],
  topOutcomes:["Grow digital shelf revenue by $120M in organic eCommerce sales","Eliminate 90% of non-value-added FTE time spent on manual content tasks","Achieve 100% GS1-compliant data syndication to all tier-1 retailers"],
  challenges:["No centralized repository for product content and digital assets","Data is inaccurate and inconsistent across 12+ retail portals","Cannot react fast enough to changing Buy Box winners and pricing algorithms","Syndication to priority retailers is manual and error-prone","New product introductions take 6–8 weeks vs. 2-week industry benchmark"],
  jobsToBeDone:["Guard the Buy Box — Defend profitability at top retailers","Protect Content — Keep PDPs accurate and brand-consistent","Centralize data to discover optimization opportunities","Automate syndication to reduce FTE dependency"],
  primaryUseCase:"Deliver compelling product experiences across the entire retail ecosystem. With a centralized PXM platform, Kraft Heinz teams can collaborate to manage product information and assets, distribute to 25+ retail endpoints, and gain real-time insight into digital shelf performance.",
  goals:{"90 Days":["Centralize all digital assets into one system","Publish top 500 SKUs to Amazon"],"1 Year":["100% of 8,000 SKUs syndicating to tier-1 retailers","Brand consistency across all retail PDPs"],"Beyond":["Improve eCommerce conversion by 2.5%","Launch D2C storefront powered by content hub"]},
},
stakeholders:[
  {id:"s1",name:"Jennifer Mills",role:"VP Digital Commerce",designation:"champion",engagement:88,lastSeen:"3h ago",initials:"JM",bu:"Digital Commerce",approvalRequired:true,docsViewed:["Executive Discovery Deck","BOVI Document","ROI Calculator"],linkedin:"https://linkedin.com/in/jennifermills",reportsTo:null},
  {id:"s2",name:"Robert Kasey",role:"Chief Digital Officer",designation:"decision-maker",engagement:41,lastSeen:"2d ago",initials:"RK",bu:"Executive",approvalRequired:true,docsViewed:["BOVI Document"],linkedin:"https://linkedin.com/in/robertkasey",reportsTo:null},
  {id:"s3",name:"Anna Patel",role:"Director of eCommerce",designation:"influencer",engagement:62,lastSeen:"1d ago",initials:"AP",bu:"eCommerce",approvalRequired:false,docsViewed:["Executive Discovery Deck","Security Overview"],linkedin:"https://linkedin.com/in/annapatel",reportsTo:"s1"},
  {id:"s4",name:"Tom Briggs",role:"VP IT / Security",designation:"blocker",engagement:18,lastSeen:"6d ago",initials:"TB",bu:"Technology",approvalRequired:true,docsViewed:["Security Overview"],linkedin:"https://linkedin.com/in/tombriggs",reportsTo:"s2"},
],
mapItems:[
  {id:1,phase:"Value Alignment",task:"Initial Discovery Meeting",owner:"Mark H.",buyerOwner:"Jennifer Mills",dueDate:"2026-02-10",status:"complete",notes:"Confirmed 3 core pain points",approvalRequired:false},
  {id:2,phase:"Value Alignment",task:"BOVI / Deep Discovery Document",owner:"Mark H.",buyerOwner:"Jennifer Mills",dueDate:"2026-02-20",status:"complete",notes:"Submitted and reviewed — outcomes confirmed",approvalRequired:false},
  {id:3,phase:"Value Alignment",task:"Custom Day-in-the-Life Demo",owner:"Mark H.",buyerOwner:"Jennifer Mills + Anna Patel",dueDate:"2026-03-05",status:"in-progress",notes:"Demo around Kraft Heinz Walmart syndication workflow",approvalRequired:false},
  {id:4,phase:"Value Alignment",task:"Deep Dive Technical Demo",owner:"SE Team",buyerOwner:"Anna Patel + Tom Briggs",dueDate:"2026-03-12",status:"pending",notes:"",approvalRequired:false},
  {id:5,phase:"Trial Sessions",task:"Technical Environment Setup",owner:"SE Team",buyerOwner:"Tom Briggs",dueDate:"2026-03-15",status:"pending",notes:"",approvalRequired:true},
  {id:6,phase:"Trial Sessions",task:"Champion Team Training",owner:"Mark H.",buyerOwner:"Jennifer Mills",dueDate:"2026-03-18",status:"pending",notes:"",approvalRequired:false},
  {id:7,phase:"Trial Sessions",task:"Mid-Point Trial Check-In",owner:"Mark H.",buyerOwner:"Jennifer Mills + Anna Patel",dueDate:"2026-03-25",status:"pending",notes:"",approvalRequired:false},
  {id:8,phase:"Trial Sessions",task:"Present Trial Findings & ROI",owner:"Mark H.",buyerOwner:"Jennifer Mills",dueDate:"2026-04-02",status:"pending",notes:"",approvalRequired:true},
  {id:9,phase:"Business Case",task:"Executive Sponsor Presentation",owner:"Mark H.",buyerOwner:"Robert Kasey",dueDate:"2026-04-10",status:"pending",notes:"CDO needs As-Is → To-Be + ROI model",approvalRequired:true},
  {id:10,phase:"Business Case",task:"ROI Model & Cost-Benefit Sign-Off",owner:"Mark H.",buyerOwner:"Jennifer Mills",dueDate:"2026-04-18",status:"pending",notes:"",approvalRequired:true},
  {id:11,phase:"Paper Process",task:"Security Review Package",owner:"SE Team",buyerOwner:"Tom Briggs",dueDate:"2026-04-25",status:"pending",notes:"",approvalRequired:true},
  {id:12,phase:"Paper Process",task:"Legal / Procurement Review",owner:"Legal",buyerOwner:"Tom Briggs",dueDate:"2026-05-05",status:"pending",notes:"",approvalRequired:true},
  {id:13,phase:"Paper Process",task:"Contract Execution",owner:"Mark H.",buyerOwner:"Robert Kasey",dueDate:"2026-05-30",status:"pending",notes:"",approvalRequired:true},
],
content:[
  {id:1,title:"Executive Discovery Deck — Kraft Heinz",type:"pptx",uploaded:"Feb 10",views:5,viewers:["Jennifer Mills","Anna Patel"],lastViewed:"Jennifer Mills · 3h ago",url:"#",category:"Presentation"},
  {id:2,title:"BOVI / Business Outcomes Document",type:"docx",uploaded:"Feb 20",views:3,viewers:["Jennifer Mills","Robert Kasey"],lastViewed:"Robert Kasey · 2d ago",url:"#",category:"Discovery"},
  {id:3,title:"PXM ROI Calculator (CPG Benchmark)",type:"xlsx",uploaded:"Feb 24",views:2,viewers:["Jennifer Mills"],lastViewed:"Jennifer Mills · 1d ago",url:"#",category:"ROI"},
  {id:4,title:"Security & Compliance Overview",type:"pdf",uploaded:"Feb 26",views:1,viewers:["Tom Briggs"],lastViewed:"Tom Briggs · 6d ago",url:"#",category:"Security"},
  {id:5,title:"Salsify CPG Customer Case Studies",type:"pdf",uploaded:"Mar 1",views:0,viewers:[],lastViewed:"Not yet viewed",url:"#",category:"Case Study"},
],
activityLog:[
  {date:"Mar 2, 2026",entries:[
    {person:"Jennifer Mills",email:"j.mills@kraftheinz.com",location:"Chicago, US",time:"10:14am",duration:"24:00 min",actions:[{type:"viewed",item:"Executive Discovery Deck",time:"10:14am"},{type:"viewed",item:"ROI Calculator",time:"10:31am"}]},
    {person:"Anna Patel",email:"a.patel@kraftheinz.com",location:"Chicago, US",time:"11:02am",duration:"16:43 min",actions:[{type:"viewed",item:"Security Overview",time:"11:05am"}]},
  ]},
  {date:"Feb 28, 2026",entries:[
    {person:"Robert Kasey",email:"r.kasey@kraftheinz.com",location:"Pittsburgh, US",time:"2:30pm",duration:"12:23 min",actions:[{type:"viewed",item:"BOVI Document",time:"2:31pm"}]},
  ]},
]},
{id:2,company:"Church & Dwight",contact:"Michael Torres",title:"PIM + Digital Shelf Analytics",stage:"Discovery",value:"$215,000",closeDate:"2026-06-15",logo:"C&D",color:"#00539B",industry:"CPG · Personal Care",engagement:45,accessCode:"CD2026",includeTrialSessions:false,
welcomeMsg:"Welcome to your Church & Dwight deal workspace. This portal centralizes everything related to your PIM and Digital Shelf evaluation.",
execSummary:{
  problem:"Church & Dwight manages 3,000+ SKUs across major retail platforms but lacks the centralized infrastructure to maintain PDP accuracy, monitor Buy Box performance, or respond quickly to unauthorized 3P seller activity. Manual processes are creating compliance risks and slowing launch timelines.",
  challenges:["Manual PDP monitoring not scalable across 3,000 SKUs","Unauthorized 3P sellers eroding brand pricing and content quality","No real-time visibility into Buy Box win rate by SKU","Data scattered across brand.com, retailer portals, and agency systems"],
  solutions:["Centralized PIM to unify all product content and digital assets","Automated Buy Box monitoring with real-time alerts","Retailer content compliance scoring dashboard","Unauthorized seller detection and reporting workflows"],
},
discovery:{
  summary:"Church & Dwight is a fast-growing CPG brand in the personal care space, managing a complex multi-channel digital presence without the infrastructure to match its ambition. The core opportunity is to replace manual, fragmented content operations with a scalable PIM platform.",
  corporateStrategy:["Expand eCommerce presence to capture $500M in digital revenue","Maintain brand integrity across all 3P seller channels","Reduce time-to-market for product launches by 40%"],
  topOutcomes:["Drive 25% CAGR in Amazon and Walmart.com net sales","Eliminate manual PDP monitoring — cut FTE time by 70%","Ensure brand content accuracy across 15 major retail portals"],
  challenges:["Manual monitoring of PDPs not scalable across 3,000 SKUs","Unauthorized 3P sellers eroding brand pricing and content quality","No real-time visibility into Buy Box win rate by SKU"],
  jobsToBeDone:["Monitor and defend Buy Box at scale","Automate retailer content compliance checks","Centralize content for faster new product launches"],
  primaryUseCase:"Centralize product information and digital assets to power consistent, accurate content across all retail endpoints while gaining real-time analytics on digital shelf performance.",
  goals:{"90 Days":["Audit and correct top 500 SKUs on Amazon","Implement Buy Box monitoring"],"1 Year":["Full PIM rollout across all 3,000 SKUs","Automated syndication to 15 retail partners"],"Beyond":["Real-time pricing intelligence","Predictive content optimization"]},
},
stakeholders:[
  {id:"s1",name:"Michael Torres",role:"Sr. Director eCommerce",designation:"champion",engagement:71,lastSeen:"1d ago",initials:"MT",bu:"eCommerce",approvalRequired:true,docsViewed:["Company Overview"],linkedin:"https://linkedin.com/in/michaeltorres",reportsTo:null},
  {id:"s2",name:"Lisa Huang",role:"VP Marketing",designation:"influencer",engagement:28,lastSeen:"4d ago",initials:"LH",bu:"Marketing",approvalRequired:false,docsViewed:[],linkedin:"https://linkedin.com/in/lisahuang",reportsTo:"s1"},
],
mapItems:[
  {id:1,phase:"Value Alignment",task:"Initial Discovery Meeting",owner:"Mark H.",buyerOwner:"Michael Torres",dueDate:"2026-02-25",status:"complete",notes:"",approvalRequired:false},
  {id:2,phase:"Value Alignment",task:"BOVI Discovery Document",owner:"Mark H.",buyerOwner:"Michael Torres",dueDate:"2026-03-10",status:"in-progress",notes:"",approvalRequired:false},
  {id:3,phase:"Value Alignment",task:"Custom Demo",owner:"Mark H.",buyerOwner:"Michael Torres + Lisa Huang",dueDate:"2026-03-25",status:"pending",notes:"",approvalRequired:false},
],
content:[
  {id:1,title:"Company Overview & Capabilities Deck",type:"pptx",uploaded:"Feb 25",views:2,viewers:["Michael Torres"],lastViewed:"Michael Torres · 1d ago",url:"#",category:"Presentation"},
],
activityLog:[
  {date:"Mar 1, 2026",entries:[
    {person:"Michael Torres",email:"m.torres@churchdwight.com",location:"Ewing, US",time:"9:45am",duration:"18:30 min",actions:[{type:"viewed",item:"Company Overview & Capabilities Deck",time:"9:46am"}]},
  ]},
]}
];

const Badge = ({label,color,bg,border,small}) => (
  <span style={{padding:small?"2px 7px":"3px 10px",borderRadius:4,background:bg,border:`1px solid ${border}`,color,fontSize:small?10:11,fontWeight:700,whiteSpace:"nowrap"}}>{label}</span>
);
const renderMD = t => t
  .replace(/^## (.+)/gm,`<div style="font-size:12px;font-weight:800;color:${P.accent};margin:14px 0 5px;text-transform:uppercase;letter-spacing:.07em;border-bottom:2px solid ${P.accentLight};padding-bottom:3px">$1</div>`)
  .replace(/\*\*(.+?)\*\*/g,`<strong style="color:${P.text}">$1</strong>`)
  .replace(/^- (.+)/gm,`<div style="display:flex;gap:7px;margin:3px 0"><span style="color:${P.accent};font-size:10px;margin-top:3px;flex-shrink:0">◆</span><span>$1</span></div>`)
  .replace(/\n\n/g,`<div style="margin:6px 0"></div>`).replace(/\n/g,"<br/>");

const LI_SVG = <svg width="11" height="11" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;

const ProspectLogin = ({deal,onSuccess}) => {
  const [email,setEmail]=useState(""); const [code,setCode]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const go=()=>{setLoading(true);setTimeout(()=>{if(code.toUpperCase()===deal.accessCode&&email.includes("@")){onSuccess(email);}else{setError("Invalid email or access code. Please check with your account executive.");setLoading(false);}},900);};
  return (<div style={{flex:1,minHeight:"100vh",background:"linear-gradient(135deg,#F0F4FF 0%,#F7F8FA 60%,#EEF3FF 100%)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:440,background:P.surface,borderRadius:20,padding:"44px 40px",boxShadow:"0 20px 60px rgba(26,79,186,0.12)",border:`1px solid ${P.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:`linear-gradient(135deg,${P.accent},${P.accentMid})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:16,fontWeight:800}}>D</span></div>
          <span style={{fontSize:16,fontWeight:800,color:P.text}}>DealRoom</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:6,background:deal.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff"}}>{deal.logo}</div>
          <span style={{fontSize:12,fontWeight:600,color:P.textSec}}>{deal.company}</span>
        </div>
      </div>
      <div style={{fontSize:24,fontWeight:800,color:P.text,letterSpacing:"-0.6px",marginBottom:6}}>Access your Deal Room</div>
      <div style={{fontSize:13,color:P.textSec,lineHeight:1.6,marginBottom:28}}>Your account executive has prepared a private workspace for your evaluation. Enter your credentials to access.</div>
      <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5}}>Your Work Email</label>
        <input value={email} onChange={e=>{setEmail(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="you@company.com" type="email" style={{width:"100%",border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none"}}/></div>
      <div style={{marginBottom:20}}><label style={{fontSize:11,fontWeight:700,color:P.textSec,textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5}}>Access Code</label>
        <input value={code} onChange={e=>{setCode(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="Provided by your AE" style={{width:"100%",border:`1px solid ${error?P.red:P.border}`,borderRadius:8,padding:"11px 14px",fontSize:13,color:P.text,background:P.bg,fontFamily:"inherit",outline:"none",letterSpacing:"0.08em"}}/>
        {error&&<div style={{fontSize:11,color:P.red,marginTop:6}}>{error}</div>}</div>
      <button onClick={go} disabled={loading||!email||!code} style={{width:"100%",padding:"12px",background:loading||!email||!code?P.border:P.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:loading||!email||!code?"not-allowed":"pointer"}}>{loading?"Verifying…":"Access My Deal Room →"}</button>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:20,padding:"12px 14px",background:P.accentLight,borderRadius:8,border:`1px solid #BFDBFE`}}>
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
  const done=items.filter(t=>t.status==="complete").length;
  const pct=items.length>0?done/items.length:0;
  const aIdx=Math.min(Math.floor(pct*steps.length),steps.length-1);
  const hasIP=items.some(t=>t.status==="in-progress");
  const progW=steps.length>1?Math.min(aIdx/(steps.length-1)*86,86):0;
  return (
    <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:14,padding:"28px 36px",marginBottom:24}}>
      <div style={{fontSize:13,fontWeight:600,color:P.textSec,marginBottom:28}}>Track where we are in the process at any given time</div>
      <div style={{position:"relative",display:"flex",alignItems:"flex-start"}}>
        <div style={{position:"absolute",top:20,left:"7%",right:"7%",height:2,background:P.border,zIndex:0}}/>
        <div style={{position:"absolute",top:20,left:"7%",height:2,width:`${progW}%`,background:`linear-gradient(90deg,${P.teal},${P.accentMid})`,zIndex:1,transition:"width .6s ease"}}/>
        {steps.map((step,i)=>{
          const isCom=i<aIdx,isAct=i===aIdx&&hasIP,isUp=!isCom&&!isAct;
          return (<div key={step.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",position:"relative",zIndex:2}}>
            <div style={{width:42,height:42,borderRadius:"50%",background:isCom?P.teal:isAct?P.accentMid:"#E5E7EB",border:`3px solid ${isCom?P.teal:isAct?P.accent:P.border}`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:isAct?`0 0 0 8px ${P.accentLight},0 0 0 4px ${P.accentMid}30`:"none"}}>
              {isCom?<span style={{color:"#fff",fontSize:14,fontWeight:800}}>✓</span>:isAct?<div style={{width:12,height:12,borderRadius:"50%",background:"#fff"}}/>:<div style={{width:8,height:8,borderRadius:"50%",background:P.textMute}}/>}
            </div>
            <div style={{width:1,height:18,background:isUp?P.border:P.teal,margin:"4px 0"}}/>
            <div style={{textAlign:"center",maxWidth:110,padding:"0 4px"}}>
              <div style={{fontSize:12,fontWeight:800,color:isUp?P.textMute:P.text,marginBottom:3}}>{step.label}</div>
              <div style={{fontSize:10,color:P.textMute,lineHeight:1.4}}>{step.desc}</div>
            </div>
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
        <div><div style={{fontSize:17,fontWeight:800,color:P.text}}>Create Deal Room</div><div style={{fontSize:12,color:P.textSec,marginTop:2}}>Step {step} of 3 · {["Choose Method","AI Generation","Review & Save"][step-1]}</div></div>
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
          {draft.discovery.challenges.length>0&&<div style={{background:P.accentLight,border:`1px solid #BFDBFE`,borderRadius:8,padding:"12px 16px",marginBottom:12}}><div style={{fontSize:11,fontWeight:700,color:P.accent,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>AI Extracted — Challenges</div>{draft.discovery.challenges.map((c,i)=><div key={i} style={{fontSize:12,color:P.textSec,marginBottom:3}}>· {c}</div>)}</div>}
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

function DealRoom() {
  const [deals,setDeals]=useState(INIT_DEALS);
  const [activeId,setActiveId]=useState(1);
  const [viewMode,setViewMode]=useState("rep");
  const [prospectAuth,setProspectAuth]=useState({});
  const [tab,setTab]=useState("map");
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

  const deal=deals.find(d=>d.id===activeId);
  const upd=d=>setDeals(prev=>prev.map(x=>x.id===d.id?d:x));
  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),2800);};

  const phases=deal.includeTrialSessions?PHASES_ALL:PHASES_NO_TRIAL;
  const visItems=deal.mapItems.filter(t=>phases.includes(t.phase));
  const done=visItems.filter(t=>t.status==="complete").length;
  const pct=Math.round(done/(visItems.length||1)*100);

  const repTabs=[["map","Action Plan"],["summary","Executive Summary"],["discovery","Discovery"],["content","Content"],["stakeholders","Stakeholders"],["analytics","Analytics"]];
  const prosTabs=[["welcome","Welcome"],["summary","Executive Summary"],["map","Action Plan"],["discovery","Discovery"],["content","Resources"],["stakeholders","Team"]];
  const tabs=viewMode==="prospect"?prosTabs:repTabs;

  const ctx=()=>`Deal: ${deal.title} | ${deal.company} | Stage: ${deal.stage} | Value: ${deal.value}\nIndustry: ${deal.industry}\nStakeholders: ${deal.stakeholders.map(s=>`${s.name} (${s.role}, ${s.designation})`).join("; ")}\nOutcomes: ${deal.discovery.topOutcomes.join("; ")}\nChallenges: ${deal.discovery.challenges.join("; ")}\nMAP: ${done}/${visItems.length} complete`;

  const runAI=async(mode,custom)=>{setAiLoading(true);setAiText("");setAiOpen(true);setAiMode(mode);
    const SYS="You are an elite enterprise sales coach for CPG digital commerce. Be sharp, direct, tactical. Use ## headers, **bold**, - bullets. No fluff.";
    const PR={brief:`Write a deal brief. Score health 1-10, assess champion, list top 3 risks, 3 specific next actions.\n\n${ctx()}`,bizcase:`Build a champion-ready internal business case. Include: Executive Summary, Problem with metrics, Solution fit, ROI (CPG benchmarks), Risk of Inaction, Timeline.\n\n${ctx()}`,nextsteps:`5 tactical next steps this week. For each: who to contact, what to say, why it matters.\n\n${ctx()}`,email:`Draft follow-up email to ${deal.stakeholders[0]?.name}. Reference their outcomes. Subject + body. Max 150 words.\n\n${ctx()}`,chat:custom||""};
    try{setAiText(await callClaude(SYS,PR[mode]+(mode==="chat"?`\n\nDeal:\n${ctx()}`:""),1200));}catch{setAiText("Unable to reach AI. Please try again.");}
    setAiLoading(false);};

  const inpS={border:`1px solid ${P.border}`,borderRadius:6,padding:"8px 10px",fontSize:12,color:P.text,background:P.surface,fontFamily:"inherit",outline:"none"};

  const CSS=`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${P.bg}}::-webkit-scrollbar-thumb{background:${P.borderDark};border-radius:3px}
input,select,textarea{font-family:inherit;outline:none;}
input:focus,select:focus,textarea:focus{border-color:${P.accent}!important;box-shadow:0 0 0 3px ${P.accentLight};}
.hr:hover{background:${P.bg}!important}.hd:hover{background:${P.bg}!important;cursor:pointer}.hv:hover{opacity:.82}
.fade{animation:fi .2s ease}@keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.shim>div{animation:sh 1.5s ease infinite alternate;background:linear-gradient(90deg,#f1f5f9,#e9edf5,#f1f5f9);background-size:200%;border-radius:4px;}@keyframes sh{from{background-position:0%}to{background-position:100%}}
select option{background:#fff}`;

  if(viewMode==="prospect"&&!prospectAuth[activeId]){
    return <div style={{fontFamily:"'Plus Jakarta Sans','Segoe UI',sans-serif"}}><style>{CSS}</style>
      <div style={{display:"flex",minHeight:"100vh"}}>
        <div style={{width:252,background:P.surface,borderRight:`1px solid ${P.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${P.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <div style={{width:32,height:32,background:`linear-gradient(135deg,${P.accent},${P.accentMid})`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:14,fontWeight:800}}>D</span></div>
              <span style={{fontSize:14,fontWeight:800,color:P.text}}>DealRoom</span>
            </div>
          </div>
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${P.border}`,display:"flex",gap:4}}>
            {[["rep","Sales Rep"],["prospect","Prospect"]].map(([v,l])=>(
              <button key={v} onClick={()=>{setViewMode(v);setTab(v==="prospect"?"welcome":"map");}} style={{flex:1,padding:"6px 8px",borderRadius:6,border:`1px solid ${viewMode===v?P.accent:P.border}`,background:viewMode===v?P.accentLight:"transparent",color:viewMode===v?P.accent:P.textSec,fontSize:11,fontWeight:700,cursor:"pointer"}}>{l}</button>))}
          </div>
          <div style={{padding:"10px 8px",flex:1}}>
            {deals.map(d=><div key={d.id} onClick={()=>setActiveId(d.id)} className="hd" style={{padding:"10px 8px",borderRadius:8,background:d.id===activeId?P.accentLight:"transparent",border:`1px solid ${d.id===activeId?"#BFDBFE":"transparent"}`,borderLeft:`3px solid ${d.id===activeId?P.accent:"transparent"}`,marginBottom:2}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:32,height:32,borderRadius:7,background:d.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff"}}>{d.logo}</div><div><div style={{fontSize:12,fontWeight:700,color:d.id===activeId?P.accent:P.text}}>{d.company}</div><div style={{fontSize:10,color:P.textMute}}>{d.stage}</div></div></div>
            </div>)}
          </div>
        </div>
        <ProspectLogin deal={deal} onSuccess={email=>setProspectAuth(p=>({...p,[activeId]:email}))}/>
      </div>
    </div>;
  }

  return <div style={{fontFamily:"'Plus Jakarta Sans','Segoe UI',sans-serif",background:P.bg,minHeight:"100vh",display:"flex",color:P.text}}>
    <style>{CSS}</style>

    {/* SIDEBAR */}
    <div style={{width:252,background:P.surface,borderRight:`1px solid ${P.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
      <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${P.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <div style={{width:32,height:32,background:`linear-gradient(135deg,${P.accent},${P.accentMid})`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:14,fontWeight:800}}>D</span></div>
          <div><div style={{fontSize:14,fontWeight:800,color:P.text,letterSpacing:"-0.4px"}}>DealRoom</div><div style={{fontSize:10,color:P.textMute,marginTop:1}}>Enterprise Sales Platform</div></div>
        </div>
      </div>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${P.border}`,display:"flex",gap:4}}>
        {[["rep","Sales Rep"],["prospect","Prospect"]].map(([v,l])=>(
          <button key={v} onClick={()=>{setViewMode(v);setTab(v==="prospect"?"welcome":"map");}} style={{flex:1,padding:"6px 8px",borderRadius:6,border:`1px solid ${viewMode===v?P.accent:P.border}`,background:viewMode===v?P.accentLight:"transparent",color:viewMode===v?P.accent:P.textSec,fontSize:11,fontWeight:700,cursor:"pointer"}}>{l}</button>))}
      </div>
      <div style={{padding:"10px 8px 6px",flex:1,overflowY:"auto"}}>
        <div style={{fontSize:10,fontWeight:700,color:P.textMute,letterSpacing:"0.08em",textTransform:"uppercase",padding:"0 8px",marginBottom:6}}>Active Deals</div>
        {deals.map(d=>{const dp=Math.round(d.mapItems.filter(t=>t.status==="complete").length/d.mapItems.length*100);const isA=d.id===activeId;return(
          <div key={d.id} className="hd" onClick={()=>{setActiveId(d.id);setAiOpen(false);setAiText("");setTab(viewMode==="prospect"?"welcome":"map");}} style={{padding:"10px 8px",borderRadius:8,background:isA?P.accentLight:"transparent",border:`1px solid ${isA?"#BFDBFE":"transparent"}`,borderLeft:`3px solid ${isA?P.accent:"transparent"}`,marginBottom:2,transition:"all .12s"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:32,height:32,borderRadius:7,background:d.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{d.logo}</div>
              <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:isA?P.accent:P.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.company}</div><div style={{fontSize:10,color:P.textMute,marginTop:1}}>{d.stage} · {d.value}</div></div>
            </div>
            <div style={{marginTop:7,marginLeft:40}}><div style={{height:3,background:P.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${dp}%`,height:"100%",background:isA?P.accent:P.textMute,borderRadius:99}}/></div></div>
          </div>);})}
        <button onClick={()=>setShowCreator(true)} style={{width:"100%",marginTop:8,padding:8,border:`1.5px dashed ${P.border}`,borderRadius:8,background:"none",color:P.textMute,fontSize:11,fontWeight:600,cursor:"pointer"}} onMouseOver={e=>{e.currentTarget.style.borderColor=P.accent;e.currentTarget.style.color=P.accent;}} onMouseOut={e=>{e.currentTarget.style.borderColor=P.border;e.currentTarget.style.color=P.textMute;}}>+ New Deal Room</button>
      </div>
      <div style={{padding:"12px 16px",borderTop:`1px solid ${P.border}`,display:"flex",alignItems:"center",gap:10}}>
        <img src={AE.photo} alt={AE.name} style={{width:32,height:32,borderRadius:"50%",objectFit:"cover",border:`2px solid ${P.border}`,flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>
        <div><div style={{fontSize:12,fontWeight:700,color:P.text}}>{AE.name}</div><div style={{fontSize:11,color:P.textMute,marginTop:1}}>{AE.title}</div></div>
      </div>
    </div>

    {/* MAIN */}
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{background:P.surface,borderBottom:`1px solid ${P.border}`,padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:42,height:42,borderRadius:9,background:deal.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff"}}>{deal.logo}</div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:17,fontWeight:800,color:P.text,letterSpacing:"-0.5px"}}>{deal.company}</span>
              <span style={{fontSize:12,color:P.textMute}}>·</span>
              <span style={{fontSize:13,color:P.textSec,fontWeight:500}}>{deal.title}</span>
              {viewMode==="prospect"&&<span style={{padding:"2px 8px",background:P.greenBg,border:`1px solid ${P.greenBorder}`,borderRadius:20,fontSize:10,fontWeight:700,color:P.green}}>PROSPECT VIEW</span>}
            </div>
            <div style={{display:"flex",gap:14,marginTop:3}}>{[deal.industry,deal.value,`Close ${deal.closeDate}`,deal.contact].map((v,i)=><span key={i} style={{fontSize:11,color:P.textMute}}>{v}</span>)}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:20}}>
            <span style={{fontSize:10,color:P.textMute,fontWeight:600}}>ENGAGEMENT</span>
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
              <div style={{width:52,height:52,borderRadius:12,background:deal.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:800,color:"#fff",marginBottom:16}}>{deal.logo}</div>
              <div style={{fontSize:22,fontWeight:800,color:"#fff",letterSpacing:"-0.5px",marginBottom:8}}>Welcome, {deal.company}</div>
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
              <div style={{fontSize:20,fontWeight:800,color:P.text,letterSpacing:"-0.5px"}}>Executive Summary</div>
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
              const pc=PHASE_CFG[phase]||PHASE_CFG["Value Alignment"];
              return <div key={phase} style={{marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,padding:"4px 14px",background:pc.bg,border:`1px solid ${pc.border}`,borderRadius:20}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:pc.dot}}/><span style={{fontSize:11,fontWeight:800,color:pc.color,letterSpacing:"0.05em",textTransform:"uppercase"}}>{phase}</span>
                  </div>
                  <div style={{flex:1,height:1,background:pc.border}}/>
                  <span style={{fontSize:11,fontWeight:700,color:pc.color}}>{items.filter(t=>t.status==="complete").length}/{items.length}</span>
                </div>
                <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:`1fr 100px 150px 100px 110px${viewMode==="rep"?" 26px":""}`,padding:"7px 16px",background:P.bg,borderBottom:`1px solid ${P.border}`}}>
                    {["Task","Seller","Buyer Owner","Due Date","Status"].concat(viewMode==="rep"?[""]:[]).map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:P.textMute,textTransform:"uppercase",letterSpacing:"0.07em"}}>{h}</div>)}
                  </div>
                  {items.map((task,i)=>{const sc=STATUS_CFG[task.status];return(
                    <div key={task.id} className="hr" style={{display:"grid",gridTemplateColumns:`1fr 100px 150px 100px 110px${viewMode==="rep"?" 26px":""}`,padding:"11px 16px",borderBottom:i<items.length-1?`1px solid ${P.bg}`:"none",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                        <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${task.status==="complete"?P.green:P.border}`,background:task.status==="complete"?P.green:P.surface,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>{task.status==="complete"&&<span style={{color:"#fff",fontSize:9,fontWeight:800}}>✓</span>}</div>
                        <div>
                          <div style={{fontSize:13,color:task.status==="complete"?P.textMute:P.text,textDecoration:task.status==="complete"?"line-through":"none",fontWeight:500}}>{task.task}</div>
                          {task.notes&&<div style={{fontSize:11,color:P.textMute,marginTop:2,fontStyle:"italic"}}>{task.notes}</div>}
                          {task.approvalRequired&&<span style={{fontSize:9,fontWeight:700,color:P.red,textTransform:"uppercase",letterSpacing:"0.06em"}}>Approval Required</span>}
                        </div>
                      </div>
                      <div style={{fontSize:12,color:P.textSec}}>{task.owner}</div>
                      <div style={{fontSize:12,color:P.textSec}}>{task.buyerOwner}</div>
                      <div style={{fontSize:11,color:P.textMute}}>{task.dueDate}</div>
                      {viewMode==="rep"?<select value={task.status} onChange={e=>upd({...deal,mapItems:deal.mapItems.map(t=>t.id===task.id?{...t,status:e.target.value}:t)})} style={{background:sc.bg,border:`1px solid ${sc.border}`,color:sc.text,borderRadius:5,padding:"4px 6px",fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}><option value="complete">Complete</option><option value="in-progress">In Progress</option><option value="pending">Pending</option></select>
                      :<div style={{padding:"3px 8px",borderRadius:4,background:sc.bg,border:`1px solid ${sc.border}`,color:sc.text,fontSize:11,fontWeight:700,textAlign:"center"}}>{sc.label}</div>}
                      {viewMode==="rep"&&<button onClick={()=>upd({...deal,mapItems:deal.mapItems.filter(t=>t.id!==task.id)})} style={{background:"none",border:"none",color:P.textMute,cursor:"pointer",fontSize:14}}>×</button>}
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
                <button onClick={()=>{if(!newTask.task.trim())return;upd({...deal,mapItems:[...deal.mapItems,{...newTask,id:Date.now()}]});setNewTask({phase:"Value Alignment",task:"",owner:"Mark H.",buyerOwner:"",dueDate:"",status:"pending",notes:"",approvalRequired:false});setShowAddTask(false);flash("Task added");}} style={{padding:"8px 18px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Add Task</button>
                <button onClick={()=>setShowAddTask(false)} style={{padding:"8px 14px",background:"none",border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>:<button onClick={()=>setShowAddTask(true)} style={{width:"100%",padding:10,background:"none",border:`1.5px dashed ${P.border}`,borderRadius:8,color:P.textMute,fontSize:12,cursor:"pointer"}} onMouseOver={e=>{e.currentTarget.style.borderColor=P.accent;e.currentTarget.style.color=P.accent;}} onMouseOut={e=>{e.currentTarget.style.borderColor=P.border;e.currentTarget.style.color=P.textMute;}}>+ Add Task</button>)}
          </div>}

          {/* DISCOVERY */}
          {tab==="discovery"&&<div style={{maxWidth:860}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div style={{fontSize:20,fontWeight:800,color:P.text,letterSpacing:"-0.5px"}}>Business Outcomes & Value Identification</div><div style={{fontSize:13,color:P.textSec,marginTop:3}}>{deal.company} · {deal.industry}</div></div>
              {viewMode==="rep"&&<button onClick={()=>runAI("bizcase")} style={{padding:"8px 16px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>✦ Build Business Case</button>}
            </div>
            {deal.discovery.summary&&<div style={{background:`linear-gradient(135deg,${P.accentLight},#EEF6FF)`,border:`1px solid #BFDBFE`,borderRadius:12,padding:"18px 22px",marginBottom:16,borderLeft:`4px solid ${P.accent}`}}>
              <div style={{fontSize:11,fontWeight:800,color:P.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Discovery Summary</div>
              <p style={{fontSize:13,color:P.textSec,lineHeight:1.75}}>{deal.discovery.summary}</p>
            </div>}
            {[{key:"st",title:"Corporate Strategy & Growth Initiatives",icon:"◈",items:deal.discovery.corporateStrategy,color:P.accent,bg:P.accentLight,border:"#BFDBFE"},
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
            <div style={{background:`linear-gradient(135deg,${P.accentLight},#EEF6FF)`,border:`1px solid #BFDBFE`,borderRadius:10,padding:"18px 20px",marginBottom:12}}>
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
                <button style={{padding:"6px 14px",background:P.accent,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add File</button>
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
                  <a href={f.url} style={{padding:"7px 14px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:12,fontWeight:600,textDecoration:"none",flexShrink:0}}>Open →</a>
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
                  <div style={{width:48,height:48,borderRadius:"50%",background:deal.color+"20",border:`2px solid ${deal.color}50`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:deal.color,flexShrink:0}}>{s.initials}</div>
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
                    <a href={s.linkedin} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#EBF5FF",border:"1px solid #BFDBFE",borderRadius:6,color:"#0A66C2",fontSize:11,fontWeight:700,textDecoration:"none"}}>{LI_SVG}LinkedIn</a>
                    {viewMode==="rep"&&<button onClick={()=>{setChatInput(`How do I engage ${s.name} (${s.role}, ${s.designation})?`);setAiOpen(true);}} style={{padding:"5px 10px",background:P.bg,border:`1px solid ${P.border}`,borderRadius:6,color:P.textSec,fontSize:11,fontWeight:600,cursor:"pointer"}}>Coach me</button>}
                  </div>
                </div>);})}
            </div>}
          </div>}

          {/* ANALYTICS */}
          {tab==="analytics"&&viewMode==="rep"&&<div style={{maxWidth:900}}>
            <div style={{fontSize:18,fontWeight:800,color:P.text,letterSpacing:"-0.3px",marginBottom:20}}>Analytics</div>
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
                  <div style={{width:32,height:32,borderRadius:"50%",background:deal.color+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:deal.color}}>{s.initials}</div>
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
            <div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:8,height:8,borderRadius:"50%",background:aiLoading?P.amber:P.accent}}/><span style={{fontSize:13,fontWeight:800,color:P.text}}>AI Deal Coach</span></div>
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

    {showCreator&&<DealCreator onSave={(d)=>{setDeals(prev=>[...prev,d]);setActiveId(d.id);setShowCreator(false);flash("Deal room created!");}} onClose={()=>setShowCreator(false)}/>}
    {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:P.text,borderRadius:8,padding:"10px 20px",fontSize:12,color:"#fff",fontWeight:600,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",zIndex:999}}>{toast} ✓</div>}
  </div>;
}

globalThis.DealRoom = DealRoom;
