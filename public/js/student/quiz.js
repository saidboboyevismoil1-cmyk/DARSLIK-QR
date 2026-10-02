// Test yechish: savollar, javob qoralamasi, taymer, offline navbat, natija va tahlil.
import { $, esc, icon, fmtTime, haptic, toast } from './util.js';
import { S, bus, actions, push, onEnter, onLeave, currentScreen } from './state.js';
import { t, tn } from './i18n.js';
import * as net from './net.js';

let builtId = null;
let timerId = null;
let watchId = null;
const letter = (i) => String.fromCharCode(65 + i);
const isDone = () => !!(S.quiz && S.sess && S.sess.quizDone && S.sess.quizDone[S.quiz.quizId]);
const isPending = () => !!(S.sess && S.sess.pending && S.quiz && S.sess.pending.quizId === S.quiz.quizId);

function show(which) {
  $('#quiz-empty').hidden = which !== 'empty';
  $('#quiz-form').hidden = which !== 'form';
  $('#quiz-result').hidden = which !== 'result';
}

function render() {
  clearInterval(timerId); timerId = null;
  const q = S.quiz;
  if (!q || !q.questions || !q.questions.length) { builtId = null; $('#quiz-title').textContent = t('quiz.title'); $('#quiz-timer').hidden = true; show('empty'); return; }
  $('#quiz-title').textContent = q.title || t('quiz.defaultTitle');
  if (isDone()) { renderResult(q, S.sess.quizDone[q.quizId]); return; }

  show('form');
  if (builtId !== q.quizId) { buildForm(q); builtId = q.quizId; }
  $('#quiz-count').textContent = tn('quiz.count', q.questions.length);
  updateProgress();
  syncSubmitButton();
  startTimer(q);
}

function buildForm(q) {
  const draft = (S.sess && S.sess.draft && S.sess.draft[q.quizId]) || {};
  $('#quiz-body').innerHTML = q.questions.map((qq, i) => {
    const opts = (qq.options || []).map((o, oi) => `
      <label class="opt"><input type="radio" name="q_${esc(qq.id)}" value="${oi}" ${String(draft[qq.id]) === String(oi) ? 'checked' : ''}>
        <span class="lt">${letter(oi)}</span><span class="ot">${esc(o)}</span></label>`).join('');
    return `<div class="glass q-card fade-in" data-q="${esc(qq.id)}"><div class="qt">${i + 1}. ${esc(qq.text)}</div><div class="stack" style="gap:8px">${opts}</div></div>`;
  }).join('');
}

function collect() {
  const answers = {};
  (S.quiz ? S.quiz.questions : []).forEach((qq) => {
    const el = document.querySelector(`#quiz-body input[name="q_${CSS.escape(String(qq.id))}"]:checked`);
    if (el) answers[qq.id] = el.value;
  });
  return answers;
}

function updateProgress() {
  const total = S.quiz ? S.quiz.questions.length : 0;
  const n = Object.keys(collect()).length;
  $('#quiz-progress-text').textContent = t('quiz.progress', { n, total });
  $('#quiz-progress').style.transform = `scaleX(${total ? n / total : 0})`;
}

function syncSubmitButton() {
  const btn = $('#quiz-submit');
  const pend = isPending();
  btn.disabled = pend;
  btn.innerHTML = pend ? `<span class="spinner" style="width:20px;height:20px;border-width:3px"></span>${esc(net.connected() ? t('quiz.sending') : t('quiz.queued'))}` : `${icon('check')}${esc(t('quiz.submit'))}`;
}

$('#quiz-body').addEventListener('change', (e) => {
  if (!S.quiz || !S.sess || !e.target.matches('input[type=radio]')) return;
  const id = S.quiz.quizId;
  S.sess.draft = S.sess.draft || {};
  S.sess.draft[id] = collect();
  net.persist();
  updateProgress();
  haptic(8);
});

// ---------- Taymer ----------
function startTimer(q) {
  const chip = $('#quiz-timer');
  const limit = Number(q.timeLimit) || 0;
  if (!limit || !S.sess) { chip.hidden = true; return; }
  S.sess.quizStart = S.sess.quizStart || {};
  if (!S.sess.quizStart[q.quizId]) { S.sess.quizStart[q.quizId] = Date.now(); net.persist(); }
  const endAt = S.sess.quizStart[q.quizId] + limit * 60000;
  chip.hidden = false;
  const tickQ = () => {
    const left = Math.round((endAt - Date.now()) / 1000);
    chip.querySelector('span').textContent = fmtTime(left);
    chip.classList.toggle('low', left <= 60);
    if (left <= 0) { clearInterval(timerId); timerId = null; submit(true); }
  };
  tickQ();
  if (timerId === null && !isPending()) timerId = setInterval(tickQ, 1000);
}

// ---------- Yuborish ----------
function submit(auto) {
  if (!S.quiz || !S.sess || isDone() || isPending()) return;
  const answers = collect();
  const total = S.quiz.questions.length;
  if (!auto && Object.keys(answers).length < total) {
    const first = S.quiz.questions.find((qq) => answers[qq.id] === undefined);
    toast(t('quiz.answerAll', { n: Object.keys(answers).length, total }));
    const card = first && document.querySelector(`#quiz-body [data-q="${CSS.escape(String(first.id))}"]`);
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  clearInterval(timerId); timerId = null;
  net.submitQuiz(S.quiz.quizId, answers);
  syncSubmitButton();
  clearTimeout(watchId);
  watchId = setTimeout(() => {
    if (isPending() && net.connected()) { toast(t('quiz.notConfirmed')); net.flushPending(); }
  }, 10000);
}
$('#quiz-form').addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
bus.on('conn', () => { if (S.sess && S.sess.pending) { net.flushPending(); if (currentScreen() === 's-quiz') syncSubmitButton(); } });

// ---------- Natija ----------
function renderResult(q, res) {
  clearInterval(timerId); timerId = null;
  $('#quiz-timer').hidden = true;
  const pct = res.percentage;
  const [grad, title] = pct >= 80 ? ['linear-gradient(135deg,#10b981,#06b6d4)', t('quiz.r.great')] : pct >= 50 ? ['linear-gradient(135deg,#f59e0b,#f97316)', t('quiz.r.good')] : ['linear-gradient(135deg,#ef4444,#f97316)', t('quiz.r.try')];
  const byId = {};
  (res.results || []).forEach((r) => { byId[r.questionId] = r; });
  const review = q.questions.map((qq, i) => {
    const r = byId[qq.id] || {};
    const opts = (qq.options || []).map((o, oi) => {
      const isRight = Number(r.correctIndex) === oi;
      const isSel = r.selected !== undefined && Number(r.selected) === oi;
      const cls = isRight ? 'right' : isSel ? 'wrong' : '';
      return `<div class="opt ${cls}" style="cursor:default"><span class="lt">${letter(oi)}</span><span class="ot">${esc(o)}</span>${isRight ? icon('check', 'sm') : isSel ? icon('x', 'sm') : ''}</div>`;
    }).join('');
    return `<div class="glass q-card"><div class="qt">${i + 1}. ${esc(qq.text)}</div><div class="stack" style="gap:8px">${opts}</div></div>`;
  }).join('');
  $('#quiz-result').innerHTML = `
    <div class="glass card center stack" style="align-items:center;text-align:center;padding:28px 18px">
      <div class="result-ico" style="background:${grad}">${icon('award')}</div>
      <h2 class="h2">${title}</h2>
      <div class="score grad-text">${res.correctCount} / ${res.totalQuestions}</div>
      <p class="muted">${esc(t('quiz.correct', { pct }))}</p>
    </div>
    <b class="muted small" style="padding-left:6px">${esc(t('quiz.review'))}</b>${review}
    <button class="btn btn-glass block" data-act="back">${esc(t('common.back'))}</button>`;
  show('result');
}

bus.on('quiz-result', () => { if (currentScreen() === 's-quiz') render(); });
bus.on('quiz', (quiz) => {
  haptic([100, 50, 100]);
  toast(t('quiz.new', { title: quiz.title || t('quiz.title') }));
  if (S.phase === 'joined') { if (currentScreen() === 's-quiz') render(); else push('s-quiz'); }
});
bus.on('applied', ({ fresh }) => {
  if (fresh && S.quiz && !isDone()) setTimeout(() => push('s-quiz'), 250);
});
onEnter('s-quiz', render);
onLeave('s-quiz', () => { clearInterval(timerId); timerId = null; clearTimeout(watchId); });
