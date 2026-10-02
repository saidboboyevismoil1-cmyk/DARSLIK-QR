// Native ko'prik: Android (AndroidBridge.invoke) va iOS (window.__efNativeHost) uchun yagona, Promise asosidagi interfeys.
// Brauzerda (native yo'q) present=false. Protokol: docs/lock-mode/native-bridge.md
//   web → native:  host.invoke(id, method, argsJson)
//   native → web:  window.__efNative.resolve(id, '{"ok":true,"data":…}')  va  window.__efNative.emit(event, json)
const pending = new Map();
const handlers = {};
let seq = 0;

function host() {
  if (window.__efNativeHost) return window.__efNativeHost;          // iOS (user script) yoki test mock
  const ab = window.AndroidBridge;
  if (ab && typeof ab.invoke === 'function') return { platform: 'android', invoke: (id, m, a) => ab.invoke(id, m, a) };
  return null;
}

window.__efNative = {
  resolve(id, json) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id); clearTimeout(p.tm);
    let r;
    try { r = typeof json === 'string' ? JSON.parse(json) : json; } catch { r = { ok: false, error: 'bad_json' }; }
    if (r && r.ok) p.res(r.data); else p.rej(Object.assign(new Error((r && r.error) || 'native_error'), { code: (r && r.error) || 'native_error' }));
  },
  emit(evt, json) {
    let d = null;
    try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch { /* ignore */ }
    (handlers[evt] || []).forEach((f) => { try { f(d); } catch (e) { console.error(evt, e); } });
  },
};

export const native = {
  get present() { return !!host(); },
  get platform() { const h = host(); return h ? h.platform : 'web'; },
  invoke(method, args = {}, timeoutMs = 10000) {
    const h = host();
    if (!h) return Promise.reject(Object.assign(new Error('no_native'), { code: 'no_native' }));
    return new Promise((res, rej) => {
      const id = ++seq;
      const tm = setTimeout(() => { pending.delete(id); rej(Object.assign(new Error('timeout:' + method), { code: 'timeout' })); }, timeoutMs);
      pending.set(id, { res, rej, tm });
      try { h.invoke(id, method, JSON.stringify(args)); } catch (e) { pending.delete(id); clearTimeout(tm); rej(e); }
    });
  },
  /** Xatoni yutib, fallback qaytaradi. */
  async safe(method, args, fallback, timeoutMs) {
    try { return await native.invoke(method, args, timeoutMs); } catch { return fallback; }
  },
  /** Javob kutilmaydigan buyruq. */
  fire(method, args) { native.invoke(method, args, 4000).catch(() => {}); },
  on(evt, fn) { (handlers[evt] ||= []).push(fn); },
};
