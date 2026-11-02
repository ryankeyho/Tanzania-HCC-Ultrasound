/* Reviewer comments on course pages.
   Select text (or use "Comment on figure"), pick a category, write a note.
   Reviewers see only their own comments. Instructors and admins see everyone's. */
(function () {
  "use strict";
  var PAGE = location.pathname.split("/").pop();
  if (!/^[a-z0-9][a-z0-9\-]*\.html$/.test(PAGE)) return;
  var ROOT = document.querySelector(".lp-mod") || document.querySelector(".site-shell");
  if (!ROOT) return;

  var state = { me: null, staff: false, cats: {}, items: [], csrf: null, guest: false };

  function api(path, method, body) {
    var h = { "Content-Type": "application/json" };
    if (method && method !== "GET" && state.csrf) h["X-CSRF-Token"] = state.csrf;
    return fetch(path, { method: method || "GET", headers: h, credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ("Request failed (" + r.status + ")")); e.status = r.status; throw e; }
        return d; }); });
  }

  /* ---------------------------------------------------------- styles */
  var css = document.createElement("style");
  css.textContent =
    "mark.lp-cm{background:rgba(255,214,102,.30);color:inherit;border-bottom:2px solid #ffd666;border-radius:2px;cursor:pointer;padding:0}" +
    "mark.lp-cm.lp-cm-resolved{background:rgba(120,200,150,.20);border-bottom-color:#78c896}" +
    "mark.lp-cm.lp-cm-declined{background:rgba(160,160,170,.18);border-bottom-color:#9a9aa6}" +
    "mark.lp-cm.lp-cm-flash,.lp-cm-fig.lp-cm-flash{outline:3px solid #ffd666;outline-offset:2px}" +
    "figure.lp-cm-fig{position:relative;box-shadow:0 0 0 2px rgba(255,214,102,.65);border-radius:4px}" +
    ".lp-cm-figbtn{position:absolute;top:6px;right:6px;z-index:6;background:#1b2430;color:#e8edf3;border:1px solid #3a4a5e;border-radius:6px;padding:4px 8px;font:600 12px system-ui,sans-serif;cursor:pointer;opacity:.85}" +
    ".lp-cm-figbtn:hover,.lp-cm-figbtn:focus-visible{opacity:1;outline:2px solid #ffd666}" +
    "#lp-cm-fab{position:absolute;z-index:10000;display:none;background:#ffd666;color:#10151c;border:0;border-radius:6px;padding:7px 12px;font:700 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)}" +
    "#lp-cm-box{position:fixed;z-index:10001;left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:#141b24;color:#e8edf3;border:1px solid #3a4a5e;border-radius:10px;padding:16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);display:none}" +
    "#lp-cm-box h4{margin:0 0 8px;font:700 15px system-ui,sans-serif;border:0;color:#fff}" +
    "#lp-cm-box blockquote{margin:0 0 10px;padding:6px 10px;border-left:3px solid #ffd666;background:#1b2430;color:#cdd6e0;font-size:13px;max-height:90px;overflow:auto;white-space:pre-wrap}" +
    "#lp-cm-box label{display:block;font-weight:600;margin:8px 0 3px;color:#a9b6c6;font-size:12px;text-transform:uppercase;letter-spacing:.04em}" +
    "#lp-cm-box select,#lp-cm-box textarea{width:100%;box-sizing:border-box;background:#0e141b;color:#e8edf3;border:1px solid #3a4a5e;border-radius:6px;padding:8px;font:inherit}" +
    "#lp-cm-box textarea{min-height:96px;resize:vertical}" +
    "#lp-cm-box .lp-cm-row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}" +
    "#lp-cm-box button,#lp-cm-panel button{font:600 13px system-ui,sans-serif;border-radius:6px;padding:7px 12px;cursor:pointer;border:1px solid #3a4a5e;background:#1b2430;color:#e8edf3}" +
    "#lp-cm-box button.lp-cm-primary{background:#ffd666;color:#10151c;border-color:#ffd666}" +
    "#lp-cm-err{color:#ff9b9b;margin-top:6px;min-height:1em}" +
    "#lp-cm-panel{position:fixed;left:14px;bottom:14px;z-index:9998;width:min(360px,calc(100vw - 28px));font:14px/1.4 system-ui,sans-serif;color:#e8edf3}" +
    "#lp-cm-list{display:none;margin-bottom:8px;background:#141b24;border:1px solid #3a4a5e;border-radius:8px;max-height:60vh;overflow:auto;padding:6px}" +
    ".lp-cm-open #lp-cm-list{display:block}" +
    ".lp-cm-item{border-left:4px solid #ffd666;background:#18212c;margin:6px 0;padding:8px 10px;border-radius:4px}" +
    ".lp-cm-item.lp-cm-resolved{border-left-color:#78c896}.lp-cm-item.lp-cm-declined{border-left-color:#9a9aa6}" +
    ".lp-cm-item .q{color:#a9b6c6;font-size:12px;margin:2px 0 4px;cursor:pointer;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
    ".lp-cm-item .m{font-size:12px;color:#a9b6c6}.lp-cm-item .b{white-space:pre-wrap;margin:4px 0}" +
    ".lp-cm-item .note{border-top:1px dashed #3a4a5e;margin-top:6px;padding-top:6px;color:#cde8d6;font-size:13px}" +
    ".lp-cm-item .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}" +
    ".lp-cm-item .acts button,.lp-cm-item .acts select,.lp-cm-item .acts input{font:600 12px system-ui,sans-serif;padding:4px 8px;border-radius:5px;border:1px solid #3a4a5e;background:#1b2430;color:#e8edf3}" +
    ".lp-cm-item .acts input{font-weight:400;flex:1;min-width:120px}" +
    ".lp-cm-empty{padding:8px;color:#a9b6c6}" +
    "#lp-cm-hint{position:fixed;left:14px;bottom:60px;z-index:9997;max-width:300px;background:#1b2430;color:#e8edf3;border:1px solid #ffd666;border-radius:8px;padding:8px 12px;font:13px/1.4 system-ui,sans-serif;display:none}";
  document.head.appendChild(css);

  /* ---------------------------------------------------------- text index */
  function skip(node) {
    for (var n = node.parentNode; n && n !== ROOT; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      var t = n.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "IFRAME" || t === "SVG" || t === "BUTTON" || t === "SELECT" || t === "TEXTAREA") return true;
      if (n.classList && (n.classList.contains("lp-rv-badge") || n.classList.contains("lp-cm-figbtn"))) return true;
      if (n.id === "lp-rv-panel" || n.id === "lp-cm-panel" || n.id === "lp-cm-box") return true;
    }
    return false;
  }
  function textNodes() {
    var out = [], w = document.createTreeWalker(ROOT, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) { if (!skip(n)) out.push(n); }
    return out;
  }
  function index() {
    var nodes = textNodes(), pos = 0, map = [];
    nodes.forEach(function (n) { map.push({ node: n, start: pos, end: pos + n.nodeValue.length }); pos += n.nodeValue.length; });
    return { map: map, text: map.map(function (m) { return m.node.nodeValue; }).join("") };
  }
  function offsetOf(ix, container, off, isEnd) {
    for (var i = 0; i < ix.map.length; i++) {
      var m = ix.map[i];
      if (m.node === container) return m.start + off;
    }
    // container is an element: choose by document order
    for (var j = 0; j < ix.map.length; j++) {
      var m2 = ix.map[j];
      var rel = container.compareDocumentPosition(m2.node);
      var inside = container.contains(m2.node);
      if (inside) {
        // child index based
        var child = container.childNodes[off];
        if (child && (child === m2.node || child.contains(m2.node) || (child.compareDocumentPosition(m2.node) & Node.DOCUMENT_POSITION_FOLLOWING))) return isEnd ? m2.start : m2.start;
      } else if (rel & Node.DOCUMENT_POSITION_FOLLOWING) {
        return m2.start;
      }
    }
    return ix.text.length;
  }
  function selectionAnchor() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!ROOT.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== ROOT) return null;
    var ix = index();
    var s = offsetOf(ix, r.startContainer, r.startOffset, false);
    var e = offsetOf(ix, r.endContainer, r.endOffset, true);
    if (e < s) { var t = s; s = e; e = t; }
    // trim whitespace
    while (s < e && /\s/.test(ix.text.charAt(s))) s++;
    while (e > s && /\s/.test(ix.text.charAt(e - 1))) e--;
    if (e - s < 2) return null;
    if (e - s > 1200) e = s + 1200;
    return { kind: "text", quote: ix.text.slice(s, e), prefix: ix.text.slice(Math.max(0, s - 40), s), suffix: ix.text.slice(e, e + 40), rect: r.getBoundingClientRect() };
  }
  function locate(ix, c) {
    var q = c.quote, idx = -1, best = -1, from = 0, hit;
    while ((hit = ix.text.indexOf(q, from)) !== -1) {
      var score = 0;
      if (c.prefix && ix.text.slice(Math.max(0, hit - c.prefix.length), hit) === c.prefix) score += 2;
      if (c.suffix && ix.text.slice(hit + q.length, hit + q.length + c.suffix.length) === c.suffix) score += 2;
      if (score > best) { best = score; idx = hit; }
      from = hit + 1;
    }
    return idx;
  }

  /* ---------------------------------------------------------- highlights */
  function unwrapAll() {
    document.querySelectorAll("mark.lp-cm").forEach(function (m) {
      var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize();
    });
    document.querySelectorAll("figure.lp-cm-fig").forEach(function (f) { f.classList.remove("lp-cm-fig"); f.removeAttribute("data-cm"); });
  }
  function wrapRange(c) {
    var ix = index(), s = locate(ix, c);
    if (s < 0) return false;
    var e = s + c.quote.length, parts = [];
    ix.map.forEach(function (m) {
      if (m.end <= s || m.start >= e) return;
      parts.push({ node: m.node, a: Math.max(s, m.start) - m.start, b: Math.min(e, m.end) - m.start });
    });
    parts.forEach(function (p) {
      if (!p.node.nodeValue.slice(p.a, p.b).trim()) return;
      var r = document.createRange();
      r.setStart(p.node, p.a); r.setEnd(p.node, p.b);
      var mk = document.createElement("mark");
      mk.className = "lp-cm lp-cm-" + c.status; mk.setAttribute("data-cm", c.id);
      mk.title = (c.category_label || "Comment") + ": " + c.comment;
      try { r.surroundContents(mk); } catch (err) { /* skip fragment that crosses elements */ }
    });
    return true;
  }
  function figureFor(c) {
    var im = document.querySelector('figure img[src$="' + c.quote.replace(/"/g, "") + '"]');
    return im ? im.closest("figure") : null;
  }
  function paint() {
    unwrapAll();
    state.items.forEach(function (c) {
      c.placed = false;
      if (c.kind === "figure") {
        var f = figureFor(c);
        if (f) { f.classList.add("lp-cm-fig"); f.setAttribute("data-cm", c.id); c.placed = true; }
      } else {
        c.placed = wrapRange(c);
      }
    });
    document.querySelectorAll("mark.lp-cm").forEach(function (m) {
      m.addEventListener("click", function (ev) { ev.stopPropagation(); openPanel(true); focusItem(m.getAttribute("data-cm")); });
    });
  }

  /* ---------------------------------------------------------- composer */
  var box = document.createElement("div"); box.id = "lp-cm-box"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  document.body.appendChild(box);
  var fab = document.createElement("button"); fab.id = "lp-cm-fab"; fab.type = "button"; fab.textContent = "Add comment";
  document.body.appendChild(fab);
  var pending = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }
  function catOptions(sel) {
    return Object.keys(state.cats).map(function (k) { return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + esc(state.cats[k]) + "</option>"; }).join("");
  }
  function openComposer(anchor, existing) {
    pending = anchor;
    var q = existing ? existing.quote : anchor.quote;
    box.innerHTML = "<h4>" + (existing ? "Edit comment" : "Add a comment") + "</h4>" +
      "<blockquote>" + esc(anchor && anchor.kind === "figure" ? "Figure: " + anchor.quote : (existing && existing.kind === "figure" ? "Figure: " + q : q)) + "</blockquote>" +
      '<label for="lp-cm-cat">What kind of comment</label><select id="lp-cm-cat">' + catOptions(existing ? existing.category : "needs_revision") + "</select>" +
      '<label for="lp-cm-txt">Your comment</label><textarea id="lp-cm-txt" placeholder="For example: this is confusing because... / the diagram does not match the text..."></textarea>' +
      '<div id="lp-cm-err" role="alert"></div>' +
      '<div class="lp-cm-row"><button type="button" id="lp-cm-cancel">Cancel</button><button type="button" class="lp-cm-primary" id="lp-cm-save">Save comment</button></div>';
    box.style.display = "block";
    var ta = document.getElementById("lp-cm-txt");
    if (existing) ta.value = existing.comment;
    ta.focus();
    document.getElementById("lp-cm-cancel").onclick = closeComposer;
    document.getElementById("lp-cm-save").onclick = function () {
      var txt = ta.value.trim(), cat = document.getElementById("lp-cm-cat").value, err = document.getElementById("lp-cm-err");
      if (!txt) { err.textContent = "Please write a comment."; return; }
      var btn = this; btn.disabled = true;
      var req = existing
        ? api("/api/comments/" + existing.id, "PUT", { comment: txt, category: cat })
        : api("/api/comments", "POST", { page: PAGE, kind: anchor.kind, quote: anchor.quote, prefix: anchor.prefix || "", suffix: anchor.suffix || "", category: cat, comment: txt });
      req.then(function () { closeComposer(); return reload(); }).then(function () { openPanel(true); })
        .catch(function (e) { btn.disabled = false; err.textContent = e.message; });
    };
  }
  function closeComposer() { box.style.display = "none"; box.innerHTML = ""; pending = null; var s = window.getSelection(); if (s) s.removeAllRanges(); fab.style.display = "none"; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && box.style.display === "block") closeComposer(); });

  /* selection button */
  var cur = null;
  function maybeShowFab() {
    if (box.style.display === "block") return;
    var a = selectionAnchor();
    if (!a || !state.me) { fab.style.display = "none"; cur = null; return; }
    cur = a;
    fab.style.display = "block";
    var top = window.scrollY + a.rect.bottom + 8, left = window.scrollX + Math.min(a.rect.left, window.innerWidth - 130);
    fab.style.top = top + "px"; fab.style.left = Math.max(8, left) + "px";
  }
  document.addEventListener("mouseup", function (e) { if (e.target === fab) return; setTimeout(maybeShowFab, 10); });
  document.addEventListener("touchend", function () { setTimeout(maybeShowFab, 250); });
  document.addEventListener("keyup", function (e) { if (e.key === "Shift" || e.key.indexOf("Arrow") === 0) maybeShowFab(); });
  document.addEventListener("selectionchange", function () { var s = window.getSelection(); if (!s || s.isCollapsed) fab.style.display = "none"; });
  fab.addEventListener("mousedown", function (e) { e.preventDefault(); });
  fab.addEventListener("click", function () {
    if (state.guest) { hint("Guest sessions cannot leave comments. Please create an account to comment."); return; }
    if (cur) { var a = cur; fab.style.display = "none"; openComposer(a); }
  });

  /* ---------------------------------------------------------- figures */
  function addFigureButtons() {
    document.querySelectorAll(".lp-mod figure").forEach(function (f) {
      if (f.querySelector(".lp-cm-figbtn")) return;
      var im = f.querySelector("img");
      if (!im) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "lp-cm-figbtn"; b.textContent = "Comment on figure";
      b.addEventListener("click", function () {
        if (state.guest) { hint("Guest sessions cannot leave comments. Please create an account to comment."); return; }
        var name = (im.getAttribute("src") || "").split("/").pop();
        openComposer({ kind: "figure", quote: name, prefix: "", suffix: "" });
      });
      if (getComputedStyle(f).position === "static") f.style.position = "relative";
      f.insertBefore(b, f.firstChild);
    });
  }

  /* ---------------------------------------------------------- panel */
  var panel = document.createElement("div"); panel.id = "lp-cm-panel";
  var list = document.createElement("div"); list.id = "lp-cm-list";
  var tog = document.createElement("button"); tog.type = "button"; tog.id = "lp-cm-tog";
  panel.appendChild(list); panel.appendChild(tog); document.body.appendChild(panel);
  var hintEl = document.createElement("div"); hintEl.id = "lp-cm-hint"; document.body.appendChild(hintEl);
  function hint(t) { hintEl.textContent = t; hintEl.style.display = "block"; setTimeout(function () { hintEl.style.display = "none"; }, 5000); }
  function openPanel(on) { document.body.classList.toggle("lp-cm-open", on); }
  tog.addEventListener("click", function () { openPanel(!document.body.classList.contains("lp-cm-open")); });

  function focusItem(id) {
    var el = list.querySelector('[data-id="' + id + '"]');
    if (el) { el.scrollIntoView({ block: "nearest" }); }
    var tgt = document.querySelector('mark.lp-cm[data-cm="' + id + '"], figure.lp-cm-fig[data-cm="' + id + '"]');
    if (tgt) { tgt.scrollIntoView({ behavior: "smooth", block: "center" }); tgt.classList.add("lp-cm-flash"); setTimeout(function () { tgt.classList.remove("lp-cm-flash"); }, 1600); }
  }
  function render() {
    tog.textContent = (state.staff ? "All comments" : "My comments") + " (" + state.items.length + ")";
    if (!state.items.length) {
      list.innerHTML = '<div class="lp-cm-empty">' + (state.guest ? "Guest sessions cannot leave comments. Create an account to comment." : "No comments on this page yet. Select any text, or use Comment on figure, to add one.") + "</div>";
      return;
    }
    list.innerHTML = "";
    state.items.forEach(function (c) {
      var own = c.user_id === state.me;
      var el = document.createElement("div"); el.className = "lp-cm-item lp-cm-" + c.status; el.setAttribute("data-id", c.id);
      var who = state.staff ? esc(c.author) + " &middot; " : "";
      el.innerHTML = '<div class="m">' + who + esc(c.category_label) + " &middot; " + esc(c.status) + (c.placed ? "" : " &middot; text has changed") + "</div>" +
        '<div class="q">' + esc(c.kind === "figure" ? "Figure: " + c.quote : c.quote) + "</div>" +
        '<div class="b">' + esc(c.comment) + "</div>" +
        (c.admin_note ? '<div class="note"><strong>Reply:</strong> ' + esc(c.admin_note) + "</div>" : "");
      el.querySelector(".q").addEventListener("click", function () { focusItem(c.id); });
      var acts = document.createElement("div"); acts.className = "acts";
      if (own) {
        var eb = document.createElement("button"); eb.type = "button"; eb.textContent = "Edit";
        eb.onclick = function () { openComposer({ kind: c.kind, quote: c.quote }, c); };
        var db = document.createElement("button"); db.type = "button"; db.textContent = "Delete";
        db.onclick = function () { if (confirm("Delete this comment?")) api("/api/comments/" + c.id, "DELETE").then(reload).catch(function (e) { hint(e.message); }); };
        acts.appendChild(eb); acts.appendChild(db);
      }
      if (state.staff) {
        var sel = document.createElement("select");
        ["open", "resolved", "declined"].forEach(function (s) { var o = document.createElement("option"); o.value = s; o.textContent = s; if (s === c.status) o.selected = true; sel.appendChild(o); });
        var note = document.createElement("input"); note.type = "text"; note.placeholder = "Reply or note"; note.value = c.admin_note || "";
        var sv = document.createElement("button"); sv.type = "button"; sv.textContent = "Save";
        sv.onclick = function () { api("/api/comments/" + c.id, "PUT", { status: sel.value, admin_note: note.value }).then(reload).catch(function (e) { hint(e.message); }); };
        acts.appendChild(sel); acts.appendChild(note); acts.appendChild(sv);
        if (!own) { var dl = document.createElement("button"); dl.type = "button"; dl.textContent = "Delete"; dl.onclick = function () { if (confirm("Delete this comment?")) api("/api/comments/" + c.id, "DELETE").then(reload).catch(function (e) { hint(e.message); }); }; if (state.role === "admin") acts.appendChild(dl); }
      }
      if (acts.children.length) el.appendChild(acts);
      list.appendChild(el);
    });
  }
  function reload() {
    return api("/api/comments?page=" + encodeURIComponent(PAGE)).then(function (d) {
      state.items = d.comments; state.me = d.me; state.staff = d.staff; state.cats = d.categories; state.enabled = d.enabled !== false;
      paint(); render();
    });
  }

  /* ---------------------------------------------------------- start */
  api("/api/me").then(function (d) {
    if (!d.user) return;
    state.csrf = d.csrf; state.role = d.user.role; state.guest = d.user.email === "guest@demo.local";
    state.me = d.user.id;
    return reload().then(function () {
      if (!state.enabled) { [panel, fab, box, hintEl].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); return; }
      addFigureButtons();
      var m = /^#comment-(\d+)$/.exec(location.hash);
      if (m) { openPanel(true); setTimeout(function () { focusItem(m[1]); }, 400); }
    });
  }).catch(function () { /* not signed in: nothing to show */ });
})();
