// Joriy nazorat balli (formula admin panelda sozlanadi). Sof funksiyalar — oson test qilinadi.
//   bal = davomat*w1 + testlar*w2 + fokus*w3   (vaznlar yig'indisi 100)
//   fokus      = himoyada o'tgan vaqt ulushi; jami himoyasiz > focusZeroSec bo'lsa 0
//   davomat    = 100; jami himoyasiz > absentSec bo'lsa 0 (talaba qatnashmagan deb belgilanadi)
//   testlar    = yuborilgan testlar bo'yicha o'rtacha % (topshirilmagan = 0); test bo'lmasa vazn boshqalarga taqsimlanadi
// Chegara 0 (yoki manfiy) = qoida o'chirilgan.

function unprotectedMs(ms, settings) {
  return ms.unprotected + (settings['score.offlineCountsAsUnprotected'] ? ms.offline : 0);
}

function evaluateFlags(ms, settings) {
  const unprot = unprotectedMs(ms, settings) / 1000;
  const fz = settings['score.unprotectedFocusZeroSec'], ab = settings['score.unprotectedAbsentSec'];
  return { unprotectedSec: Math.round(unprot), focusZero: fz > 0 && unprot > fz, absent: ab > 0 && unprot > ab };
}

/**
 * @param ms          { protected, unprotected, offline, assumed } millisekundlarda
 * @param quizPcts    yuborilgan har bir test uchun talaba foizi (topshirmagan = 0), test bo'lmasa []
 * @param joined      darsga qo'shilganmi
 * @param flags       oldindan belgilangan { focusZero, absent } (bir marta belgilansa, qaytmaydi)
 */
function computeScore({ ms, quizPcts = [], joined = true, flags = {} }, settings) {
  const f = evaluateFlags(ms, settings);
  const focusZero = !!flags.focusZero || f.focusZero;
  const absent = !!flags.absent || f.absent;

  const protectedMs = ms.protected + ms.assumed;
  const counted = protectedMs + ms.unprotected + (settings['score.offlineCountsAsUnprotected'] ? ms.offline : 0);
  const ratio = counted > 0 ? protectedMs / counted : 1;
  const focus = focusZero ? 0 : Math.round(100 * ratio);
  const attendance = joined && !absent ? 100 : 0;
  const quizzes = quizPcts.length ? Math.round(quizPcts.reduce((a, b) => a + b, 0) / quizPcts.length) : null;

  const w = { ...settings['score.weights'] };
  if (quizzes === null) {   // testlar bo'lmasa vaznni qolganlarga nisbatan taqsimlaymiz
    const rest = w.attendance + w.focus;
    if (rest > 0) { w.attendance = (w.attendance * 100) / rest; w.focus = (w.focus * 100) / rest; w.quizzes = 0; }
  }
  const total = Math.round((attendance * w.attendance + (quizzes || 0) * w.quizzes + focus * w.focus) / 100);
  return { attendance, quizzes, focus, total, focusZero, absent, unprotectedSec: f.unprotectedSec, protectedPct: Math.round(100 * ratio) };
}

module.exports = { computeScore, evaluateFlags, unprotectedMs };
