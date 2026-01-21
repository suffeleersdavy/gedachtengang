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
      tasks.push({ title: p, dueAt: null, tags: [...new Set([...(tag]()]()
