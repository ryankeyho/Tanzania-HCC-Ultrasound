/* Single source of truth for course structure, used by the home page
   (index.html) to render sections, and by course content pages to build
   the prev/next footer and the top course-nav strip. */

const COURSE = [
  { section: "0. Pre-Work", items: [
    { title: "Welcome & Pre-Course Readings", page: "pages/00-welcome.html" },
    { title: "Pretest: Baseline Knowledge", quiz: "pretest" },
  ]},
  { section: "1. Week 1: Foundations", items: [
    { title: "Session 1: Physics & the Vscan Air CL", page: "pages/session1-physics.html", quiz: "section-01" },
    { title: "Session 2: The Upper Abdominal Roadmap", page: "pages/session2a-roadmap.html", quiz: "section-02a" },
    { title: "Session 2a: Liver Anatomy and Landmarks", page: "pages/session2-anatomy.html", quiz: "section-02" },
    { title: "Session 2b: Scanning Technique, Controls and the Protocol", page: "pages/session2b-technique.html", quiz: "section-02b" },
    { title: "Reference: Required Views by Organ", page: "pages/views-reference.html" },
  ]},
  { section: "2. Week 2: Pathology & Screening", items: [
    { title: "Session 3: Diffuse Liver Pathology", page: "pages/session3-diffuse.html", quiz: "section-03" },
    { title: "Session 4: Focal Lesions & HCC Findings", page: "pages/session4-focal.html", quiz: "section-04" },
    { title: "Session 4a: Beyond the Liver", page: "pages/session4a-neighbours.html", quiz: "section-04a" },
    { title: "Session 5: Screening Protocol & Local Context", page: "pages/session5-protocol.html", quiz: "section-05" },
    { title: "Session 6: Structured Reporting & Interpretation", page: "pages/session6-reporting.html", quiz: "section-06" },
    { title: "Posttest: End of Course", quiz: "posttest" },
  ]},
  { section: "3. Week 3: In Person, Days 1 to 3", items: [
    { title: "Foundational Peer-to-Peer Practice", page: "pages/basic-peer-practice.html" },
    { title: "Simulation Lab: The Bovine Liver Phantom", page: "pages/lab-phantom.html" },
    { title: "Peer OSCE Scanning", page: "pages/supervised-scanning.html" },
    { title: "Course Completion Criteria", page: "pages/completion-criteria.html" },
  ]},
  { section: "4. References", items: [
    { title: "Reference: Sources and Image Citations", page: "pages/references.html" },
  ]},
];

/** Flat ordered list of {title, page} for prev/next navigation (quizzes excluded). */
function flatPages() {
  const out = [];
  COURSE.forEach((s) => s.items.forEach((it) => { if (it.page) out.push(it); }));
  return out;
}
