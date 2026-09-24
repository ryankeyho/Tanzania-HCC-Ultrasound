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
  const dom = new JSDOM(html, { url, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
  dom.window.fetch = (path, opts) => fetchWithCookies(path.startsWith("http") ? path : BASE + path, opts);
  if (!dom.window.sessionStorage) {
    const store = {};
    dom.window.sessionStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  }
  return { dom, fetchWithCookies };
}
function waitFor(dom, pred, timeoutMs = 4000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let r; try { r = pred(dom); } catch (e) { r = false; }
      if (r) return resolve(true);
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function run() {
  // ---------------- register.html, driven as a real form ----------------
  console.log("== register.html ==");
  const regEmail = `regform${Date.now()}@example.org`;
  const jar1 = new CookieJar();
  let { dom } = await loadPage(`${BASE}/register.html`, jar1);
  await new Promise((r) => setTimeout(r, 300));
  dom.window.document.getElementById("name").value = "Register Form Test";
  dom.window.document.getElementById("email").value = regEmail;
  dom.window.document.getElementById("cohort").value = "Cohort QA";
  dom.window.document.getElementById("password").value = "testpass123";
  dom.window.document.getElementById("register-form")
    .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(dom, (d) => d.window.document.getElementById("msg").textContent.length > 0);
  ok("register form shows success message", dom.window.document.getElementById("msg").textContent.includes("created"),
     dom.window.document.getElementById("msg").textContent);

  // second submit with the same email via the real form should surface the server's error
  let { dom: dom2 } = await loadPage(`${BASE}/register.html`, new CookieJar());
  await new Promise((r) => setTimeout(r, 300));
  dom2.window.document.getElementById("name").value = "Dup";
  dom2.window.document.getElementById("email").value = regEmail;
  dom2.window.document.getElementById("password").value = "testpass123";
  dom2.window.document.getElementById("register-form")
    .dispatchEvent(new dom2.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(dom2, (d) => d.window.document.getElementById("msg").textContent.length > 0);
  ok("duplicate email via real form shows server error, not a silent success",
     dom2.window.document.getElementById("msg").textContent.toLowerCase().includes("already exists"),
     dom2.window.document.getElementById("msg").textContent);

  // password too short, client sends it anyway (minlength is a soft HTML
  // hint, not enforced by our dispatchEvent bypass of native validation),
  // so this also exercises the server-side length check independently.
  let { dom: dom3 } = await loadPage(`${BASE}/register.html`, new CookieJar());
  await new Promise((r) => setTimeout(r, 300));
  dom3.window.document.getElementById("name").value = "Short PW";
  dom3.window.document.getElementById("email").value = `shortpw${Date.now()}@example.org`;
  dom3.window.document.getElementById("password").value = "abc";
  dom3.window.document.getElementById("register-form")
    .dispatchEvent(new dom3.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(dom3, (d) => d.window.document.getElementById("msg").textContent.length > 0);
  ok("server rejects short password even if client-side validation is bypassed",
     dom3.window.document.getElementById("msg").textContent.toLowerCase().includes("character"),
     dom3.window.document.getElementById("msg").textContent);

  // ---------------- generate one real completed attempt to check against ----------------
  // (this test file never otherwise takes a quiz, unlike real_dom_test.js)
  const qFetch = fetchCookie(nodeFetch, jar1);
  const qLogin = await qFetch(`${BASE}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: regEmail, password: "testpass123" }),
  });
  const qCsrf = (await qLogin.json()).csrf;
  const qStart = await (await qFetch(`${BASE}/api/quiz/section-01/start`, {
    method: "POST", headers: { "X-CSRF-Token": qCsrf },
  })).json();
  for (const q of qStart.questions) {
    await qFetch(`${BASE}/api/quiz/attempt/${qStart.attempt_id}/answer`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": qCsrf },
      body: JSON.stringify({ question_id: q.question_id, selected: q.position_map[0] }),
    });
  }
  await qFetch(`${BASE}/api/quiz/attempt/${qStart.attempt_id}/finish`, {
    method: "POST", headers: { "X-CSRF-Token": qCsrf },
  });

  // ---------------- admin dashboard, real content ----------------
  console.log("\n== admin.html (as real admin) ==");
  const adminJar = new CookieJar();
  const adminFetch = fetchCookie(nodeFetch, adminJar);
  const loginRes = await adminFetch(`${BASE}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qaadmin@example.org", password: "testpass123" }),
  });
  ok("admin login for dashboard test", loginRes.status === 200, `status ${loginRes.status}`);

  const { dom: adom } = await loadPage(`${BASE}/admin.html`, adminJar);
  await waitFor(adom, (d) => d.window.document.querySelectorAll(".site-admin-table tr").length > 1);
  const userRows = adom.window.document.querySelectorAll(".site-admin-table tr").length - 1;
  ok("admin dashboard lists users", userRows >= 2, `${userRows} user rows`);
  ok("dashboard shows the trainee's recorded attempt",
     adom.window.document.body.textContent.includes("section-01"));

  const resetBtn = adom.window.document.querySelector(".reset-btn");
  ok("reset-password button present per user", !!resetBtn);

  // Drive the reset flow directly against the API the button calls,
  // since dom.window.prompt/confirm are not real UI in jsdom.
  const targetUserId = resetBtn.dataset.id;
  const csrfRes = await adminFetch(`${BASE}/api/me`);
  const csrfData = await csrfRes.json();
  const resetRes = await adminFetch(`${BASE}/api/admin/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfData.csrf },
    body: JSON.stringify({ user_id: Number(targetUserId), new_password: "brandnewpass123" }),
  });
  ok("admin password reset endpoint succeeds", resetRes.status === 200, `status ${resetRes.status}`);

  // ---------------- CSV export, real content check ----------------
  console.log("\n== CSV export ==");
  const csvRes = await adminFetch(`${BASE}/api/admin/export.csv`);
  const csvText = await csvRes.text();
  const csvLines = csvText.trim().split("\n").map((l) => l.replace(/\r$/, ""));
  ok("CSV has a header row plus at least one data row", csvLines.length >= 2, `${csvLines.length} lines`);
  ok("CSV header matches expected columns",
     csvLines[0] === "Name,Email,Cohort,Quiz,Score,Total,Percent,Completed At (UTC)", csvLines[0]);
  ok("CSV content-type is text/csv", (csvRes.headers.get("content-type") || "").includes("text/csv"));

  // ---------------- non-admin cannot reset passwords or export ----------------
  console.log("\n== instructor-only endpoints reject a trainee ==");
  const trFetch = fetchCookie(nodeFetch, jar1);
  const trLogin = await trFetch(`${BASE}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: regEmail, password: "testpass123" }),
  });
  const trCsv = await trFetch(`${BASE}/api/admin/export.csv`);
  ok("trainee blocked from CSV export", trCsv.status === 403, `status ${trCsv.status}`);
  const trUsers = await trFetch(`${BASE}/api/admin/users`);
  ok("trainee blocked from admin users list", trUsers.status === 403, `status ${trUsers.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
