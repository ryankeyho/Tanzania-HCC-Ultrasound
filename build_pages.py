import re
import os
import glob
import json

SRC_DIR = "/mnt/user-data/outputs"
OUT_DIR = "/home/claude/webapp/app/static/pages"
os.makedirs(OUT_DIR, exist_ok=True)

# Map source filename -> (output filename, quiz id or None)
PAGE_MAP = {
    "page-00-welcome.html":            ("00-welcome.html",            None),
    "page-session1-physics.html":      ("session1-physics.html",      "section-01"),
    "page-session2a-roadmap.html":     ("session2a-roadmap.html",     "section-02a"),
    "page-session2-anatomy.html":      ("session2-anatomy.html",      "section-02"),
    "page-session2b-technique.html":   ("session2b-technique.html",   "section-02b"),
    "page-views-reference.html":       ("views-reference.html",       None),
    "page-references.html":            ("references.html",            None),
    "page-session3-diffuse.html":      ("session3-diffuse.html",      "section-03"),
    "page-session4-focal.html":        ("session4-focal.html",        "section-04"),
    "page-session4a-neighbours.html":  ("session4a-neighbours.html",  "section-04a"),
    "page-session5-protocol.html":     ("session5-protocol.html",     "section-05"),
    "page-session6-reporting.html":    ("session6-reporting.html",    "section-06"),
    "page-basic-peer-practice.html":   ("basic-peer-practice.html",   None),
    "page-lab-phantom.html":           ("lab-phantom.html",           None),
    "page-supervised-scanning.html":   ("supervised-scanning.html",   None),
    "page-trainer-of-trainers.html":   ("trainer-of-trainers.html",   None),
    "page-completion-criteria.html":   ("completion-criteria.html",   None),
}

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title} - Liver POCUS Course</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/static/favicon.png">
<link rel="stylesheet" href="/static/css/site.css">
<link rel="stylesheet" href="/static/css/content-dark.css">
</head>
<body>
<div class="site-header" id="site-header"></div>
<div class="site-course-nav" id="course-nav"></div>
<div class="site-shell" style="padding-top:1.6rem">
{content}
<div id="prevnext"></div>
{quiz_cta}
</div>
<script src="/static/js/api.js"></script>
<script src="/static/js/course-structure.js"></script>
<script>
(async () => {{
  await Api.requireAuth();
  const here = window.location.pathname.split("/").pop();

  // top course-nav strip: section titles only, current section highlighted
  const navEl = document.getElementById("course-nav");
  navEl.innerHTML = COURSE.map((s) => {{
    const active = s.items.some((it) => it.page && it.page.endsWith(here));
    return `<a href="/index.html#" class="${{active ? "active" : ""}}">${{s.section}}</a>`;
  }}).join("");

  // prev/next footer across content pages only
  const flat = flatPages();
  const idx = flat.findIndex((p) => p.page.endsWith(here));
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  document.getElementById("prevnext").innerHTML = `
    <div class="site-prevnext">
      <span>${{prev ? `&larr; <a href="/${{prev.page}}">${{prev.title}}</a>` : ""}}</span>
      <span><a href="/index.html">Course Home</a></span>
      <span>${{next ? `<a href="/${{next.page}}">${{next.title}}</a> &rarr;` : ""}}</span>
    </div>`;
}})();
</script>
</body>
</html>
"""

QUIZ_CTA = """<div style="margin:2.5rem 0;padding:1.2rem;background:var(--site-panel);border-radius:6px;text-align:center">
  <a href="/quiz.html?quiz={quiz_id}" style="font-weight:700;text-decoration:none;font-size:1.02rem">Take the Section Quiz &rarr;</a>
</div>"""


def extract_lp_mod(html):
    """Pulls the <div class="lp-mod"> wrapper, but strips the embedded
    <style> block, the webapp uses a shared content-dark.css instead
    (linked once in the page <head>), so 15 copies of the same CSS don't
    end up duplicated across every page. The Moodle-facing source files
    keep their embedded styles untouched; only this webapp build step
    strips them."""
    start = html.index('<div class="lp-mod">')
    end = html.rindex("</div>") + len("</div>")
    block = html[start:end]
    style_start = block.index("<style>")
    style_end = block.index("</style>") + len("</style>")
    return block[:style_start] + block[style_end:]


def fix_image_paths(html):
    # pages/ sits one level below static/, images/ sits directly under static/
    return re.sub(r'src="([\w.-]+\.png)"', r'src="/static/images/\1"', html)


def title_from(html):
    m = re.search(r"<h2>(.*?)</h2>", html, flags=re.S)
    if not m:
        return "Course"
    return re.sub(r"<[^>]+>", "", m.group(1)).strip()


built = []
for src_name, (out_name, quiz_id) in PAGE_MAP.items():
    src_path = os.path.join(SRC_DIR, src_name)
    raw = open(src_path, encoding="utf-8").read()
    content = extract_lp_mod(raw)
    content = fix_image_paths(content)
    title = title_from(raw)
    quiz_cta = QUIZ_CTA.format(quiz_id=quiz_id) if quiz_id else ""
    page_html = TEMPLATE.format(title=title, content=content, quiz_cta=quiz_cta)
    out_path = os.path.join(OUT_DIR, out_name)
    open(out_path, "w", encoding="utf-8").write(page_html)
    built.append((out_name, title, quiz_id, len(page_html)))

print(f"Built {len(built)} pages:")
for name, title, quiz_id, size in built:
    print(f"  {name:34s} {title[:44]:44s} quiz={quiz_id or '-'}  {size:,}b")
