// Test savollari: bitta model, to'rt tur. Eski formatlar (`correct`, `correctIndex`) ham o'qiladi.
//   single — bitta to'g'ri variant        correct: number
//   multi  — bir nechta to'g'ri variant   correct: number[]
//   tf     — to'g'ri/noto'g'ri            correct: 0 (To'g'ri) | 1 (Noto'g'ri)   (variantlar tilga qarab mijozda)
//   short  — qisqa javob                  accept: string[] (qabul qilinadigan javoblar; katta-kichik harf va ortiqcha bo'shliqsiz solishtiriladi)
const TYPES = ['single', 'multi', 'tf', 'short'];
const MAX_Q = 100, MAX_OPT = 8;

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function normalizeQuestion(q, i = 0) {
  q = q || {};
  const id = q.id != null && q.id !== '' ? String(q.id) : String(i + 1);
  const text = str(q.text, 500);
  let type = TYPES.includes(q.type) ? q.type : null;
  if (!type) type = Array.isArray(q.accept) ? 'short' : Array.isArray(q.correct) ? 'multi' : 'single';
  const out = { id, type, text };
  if (type === 'short') {
    const acc = (Array.isArray(q.accept) ? q.accept : [q.accept != null ? q.accept : q.correct]).map((x) => str(x, 120)).filter(Boolean).slice(0, 10);
    out.accept = acc;
    return out;
  }
  if (type === 'tf') {
    out.options = ['true', 'false'];                      // mijoz tarjima qiladi
    const c = q.correct != null ? q.correct : q.correctIndex;
    out.correct = c === true || c === 'true' || Number(c) === 0 && c !== false ? 0 : 1;
    return out;
  }
  const opts = (Array.isArray(q.options) ? q.options : []).map((o) => str(o, 200)).slice(0, MAX_OPT);
  out.options = opts;
  if (type === 'multi') {
    const arr = Array.isArray(q.correct) ? q.correct : Array.isArray(q.correctIndexes) ? q.correctIndexes : [];
    out.correct = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < opts.length))].sort((a, b) => a - b);
  } else {
    const c = q.correctIndex != null ? q.correctIndex : q.correct;
    const n = Number(c);
    out.correct = Number.isInteger(n) && n >= 0 && n < opts.length ? n : 0;
  }
  return out;
}

const normalizeQuestions = (arr) => (Array.isArray(arr) ? arr : []).slice(0, MAX_Q).map(normalizeQuestion);

/** Tekshiruv: tuzatib bo'lmaydigan xatolar ro'yxati (bo'sh = yaroqli). */
function validateQuestions(arr) {
  const errs = [];
  (Array.isArray(arr) ? arr : []).forEach((q, i) => {
    const n = normalizeQuestion(q, i);
    const label = `${i + 1}-savol`;
    if (!n.text) errs.push(`${label}: savol matni bo'sh`);
    if (n.type === 'short' && !n.accept.length) errs.push(`${label}: to'g'ri javob kiritilmagan`);
    if ((n.type === 'single' || n.type === 'multi') && n.options.filter(Boolean).length < 2) errs.push(`${label}: kamida 2 ta variant kerak`);
    if (n.type === 'multi' && !n.correct.length) errs.push(`${label}: kamida bitta to'g'ri variant belgilang`);
  });
  return errs;
}

/** Talabaga yuboriladigan ko'rinish (to'g'ri javobsiz). */
const publicQuestion = (q) => ({ id: q.id, type: q.type || 'single', text: q.text, options: q.options || [] });

/** Javobni tekshiradi → { isCorrect, selected, correct }. */
function grade(q, answer) {
  q = normalizeQuestion(q);
  if (answer === undefined || answer === null || answer === '') return { isCorrect: false, selected: null, correct: correctOf(q) };
  let isCorrect = false, selected = answer;
  if (q.type === 'short') {
    selected = str(answer, 120);
    isCorrect = q.accept.some((a) => norm(a) === norm(selected));
  } else if (q.type === 'multi') {
    const arr = (Array.isArray(answer) ? answer : String(answer).split(',')).map(Number).filter((n) => Number.isInteger(n));
    selected = [...new Set(arr)].sort((a, b) => a - b);
    isCorrect = selected.length === q.correct.length && selected.every((v, i) => v === q.correct[i]);
  } else {
    selected = Number(answer);
    isCorrect = selected === q.correct;
  }
  return { isCorrect, selected, correct: correctOf(q) };
}
const correctOf = (q) => (q.type === 'short' ? q.accept : q.correct);

module.exports = { TYPES, normalizeQuestion, normalizeQuestions, validateQuestions, publicQuestion, grade, correctOf };
