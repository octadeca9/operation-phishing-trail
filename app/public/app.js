"use strict";

// Frontend tanpa dependency. TIDAK memuat jawaban/flag — semua divalidasi server.
const API = "/api/v1";
const CHALLENGE_ID = "operation-phishing-trail";

const state = {
  manifest: null,
  sessionId: null,
  maxScore: 0,
};

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data && data.error) || res.statusText;
    throw new Error(msg);
  }
  return data;
}

function randomKey() {
  return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
}

// ---------- Boot ----------
async function boot() {
  try {
    const res = await api("GET", `/challenges/${CHALLENGE_ID}`);
    state.manifest = res.challenge;
    state.maxScore = res.challenge.scoring.max_score;
    renderIntro();
  } catch (e) {
    $("introError").textContent = "Gagal memuat challenge: " + e.message;
  }
}

function renderIntro() {
  const m = state.manifest;
  $("introTitle").textContent = m.title;
  $("introMeta").textContent =
    `Difficulty: ${m.difficulty} · Estimasi: ${m.estimated_minutes} menit · Maks skor: ${m.scoring.max_score}`;
  $("introDesc").textContent = m.description;
  $("maxScoreVal").textContent = m.scoring.max_score;
}

$("startBtn").addEventListener("click", async () => {
  try {
    const s = await api("POST", "/sessions", { challenge_id: CHALLENGE_ID });
    onSession(s);
  } catch (e) {
    $("introError").textContent = "Gagal memulai sesi: " + e.message;
  }
});

function onSession(s) {
  state.sessionId = s.session_id;
  state.maxScore = s.max_score;
  $("intro").hidden = true;
  $("lab").hidden = false;
  $("scoreBox").hidden = false;
  updateScore(s);
  renderArtifacts();
  renderCheckpoints(s);
}

function updateScore(s) {
  $("scoreVal").textContent = s.score;
  $("maxScoreVal").textContent = state.maxScore;
  const pill = $("statusPill");
  pill.textContent = s.status;
  pill.className = "status-pill" + (s.status === "completed" ? " completed" : "");
}

// ---------- Artifacts ----------
function renderArtifacts() {
  const tabs = $("artifactTabs");
  tabs.textContent = "";
  state.manifest.artifacts.forEach((a, i) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (i === 0 ? " active" : "");
    btn.textContent = a.title;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      loadArtifact(a.id);
    });
    tabs.appendChild(btn);
  });
  if (state.manifest.artifacts[0]) loadArtifact(state.manifest.artifacts[0].id);
}

async function loadArtifact(artifactId) {
  const viewer = $("artifactViewer");
  viewer.textContent = "Memuat…";
  try {
    const res = await fetch(`${API}/sessions/${state.sessionId}/artifacts/${encodeURIComponent(artifactId)}`);
    const text = await res.text();
    // textContent → tidak ada HTML aktif / XSS.
    viewer.textContent = res.ok ? text : "Gagal memuat artefak (" + res.status + ").";
  } catch (e) {
    viewer.textContent = "Error: " + e.message;
  }
}

// ---------- Checkpoints ----------
function renderCheckpoints(session) {
  const list = $("checkpointList");
  list.textContent = "";
  state.manifest.objectives.forEach((obj) => {
    list.appendChild(buildCheckpoint(obj, session.checkpoints[obj.id]));
  });
  reflectCompletion(session);
}

function buildCheckpoint(obj, cpState) {
  const wrap = document.createElement("div");
  wrap.className = "checkpoint" + (cpState && cpState.correct ? " correct" : "");
  wrap.id = "cp-" + obj.id;

  const head = document.createElement("div");
  head.className = "cp-head";
  const h = document.createElement("h3");
  h.textContent = `${obj.id} · ${obj.title}`;
  const pts = document.createElement("span");
  pts.className = "cp-points";
  pts.textContent = `${obj.points} poin`;
  head.append(h, pts);
  wrap.appendChild(head);

  const prompt = document.createElement("p");
  prompt.className = "cp-prompt";
  prompt.textContent = obj.prompt;
  wrap.appendChild(prompt);

  const inputs = document.createElement("div");
  inputs.className = "cp-inputs";
  wrap.appendChild(inputs);

  const getAnswer = buildInputs(obj, inputs);

  const actions = document.createElement("div");
  actions.className = "cp-actions";
  const submitBtn = document.createElement("button");
  submitBtn.className = "btn primary";
  submitBtn.textContent = "Kirim";
  const hintBtn = document.createElement("button");
  hintBtn.className = "btn ghost";
  hintBtn.textContent = "Hint";
  actions.append(submitBtn, hintBtn);
  wrap.appendChild(actions);

  const feedback = document.createElement("div");
  feedback.className = "feedback";
  wrap.appendChild(feedback);

  const hintsBox = document.createElement("div");
  hintsBox.className = "hints";
  wrap.appendChild(hintsBox);

  if (cpState && cpState.correct) {
    feedback.textContent = `✓ Benar (+${cpState.points_awarded})`;
    feedback.className = "feedback ok";
    submitBtn.disabled = true;
  }

  submitBtn.addEventListener("click", async () => {
    feedback.textContent = "Mengirim…";
    feedback.className = "feedback";
    try {
      const answer = getAnswer();
      const res = await api("POST", `/sessions/${state.sessionId}/submissions`, {
        checkpoint_id: obj.id,
        answer,
        idempotency_key: randomKey(),
      });
      if (res.correct) {
        feedback.textContent = `✓ Benar (+${res.points_awarded})`;
        feedback.className = "feedback ok";
        wrap.classList.add("correct");
        submitBtn.disabled = true;
      } else {
        feedback.textContent = "✗ Belum tepat. Periksa kembali bukti pada artefak.";
        feedback.className = "feedback bad";
      }
      await refreshSession();
    } catch (e) {
      feedback.textContent = "Error: " + e.message;
      feedback.className = "feedback bad";
    }
  });

  hintBtn.addEventListener("click", async () => {
    try {
      const res = await api("POST", `/sessions/${state.sessionId}/hints`, { checkpoint_id: obj.id });
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = `Hint ${res.hint_level}: ${res.hint}`;
      hintsBox.appendChild(hint);
    } catch (e) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = e.message;
      hintsBox.appendChild(hint);
    }
  });

  return wrap;
}

function buildInputs(obj, container) {
  if (obj.type === "structured") {
    const fields = obj.fields || [];
    const refs = {};
    fields.forEach((f) => {
      const g = document.createElement("div");
      g.className = "field";
      const lab = document.createElement("label");
      lab.textContent = f.label;
      const inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = f.placeholder || "";
      g.append(lab, inp);
      container.appendChild(g);
      refs[f.id] = inp;
    });
    return () => {
      const out = {};
      Object.keys(refs).forEach((k) => (out[k] = refs[k].value));
      return out;
    };
  }

  if (obj.type === "exact_match") {
    const f = obj.field || { label: "Jawaban", id: "url" };
    const g = document.createElement("div");
    g.className = "field";
    const lab = document.createElement("label");
    lab.textContent = f.label;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = f.placeholder || "";
    g.append(lab, inp);
    container.appendChild(g);
    return () => ({ url: inp.value });
  }

  if (obj.type === "multi_select" || obj.type === "single_select") {
    const name = "cp_" + obj.id;
    const inputs = [];
    (obj.options || []).forEach((o) => {
      const row = document.createElement("label");
      row.className = "opt";
      const inp = document.createElement("input");
      inp.type = obj.type === "multi_select" ? "checkbox" : "radio";
      inp.name = name;
      inp.value = o.id;
      const span = document.createElement("span");
      span.textContent = o.label;
      row.append(inp, span);
      container.appendChild(row);
      inputs.push(inp);
    });
    return () => {
      if (obj.type === "single_select") {
        const sel = inputs.find((i) => i.checked);
        return { option: sel ? sel.value : "" };
      }
      return inputs.filter((i) => i.checked).map((i) => i.value);
    };
  }

  return () => ({});
}

async function refreshSession() {
  const s = await api("GET", `/sessions/${state.sessionId}`);
  updateScore(s);
  reflectCompletion(s);
}

function reflectCompletion(session) {
  const box = $("completionBox");
  if (session.status === "completed") {
    box.hidden = false;
    $("finalScore").textContent = `${session.score} / ${state.maxScore}`;
  } else {
    box.hidden = true;
  }
}

$("walkthroughBtn").addEventListener("click", async () => {
  const viewer = $("walkthroughViewer");
  try {
    const res = await fetch(`${API}/sessions/${state.sessionId}/walkthrough`);
    const text = await res.text();
    viewer.textContent = res.ok ? text : "Walkthrough belum tersedia.";
    viewer.hidden = false;
  } catch (e) {
    viewer.textContent = "Error: " + e.message;
    viewer.hidden = false;
  }
});

$("resetBtn").addEventListener("click", async () => {
  if (!confirm("Reset sesi ini? Progres checkpoint pada sesi ini akan dihapus.")) return;
  try {
    const s = await api("POST", `/sessions/${state.sessionId}/reset`, {});
    onSession(s);
    $("walkthroughViewer").hidden = true;
  } catch (e) {
    alert("Gagal reset: " + e.message);
  }
});

boot();
