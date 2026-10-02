// Oddiy xotiradagi tezlik cheklovi (IP bo'yicha). Bitta jarayon uchun yetarli; ko'p jarayonli muhitda Redis'ga o'tkaziladi.
function rateLimit({ windowMs, max, name = 'default' }) {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, windowMs);
  if (timer.unref) timer.unref();
  return (req, res, next) => {
    const k = `${name}:${req.ip}`;
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset <= now) { h = { count: 0, reset: now + windowMs }; hits.set(k, h); }
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: "Juda ko'p so'rov. Birozdan keyin urinib ko'ring" });
    }
    next();
  };
}
module.exports = { rateLimit };
