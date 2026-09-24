// Builds everything the demo workspaces need from demo/content.mjs:
//   demo/template.json                       -- deal content, bundled into /api/start-demo
//   demo-assets/*                            -- the sample documents deal rooms link to
//
// Usage:  node demo/build.mjs            (needs Google Chrome for PDFs, macOS textutil for
//                                          .docx, and a Python with openpyxl + python-pptx:
//                                          set DEMO_PYTHON=/path/to/python if not on PATH)
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { SELLER, OWNER, TEAMMATES, SHARED_DOCS, DEALS, TEAM_DEALS } from "./content.mjs";
import { DOCS, SHEETS, WORD_DOCS, DECK, RECORDINGS } from "./documents.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "demo-assets");
const TMP = join(tmpdir(), "mybivy-demo-build");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PY = process.env.DEMO_PYTHON || "python3";
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// ── 1. Database template ─────────────────────────────────────────────────────────────────
const template = { orgName: SELLER.org, owner: OWNER, teammates: TEAMMATES, sharedDocs: SHARED_DOCS, deals: DEALS, teamDeals: TEAM_DEALS };
const json = JSON.stringify(template);
// Every referenced document must exist in the build list below.
const built = new Set([...DOCS.map(d => d.file), ...SHEETS.map(d => d.file), ...WORD_DOCS.map(d => d.file), DECK.file, ...RECORDINGS.map(d => d.file)]);
for (const d of [...DEALS, ...TEAM_DEALS]) for (const doc of d.docs || []) {
  const path = doc.shared ? SHARED_DOCS[doc.shared]?.path : doc.path;
  if (!path) throw new Error(`${d.key}: unknown shared doc ${doc.shared}`);
  if (!built.has(path.replace("/demo-assets/", ""))) throw new Error(`${d.key}: no generator for ${path}`);
}
// Bundled into netlify/functions/start-demo.mts and passed to create_demo_workspace().
writeFileSync(join(ROOT, "demo", "template.json"), json);
console.log("wrote demo/template.json", `(${(json.length / 1024).toFixed(0)} KB)`);

// ── 2. PDFs (HTML -> headless Chrome) ───────────────────────────────────────────────────────
const CSS = (landscape) => `
@page { size: ${landscape ? "11in 8.5in" : "8.5in 11in"}; margin: 0.6in 0.65in; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1f2a37; font-size: 10.5pt; line-height: 1.5; margin: 0; }
.brand { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #16324F; padding-bottom: 8px; margin-bottom: 22px; }
.brand .logo { font-weight: 800; letter-spacing: .04em; color: #16324F; font-size: 11pt; }
.brand .logo span { color: #0E7C7B; }
.brand .tag { font-size: 8.5pt; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; }
h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 6px; color: #16324F; }
.sub { font-size: 11.5pt; color: #4b5563; margin: 0 0 20px; }
h2 { font-size: 12.5pt; color: #16324F; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
p { margin: 0 0 8px; }
ul { margin: 0 0 8px; padding-left: 18px; } li { margin-bottom: 3px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9.5pt; }
th { background: #16324F; color: #fff; text-align: left; padding: 6px 8px; font-weight: 600; }
td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
tr:nth-child(even) td { background: #f8fafc; }
td.num, th.num { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 2px solid #16324F; background: #fff; }
.kpis { display: flex; gap: 12px; margin: 8px 0 14px; }
.kpi { flex: 1; border: 1px solid #e5e7eb; border-top: 4px solid #0E7C7B; border-radius: 6px; padding: 10px 12px; }
.kpi .v { font-size: 19pt; font-weight: 800; color: #16324F; line-height: 1.1; }
.kpi .l { font-size: 8.5pt; color: #4b5563; margin-top: 3px; }
.quote { border-left: 4px solid #0E7C7B; background: #f0fdfa; padding: 10px 14px; margin: 10px 0; font-style: italic; }
.quote b { font-style: normal; display: block; margin-top: 6px; font-size: 9pt; color: #374151; }
.note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 12px; font-size: 9.5pt; margin: 8px 0; }
.stamp { display: inline-block; border: 2px solid #15803d; color: #15803d; font-weight: 800; letter-spacing: .12em; padding: 4px 12px; border-radius: 4px; transform: rotate(-4deg); margin: 6px 0 12px; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 8.5pt; font-weight: 700; }
.pill.g { background: #dcfce7; color: #166534; } .pill.a { background: #fef3c7; color: #92400e; } .pill.r { background: #fee2e2; color: #991b1b; } .pill.n { background: #e5e7eb; color: #374151; }
.sig { display: flex; gap: 30px; margin-top: 18px; } .sig > div { flex: 1; border-top: 1px solid #9ca3af; padding-top: 6px; font-size: 9pt; }
.sig .s { font-family: "Snell Roundhand", "Brush Script MT", cursive; font-size: 18pt; color: #1e3a8a; margin-bottom: 4px; }
.page-break { page-break-before: always; }
.foot { margin-top: 26px; font-size: 8pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 6px; }
`;
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const block = b => {
  if (typeof b === "string") return b; // raw HTML
  if (b.h) return `<h2>${esc(b.h)}</h2>`;
  if (b.p) return `<p>${esc(b.p)}</p>`;
  if (b.ul) return `<ul>${b.ul.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
  if (b.kpis) return `<div class="kpis">${b.kpis.map(([v, l]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>`;
  if (b.quote) return `<div class="quote">“${esc(b.quote)}”<b>${esc(b.by)}</b></div>`;
  if (b.note) return `<div class="note">${esc(b.note)}</div>`;
  if (b.table) {
    const numCols = new Set(b.num || []);
    const head = `<tr>${b.table[0].map((c, i) => `<th class="${numCols.has(i) ? "num" : ""}">${esc(c)}</th>`).join("")}</tr>`;
    const rows = b.table.slice(1).map((r, ri) => `<tr class="${b.totalLast && ri === b.table.length - 2 ? "total" : ""}">${r.map((c, i) => `<td class="${numCols.has(i) ? "num" : ""}">${typeof c === "object" && c?.html ? c.html : esc(c)}</td>`).join("")}</tr>`).join("");
    return `<table>${head}${rows}</table>`;
  }
  if (b.pageBreak) return `<div class="page-break"></div>`;
  throw new Error("unknown block " + JSON.stringify(b));
};
const docHtml = d => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>${CSS(d.landscape)}</style></head><body>
<div class="brand"><div class="logo">RIDGELINE <span>OPS CLOUD</span></div><div class="tag">${esc(d.tag || "Prepared for " + (d.for || "you"))}</div></div>
<h1>${esc(d.title)}</h1>${d.sub ? `<p class="sub">${esc(d.sub)}</p>` : ""}
${d.blocks.map(block).join("\n")}
<div class="foot">Sample document for the myBivy demo workspace. Ridgeline Software and all customer names, people, and figures are fictional.</div>
</body></html>`;

for (const d of DOCS) {
  const html = join(TMP, d.file.replace(/\.pdf$/, ".html"));
  writeFileSync(html, docHtml(d));
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--no-sandbox", `--print-to-pdf=${join(OUT, d.file)}`, `file://${html}`], { stdio: "ignore" });
  if (!existsSync(join(OUT, d.file))) throw new Error("PDF not produced: " + d.file);
  console.log("pdf ", d.file);
}

// ── 3. Word documents (HTML -> textutil) ──────────────────────────────────────────────────────
for (const d of WORD_DOCS) {
  const html = join(TMP, d.file.replace(/\.docx$/, ".html"));
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body style="font-family:Helvetica;font-size:11pt">${d.html}</body></html>`);
  execFileSync("textutil", ["-convert", "docx", "-output", join(OUT, d.file), html]);
  console.log("docx", d.file);
}

// ── 4. Spreadsheets + deck (Python: openpyxl / python-pptx) ────────────────────────────────────
const spec = join(TMP, "office.json");
writeFileSync(spec, JSON.stringify({ out: OUT, sheets: SHEETS, deck: DECK }));
execFileSync(PY, [join(ROOT, "demo", "office.py"), spec], { stdio: "inherit" });

// ── 5. Recording pages (plain HTML, opened directly) ──────────────────────────────────────────
for (const r of RECORDINGS) {
  writeFileSync(join(OUT, r.file), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(r.title)}</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1b1f23;--mute:#6b7178;--line:#e2e0da;--accent:#0E7C7B;--navy:#16324F}
@media (prefers-color-scheme:dark){:root{--bg:#15181b;--card:#1d2226;--ink:#eef0f2;--mute:#a3a9b0;--line:#2c3237}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 60px}.top{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin-bottom:6px}
h1{font-size:26px;line-height:1.2;margin:0 0 6px}.meta{color:var(--mute);font-size:13.5px;margin-bottom:18px}
.player{aspect-ratio:16/9;background:linear-gradient(135deg,#16324F,#0E7C7B);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:20px;margin-bottom:22px}
.play{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:12px}
.player small{opacity:.8;max-width:420px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
.card h2{font-size:15px;margin:0 0 10px}.card ul{margin:0;padding-left:18px}.card li{margin-bottom:5px}
.moment{display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--line)}.moment:first-of-type{border-top:0}
.ts{font-family:ui-monospace,Menlo,monospace;color:var(--accent);font-weight:600;min-width:52px}
.line{margin-bottom:10px}.who{font-weight:700;font-size:13.5px}.foot{color:var(--mute);font-size:12px;margin-top:24px}
</style></head><body><div class="wrap">
<div class="top">Call recording · Ridgeline Ops Cloud</div>
<h1>${esc(r.title)}</h1>
<div class="meta">${esc(r.meta)}</div>
<div class="player"><div class="play">▶</div><b>${esc(r.duration)}</b><small>Video playback isn't included in the demo workspace. The AI summary, key moments, and transcript below are what your buyers see.</small></div>
<div class="card"><h2>Summary</h2><ul>${r.summary.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
<div class="card"><h2>Key moments</h2>${r.moments.map(([ts, m]) => `<div class="moment"><span class="ts">${esc(ts)}</span><span>${esc(m)}</span></div>`).join("")}</div>
<div class="card"><h2>Transcript excerpt</h2>${r.transcript.map(([who, line]) => `<div class="line"><div class="who">${esc(who)}</div>${esc(line)}</div>`).join("")}</div>
<div class="card"><h2>Action items</h2><ul>${r.actions.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
<div class="foot">Sample recording page for the myBivy demo workspace. All companies and people are fictional.</div>
</div></body></html>`);
  console.log("html", r.file);
}

rmSync(TMP, { recursive: true, force: true });
console.log("done");
