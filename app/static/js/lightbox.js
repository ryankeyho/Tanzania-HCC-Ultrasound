/* Click to enlarge for images marked with class "zoom" or inside a ".zoomable" container. Esc, click or the close button dismisses. */
(function () {
  var ov = null;
  function close() { if (ov) { ov.remove(); ov = null; document.removeEventListener("keydown", onKey); } }
  function onKey(e) { if (e.key === "Escape") close(); }
  function open(src, alt) {
    close();
    ov = document.createElement("div"); ov.className = "lp-lightbox"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Enlarged image");
    var img = document.createElement("img"); img.src = src; img.alt = alt || "";
    var b = document.createElement("button"); b.type = "button"; b.className = "lp-lightbox-x"; b.textContent = "Close"; b.setAttribute("aria-label", "Close enlarged image");
    ov.appendChild(img); ov.appendChild(b);
    ov.addEventListener("click", close);
    document.body.appendChild(ov); document.addEventListener("keydown", onKey); b.focus();
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName === "IMG" && (t.classList.contains("zoom") || t.closest(".zoomable"))) { e.preventDefault(); open(t.getAttribute("data-full") || t.currentSrc || t.src, t.alt); }
  });
  function mark() { document.querySelectorAll(".zoomable img, img.zoom").forEach(function (i) { i.style.cursor = "zoom-in"; i.title = "Click to enlarge"; }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark); else mark();
})();
