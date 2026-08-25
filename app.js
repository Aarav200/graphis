// ---------- State ----------
let currentUser = null;
let stagedFiles = [];
let currentGraph = { nodes: [], links: [] };
let graphInstance = null;
const FIELD_LIST = ["Computer Science", "Public Health", "Environmental Science", "Social Sciences", "Data Science", "Biology"];

// ---------- Local "multi-user" storage (client-side demo of collaboration) ----------
function getAllUsersData() {
  return JSON.parse(localStorage.getItem("graphis_users") || "{}");
}
function saveAllUsersData(data) {
  localStorage.setItem("graphis_users", JSON.stringify(data));
}
function getUserDocs(name) {
  const all = getAllUsersData();
  return (all[name] && all[name].docs) || [];
}
function addUserDoc(name, doc) {
  const all = getAllUsersData();
  if (!all[name]) all[name] = { docs: [], inbox: [] };
  all[name].docs.push(doc);
  saveAllUsersData(all);
}
function addInboxMessage(toUser, message) {
  const all = getAllUsersData();
  if (!all[toUser]) all[toUser] = { docs: [], inbox: [] };
  if (!all[toUser].inbox) all[toUser].inbox = [];
  all[toUser].inbox.push(message);
  saveAllUsersData(all);
}

// ---------- Login ----------
document.getElementById("loginBtn").addEventListener("click", doLogin);
document.getElementById("loginName").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });

function doLogin() {
  const name = document.getElementById("loginName").value.trim();
  if (!name) return;
  currentUser = name;
  localStorage.setItem("graphis_currentUser", name);
  enterApp();
}

function enterApp() {
  document.getElementById("loginGate").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  const bar = document.getElementById("loginBar");
  bar.innerHTML = `<span>Signed in as <strong>${escapeHtml(currentUser)}</strong></span><button id="switchUserBtn">Switch user</button>`;
  document.getElementById("switchUserBtn").addEventListener("click", () => {
    localStorage.removeItem("graphis_currentUser");
    location.reload();
  });
  renderFileList();
  renderFieldScores();
  renderCollabList();
}

(function initSession() {
  const saved = localStorage.getItem("graphis_currentUser");
  if (saved) { currentUser = saved; enterApp(); }
})();

// ---------- Tabs ----------
const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));

function activateTab(btn) {
  tabBtns.forEach(b => {
    b.classList.remove("active");
    b.setAttribute("aria-selected", "false");
    b.tabIndex = -1;
  });
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  btn.setAttribute("aria-selected", "true");
  btn.tabIndex = 0;
  document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  if (btn.dataset.tab === "fields") renderFieldScores();
  if (btn.dataset.tab === "collab") renderCollabList();
}

tabBtns.forEach((btn, i) => {
  btn.addEventListener("click", () => { activateTab(btn); btn.focus(); });
  btn.addEventListener("keydown", e => {
    let target = null;
    if (e.key === "ArrowRight") target = tabBtns[(i + 1) % tabBtns.length];
    else if (e.key === "ArrowLeft") target = tabBtns[(i - 1 + tabBtns.length) % tabBtns.length];
    else if (e.key === "Home") target = tabBtns[0];
    else if (e.key === "End") target = tabBtns[tabBtns.length - 1];
    if (target) { e.preventDefault(); activateTab(target); target.focus(); }
  });
});

// ---------- Upload / drag-drop ----------
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", e => handleFiles(e.target.files));

function handleFiles(fileListObj) {
  Array.from(fileListObj).forEach(f => {
    if (!isAllowedFileType(f.name)) {
      setStatus(`"${f.name}" is not a supported file type.`, "error");
      return;
    }
    stagedFiles.push(f);
  });
  renderFileList();
  if (stagedFiles.length) setStatus(`${stagedFiles.length} file(s) ready to build.`, "success");
}

function renderFileList() {
  const list = document.getElementById("fileList");
  list.innerHTML = "";
  stagedFiles.forEach((f, i) => {
    const ext = f.name.split(".").pop().toLowerCase();
    const badge = ext === "pdf" ? "PDF" : ext === "md" ? "Markdown" : "Code";
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.innerHTML = `<span>${escapeHtml(f.name)}</span><span class="type-badge">${badge}</span>`;
    list.appendChild(chip);
  });
}

function setStatus(msg, type) {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.className = "status-msg" + (type ? " " + type : "");
}

// ---------- Text extraction (client-side) ----------
async function extractTextFromFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf") {
    const buf = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(" ") + "\n";
    }
    return text;
  } else {
    return await file.text();
  }
}

// extractCodeSymbols now lives in utils.js (shared with the test suite)

// ---------- Build knowledge graph ----------
document.getElementById("buildBtn").addEventListener("click", buildKnowledgeGraph);

async function buildKnowledgeGraph() {
  if (stagedFiles.length === 0) { setStatus("Add at least one file first.", "error"); return; }
  setStatus("Extracting text and calling the model…", "");
  const docs = [];

  for (const file of stagedFiles) {
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const text = await extractTextFromFile(file);
      const codeSymbols = ["py", "js", "ts", "jsx", "tsx"].includes(ext) ? extractCodeSymbols(text, ext) : null;

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, text: text.slice(0, 15000), codeSymbols, fields: FIELD_LIST })
      });
      if (!resp.ok) throw new Error(`Server error (${resp.status})`);
      const data = await resp.json();

      const doc = {
        id: cryptoRandomId(),
        filename: file.name,
        owner: currentUser,
        entities: data.entities || [],
        relationships: data.relationships || [],
        embedding: data.embedding || [],
        fieldScores: data.fieldScores || {},
        createdAt: Date.now()
      };
      docs.push(doc);
      addUserDoc(currentUser, doc);
    } catch (err) {
      setStatus(`Failed on "${file.name}": ${err.message}`, "error");
    }
  }

  if (docs.length === 0) { setStatus("Nothing was processed successfully.", "error"); return; }

  setStatus(`Processed ${docs.length} file(s). Building graph…`, "success");
  const allMyDocs = getUserDocs(currentUser);
  renderGraph(allMyDocs);
  renderFieldScores();
  renderCollabList();
  stagedFiles = [];
  renderFileList();
}

// ---------- Graph rendering (3D) ----------
function renderGraph(docs) {
  const nodes = [];
  const links = [];
  const nodeIndex = {};

  function ensureNode(id, label, type) {
    if (!nodeIndex[id]) {
      nodeIndex[id] = true;
      nodes.push({ id, label, type });
    }
  }

  docs.forEach(doc => {
    const docNodeId = "doc:" + doc.id;
    ensureNode(docNodeId, doc.filename, "paper");
    (doc.entities || []).forEach((ent, idx) => {
      const entId = "ent:" + doc.id + ":" + idx;
      ensureNode(entId, ent.name, ent.type || "topic");
      links.push({ source: docNodeId, target: entId, kind: "explicit" });
    });
    (doc.relationships || []).forEach(rel => {
      const srcId = findEntityNodeId(doc, rel.source) || docNodeId;
      const tgtId = findEntityNodeId(doc, rel.target) || docNodeId;
      links.push({ source: srcId, target: tgtId, kind: "explicit", label: rel.type, justification: rel.justification });
    });
  });

  // hidden connections via embedding similarity across this user's own docs
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const sim = cosineSimilarity(docs[i].embedding, docs[j].embedding);
      if (sim > 0.55) {
        links.push({
          source: "doc:" + docs[i].id,
          target: "doc:" + docs[j].id,
          kind: "hidden",
          label: "hidden connection",
          justification: `Semantic similarity ${(sim * 100).toFixed(0)}% — no explicit citation found between these documents.`
        });
      }
    }
  }

  currentGraph = { nodes, links };
  document.getElementById("graphEmpty").classList.add("hidden");
  mountGraph();
}

function findEntityNodeId(doc, entityName) {
  const idx = (doc.entities || []).findIndex(e => e.name === entityName);
  return idx >= 0 ? "ent:" + doc.id + ":" + idx : null;
}

function mountGraph() {
  const el = document.getElementById("graphCanvas");
  el.innerHTML = "";
  const colorMap = { paper: "#0d9488", author: "#7c3aed", topic: "#2563eb", dataset: "#ea580c", method: "#0891b2", finding: "#16a34a" };

  graphInstance = ForceGraph3D()(el)
    .graphData({ nodes: currentGraph.nodes, links: currentGraph.links })
    .backgroundColor("#ffffff")
    .nodeLabel(n => n.label)
    .nodeColor(n => colorMap[n.type] || "#78716c")
    .linkColor(l => l.kind === "hidden" ? "#f97316" : "#94a3b8")
    .linkWidth(l => l.kind === "hidden" ? 2 : 1)
    .linkOpacity(0.6)
    .onNodeClick(node => showNodePanel(node));
}

function showNodePanel(node) {
  const panel = document.getElementById("nodePanel");
  const connections = currentGraph.links.filter(l => l.source === node.id || l.source.id === node.id || l.target === node.id || l.target.id === node.id);
  let html = `<h4>${escapeHtml(node.label)}</h4><p style="color:var(--text-muted);font-size:12.5px;">Type: ${node.type}</p><hr style="border:none;border-top:1px solid var(--border);"><p style="font-weight:600;font-size:13px;">Connections</p>`;
  if (connections.length === 0) html += `<p style="color:var(--text-muted);font-size:13px;">No connections yet.</p>`;
  connections.forEach(c => {
    html += `<p style="font-size:12.5px;margin:6px 0;"><strong>${c.label || c.kind}</strong>${c.justification ? " — " + escapeHtml(c.justification) : ""}</p>`;
  });
  document.getElementById("nodePanelContent").innerHTML = html;
  panel.classList.remove("hidden");
}
document.getElementById("closeNodePanel").addEventListener("click", () => document.getElementById("nodePanel").classList.add("hidden"));

// ---------- Field relevance ----------
function renderFieldScores() {
  const docs = getUserDocs(currentUser);
  const container = document.getElementById("fieldScores");
  if (docs.length === 0) {
    container.innerHTML = `<p class="hint">Upload and build your graph first to see field relevance scores.</p>`;
    return;
  }
  const avg = {};
  FIELD_LIST.forEach(f => avg[f] = 0);
  docs.forEach(d => FIELD_LIST.forEach(f => avg[f] += (d.fieldScores && d.fieldScores[f]) || 0));
  FIELD_LIST.forEach(f => avg[f] = Math.round(avg[f] / docs.length));

  container.innerHTML = FIELD_LIST.map(f => `
    <div class="field-row">
      <span class="field-name">${f}</span>
      <div class="field-bar-track"><div class="field-bar-fill" style="width:${avg[f]}%"></div></div>
      <span class="field-pct">${avg[f]}%</span>
    </div>
  `).join("");
}

// ---------- Collaboration ----------
function renderCollabList() {
  const container = document.getElementById("collabList");
  const all = getAllUsersData();
  const myDocs = getUserDocs(currentUser);
  if (myDocs.length === 0) {
    container.innerHTML = `<p class="hint">Upload documents first to see collaboration matches with other local users.</p>`;
    return;
  }
  const matches = [];
  Object.keys(all).forEach(otherUser => {
    if (otherUser === currentUser) return;
    const theirDocs = all[otherUser].docs || [];
    myDocs.forEach(myDoc => {
      theirDocs.forEach(theirDoc => {
        const sim = cosineSimilarity(myDoc.embedding, theirDoc.embedding);
        if (sim > 0.5) matches.push({ otherUser, myDoc, theirDoc, sim });
      });
    });
  });
  matches.sort((a, b) => b.sim - a.sim);

  if (matches.length === 0) {
    container.innerHTML = `<p class="hint">No overlapping researchers yet. Log in as a different name in another browser/tab, upload a related file, and matches will appear here.</p>`;
    return;
  }

  container.innerHTML = matches.map((m, i) => `
    <div class="collab-card">
      <h4>${escapeHtml(m.otherUser)}</h4>
      <p>Their <strong>${escapeHtml(m.theirDoc.filename)}</strong> overlaps <span class="collab-score">${(m.sim * 100).toFixed(0)}%</span> with your <strong>${escapeHtml(m.myDoc.filename)}</strong></p>
      <div class="collab-actions">
        <button data-idx="${i}" class="sendCollabBtn">Send collaboration request</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".sendCollabBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = matches[btn.dataset.idx];
      addInboxMessage(m.otherUser, {
        from: currentUser,
        text: `${currentUser} wants to collaborate — your "${m.theirDoc.filename}" overlaps with their "${m.myDoc.filename}" (${(m.sim*100).toFixed(0)}% similarity).`,
        createdAt: Date.now()
      });
      btn.textContent = "Request sent ✓";
      btn.classList.add("sent");
      btn.disabled = true;
    });
  });
}

// ---------- Chatbot ----------
document.getElementById("chatSendBtn").addEventListener("click", sendChatMessage);
document.getElementById("chatInput").addEventListener("keydown", e => { if (e.key === "Enter") sendChatMessage(); });

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  appendChatBubble(msg, "user");
  input.value = "";

  const docs = getUserDocs(currentUser);
  const context = docs.map(d => ({
    filename: d.filename,
    entities: (d.entities || []).map(e => e.name),
    fieldScores: d.fieldScores
  }));

  appendChatBubble("…", "assistant", true);
  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, context })
    });
    const data = await resp.json();
    updateLastAssistantBubble(data.reply || "Sorry, I couldn't generate a response.");
  } catch (err) {
    updateLastAssistantBubble("Something went wrong reaching the assistant: " + err.message);
  }
}

function appendChatBubble(text, role, isPlaceholder) {
  const wrap = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "chat-bubble " + role;
  div.textContent = text;
  if (isPlaceholder) div.dataset.placeholder = "1";
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}
function updateLastAssistantBubble(text) {
  const wrap = document.getElementById("chatMessages");
  const placeholder = wrap.querySelector('[data-placeholder="1"]');
  if (placeholder) { placeholder.textContent = text; placeholder.removeAttribute("data-placeholder"); }
  wrap.scrollTop = wrap.scrollHeight;
}

// ---------- Utils ----------
// cosineSimilarity, cryptoRandomId, escapeHtml, isAllowedFileType now live in
// utils.js (loaded before this file) so they can be unit-tested independently.