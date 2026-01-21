// ---- iOS fallback storage (IndexedDB → localStorage) ----
const USE_LOCAL = true;

function lsGet(key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}
function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

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
// ---- LocalStorage opslag (iOS-proof) ----
function getAllInbox() {
  return Promise.resolve(lsGet("inbox_" + currentProfile));
}

function getAllTasks() {
  return Promise.resolve(lsGet("tasks_" + currentProfile));
}

function getAllNodes() {
  return Promise.resolve(lsGet("nodes_" + currentProfile));
}

function addInboxItem(rawText) {
  const list = lsGet("inbox_" + currentProfile);
  const item = {
    id: uid(),
    profileId: currentProfile,
    rawText,
    createdAt: new Date().toISOString()
  };
  list.push(item);
  lsSet("inbox_" + currentProfile, list);
  return Promise.resolve(item);
}

function addTask(t, sourceInboxId) {
  const list = lsGet("tasks_" + currentProfile);
  const task = {
    id: uid(),
    profileId: currentProfile,
    type: t.type || "task",
    title: cleanTitle(t.title),
    dueAt: t.dueAt || null,
    done: (t.type === "agenda") ? null : false,
    createdAt: new Date().toISOString(),
    sourceInboxId: sourceInboxId || null,
    tags: t.tags || []
  };
  list.push(task);
  lsSet("tasks_" + currentProfile, list);
  return Promise.resolve(task);
}

function toggleTaskDone(taskId, done) {
  const list = lsGet("tasks_" + currentProfile);
  const item = list.find(x => x.id === taskId);
  if (item) item.done = done;
  lsSet("tasks_" + currentProfile, list);
  return Promise.resolve(true);
}

function ensureNode(title) {
  const list = lsGet("nodes_" + currentProfile);
  if (!list.find(x => x.title === title)) {
    list.push({ id: uid(), title, profileId: currentProfile });
    lsSet("nodes_" + currentProfile, list);
  }
  return Promise.resolve(true);
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
