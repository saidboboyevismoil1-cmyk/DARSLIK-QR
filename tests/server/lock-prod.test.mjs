import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, makeApi } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runUntilExit(env) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'edufocus-prod-'));
  return new Promise((resolve) => {
    const child = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', DATA_DIR: dataDir, EDUFOCUS_ENV_FILE: path.join(dataDir, 'none.env'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: 'running', out }); }, 4000);
    child.on('exit', (code) => { clearTimeout(t); rmSync(dataDir, { recursive: true, force: true }); resolve({ code, out }); });
  });
}

test("production: JWT_SECRET'siz yoki demo ustoz bilan server ishga tushmaydi", async () => {
  const a = await runUntilExit({ NODE_ENV: 'production' });
  assert.equal(a.code, 1); assert.match(a.out, /JWT_SECRET/);
  const b = await runUntilExit({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), ENABLE_DEMO_TEACHER: 'true' });
  assert.equal(b.code, 1); assert.match(b.out, /ENABLE_DEMO_TEACHER/);
});

test('production: demo ustoz yo\'q, birinchi admin muhitdan yaratiladi, ro\'yxatdan o\'tish yopilishi mumkin', async () => {
  const srv = await startServer({ NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(40), ENABLE_DEMO_TEACHER: 'false', ADMIN_BOOTSTRAP_EMAIL: 'admin@otm.uz', ADMIN_BOOTSTRAP_PASSWORD: 'Kuchli-Parol-1', REGISTRATION_OPEN: 'false' });
  try {
    const api = makeApi(srv.base);
    assert.equal((await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' }))._status, 401);
    const login = await api('POST', '/api/login', { email: 'admin@otm.uz', password: 'Kuchli-Parol-1' });
    assert.ok(login.token); assert.equal(login.teacher.role, 'admin');
    assert.equal((await api('GET', '/api/admin/settings', undefined, login.token))._status, 200);
    assert.equal((await api('POST', '/api/register', { name: 'A', surname: 'B', email: 'x@y.uz', password: 'secret12' }))._status, 403);
  } finally { await srv.stop(); }
});

test("ustozlar va sozlamalar qayta ishga tushganda yo'qolmaydi (sqlite)", async () => {
  const srv = await startServer();
  try {
    const api = makeApi(srv.base);
    const email = `persist${Date.now()}@x.uz`;
    assert.ok((await api('POST', '/api/register', { name: 'Doimiy', surname: 'Ustoz', email, password: 'secret12' })).token);
    const admin = await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' });
    assert.equal((await api('PUT', '/api/admin/settings', { values: { 'release.offlineMinutes': 20 } }, admin.token))._status, 200);
    const f = await api('POST', '/api/admin/faculties', { name: 'Doimiy fakultet' }, admin.token);
    await srv.restart();
    const again = await api('POST', '/api/login', { email, password: 'secret12' });
    assert.ok(again.token, 'qayta ishga tushgach ustoz tizimga kira olishi kerak');
    const login2 = await api('POST', '/api/login', { email: 'teacher@edufocus.uz', password: '123456' });
    const st = await api('GET', '/api/admin/settings', undefined, login2.token);
    assert.equal(st.effective['release.offlineMinutes'], 20);
    assert.ok((await api('GET', '/api/admin/faculties', undefined, login2.token)).faculties.some((x) => x.id === f.id));
  } finally { await srv.stop(); }
});
