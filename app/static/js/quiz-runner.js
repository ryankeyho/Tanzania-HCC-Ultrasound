/* Quiz runner. Question/choice/rationale text is rendered with innerHTML
   deliberately: this content is server-authored (from our own verified
   question bank, never user input) and was HTML-escaped once when the
   bank was built, so innerHTML is what correctly turns "&lt;1 cm" back
   into "<1 cm" for display. There is no path for a trainee's own input
   to reach this rendering. */

let STATE = { quizId: null, mode: null, attemptId: null, questions: null, index: 0, answers: {} };

function qs(sel) { return document.querySelector(sel); }

function params() { return new URLSearchParams(window.location.search); }

async function main() {
  const user = await Api.requireAuth();
  STATE.quizId = params().get("quiz");
  if (!STATE.quizId) {
    qs("#quiz-root").innerHTML = `<p>No quiz specified.</p>`;
    return;
  }
  await startQuiz();
}

async function startQuiz() {
  qs("#quiz-root").innerHTML = `<div class="site-loading">Loading quiz…</div>`;
  try {
    const data = await Api.call(`/api/quiz/${encodeURIComponent(STATE.quizId)}/start`, { method: "POST" });
    STATE.mode = data.mode;
    STATE.attemptId = data.attempt_id;
    STATE.questions = data.questions;
    STATE.index = 0;
    STATE.answers = {};
    document.title = `Quiz: ${STATE.quizId}`;
    if (STATE.mode === "section") renderSectionMode();
    else renderExamMode();
  } catch (err) {
    qs("#quiz-root").innerHTML = `<div class="site-msg error">${escapeText(err.message)}</div>`;
  }
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ---------------- SECTION MODE: one question at a time, immediate feedback ---------------- */
function renderSectionMode() {
  const q = STATE.questions[STATE.index];
  const total = STATE.questions.length;
  const root = qs("#quiz-root");
  root.innerHTML = `
    <div class="site-quiz-progress">Question ${STATE.index + 1} of ${total}, formative, retake anytime</div>
    <div class="site-question" id="q-card">
      <div class="q-stem">${q.stem}</div>
      <div id="choices"></div>
      <div id="feedback"></div>
    </div>
    <div class="site-quiz-actions">
      <button class="primary" id="check-btn">Check answer</button>
    </div>`;
  const choicesEl = qs("#choices");
  q.choices.forEach((text, pos) => {
    const label = document.createElement("label");
    label.className = "site-choice";
    label.innerHTML = `<input type="radio" name="choice" value="${pos}"> <span></span>`;
    label.querySelector("span").innerHTML = text;
    choicesEl.appendChild(label);
  });

  qs("#check-btn").addEventListener("click", onCheckAnswer);
}

async function onCheckAnswer() {
  const q = STATE.questions[STATE.index];
  const picked = document.querySelector('input[name="choice"]:checked');
  if (!picked) { alert("Choose an answer first."); return; }
  const pos = Number(picked.value);
  const originalIndex = q.position_map[pos];

  const btn = qs("#check-btn");
  btn.disabled = true;
  try {
    const result = await Api.call(`/api/quiz/attempt/${STATE.attemptId}/answer`, {
      method: "POST", body: { question_id: q.question_id, selected: originalIndex },
    });
    STATE.answers[q.question_id] = result.correct;

    // Mark choices correct/incorrect
    const labels = document.querySelectorAll(".site-choice");
    labels.forEach((label, pos2) => {
      const isPicked = pos2 === pos;
      const isCorrectPos = q.position_map[pos2] === result.correct_index;
      if (isCorrectPos) label.classList.add("correct");
      else if (isPicked) label.classList.add("incorrect");
      label.querySelector("input").disabled = true;
    });

    qs("#feedback").innerHTML = `
      <div class="site-feedback ${result.correct ? "correct" : "incorrect"}">
        <strong>${result.correct ? "Correct." : "Not quite."}</strong> ${result.rationale}
      </div>`;

    const isLast = STATE.index === STATE.questions.length - 1;
    qs(".site-quiz-actions").innerHTML = isLast
      ? `<button class="primary" id="finish-btn">See summary</button>`
      : `<button class="primary" id="next-btn">Next question</button>`;
    if (isLast) qs("#finish-btn").addEventListener("click", showSectionSummary);
    else qs("#next-btn").addEventListener("click", () => { STATE.index++; renderSectionMode(); });
  } catch (err) {
    qs("#feedback").innerHTML = `<div class="site-msg error">${escapeText(err.message)}</div>`;
    btn.disabled = false;
  }
}

async function showSectionSummary() {
  const correct = Object.values(STATE.answers).filter(Boolean).length;
  const total = STATE.questions.length;
  try {
    await Api.call(`/api/quiz/attempt/${STATE.attemptId}/finish`, { method: "POST" });
  } catch (err) {
    // Non-fatal for the trainee's own view, they still see their score,
    // but this means the attempt won't show up in progress/admin views.
    console.error("Failed to mark section attempt complete:", err);
  }
  qs("#quiz-root").innerHTML = `
    <div class="site-quiz-result">
      <div class="score">${correct} / ${total}</div>
      <p>This section quiz is formative, retake it as many times as you like.</p>
      <div class="site-quiz-actions" style="justify-content:center">
        <button class="primary" id="retake-btn">Retake this quiz</button>
        <a href="/index.html" class="site-btn" style="width:auto;background:var(--site-raised);border:1px solid var(--site-rule);display:inline-block;padding:.6rem 1.3rem;text-decoration:none;border-radius:4px;color:var(--site-ink);font-weight:700">Back to course</a>
      </div>
    </div>`;
  qs("#retake-btn").addEventListener("click", startQuiz);
}

/* ---------------- EXAM MODE: all at once, hidden until submit, single attempt ---------------- */
function renderExamMode() {
  const root = qs("#quiz-root");
  const notice = `<div class="site-msg ok">This is a single-attempt assessment. Answers and explanations are not shown until every question has been answered and submitted.</div>`;
  const items = STATE.questions.map((q, i) => `
    <div class="site-question" data-qid="${q.question_id}">
      <div class="q-stem"><strong>${i + 1}.</strong> ${q.stem}</div>
      <div class="choices-${q.question_id}"></div>
    </div>`).join("");
  root.innerHTML = `
    ${notice}
    <div class="site-quiz-progress" id="exam-progress"></div>
    ${items}
    <div class="site-quiz-actions">
      <button class="primary" id="submit-exam-btn" disabled>Submit exam</button>
    </div>`;

  STATE.questions.forEach((q) => {
    const container = document.querySelector(`.choices-${q.question_id}`);
    q.choices.forEach((text, pos) => {
      const label = document.createElement("label");
      label.className = "site-choice";
      label.innerHTML = `<input type="radio" name="q-${q.question_id}" value="${pos}"> <span></span>`;
      label.querySelector("span").innerHTML = text;
      label.querySelector("input").addEventListener("change", onExamAnswerChange);
      container.appendChild(label);
    });
  });

  updateExamProgress();
  qs("#submit-exam-btn").addEventListener("click", onSubmitExam);
}

function onExamAnswerChange(e) {
  const qid = Number(e.target.name.replace("q-", ""));
  const pos = Number(e.target.value);
  const q = STATE.questions.find((x) => x.question_id === qid);
  STATE.answers[qid] = q.position_map[pos];
  updateExamProgress();
}

function updateExamProgress() {
  const answered = Object.keys(STATE.answers).length;
  const total = STATE.questions.length;
  qs("#exam-progress").textContent = `${answered} of ${total} answered`;
  qs("#submit-exam-btn").disabled = answered !== total;
}

async function onSubmitExam() {
  if (!confirm("Submit the exam now? You will not be able to change any answers afterward.")) return;
  const btn = qs("#submit-exam-btn");
  btn.disabled = true;
  btn.textContent = "Submitting…";
  const answers = Object.entries(STATE.answers).map(([qid, selected]) => ({
    question_id: Number(qid), selected,
  }));
  try {
    const result = await Api.call(`/api/quiz/attempt/${STATE.attemptId}/submit`, {
      method: "POST", body: { answers },
    });
    const passClass = result.percent >= 80 ? "pass" : "fail";
    qs("#quiz-root").innerHTML = `
      <div class="site-quiz-result">
        <div class="score ${passClass}">${result.score} / ${result.total}</div>
        <p>${result.percent}% correct</p>
        <p style="color:var(--site-muted);font-size:.88rem">This assessment allows one attempt. Your result has been recorded.</p>
        <div class="site-quiz-actions" style="justify-content:center">
          <a href="/progress.html" class="site-btn" style="width:auto;display:inline-block;padding:.6rem 1.3rem;text-decoration:none;border-radius:4px">My Progress</a>
          <a href="/index.html" class="site-btn" style="width:auto;background:var(--site-raised);border:1px solid var(--site-rule);display:inline-block;padding:.6rem 1.3rem;text-decoration:none;border-radius:4px;color:var(--site-ink);font-weight:700">Back to course</a>
        </div>
      </div>`;
  } catch (err) {
    alert(err.message || "Submission failed");
    btn.disabled = false;
    btn.textContent = "Submit exam";
  }
}

main();
