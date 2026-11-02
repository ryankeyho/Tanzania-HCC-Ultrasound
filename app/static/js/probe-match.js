/* Probe position to sonogram matching activity (Session 2B).
   Pick a probe position and the ultrasound image it produces. Correct: green flash and the full image
   with its explanation is revealed. Wrong: red flash and a try-again message. Formative only: nothing is saved. */
(function () {
  "use strict";
  var mount = document.getElementById("probe-match");
  if (!mount) return;
  var base = mount.getAttribute("data-base") || "/static/images/";
  var REF = mount.getAttribute("data-ref") || "";
  var ITEMS = [
    { title: "Left lobe of liver (transverse)", steps: ["Place the probe in the midline in transverse orientation, just under the costal margin.", "Ask the patient to take a deep breath if there is difficulty in visualizing the left lobe."] },
    { title: "Left lobe of liver (longitudinal)", steps: ["Rotate the probe 90 degrees clockwise into longitudinal orientation.", "Sweep towards the left upper quadrant and scan all the way to the edge of the liver."] },
    { title: "Caudate lobe", steps: ["Place the probe in longitudinal orientation and move to the right of the midline."] },
    { title: "Porta hepatis and bile duct", steps: ["Keeping the probe in longitudinal orientation, move further to the right of the patient.", "Locate the portal vein and its entry into the liver; this is the porta hepatis.", "Rotate the probe slightly anticlockwise to locate the common bile duct."] },
    { title: "Right lobe medial to kidney", steps: ["Move even further to the right of the patient.", "Sweep to the left and right to scan the right lobe."] },
    { title: "Right lobe and kidney", steps: ["Keep going right until you locate the right kidney. It is usually at the midclavicular line.", "Scan laterally towards the right upper quadrant.", "Scan all the way to the right edge of the liver."] },
    { title: "Right lobe and hepatic veins (transverse)", steps: ["Place the transducer parallel and just below the right costal margin, in transverse orientation.", "Ask the patient to take a deep breath."] },
    { title: "Liver at the porta hepatis level (transverse)", steps: ["Align the probe parallel to the right costal margin.", "Ask the patient to take another deep breath. During the breath hold, sweep cranially and caudally while angling the probe towards the patient's right shoulder."] },
    { title: "Liver and kidney (transverse)", steps: ["Align the probe parallel to the right costal margin and ask the patient to take a deep breath.", "Scan the liver at the level of the right kidney until the inferior edge of the liver."] }
  ];
  var n = ITEMS.length, matched = {}, mPos = {}, mImg = {}, selPos = null, selImg = null, locked = false;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  mount.innerHTML = "";
  var status = el("p", "pm-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  var grid = el("div", "pm-grid");
  var colA = el("div", "pm-col"), colB = el("div", "pm-col");
  colA.appendChild(el("h4", null, "Probe positions"));
  colB.appendChild(el("h4", null, "Ultrasound images"));
  var posBtns = [], imgBtns = [];
  for (var i = 0; i < n; i++) {
    (function (i) {
      var b = el("button", "pm-card");
      b.type = "button";
      b.innerHTML = '<img src="' + base + 's2b-match-pos-' + (i + 1) + '.jpg" alt="Probe position diagram ' + (i + 1) + ' of ' + n + '" loading="lazy">';
      b.addEventListener("click", function () { pick("pos", i); });
      posBtns[i] = b; colA.appendChild(b);
    })(i);
  }
  var order = shuffle(ITEMS.map(function (_, k) { return k; }));
  order.forEach(function (k, slot) {
    var b = el("button", "pm-card");
    b.type = "button";
    b.innerHTML = '<img src="' + base + 's2b-match-img-' + (k + 1) + '.jpg" alt="Ultrasound image option ' + (slot + 1) + ' of ' + n + '" loading="lazy">';
    b.addEventListener("click", function () { pick("img", k); });
    imgBtns[k] = b; colB.appendChild(b);
  });
  grid.appendChild(colA); grid.appendChild(colB);
  var results = el("div", "pm-results");
  var bar = el("div", "pm-bar");
  var count = el("span", "pm-count");
  var reset = el("button", "pm-reset", "Start again"); reset.type = "button";
  reset.addEventListener("click", function () { render(); });
  bar.appendChild(count); bar.appendChild(reset);
  mount.appendChild(bar); mount.appendChild(status); mount.appendChild(grid); mount.appendChild(results);

  function setStatus(msg, kind) { status.textContent = msg; status.className = "pm-status" + (kind ? " pm-" + kind : ""); }
  function updateCount() { var c = Object.keys(matched).length; count.textContent = c + " of " + n + " matched"; }
  function mark(btns) { btns.forEach(function (b, k) { b.classList.toggle("pm-sel", (btns === posBtns ? selPos : selImg) === k && !(btns === posBtns ? mPos : mImg)[k]); }); }

  function pick(side, k) {
    if (locked || (side === "pos" ? mPos : mImg)[k]) return;
    if (side === "pos") selPos = (selPos === k ? null : k); else selImg = (selImg === k ? null : k);
    mark(posBtns); mark(imgBtns);
    if (selPos == null && selImg == null) { setStatus("Choose a probe position and the ultrasound image it produces."); return; }
    if (selPos == null) { setStatus("Now choose the probe position for that image."); return; }
    if (selImg == null) { setStatus("Now choose the ultrasound image this probe position produces."); return; }
    check();
  }
  function flash(btn, cls) { btn.classList.add(cls); setTimeout(function () { btn.classList.remove(cls); }, 700); }
  function check() {
    var p = selPos, im = selImg;
    // items 7 and 8 (index 6 and 7) share the same probe position, so either probe card counts for either image
    if (p === im || (p >= 6 && p <= 7 && im >= 6 && im <= 7)) {
      matched[im] = true; mPos[p] = true; mImg[im] = true; locked = true;
      flash(posBtns[p], "pm-ok"); flash(imgBtns[im], "pm-ok");
      posBtns[p].classList.add("pm-done"); imgBtns[im].classList.add("pm-done");
      posBtns[p].disabled = true; imgBtns[im].disabled = true;
      selPos = selImg = null; mark(posBtns); mark(imgBtns);
      reveal(im); updateCount();
      var done = Object.keys(matched).length === n;
      setStatus(done ? "Correct. All " + n + " pairs matched." : "Correct. " + ITEMS[im].title + ". Choose the next pair.", "ok");
      setTimeout(function () { locked = false; }, 450);
    } else {
      locked = true;
      flash(posBtns[p], "pm-bad"); flash(imgBtns[im], "pm-bad");
      setStatus("Not quite. Try again.", "bad");
      setTimeout(function () { selPos = selImg = null; mark(posBtns); mark(imgBtns); locked = false; }, 700);
    }
  }
  function reveal(k) {
    var it = ITEMS[k];
    var fig = el("figure", "pm-full pm-pop");
    fig.setAttribute("data-k", k);
    fig.innerHTML = '<img src="' + base + 's2b-match-full-' + (k + 1) + '.jpg" alt="' + esc(it.title) + ': probe position and the matching ultrasound view" style="width:100%;height:auto;display:block;margin-bottom:.6em">' +
      (REF ? REF : "") +
      "<figcaption><strong>" + esc(it.title) + "</strong><ul>" + it.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></figcaption>";
    // keep revealed items in protocol order
    var placed = false, kids = results.children;
    for (var i = 0; i < kids.length; i++) { if (Number(kids[i].getAttribute("data-k")) > k) { results.insertBefore(fig, kids[i]); placed = true; break; } }
    if (!placed) results.appendChild(fig);
    fig.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function render() {
    matched = {}; mPos = {}; mImg = {}; selPos = selImg = null; locked = false; results.innerHTML = "";
    posBtns.forEach(function (b) { b.disabled = false; b.className = "pm-card"; });
    imgBtns.forEach(function (b) { b.disabled = false; b.className = "pm-card"; });
    updateCount(); setStatus("Choose a probe position and the ultrasound image it produces.");
  }
  render();
})();
