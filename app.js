/* DenkApp - iOS-proof (localStorage), 2 profielen
   - "te bespreken" => Agenda (niet afvinkbaar)
   - Tags: CBS / Persbericht / Communicatie automatisch
*/

const PROFILES = {
  work: { id: "work", label: "Werk/Gemeente" },
  priv: { id: "priv", label: "Privé" },
};

let currentProfile = PROFILES.work.id;

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function cleanTitle(s) {
  return String(s || "").trim().replace(/\s+/g, " ").replace(/^[\-\*\•\d\.\)\(]+\s*/, "");
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" });
}

function formatDue(dueISO) {
  if (!dueISO) return "";
  const dt = new Date(dueISO);
  return dt.toLocaleString("nl-BE", {
    weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

// ---------- localStorage helpers ----------
function lsKey(prefix) {
  return `${prefix}_${currentProfile}`;
}
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}
function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- Storage API (async-compatible) ----------
function getAllInbox() {
  return Promise.resolve(lsGet(lsKey("inbox")));
}
function getAllTasks() {
  return Promise.resolve(lsGet(lsKey("tasks")));
}
function getAllNodes() {
  return Promise.resolve(lsGet(lsKey("nodes")));
}

function addInboxItem(rawText) {
  const list = lsGet(lsKey("inbox"));
  const item = {
    id: uid(),
    profileId: currentProfile,
    rawText: String(rawText || ""),
    createdAt: new Date().toISOString(),
  };
  list.push(item);
  lsSet(lsKey("inbox"), list);
  return Promise.resolve(item);
}

function addTask(t, sourceInboxId) {
  const list = lsGet(lsKey("tasks"));
  const type = t.type || "task";
  const task = {
    id: uid(),
    profileId: currentProfile,
    type,
    title: cleanTitle(t.title),
    dueAt: t.dueAt || null,
    done: (type === "agenda") ? null : false,
    createdAt: new Date().toISOString(),
    sourceInboxId: sourceInboxId || null,
    tags: t.tags || []
  };
  list.push(task);
  lsSet(lsKey("tasks"), list);
  return Promise.resolve(task);
}

function toggleTaskDone(taskId, done) {
  const list = lsGet(lsKey("tasks"));
  const item = list.find(x => x.id === taskId);
  if (item) item.done = done;
  lsSet(lsKey("tasks"), list);
  return Promise.resolve(true);
}
function deleteItemById(id) {
  // verwijdert uit tasks van huidig profiel
  const list = lsGet(lsKey("tasks"));
  const next = list.filter(x => x.id !== id);
  lsSet(lsKey("tasks"), next);
  return Promise.resolve(true);
}

function clearDoneTasks() {
  const list = lsGet(lsKey("tasks"));
  const next = list.filter(x => !(x.type !== "agenda" && x.done === true));
  lsSet(lsKey("tasks"), next);
  return Promise.resolve(true);
}

function clearAgendaItems() {
  const list = lsGet(lsKey("tasks"));
  const next = list.filter(x => x.type !== "agenda");
  lsSet(lsKey("tasks"), next);
  return Promise.resolve(true);
}

function ensureNode(title) {
  title = cleanTitle(title);
  if (!title) return Promise.resolve(false);

  const list = lsGet(lsKey("nodes"));
  const hit = list.find(x => (x.title || "").toLowerCase() === title.toLowerCase());
  if (!hit) {
    list.push({ id: uid(), profileId: currentProfile, title, createdAt: new Date().toISOString() });
    lsSet(lsKey("nodes"), list);
  }
  return Promise.resolve(true);
}

// ---------- Parsing ----------
const ACTION_VERBS = [
  "bel","mail","stuur","plan","maak","vraag","check","controleer","regel","boek","koop","betaal",
  "herinner","breng","haal","bestel","fix","neem","schrijf","werk","overleg","vergader","contacteer"
];

function splitSentences(raw) {
  return String(raw || "")
    .split(/[\n;\.]+/g)
    .map(s => cleanTitle(s))
    .filter(Boolean);
}

function detectDue(text) {
  const t = String(text || "").toLowerCase();
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

function extractTags(text) {
  const t = String(text || "").trim();
  const tags = new Set();

  const m = t.match(/tag:\s*([a-zA-Z0-9à-žÀ-Ž _-]+)/i);
  if (m) tags.add(cleanTitle(m[1]));

  const low = t.toLowerCase();

  const rules = [
    { k: ["cbs","college","schepencollege","college van burgemeester en schepenen"], tag: "CBS" },
    { k: ["communicatie","facebook","instagram","post","bericht","aankondiging"], tag: "Communicatie" },
    { k: ["persbericht","persmededeling","media","journalist","krant","radio","tv"], tag: "Persbericht" },
    { k: ["te bespreken","agendapunt","agenda"], tag: "Te bespreken" }
  ];

  for (const r of rules) {
    if (r.k.some(x => low.includes(x))) tags.add(r.tag);
  }

  // optioneel thema’s (mag blijven)
  const themes = [
    { k: ["wegen","fietspad","mobiliteit","trage wegen","signalisatie"], tag: "Mobiliteit" },
    { k: ["school","onderwijs","bko","kinderopvang"], tag: "Onderwijs" },
    { k: ["sport","club","hal"], tag: "Sport" },
    { k: ["cultuur","santro","evenement","libbeke"], tag: "Cultuur/Events" },
    { k: ["privé","gezin","thuis"], tag: "Thuis" }
  ];
  for (const r of themes) {
    if (r.k.some(x => low.includes(x))) tags.add(r.tag);
  }

  return [...tags];
}

function classifySentence(s) {
  const low = String(s || "").toLowerCase();

  if (low.includes("te bespreken") || low.startsWith("te bespreken")) return "agenda";
  if (low.startsWith("idee") || low.startsWith("misschien")) return "idea";

  const first = low.split(" ")[0];
  if (ACTION_VERBS.includes(first)) return "task";
  if (low.includes("moet")) return "task";

  return "note";
}

function parseInput(raw) {
  const parts = splitSentences(raw);
  const tasks = [];

  for (const p of parts) {
    const kind = classifySentence(p);
    const due = detectDue(p);
    const tags = extractTags(p);

    if (kind === "task") {
      tasks.push({ title: p, dueAt: due, tags, type: "task" });
    } else if (kind === "agenda") {
      tasks.push({ title: p, dueAt: null, tags: [...new Set([...(tags||[]), "Te bespreken"])], type: "agenda" });
    } else if (kind === "idea") {
      // idee -> geen taak, wel onderwerp
      (tags||[]).forEach(tag => ensureNode(tag));
    } else {
      // note -> alleen onderwerpen
      (tags||[]).forEach(tag => ensureNode(tag));
    }
  }
  return { tasks };
}

// ---------- UI ----------
function setProfileUI() {
  $("profileWork").classList.toggle("active", currentProfile === PROFILES.work.id);
  $("profilePrivate").classList.toggle("active", currentProfile === PROFILES.priv.id);
}

async function render() {
  setProfileUI();

  const [inboxAll, tasksAll, nodesAll] = await Promise.all([getAllInbox(), getAllTasks(), getAllNodes()]);

  const inbox = inboxAll
    .filter(x => x.profileId === currentProfile)
    .sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const items = tasksAll
    .filter(x => x.profileId === currentProfile);

  const agendaItems = items
    .filter(x => x.type === "agenda")
    .sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const tasks = items
    .filter(x => x.type !== "agenda")
    .sort((a,b) => (a.done === b.done
      ? (String(a.dueAt||"").localeCompare(String(b.dueAt||"")))
      : (a.done - b.done)));

  const nodes = (nodesAll || []).filter(x => x.profileId === currentProfile);

  // Agenda
  const agendaEl = $("agenda");
  if (!agendaItems.length) {
    agendaEl.innerHTML = `<div class="small">Nog geen agendapunten.</div>`;
  } else {
    agendaEl.innerHTML = "";
    for (const a of agendaItems) {
      const div = document.createElement("div");
      div.style.margin = "10px 0";
     div.innerHTML = `
  <div>
    <b>•</b> ${escapeHtml(a.title)}
    <button class="secondary" data-del="${a.id}" style="padding:6px 10px; border-radius:10px; margin-left:8px;">Verwijder</button>

          ${(a.tags||[]).slice(0,3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="small">${escapeHtml(formatDate(a.createdAt))}</div>
      `;
      agendaEl.appendChild(div);
        div.querySelector("[data-del]")?.addEventListener("click", async (e) => {
      await deleteItemById(e.target.getAttribute("data-del"));
      render();
    });
}
  }

  // Tasks
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
          <div style="${t.done ? "text-decoration:line-through; color:#777" : ""}">${escapeHtml(t.title)} <button class="secondary" data-del="${t.id}" style="padding:6px 10px; border-radius:10px; margin-left:8px;">Verwijder</button>

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
    tasksEl.querySelectorAll("button[data-del]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        await deleteItemById(e.target.getAttribute("data-del"));
        render();
      });
    });

  // Mindmap (tags)
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
$("clearDone").addEventListener("click", async () => {
  await clearDoneTasks();
  render();
});

$("clearAgenda").addEventListener("click", async () => {
  await clearAgendaItems();
  render();
});

$("add").addEventListener("click", async () => {
  const raw = $("input").value.trim();
  if (!raw) return;

  setStatus("Bezig...");
  $("input").value = "";

  try {
    const inboxItem = await addInboxItem(raw);
    const parsed = parseInput(raw);

    // nodes (tags) bijhouden
    const tagsSeen = new Set();
    for (const t of parsed.tasks) (t.tags||[]).forEach(x => tagsSeen.add(x));
    for (const tag of tagsSeen) await ensureNode(tag);

    // taken + agenda opslaan
    for (const t of parsed.tasks) await addTask(t, inboxItem.id);

    setStatus("Opgeslagen.");
    setTimeout(() => setStatus(""), 1200);
    render();
  } catch (e) {
    setStatus("Fout: " + (e?.message || String(e)));
  }
});

render();
