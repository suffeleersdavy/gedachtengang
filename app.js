/* DenkApp - offline PWA, 2 profielen, lokale opslag (IndexedDB)
   - "te bespreken" => Agenda (niet afvinkbaar)
   - CBS / Persbericht / Communicatie tags automatisch
*/

const DB_NAME = "denkapp_db";
const DB_VERSION = 1;

const PROFILES = {
  work: { id: "work", label: "Werk/Gemeente" },
  priv: { id: "priv", label: "Privé" },
};

let currentProfile = PROFILES.work.id;

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(msg) { statusEl.textContent = msg || ""; }

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" });
}

function formatDue(dueISO) {
  if (!dueISO) return "";
  const dt = new Date(dueISO);
  return dt.toLocaleString("nl-BE", { weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("inbox")) {
        const s = db.createObjectStore("inbox", { keyPath: "id" });
        s.createIndex("byProfile", "profileId", { unique: false });
        s.createIndex("byCreatedAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("tasks")) {
        const s = db.createObjectStore("tasks", { keyPath: "id" });
        s.createIndex("byProfile", "profileId", { unique: false });
        s.createIndex("byType", "type", { unique: false });
        s.createIndex("byDone", "done", { unique: false });
        s.createIndex("byDue", "dueAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("nodes")) {
        const s = db.createObjectStore("nodes", { keyPath: "id" });
        s.createIndex("byProfile", "profileId", { unique: false });
        s.createIndex("byParent", "parentId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    result = fn(store);
  });
}

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

// ---------- Parsing (heuristiek) ----------
const ACTION_VERBS = [
  "bel","mail","stuur","plan","maak","vraag","check","controleer","regel","boek","koop","betaal",
  "herinner","breng","haal","bestel","fix","neem","schrijf","werk","overleg","vergader","contacteer"
];

function detectDue(text) {
  const t = text.toLowerCase();
  const now = new Date();

  if (t.includes("vandaag")) {
    const dt = new Date(now);
    dt.setHours(18,0,0,0);
    return dt.toISOString();
  }
  if (t.includes("morgen")) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + 1);
    dt.setHours(18,0,0,0);
    return dt.toISOString();
  }

  const weekdays = ["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"];
  for (let i=0;i<weekdays.length;i++){
    if (t.includes(weekdays[i])) {
      const target = i;
      const dt = new Date(now);
      const current = dt.getDay();
      let delta = (target - current + 7) % 7;
      if (delta === 0) delta = 7;
      dt.setDate(dt.getDate() + delta);
      dt.setHours(18,0,0,0);
      return dt.toISOString();
    }
  }
  return null;
}

function cleanTitle(s) {
  return s.trim().replace(/\s+/g," ").replace(/^[\-\*\•\d\.\)\(]+\s*/,"");
}

function splitSentences(raw) {
  return raw
    .split(/[\n;\.]+/g)
    .map(s => cleanTitle(s))
    .filter(Boolean);
}

function extractTags(text) {
  const t = text.trim();
  const tags = new Set();

  // expliciet: "tag: X"
  const m = t.match(/tag:\s*([a-zA-Z0-9à-žÀ-Ž _-]+)/i);
  if (m) tags.add(cleanTitle(m[1]));

  const low = t.toLowerCase();

  // automatische tags (jouw wensen)
  const rules = [
    { k: ["cbs", "college", "schepencollege", "college van burgemeester en schepenen"], tag: "CBS" },
    { k: ["te bespreken", "bespreken", "agendapunt", "agenda"], tag: "Te bespreken" },

    { k: ["communicatie", "facebook", "instagram", "post", "bericht", "aankondiging"], tag: "Communicatie" },
    { k: ["persbericht", "persmededeling", "media", "journalist", "krant", "radio", "tv"], tag: "Persbericht" },

    // (optioneel) enkele thema’s
    { k: ["wegen","fietspad","mobiliteit","trage wegen","signalisatie"], tag: "Mobiliteit" },
    { k: ["school","onderwijs","bko","kinderopvang"], tag: "Onderwijs" },
    { k: ["sport","club","hal"], tag: "Sport" },
    { k: ["cultuur","santro","evenement","libbeke"], tag: "Cultuur/Events" },
    { k: ["privé","gezin","thuis"], tag: "Thuis" }
  ];

  for (const r of rules) {
    if (r.k.some(x => low.includes(x))) tags.add(r.tag);
  }

  return [...tags];
}

function classifySentence(s) {
  const low = s.toLowerCase();

  // Agenda: "te bespreken" => niet afvinkbaar
  if (low.includes("te bespreken") || low.startsWith("te bespreken")) return "agenda";

  // Idee als het begint met "idee" of "misschien"
  if (low.startsWith("idee") || low.startsWith("misschien")) return "idea";

  // Taak als het start met werkwoord
  const first = low.split(" ")[0];
  if (ACTION_VERBS.includes(first)) return "task";

  // Taak als het "moet" bevat
  if (low.includes("moet")) return "task";

  return "note";
}

function parseInput(raw) {
  const parts = splitSentences(raw);
  const tasks = [];
  const ideas = [];
  const notes = [];

  for (const p of parts) {
    const kind = classifySentence(p);
    const due = detectDue(p);
    const tags = extractTags(p);

    if (kind === "task") {
      tasks.push({ title: p, dueAt: due, tags, type: "task" });
    } else if (kind === "agenda") {
      tasks.push({ title: p, dueAt: null, tags: [...new Set([...(tags||[]), "Te bespreken"])], type: "agenda" });
    } else if (kind === "idea") {
      ideas.push({ title: p, tags });
    } else {
      notes.push({ title: p, tags });
    }
  }
  return { tasks, ideas, notes };
}

// ---------- Data opslaan ----------
async function addInboxItem(rawText) {
  const item = {
    id: uid(),
    profileId: currentProfile,
    rawText,
    createdAt: new Date().toISOString(),
  };
  await tx("inbox", "readwrite", (s) => s.put(item));
  return item;
}

async function addTask(t, sourceInboxId) {
  const task = {
    id: uid(),
    profileId: currentProfile,
    type: t.type || "task",                 // "task" of "agenda"
    title: cleanTitle(t.title),
    dueAt: t.dueAt || null,
    done: (t.type === "agenda") ? null : false,  // agenda niet afvinkbaar
    createdAt: new Date().toISOString(),
    sourceInboxId: sourceInboxId || null,
    tags: t.tags || []
  };
  await tx("tasks", "readwrite", (s) => s.put(task));
  return task;
}

async function ensureNode(title, parentId=null) {
  title = cleanTitle(title);
  const existing = await getAllNodes();
  const hit = existing.find(n => n.profileId === currentProfile && n.title.toLowerCase() === title.toLowerCase() && n.parentId === parentId);
  if (hit) return hit;

  const node = {
    id: uid(),
    profileId: currentProfile,
    title,
    parentId,
    createdAt: new Date().toISOString(),
  };
  await tx("nodes", "readwrite", (s) => s.put(node));
  return node;
}

async function getAllInbox() { return await tx("inbox", "readonly", (s) => s.getAll()); }
async function getAllTasks() { return await tx("tasks", "readonly", (s) => s.getAll()); }
async function getAllNodes() { return await tx("nodes", "readonly", (s) => s.getAll()); }

async function toggleTaskDone(taskId, done) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("tasks", "readwrite");
    const store = t.objectStore("tasks");
    const r = store.get(taskId);
    r.onsuccess = () => {
      const obj = r.result;
      obj.done = done;
      store.put(obj);
    };
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

// ---------- UI render ----------
function setProfileUI() {
  $("profileWork").classList.toggle("active", currentProfile === PROFILES.work.id);
  $("profilePrivate").classList.toggle("active", currentProfile === PROFILES.priv.id);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

async function render() {
  setProfileUI();

  const [inboxAll, tasksAll, nodesAll] = await Promise.all([getAllInbox(), getAllTasks(), getAllNodes()]);

  const inbox = inboxAll
    .filter(x => x.profileId === currentProfile)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));

  const items = tasksAll
    .filter(x => x.profileId === currentProfile);

  const agendaItems = items
    .filter(x => x.type === "agenda")
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));

  const tasks = items
    .filter(x => x.type !== "agenda")
    .sort((a,b) => (a.done === b.done
      ? (String(a.dueAt||"").localeCompare(String(b.dueAt||"")))
      : (a.done - b.done)));

  const nodes = nodesAll.filter(x => x.profileId === currentProfile);

  // Agenda (geen checkbox)
  const agendaEl = $("agenda");
  if (!agendaItems.length) {
    agendaEl.innerHTML = `<div class="small">Nog geen agendapunten.</div>`;
  } else {
    agendaEl.innerHTML = "";
    for (const a of agendaItems) {
      const div = document.createElement("div");
      div.style.margin = "10px 0";
      div.innerHTML = `
        <div><b>•</b> ${escapeHtml(a.title)}
          ${(a.tags||[]).slice(0,3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="small">${escapeHtml(formatDate(a.createdAt))}</div>
      `;
      agendaEl.appendChild(div);
    }
  }

  // Tasks (met checkbox)
  const tasksEl = $("tasks");
  if (!tasks.length) {
    tasksEl.innerHTML = `<div class="small">Nog geen taken.</div>`;
  } else {
    tasksEl.innerHTML = "";
    for (const t of tasks) {
      const div = document.createElement("div");
      div.className = "task";
      div.innerHTML = `
        <input type="checkbox" ${t.done ? "checked": ""} data-id="${t.id}" />
        <div>
          <div style="${t.done ? "text-decoration:line-through; color:#777" : ""}">${escapeHtml(t.title)}
            ${t.dueAt ? `<span class="due">• ${escapeHtml(formatDue(t.dueAt))}</span>` : ""}
            ${(t.tags||[]).slice(0,2).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="small">${escapeHtml(formatDate(t.createdAt))}</div>
        </div>
      `;
      tasksEl.appendChild(div);
    }
    tasksEl.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", async (e) => {
        await toggleTaskDone(e.target.dataset.id, e.target.checked);
        render();
      });
    });
  }

  // Mindmap: per tag een uitklapbaar onderwerp, inhoud = taken + agenda
  const mindEl = $("mindmap");
  const tagMap = new Map();

  for (const it of [...agendaItems, ...tasks]) {
    for (const tag of (it.tags||[])) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(it);
    }
  }
  for (const n of nodes) {
    if (!tagMap.has(n.title)) tagMap.set(n.title, []);
  }

  if (!tagMap.size) {
    mindEl.innerHTML = `<div class="small">Nog geen onderwerpen. Voeg bv. “CBS te bespreken: …” of “Persbericht: …”.</div>`;
  } else {
    mindEl.innerHTML = "";
    [...tagMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([tag, list]) => {
      const det = document.createElement("details");
      det.open = true;

      const itemsHtml = list.slice(0,80).map(x => {
        const marker = (x.type === "agenda") ? "🗓️" : (x.done ? "✅" : "☐");
        const due = x.dueAt ? ` <span class="due">(${escapeHtml(formatDue(x.dueAt))})</span>` : "";
        return `<li>${marker} ${escapeHtml(x.title)}${due}</li>`;
      }).join("");

      det.innerHTML = `
        <summary><b>${escapeHtml(tag)}</b> <span class="small">(${list.length})</span></summary>
        <ul>${itemsHtml || `<li class="small">Nog niets onder dit onderwerp.</li>`}</ul>
      `;
      mindEl.appendChild(det);
    });
  }

  // Inbox
  const inboxEl = $("inbox");
  if (!inbox.length) {
    inboxEl.innerHTML = `<div class="small">Nog geen gedachten.</div>`;
  } else {
    inboxEl.innerHTML = "";
    for (const it of inbox.slice(0,30)) {
      const div = document.createElement("div");
      div.className = "card";
      div.style.margin = "10px 0";
      div.innerHTML = `
        <div>${escapeHtml(it.rawText)}</div>
        <div class="small">${escapeHtml(formatDate(it.createdAt))}</div>
      `;
      inboxEl.appendChild(div);
    }
  }
}

// ---------- Events ----------
$("profileWork").addEventListener("click", () => { currentProfile = PROFILES.work.id; render(); });
$("profilePrivate").addEventListener("click", () => { currentProfile = PROFILES.priv.id; render(); });

$("clear").addEventListener("click", () => { $("input").value = ""; });

$("add").addEventListener("click", async () => {
  const raw = $("input").value.trim();
  if (!raw) return;

  setStatus("Bezig...");
  $("input").value = "";

  const inboxItem = await addInboxItem(raw);
  const parsed = parseInput(raw);

  // tags als nodes bijhouden (zodat mindmap altijd onderwerpen heeft)
  const tagsSeen = new Set();
  for (const t of parsed.tasks) (t.tags||[]).forEach(x => tagsSeen.add(x));
  for (const tag of tagsSeen) await ensureNode(tag);

  // items opslaan (taken + agenda zitten samen in parsed.tasks met type)
  for (const t of parsed.tasks) await addTask(t, inboxItem.id);

  setStatus("Opgeslagen.");
  setTimeout(() => setStatus(""), 1200);
  render();
});

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

render();
