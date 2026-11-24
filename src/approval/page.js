// index.html for an approval pack (docs/APPROVAL_RFC.md §4): every post with its
// slides, captions and a decision. Static: marks stay in the browser and leave
// as JSON through "Copy decisions", which `approval pull --from` reads.

const esc = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const KIND = { carousel: "Carousel", image: "Image", video: "Video" };
const CHOICES = [["approved", "Approve"], ["changes", "Change"], ["dropped", "Drop"]];

/** The destination whose files stand for the post: Instagram, else Facebook, else the first. */
export function previewDestination(post) {
  const names = Object.keys(post.destinations);
  return ["instagram", "facebook"].find((name) => names.includes(name)) ?? names[0];
}

function media(post, file) {
  const src = `${esc(post.folder)}/${esc(file)}`;
  if (/\.mp4$/i.test(file)) return `<video src="${src}" controls muted playsinline preload="metadata"></video>`;
  if (/\.pdf$/i.test(file)) return `<a href="${src}">${esc(file)}</a>`;
  return `<a href="${src}" target="_blank"><img loading="lazy" src="${src}" alt="${esc(post.title)}: ${esc(file)}"></a>`;
}

function card(post) {
  const shown = post.destinations[previewDestination(post)];
  const meta = [`${KIND[post.kind] ?? post.kind}${post.slides > 1 ? `, ${post.slides} slides` : ""}`, post.day, ...post.checks.warnings.map((warning) => `Check: ${warning}`)].filter(Boolean);
  return `<section class="post" data-id="${esc(post.id)}"><header><span class="num">${String(post.n).padStart(2, "0")}</span><div><h2>${esc(post.title)}</h2><p class="meta">${meta.map(esc).join(" · ")}</p></div></header>
<div class="slides">${shown.files.map((file) => media(post, file)).join("")}</div>
<div class="caps">${Object.entries(post.destinations).map(([name, dest]) => `<div class="cap"><div class="caphead"><h3>${esc(name)}</h3><span>${dest.caption.length} characters</span><button type="button" data-copy>Copy</button></div><pre>${esc(dest.caption)}</pre><p class="files">${dest.files.map((file) => `<a href="${esc(post.folder)}/${esc(file)}">${esc(file.split("/").pop())}</a>`).join(" ")}</p></div>`).join("")}</div>
<fieldset class="decision"><legend>Decision</legend>${CHOICES.map(([value, label]) => `<label><input type="radio" name="d-${esc(post.id)}" value="${value}"${post.decision === value ? " checked" : ""}> ${label}</label>`).join("")}<textarea rows="2" placeholder="Notes for this post" aria-label="Notes for ${esc(post.title)}">${esc(post.note)}</textarea></fieldset></section>`;
}

export function approvalPage(pack) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(pack.title)}</title><style>
:root{--bg:#f6f4ee;--card:#fff;--ink:#1c2420;--soft:#5d6b64;--line:#dcd8cc;--accent:#28564a}
@media (prefers-color-scheme:dark){:root{--bg:#10151a;--card:#182028;--ink:#f1efe9;--soft:#a9b3b8;--line:#2b3742;--accent:#7fd3b0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 120px}h1{margin:0 0 20px;font-size:26px}
.post{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 24px}.post header{display:flex;gap:14px}
.num{font:700 22px/1 ui-monospace,monospace;color:var(--accent);padding-top:4px}h2{margin:0;font-size:20px}.meta,.files{color:var(--soft);font-size:14px;margin:4px 0 0}a{color:var(--accent)}
.slides{display:flex;gap:8px;overflow-x:auto;padding:14px 0}.slides img,.slides video{height:300px;border-radius:8px;border:1px solid var(--line);display:block}
.caps{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.cap{border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
.caphead{display:flex;align-items:center;gap:10px}.caphead h3{margin:0;font-size:15px;flex:1;text-transform:capitalize}.caphead span{color:var(--soft);font-size:12px}
button{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:14px;margin:10px 0 0}.decision{border:1px solid var(--line);border-radius:10px;margin:14px 0 0;padding:10px 12px;display:flex;flex-wrap:wrap;gap:6px 18px}
legend{font-size:13px;color:var(--soft);padding:0 6px}textarea{flex:1 1 100%;font:inherit;font-size:14px;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;font-size:14px}
</style></head><body><main><h1>${esc(pack.title)}</h1>
${pack.posts.map(card).join("\n")}</main><div class="bar"><span id="tally" role="status"></span><button type="button" id="copyAll">Copy decisions</button></div><script>
const KEY="launchclip-approval-"+${JSON.stringify(pack.created)};let state={};try{state=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
const posts=[...document.querySelectorAll(".post")];
const read=()=>posts.map(p=>({id:p.dataset.id,decision:(p.querySelector("input:checked")||{}).value||"pending",note:p.querySelector("textarea").value}));
const save=()=>{const all=read();try{localStorage.setItem(KEY,JSON.stringify(Object.fromEntries(all.map(d=>[d.id,d]))))}catch{}
document.getElementById("tally").textContent=["approved","changes","dropped","pending"].map(c=>all.filter(d=>d.decision===c).length+" "+c).join(" · ")};
posts.forEach(p=>{const was=state[p.dataset.id];if(was){p.querySelectorAll("input").forEach(i=>{i.checked=i.value===was.decision});p.querySelector("textarea").value=was.note||""}p.addEventListener("input",save)});
const copy=(text,button)=>navigator.clipboard.writeText(text).then(()=>{const was=button.textContent;button.textContent="Copied";setTimeout(()=>button.textContent=was,1200)});
document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>copy(b.closest(".cap").querySelector("pre").textContent,b)));
document.getElementById("copyAll").addEventListener("click",e=>copy(JSON.stringify(read().filter(d=>d.decision!=="pending"),null,2),e.target));save();
</script></body></html>
`;
}
