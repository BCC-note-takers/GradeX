/* Note Archive viewer. Reads the public mirror directly from raw.githubusercontent.com. */
(() => {
  "use strict";

  // Filled in for this deployment: owner and repo of the public mirror.
  // Normally worked out from this page's own address (owner.github.io/repo/), so nothing to edit.
  // Only if the app is opened from somewhere else are these fallback values used.
  const FALLBACK = { owner: "BCC-note-takers", repo: "GradeX", branch: "main" };
  const onPages = location.hostname.endsWith(".github.io");
  const repoSeg = location.pathname.split("/")[1] || "";
  const MIRROR = onPages && repoSeg
    ? { owner: location.hostname.split(".")[0], repo: repoSeg, branch: FALLBACK.branch }
    : FALLBACK;
  const BASE = `https://raw.githubusercontent.com/${MIRROR.owner}/${MIRROR.repo}/${MIRROR.branch}/`;

  const $ = (id) => document.getElementById(id);
  const status = (text, err = false) => { const s = $("status"); s.textContent = text; s.className = err ? "err" : ""; };

  // ---------- selective link scrubbing (mirrors scripts/sanitize_sync.py) ----------
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  // Any YouTube URL anywhere in a note is removed (a "[label](url)" link is replaced whole).
  const YT_URL = "\\b(?:https?:\\/\\/)?(?:[\\w-]+\\.)*(?:youtube\\.com|youtu\\.be|youtube-nocookie\\.com)(?:\\/[^\\s)\\]>\"']*)?";
  const YT_MD = new RegExp("\\[[^\\]]*\\]\\(\\s*" + YT_URL + "[^)]*\\)", "gi");
  const YT = new RegExp(YT_URL, "gi");

  const FM_URL = /^(youtube_url:\s*)\S.*$/;
  const DROP_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?:source[ _-]?audio|audio[ _-]?(?:files?|sources?)|recording[ _-]?(?:files?|sources?))\b.*$/i;
  const AUDIO_FILE = /[^\s`'"()\[\]<>]+\.(?:ogg|mp3|wav|m4a|opus|flac|aac)\b/gi;
  function scrubLinksSections(md, linksFile) {
    const out = [];
    let linksLevel = linksFile ? 0 : null;
    let corrLevel = null;                 // open "Corrections" section: YouTube links are kept only there
    for (const raw of md.split(/\r?\n/)) {
      if (DROP_LINE.test(raw)) continue;
      const line = raw.replace(AUDIO_FILE, "(removed)");
      if (line.trim() === "---") corrLevel = null;   // note boundary / header block closes the Corrections section
      const fm = line.match(FM_URL);
      if (fm) { out.push(fm[1] + "(link removed)"); continue; }
      const m = line.match(HEADING);
      if (m) {
        const level = m[1].length;
        if (linksLevel !== null && !linksFile && level <= linksLevel) linksLevel = null;
        if (m[2].trim().toLowerCase() === "links") linksLevel = level;
        if (corrLevel !== null && level <= corrLevel) corrLevel = null;
        if (m[2].toLowerCase().includes("correction")) corrLevel = level;
        out.push(line);
        continue;
      }
      if (corrLevel !== null && !linksFile) { out.push(line); continue; }
      out.push(line.replace(YT_MD, "(link removed)").replace(YT, "(link removed)"));
    }
    return out.join("\n");
  }

  // Each saved note starts with a --- header block; show it as a heading plus a small date/subject line.
  function prettyHeaders(md) {
    return md.replace(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/gm, (_, block) => {
      const get = (k) => (block.match(new RegExp("^" + k + ":\\s*(.*)$", "m")) || [, ""])[1].trim();
      const title = get("title"), meta = [get("date"), get("subject")].filter(Boolean).join(" · ");
      return (title ? `## ${title}\n` : "") + (meta ? `*${meta}*\n\n` : "");
    });
  }

  // ---------- tiny safe Markdown renderer (escape first, then format) ----------
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/_([^_]+)_/g, "<em>$1</em>");
    // Only http(s) links; everything else stays plain text.
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
    return s;
  }

  function render(md) {
    const lines = md.split(/\r?\n/);
    const html = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) { flushPara(); closeList(); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara(); closeList();
        const lvl = Math.min(h[1].length, 3);           // keep headings small on phones
        html.push(`<h${lvl}>${inline(h[2].replace(/\s*#+\s*$/, ""))}</h${lvl}>`);
        continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); closeList(); html.push("<hr>"); continue; }
      const q = line.match(/^>\s?(.*)$/);
      if (q) { flushPara(); closeList(); html.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
      const li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
      if (li) {
        flushPara();
        const kind = /\d/.test(li[1]) ? "ol" : "ul";
        if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
        html.push(`<li>${inline(li[2])}</li>`);
        continue;
      }
      closeList();
      para.push(line.trim());
    }
    flushPara(); closeList();
    return html.join("\n");
  }

  // ---------- data ----------
  let files = [];           // every "years/2026/months/month_10/week_1/subject.md"-style path

  const parts = (p) => {
    const m = p.match(/^years\/(\d{4})\/months\/(month_\d+)\/(week_\d+)\/(.+)\.md$/i);
    return m ? { year: m[1], month: m[2], week: m[3], subject: m[4] } : null;
  };

  const fill = (sel, values, label, pretty = (v) => v) => {
    sel.innerHTML = "";
    const first = document.createElement("option");
    first.value = ""; first.textContent = `— ${label} —`;
    sel.appendChild(first);
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v; o.textContent = pretty(v);
      sel.appendChild(o);
    }
    sel.disabled = values.length === 0;
  };

  const uniqueSorted = (arr, cmp) => [...new Set(arr)].sort(cmp);
  const byNum = (a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0);
  const norm = (s) => s.replace(/_/g, " ").trim().toLowerCase();

  function refreshPickers() {
    const y = $("year").value, mo = $("month").value, w = $("week").value;
    const items = files.map(parts).filter(Boolean);

    fill($("year"), uniqueSorted(items.map((i) => i.year), (a, b) => b.localeCompare(a)), "Year");
    if (y) $("year").value = y;

    const yr = $("year").value;
    fill($("month"), uniqueSorted(items.filter((i) => i.year === yr).map((i) => i.month), byNum), "Month",
      (v) => v.replace("month_", "Month "));
    if (mo) $("month").value = mo;

    const mv = $("month").value;
    fill($("week"), uniqueSorted(items.filter((i) => i.year === yr && i.month === mv).map((i) => i.week), byNum), "Week",
      (v) => v.replace("week_", "Week "));
    if (w) $("week").value = w;

    const wv = $("week").value;
    fill($("subject"), items.filter((i) => i.year === yr && i.month === mv && i.week === wv && i.subject.toLowerCase() !== "video_links").map((i) => i.subject)
      .sort((a, b) => a.localeCompare(b)), "Subject", (v) => v.replace(/_/g, " "));
  }

  function currentPath() {
    const y = $("year").value, m = $("month").value, w = $("week").value, s = $("subject").value;
    return (y && m && w && s) ? `years/${y}/months/${m}/${w}/${s}.md` : null;
  }

  const isLinksFile = (path) => /(^|\/)video_links\.md$/i.test(path);
  const cache = new Map();                              // path -> cleaned markdown
  const lowCache = new Map();                           // path -> lowercased markdown (built once, reused by search)
  const dates = new Map();                              // path -> "YYYY-MM-DD" from the note's date: line ("" if none)

  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function noteDate(raw) {
    const m = raw.match(/^date:\s*(.+)$/m);
    if (!m) return "";
    const s = m[1].trim();
    const direct = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const t = new Date(s);
    return isNaN(t) ? "" : isoDay(t);
  }

  async function getNote(path, fresh = false) {
    if (cache.has(path)) return cache.get(path);
    // Opening one note always revalidates; bulk search reads may use the browser cache (thousands of notes).
    const r = await fetch(BASE + encodeURI(path), fresh ? { cache: "no-cache" } : undefined);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.text();
    dates.set(path, noteDate(raw));
    const md = prettyHeaders(scrubLinksSections(raw, isLinksFile(path)));
    cache.set(path, md);
    lowCache.set(path, md.toLowerCase());
    return md;
  }

  async function show(path) {
    const note = $("note");
    status("Loading…");
    note.hidden = true;
    $("views").hidden = true;
    try {
      note.innerHTML = render(await getNote(path, true));
      note.hidden = false;
      status("");
      history.replaceState(null, "", "#" + encodeURIComponent(path));
      countRead(path);
    } catch (e) {
      status(`Could not load this note (${e.message}). Check your connection.`, true);
    }
  }

  function openPath(p) {
    const pt = parts(p);
    if (!pt) return;
    $("year").value = pt.year; refreshPickers();
    $("month").value = pt.month; refreshPickers();
    $("week").value = pt.week; refreshPickers();
    $("subject").value = pt.subject;
    show(p);
  }

  // ---------- filters ----------
  // F is the whole filter state. Time range is a preset or custom dates; subjects are multi-select chips.
  // Year / Month / Week pickers narrow the same search.
  const F = { range: "any", from: "", to: "", subjects: new Set() };
  const RANGE_LABEL = { any: "", week: "This week", month: "This month", "30": "Last 30 days", old: "Older than 3 months", custom: "Custom dates" };

  // Returns [from, to] as YYYY-MM-DD strings for a preset ("" = open-ended).
  function presetDates(r) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (r === "week") {
      const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return [isoDay(mon), isoDay(sun)];
    }
    if (r === "month") return [isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), isoDay(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
    if (r === "30") { const s = new Date(t); s.setDate(t.getDate() - 29); return [isoDay(s), isoDay(t)]; }
    if (r === "old") { const e = new Date(t); e.setDate(t.getDate() - 91); return ["", isoDay(e)]; }
    return ["", ""];
  }

  const customSubjects = () => { try { return JSON.parse(store.get("nv_custom_subjects") || "[]"); } catch (e) { return []; } };
  const saveCustomSubjects = (list) => store.set("nv_custom_subjects", JSON.stringify(list));

  const filtersActive = () => F.range !== "any" || F.subjects.size > 0 || !!(F.from || F.to);

  function updateFilterUI() {
    document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === F.range)));
    $("dates").hidden = F.range !== "custom";
    if (document.activeElement !== $("dfrom")) $("dfrom").value = F.from;
    if (document.activeElement !== $("dto")) $("dto").value = F.to;
    document.querySelectorAll("#subjChips .chip").forEach((b) => b.setAttribute("aria-pressed", String(F.subjects.has(b.dataset.term))));
    const bits = [];
    if (F.range !== "any") bits.push(F.range === "custom" ? `${F.from || "…"} → ${F.to || "…"}` : RANGE_LABEL[F.range]);
    if (F.subjects.size) bits.push([...F.subjects].join(", "));
    $("fsum").textContent = bits.length ? "Filtering: " + bits.join(" · ") : "No filters on";
  }

  function renderSubjects() {
    const names = new Set(customSubjects());
    for (const p of files) { const pt = parts(p); if (pt && !isLinksFile(p)) names.add(norm(pt.subject)); }
    const box = $("subjChips");
    box.innerHTML = "";
    for (const n of [...names].sort((a, b) => a.localeCompare(b))) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.term = n; b.textContent = n;
      if (customSubjects().includes(n) && !files.some((p) => parts(p) && norm(parts(p).subject) === n)) {
        const x = document.createElement("span"); x.className = "x"; x.textContent = "×"; x.title = "Remove this typed subject";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          saveCustomSubjects(customSubjects().filter((c) => c !== n));
          F.subjects.delete(n); renderSubjects(); applySearch();
        });
        b.appendChild(x);
      }
      b.addEventListener("click", () => {
        F.subjects.has(n) ? F.subjects.delete(n) : F.subjects.add(n);
        renderSubjects(); applySearch();
      });
      box.appendChild(b);
    }
    updateFilterUI();
  }

  function setRange(r) {
    F.range = r;
    if (r !== "custom") [F.from, F.to] = presetDates(r);
    applySearch();
  }

  // Candidate note files: the whole archive, narrowed only by the subject chips.
  // The Year / Month / Week pickers are for browsing and do not limit search or filters.
  function candidates() {
    const subs = [...F.subjects];
    return files.map((p) => ({ p, pt: parts(p) })).filter(({ p, pt }) => pt && !isLinksFile(p)
      && (!subs.length || subs.some((t) => norm(pt.subject).includes(t))));
  }

  // ---------- search + filter (one pass over the candidate notes) ----------
  let searchSeq = 0, searchTimer = null;
  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  async function applySearch() {
    updateFilterUI();
    const seq = ++searchSeq, box = $("results"), q = $("q").value.trim();
    const terms = q.length >= 2 ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];
    if (!terms.length && !filtersActive()) {
      box.hidden = true; box.innerHTML = "";
      if (!$("note").hidden || !files.length) status("");
      return;
    }
    const list = candidates();
    const needDate = !!(F.from || F.to);
    const needBody = terms.length > 0 || needDate;
    const hits = [];
    let i = 0, done = 0, paints = 0, lastPaint = 0;
    box.classList.remove("again");

    // Title/path matches rank first, then notes that mention the words more often.
    const scoreOf = (p, low) => {
      const path = p.toLowerCase();
      let s = 0;
      for (const t of terms) { if (path.includes(t)) s += 50; s += Math.min(25, low.split(t).length - 1); }
      return s;
    };

    const paint = (final) => {
      hits.sort((a, b) => (b.s - a.s) || (b.d || "").localeCompare(a.d || "") || b.p.localeCompare(a.p));
      const top = hits.slice(0, 40);
      box.innerHTML = "";
      box.classList.toggle("again", paints++ > 0);     // only the first paint animates
      for (const h of top) {
        const pt = parts(h.p);
        let snip = "";
        if (terms.length) {
          const at = Math.max(0, h.low.indexOf(terms[0]));
          const plain = h.md.slice(Math.max(0, at - 50), at + 140).replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
          snip = esc(plain);
          for (const t of terms) snip = snip.replace(new RegExp(escRe(esc(t)), "gi"), (m) => `<mark>${m}</mark>`);
        }
        const btn = document.createElement("button");
        btn.className = "hit"; btn.type = "button"; btn.dataset.path = h.p;
        const when = h.d ? `${esc(h.d)} · ` : "";
        btn.innerHTML = `<div class="where">${when}${esc(pt.year)} · ${esc(pt.month.replace("month_", "Month "))} · ${esc(pt.week.replace("week_", "Week "))} · ${esc(pt.subject.replace(/_/g, " "))}</div>` +
          (snip ? `<div class="snip">${snip}</div>` : "");
        box.appendChild(btn);
      }
      box.hidden = !top.length;
      status(final
        ? (hits.length ? `${hits.length} note${hits.length === 1 ? "" : "s"}${hits.length > 40 ? " (showing the top 40)" : ""}` : "No notes match.")
        : `Searching… ${done}/${list.length} · ${hits.length} found`);
    };

    // Subject-only or period-only filters with no date range and no words: no need to download the notes.
    if (!needBody) {
      for (const { p } of list) hits.push({ p, md: "", low: "", d: "", s: 0 });
      paint(true);
      return;
    }

    status(`Searching ${list.length} note file${list.length === 1 ? "" : "s"}…`);
    const worker = async () => {
      while (i < list.length && seq === searchSeq) {
        const { p } = list[i++];
        try {
          const md = await getNote(p), low = lowCache.get(p), d = dates.get(p) || "";
          const dateOk = !needDate || (d && (!F.from || d >= F.from) && (!F.to || d <= F.to));
          if (dateOk && terms.every((t) => low.includes(t))) hits.push({ p, md, low, d, s: terms.length ? scoreOf(p, low) : 0 });
        } catch (e) { /* skip files that fail to load */ }
        done++;
        const now = Date.now();
        if (seq === searchSeq && hits.length && now - lastPaint > 700) { lastPaint = now; paint(false); }
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));   // 10 notes at a time
    if (seq !== searchSeq) return;                      // a newer search replaced this one
    paint(true);
  }

  async function loadIndex() {
    try {
      const r = await fetch(BASE + "index.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      files = (await r.json()).files || [];
      refreshPickers();
      renderSubjects();
      status(files.length ? "" : "No notes yet.");
      const hash = decodeURIComponent(location.hash.slice(1));
      const p = parts(hash);
      if (p) openPath(hash);
    } catch (e) {
      status(`Could not load the note list (${e.message}) from ${MIRROR.owner}/${MIRROR.repo}. Has the sync finished?`, true);
    }
  }

  // Year / Month / Week pickers: browsing only. They change the Subject list and open-note view, not the search.
  ["year", "month", "week"].forEach((id) => $(id).addEventListener("change", () => {
    refreshPickers(); $("note").hidden = true;
  }));
  $("subject").addEventListener("change", () => { const p = currentPath(); if (p) show(p); });
  $("q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 250); });
  $("results").addEventListener("click", (e) => { const b = e.target.closest(".hit"); if (b) { openPath(b.dataset.path); window.scrollTo({ top: $("note").offsetTop - 10, behavior: "smooth" }); } });

  // Time-range chips and custom dates.
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => setRange(b.dataset.range)));
  const onDates = () => { F.range = "custom"; F.from = $("dfrom").value; F.to = $("dto").value; applySearch(); };
  $("dfrom").addEventListener("change", onDates);
  $("dto").addEventListener("change", onDates);

  // Typed subjects: any text, matched against subject names (e.g. "phys" finds "physics").
  const addSubject = () => {
    const t = norm($("subjAdd").value).slice(0, 40);
    if (!t) return;
    if (!customSubjects().includes(t)) saveCustomSubjects([...customSubjects(), t]);
    F.subjects.add(t);
    $("subjAdd").value = "";
    renderSubjects(); applySearch();
  };
  $("subjAddBtn").addEventListener("click", addSubject);
  $("subjAdd").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSubject(); } });

  // Clear: resets the When and Subject filters only; keeps the search words and the browsing pickers.
  $("fclear").addEventListener("click", () => {
    F.range = "any"; F.from = ""; F.to = ""; F.subjects.clear();
    renderSubjects(); applySearch();
  });

  // ---------- offline / PWA ----------
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // ---------- name gate + reader counter ----------
  // Paste the Apps Script web-app URL (see apps_script.gs) here. Empty = counter off, name prompt still runs.
  const COUNTER_URL = "https://script.google.com/macros/s/AKfycbylKAWq-CdXsN9cTLDzfNOHC6o6noJeEKV8U_87dqsqrCMdFufaKPGBehCnWgm0S9x6AA/exec";
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));

  async function ping(name, id) {
    if (!COUNTER_URL) return;
    try {
      const u = COUNTER_URL + "?action=hit&id=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(name);
      const r = await fetch(u);
      const d = await r.json();
      if (typeof d.reads === "number") setReads(d.reads);
      else if (typeof d.count === "number") $("count").textContent = `${d.count} reader${d.count === 1 ? "" : "s"}`;
    } catch (e) { /* counter is best-effort */ }
  }

  const setReads = (n) => { $("count").textContent = `👁 ${n.toLocaleString()} read${n === 1 ? "" : "s"}`; };

  // Every open of a note (including reopening it) adds one view to that note.
  // Best-effort: if the counter is off, offline, or slow, the note simply shows no badge.
  async function countRead(path) {
    const badge = $("views");
    if (!COUNTER_URL) return;
    const id = store.get("nv_id");
    if (!id) return;
    try {
      const r = await fetch(COUNTER_URL + "?action=read&id=" + encodeURIComponent(id) + "&path=" + encodeURIComponent(path));
      const d = await r.json();
      if (typeof d.reads === "number") setReads(d.reads);
      if (typeof d.views === "number" && currentPath() === path && !$("note").hidden) {
        badge.textContent = `👁 ${d.views.toLocaleString()} view${d.views === 1 ? "" : "s"}`;
        badge.hidden = false;
      }
    } catch (e) { /* counter is best-effort */ }
  }

  function startApp(name) {
    let id = store.get("nv_id");
    if (!id) { id = newId(); store.set("nv_id", id); }
    $("gate").hidden = true;
    $("app").hidden = false;
    ping(name, id);
    loadIndex();
  }

  function boot() {
    const saved = (store.get("nv_name") || "").trim();
    if (saved) return startApp(saved);
    $("app").hidden = true;
    $("gate").hidden = false;
    const go = () => {
      const n = $("gname").value.trim().slice(0, 60);
      if (n.length < 2) { $("gerr").textContent = "Enter a name (real name or nickname)."; return; }
      store.set("nv_name", n);
      startApp(n);
    };
    $("gbtn").addEventListener("click", go);
    $("gname").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    $("gname").focus();
  }

  boot();
})();
