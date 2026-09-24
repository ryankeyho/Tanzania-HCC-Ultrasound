/**
 * Real DOM execution test: loads the actual served pages via jsdom,
 * executes the real <script> tags (api.js, quiz-runner.js, etc.) with a
 * cookie-jar-backed fetch so session cookies persist across requests the
 * way a browser's would, and simulates real clicks/form submissions.
 *
 * This is not a browser rendering engine (no layout, no CSS), but it is
 * genuine JS execution against a real DOM and a real server, it will
 * catch reference errors, broken selectors, and logic bugs that reading
 * the code will not.
 */
const { JSDOM } = require("jsdom");
const fetchCookie = require("fetch-cookie").default;
const nodeFetch = require("node-fetch");
const { CookieJar } = require("tough-cookie");

const BASE = "http://127.0.0.1:5000";
let pass = 0, fail = 0;

function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`OK   ${label}`); }
  else { fail++; console.log(`FAIL ${label}${extra ? " -- " + extra : ""}`); }
}

async function loadPage(url, jar) {
  const fetchWithCookies = fetchCookie(nodeFetch, jar);
  const html = await (await fetchWithCookies(url)).text();
  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });
  dom.window.fetch = (path, opts) => {
    const full = path.startsWith("http") ? path : BASE + path;
    return fetchWithCookies(full, opts);
  };
  // jsdom doesn't implement sessionStorage's persistence quirks we rely on
  // across page loads in a real tab; give each loadPage its own store but
  // let the caller pass one in to simulate "same tab" navigation.
  if (!dom.window.sessionStorage) {
    const store = {};
    dom.window.sessionStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  }
  return dom;
}

function waitFor(dom, predicate, timeoutMs = 4000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let result;
      try { result = predicate(dom); } catch (e) { result = false; }
      if (result) return resolve(true);
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function run() {
  const email = `jsdomtest${Date.now()}@example.org`;
  const jar = new CookieJar();

  // ---------------- login page ----------------
  console.log("\n== login.html ==");
  let dom = await loadPage(`${BASE}/login.html`, jar);
  await new Promise((r) => setTimeout(r, 300)); // let the "already logged in?" check settle
  ok("login form present", !!dom.window.document.getElementById("login-form"));

  // Register via direct API call first (register.html tested separately below),
  // then drive the real login form exactly as a user would.
  const fetchWithCookies = fetchCookie(nodeFetch, jar);
  const regRes = await fetchWithCookies(`${BASE}/api/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "JSDOM Test", email, password: "testpass123", cohort: "QA" }),
  });
  ok("register via API for login test", regRes.status === 200, `status ${regRes.status}`);

  // jsdom does not implement real page navigation, so window.location.href
  // never actually changes here even on success, that is a jsdom
  // limitation, not something the app can control. Instead we check the
  // actual success signal: no error message rendered, meaning Api.login()
  // resolved and the redirect line executed (harmlessly logged by jsdom
  // as "not implemented" rather than thrown).
  dom.window.document.getElementById("email").value = email;
  dom.window.document.getElementById("password").value = "testpass123";
  const form = dom.window.document.getElementById("login-form");
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

  await new Promise((r) => setTimeout(r, 500));
  const loginMsg = dom.window.document.getElementById("msg").textContent;
  ok("login via real form submit produced no error", loginMsg.length === 0, `msg was: "${loginMsg}"`);

  // Confirm the session actually took, independent of jsdom navigation,
  // by hitting /api/me with the same cookie jar the form's fetch used.
  const meRes = await fetchWithCookies(`${BASE}/api/me`);
  const meData = await meRes.json();
  ok("session cookie set by the real login form is valid", meData.user && meData.user.email === email,
     JSON.stringify(meData));

  // ---------------- index.html (course home) ----------------
  console.log("\n== index.html ==");
  dom = await loadPage(`${BASE}/index.html`, jar);
  await waitFor(dom, (d) => d.window.document.querySelectorAll(".site-item-list li").length > 0);
  const itemCount = dom.window.document.querySelectorAll(".site-item-list li").length;
  ok("course items rendered", itemCount > 10, `found ${itemCount}`);
  ok("header shows logged-in user", dom.window.document.getElementById("site-header").textContent.includes("JSDOM Test"));
  const quizLinks = [...dom.window.document.querySelectorAll('a[href^="/quiz.html"]')];
  ok("quiz links present", quizLinks.length === 11, `found ${quizLinks.length}`);

  // ---------------- a content page ----------------
  console.log("\n== a content page (session1-physics.html) ==");
  dom = await loadPage(`${BASE}/pages/session1-physics.html`, jar);
  await waitFor(dom, (d) => d.window.document.getElementById("prevnext").innerHTML.length > 0);
  ok("lp-mod content present", !!dom.window.document.querySelector(".lp-mod"));
  ok("prev/next footer rendered", dom.window.document.getElementById("prevnext").textContent.includes("Course Home"));
  ok("quiz CTA present", dom.window.document.body.textContent.includes("Take the Section Quiz"));
  const imgs = [...dom.window.document.querySelectorAll(".lp-mod img")].map((i) => i.getAttribute("src"));
  const badImgs = imgs.filter((s) => !s.startsWith("/static/images/"));
  ok("all course-content image srcs rewritten to /static/images/", badImgs.length === 0, JSON.stringify(badImgs));

  // ---------------- section-mode quiz, full run ----------------
  console.log("\n== quiz.html?quiz=section-01 (section mode, full run) ==");
  dom = await loadPage(`${BASE}/quiz.html?quiz=section-01`, jar);
  await waitFor(dom, (d) => d.window.document.querySelectorAll(".site-choice").length > 0);
  ok("first question rendered with 4 choices",
     dom.window.document.querySelectorAll(".site-choice").length === 4);

  let questionsSeen = 0;
  for (let i = 0; i < 25; i++) {
    const radios = dom.window.document.querySelectorAll('input[name="choice"]');
    if (radios.length !== 4) { ok(`q${i + 1} has 4 radio options`, false, `found ${radios.length}`); break; }
    radios[0].checked = true;
    dom.window.document.getElementById("check-btn").click();
    await waitFor(dom, (d) => d.window.document.getElementById("feedback").textContent.length > 0);
    const fb = dom.window.document.getElementById("feedback").textContent;
    if (i === 0) ok("feedback text non-empty after checking an answer", fb.length > 5, fb.slice(0, 60));
    questionsSeen++;
    const nextBtn = dom.window.document.getElementById("next-btn");
    const finishBtn = dom.window.document.getElementById("finish-btn");
    if (nextBtn) { nextBtn.click(); await waitFor(dom, (d) => d.window.document.querySelectorAll(".site-choice").length === 4); }
    else if (finishBtn) { finishBtn.click(); break; }
  }
  ok("all 25 section questions answered", questionsSeen === 25, `saw ${questionsSeen}`);
  await waitFor(dom, (d) => d.window.document.querySelector(".site-quiz-result") !== null);
  const scoreText = dom.window.document.querySelector(".site-quiz-result .score").textContent;
  ok("section quiz summary shows N / 25", /\d+ \/ 25/.test(scoreText), scoreText);

  console.log("\n== retake the same section quiz ==");
  dom.window.document.getElementById("retake-btn").click();
  await waitFor(dom, (d) => d.window.document.querySelectorAll(".site-choice").length === 4);
  ok("retake starts a fresh attempt with a new question set rendered",
     dom.window.document.querySelectorAll(".site-choice").length === 4);

  // ---------------- exam-mode quiz, full run ----------------
  console.log("\n== quiz.html?quiz=pretest (exam mode, full run) ==");
  dom = await loadPage(`${BASE}/quiz.html?quiz=pretest`, jar);
  await waitFor(dom, (d) => d.window.document.querySelectorAll(".site-question").length === 39);
  ok("all 39 exam questions rendered at once",
     dom.window.document.querySelectorAll(".site-question").length === 39);
  ok("submit button starts disabled",
     dom.window.document.getElementById("submit-exam-btn").disabled === true);
  ok("no answer key present anywhere in exam-mode HTML before submit",
     !dom.window.document.body.innerHTML.includes("correct_index") &&
     !dom.window.document.body.innerHTML.includes("rationale"));

  const examRadios = dom.window.document.querySelectorAll('.site-question input[type="radio"]');
  const byQuestion = {};
  examRadios.forEach((r) => { (byQuestion[r.name] = byQuestion[r.name] || []).push(r); });
  Object.values(byQuestion).forEach((group) => {
    group[0].checked = true;
    group[0].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await waitFor(dom, (d) => d.window.document.getElementById("submit-exam-btn").disabled === false);
  ok("submit enabled once all 39 answered", true);

  dom.window.confirm = () => true; // auto-confirm the "are you sure" dialog
  dom.window.document.getElementById("submit-exam-btn").click();
  await waitFor(dom, (d) => d.window.document.querySelector(".site-quiz-result") !== null, 6000);
  const examScore = dom.window.document.querySelector(".site-quiz-result .score").textContent;
  ok("exam summary shows N / 39", /\d+ \/ 39/.test(examScore), examScore);

  console.log("\n== single-attempt lock enforced in the UI too ==");
  dom = await loadPage(`${BASE}/quiz.html?quiz=pretest`, jar);
  await waitFor(dom, (d) => !d.window.document.getElementById("quiz-root").textContent.includes("Loading"));
  ok("re-visiting a completed exam shows an error, not a fresh attempt",
     dom.window.document.getElementById("quiz-root").textContent.toLowerCase().includes("one attempt"),
     dom.window.document.getElementById("quiz-root").textContent);

  // ---------------- progress page ----------------
  console.log("\n== progress.html ==");
  dom = await loadPage(`${BASE}/progress.html`, jar);
  await waitFor(dom, (d) => d.window.document.querySelectorAll("table tr").length > 1);
  const rows = dom.window.document.querySelectorAll("table tr").length - 1;
  ok("progress table has rows for completed quizzes", rows >= 2, `${rows} rows`);

  // ---------------- admin blocked for trainee ----------------
  console.log("\n== admin.html correctly blocks a trainee ==");
  dom = await loadPage(`${BASE}/admin.html`, jar);
  await waitFor(dom, (d) => !d.window.document.getElementById("admin-root").textContent.includes("Loading"));
  ok("trainee sees access-denied message on admin page",
     dom.window.document.getElementById("admin-root").textContent.includes("instructors and admins"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
