/* Review highlights for course pages. Only runs for instructors and admins.
   Learners never receive the flag data: it comes from /api/admin/review-flags,
   which returns 403 to anyone else. */
(function () {
  "use strict";
  var KEY = "lp-review-on";
  function store(get, v) {
    try { if (get) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) {}
    return null;
  }

  function note(msg) {
    var d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:9999;max-width:340px;background:#3a1620;color:#ffd9d9;border:1px solid #ff6b6b;border-radius:6px;padding:8px 12px;font:14px/1.4 system-ui,sans-serif";
    document.body.appendChild(d);
  }
  // The server decides who may see the data: 403 for learners (nothing shown),
  // 404 means the server is still running an older build.
  fetch("/api/admin/review-flags", { credentials: "same-origin" })
    .then(function (r) {
      if (r.ok) return r.json().then(start);
      if (r.status === 404) note("Review items: this server is running an older build. Stop it and start it from the 1.17 folder.");
    })
    .catch(function (e) { note("Review items failed to load: " + e.message); });

  function start(data) {
    var page = location.pathname.split("/").pop();
    var flags = (data.pages[page] || []).slice();
    var labels = data.statuses;

    // automatic flags
    document.querySelectorAll(".lp-video-slot").forEach(function (el, i) {
      flags.push({ id: "Video " + (i + 1), status: "video", el: el,
        note: "Placeholder: add your Vscan Air CL video here." });
    });
    var hasSel = flags.some(function (f) { return f.anchor && f.anchor.sel; });
    if (!hasSel) {
      document.querySelectorAll("figure svg").forEach(function (el) {
        flags.push({ id: "Diagram", status: "check", el: el.closest("figure"),
          note: "Hand-drawn diagram: please check." });
      });
    }

    // resolve anchors
    flags.forEach(function (f) {
      if (f.el || !f.anchor || f.anchor.none) return;
      var a = f.anchor, el = null;
      if (a.img) {
        var im = document.querySelector('img[src$="' + a.img + '"]');
        el = im && (im.closest("figure") || im);
      } else if (a.sel) {
        var node = document.querySelector(a.sel);
        el = node && (node.closest("figure") || node);
      } else if (a.text) {
        var best = null;
        document.querySelectorAll("p, li, td, th, figcaption, h2, h3, h4, summary").forEach(function (n) {
          if (n.textContent.indexOf(a.text) !== -1) best = best || n;
        });
        el = best;
      }
      f.el = el;
    });

    var css = document.createElement("style");
    css.textContent =
      ".lp-rv-on .lp-rv{outline:2px solid var(--rv);outline-offset:3px;border-radius:3px;position:relative;background-image:linear-gradient(var(--rvbg),var(--rvbg))}" +
      ".lp-rv-badge{display:none;position:absolute;top:-11px;left:6px;z-index:5;background:var(--rv);color:#10151c;font:600 12px/1 system-ui,sans-serif;padding:4px 7px;border-radius:3px;cursor:help}" +
      ".lp-rv-on .lp-rv>.lp-rv-badge{display:block}" +
      ".lp-rv-fix{--rv:#ff6b6b;--rvbg:rgba(255,107,107,.10)}.lp-rv-source{--rv:#f2b84b;--rvbg:rgba(242,184,75,.10)}" +
      ".lp-rv-check{--rv:#5db7ff;--rvbg:rgba(93,183,255,.10)}.lp-rv-decision{--rv:#c39bff;--rvbg:rgba(195,155,255,.10)}" +
      ".lp-rv-local{--rv:#ff9f5a;--rvbg:rgba(255,159,90,.10)}.lp-rv-video{--rv:#4fd1a5;--rvbg:rgba(79,209,165,.10)}" +
      "#lp-rv-panel{position:fixed;right:14px;bottom:14px;z-index:9999;width:min(340px,calc(100vw - 28px));font:14px/1.4 system-ui,sans-serif;color:#e8edf3}" +
      "#lp-rv-panel button.lp-rv-tog{background:#1b2430;color:#e8edf3;border:1px solid #3a4a5e;border-radius:6px;padding:8px 12px;font:600 14px system-ui,sans-serif;cursor:pointer}" +
      "#lp-rv-panel button.lp-rv-tog:focus-visible{outline:2px solid #5db7ff;outline-offset:2px}" +
      "#lp-rv-list{display:none;margin-top:8px;background:#141b24;border:1px solid #3a4a5e;border-radius:8px;max-height:55vh;overflow:auto;padding:6px}" +
      ".lp-rv-list-open #lp-rv-list{display:block}#lp-rv-panel .lp-rv-btns{display:flex;gap:6px;justify-content:flex-end}" +
      "#lp-rv-list button{display:block;width:100%;text-align:left;background:none;border:0;border-left:4px solid var(--rv);color:inherit;padding:7px 8px;margin:3px 0;cursor:pointer;font:inherit}" +
      "#lp-rv-list button:hover,#lp-rv-list button:focus-visible{background:#1f2a38}" +
      "#lp-rv-list small{display:block;color:#a9b6c6}" +
      "#lp-rv-list .lp-rv-empty{padding:8px;color:#a9b6c6}";
    document.head.appendChild(css);

    function tip(f) { return f.id + " (" + (labels[f.status] || f.status) + "): " + f.note; }

    flags.forEach(function (f) {
      if (!f.el) return;
      f.el.classList.add("lp-rv", "lp-rv-" + f.status);
      if (getComputedStyle(f.el).position === "static") f.el.style.position = "relative";
      var b = document.createElement("span");
      b.className = "lp-rv-badge";
      b.textContent = f.id + ": " + (labels[f.status] || f.status);
      b.title = f.note;
      b.style.top = (-11 - 20 * f.el.querySelectorAll(":scope > .lp-rv-badge").length) + "px";
      f.el.insertBefore(b, f.el.firstChild);
    });

    var panel = document.createElement("div");
    panel.id = "lp-rv-panel";
    var tog = document.createElement("button");
    tog.className = "lp-rv-tog"; tog.type = "button";
    var list = document.createElement("div");
    list.id = "lp-rv-list";
    if (!flags.length) {
      list.innerHTML = '<div class="lp-rv-empty">No open review items on this page.</div>';
    }
    flags.forEach(function (f) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lp-rv-" + f.status;
      btn.innerHTML = "<strong></strong><small></small>";
      btn.firstChild.textContent = f.id + ": " + (labels[f.status] || f.status);
      btn.lastChild.textContent = f.note;
      btn.addEventListener("click", function () {
        if (f.el) { f.el.scrollIntoView({ behavior: "smooth", block: "center" }); }
        else { window.scrollTo({ top: 0, behavior: "smooth" }); }
      });
      list.appendChild(btn);
    });
    var lst = document.createElement("button");
    lst.className = "lp-rv-tog"; lst.type = "button"; lst.textContent = "List";
    lst.addEventListener("click", function () { document.body.classList.toggle("lp-rv-list-open"); });
    var row = document.createElement("div"); row.className = "lp-rv-btns";
    row.appendChild(lst); row.appendChild(tog);
    panel.appendChild(row); panel.appendChild(list);
    document.body.appendChild(panel);

    function set(on) {
      document.body.classList.toggle("lp-rv-on", on);
      tog.textContent = (on ? "Hide review items" : "Show review items") + " (" + flags.length + ")";
      tog.setAttribute("aria-pressed", on ? "true" : "false");
      store(false, on ? "1" : "0");
    }
    tog.addEventListener("click", function () { set(!document.body.classList.contains("lp-rv-on")); });
    set(store(true) !== "0");
  }
})();
