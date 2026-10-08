// Mech Arena 2D - server online (Node.js + Socket.IO)
// Tài khoản, ghép trận 1v1 / 2v2 / 5v5, phòng riêng.  Chạy: npm install && npm start
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROB = { raptor:200, titan:340, phantom:170, inferno:230, striker:210, warden:290, frost:220,
  reaper:190, bulwark:380, comet:215, omega:360, ghost:180, colossus:420, blaze:240, aegis:310 };
const MODES = { '1v1': 1, '2v2': 2, '5v5': 5, 'coop': 1, 'world': 1 };   // 'coop' = sinh tồn 2 người (cùng đội, đánh bot)
const SPX = [450, 850, 950, 1300, 1450];     // vị trí xuất phát (đội 2 lấy đối xứng)
const MAXW = 5200, MAXH = 1500, VIP_COUNT = 5;
const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));

function attach(io, opts = {}) {
  // ===== Lưu trữ tài khoản (file JSON). Trên Render nhớ gắn Disk và đặt DATA_DIR vào ổ đó =====
  const dir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, 'accounts.json');
  let db = { accounts: {}, order: 0 };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let dirty = false;
  function flush() {
    if (!dirty) return; dirty = false;
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); }
    catch (e) { console.error('Không lưu được tài khoản:', e.message); }
  }
  const mark = () => { dirty = true; };
  const timer = setInterval(flush, 5000); if (timer.unref) timer.unref();
  const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const online = new Map();   // tên (chữ thường) -> các kết nối đang đăng nhập
  function authOk(s, a, withToken) {
    s.acct = a; s.disp = (a.vip ? '@' : '') + a.name;
    s.okey = a.name.toLowerCase(); if (!online.has(s.okey)) online.set(s.okey, new Set()); online.get(s.okey).add(s);
    let token;
    if (withToken) { token = crypto.randomBytes(24).toString('hex'); a.tokens = (a.tokens || []).slice(-4); a.tokens.push(sha(token)); mark(); }
    s.emit('auth', { ok: true, name: a.name, disp: (a.vip ? '@' : '') + a.name, vip: a.vip, token, data: a.data || null });
  }
  const authErr = (s, e) => s.emit('auth', { ok: false, err: e });
  function cleanData(d) { try { return JSON.stringify(d).length <= 80000 ? JSON.parse(JSON.stringify(d)) : null; } catch (e) { return null; } }

  // ===== Phòng chơi =====
  const queues = { '1v1': [], '2v2': [], '5v5': [], 'coop': [], 'world': [] };
  const custom = new Map();
  const alive = (r, t) => r.players.filter(p => p.team === t && p.hp > 0).length;

  function profile(s, d) {
    const mk = ROB[d && d.mk] ? d.mk : 'raptor';
    s.mk = mk; s.mhp = Math.round(num(d && d.mhp, 50, Math.floor(ROB[mk] * 2.7))); s.hp = s.mhp;
  }
  function hpTable(r) { const h = {}; r.players.forEach(p => { h[p.pid] = p.hp; }); return h; }
  function broadcast(r, ev, data, except) { r.players.forEach(p => { if (p !== except) p.emit(ev, data); }); }
  function startRoom(r) {
    r.started = true; r.over = false;
    if (r.code) { custom.delete(r.code); }
    const cnt = [0, 0];
    r.players.forEach((p, i) => {
      p.pid = i; p.team = r.mode === 'coop' ? 0 : i % 2; p.cpT = 0; p.cpN = 0; p.room = r; if (r.mode === 'world') p.mhp = Math.round(p.mhp * 3);   // The World: chỉ huy có máu x3
      p.hp = p.mhp; p.hbt = 0; p.hbv = 0; p.lastSt = 0; p.shotT = 0; p.shotN = 0; p.lastHeal = 0;
      const k = Math.min(4, cnt[p.team]++);
      p.px = p.team === 0 ? SPX[k] : MAXW - 34 - SPX[k];
    });
    const list = r.players.map(p => ({ pid: p.pid, name: p.disp, team: p.team, mk: p.mk, mhp: p.mhp, x: p.px }));
    r.players.forEach(p => p.emit('start', { mode: r.mode, you: p.pid, team: p.team, players: list }));
  }
  function finish(r, winTeam, why) {
    if (r.over) return; r.over = true;
    r.players.forEach(p => { p.emit('end', { win: p.team === winTeam, why }); if (p.room === r) p.room = null; });
  }
  function check(r, lastTeam) {
    if (r.over || !r.started || r.mode === 'coop') return;   // (world dùng luật loại chỉ huy như đấu thường)
    const a0 = alive(r, 0), a1 = alive(r, 1);
    if (a0 && a1) return;
    finish(r, a0 ? 0 : a1 ? 1 : lastTeam, 'Đội đối phương bị loại hết');
  }
  function lobby(r) {
    const names = r.players.map(p => p.disp);
    r.players.forEach(p => p.emit('lobby', { code: r.code, mode: r.mode, names, host: p === r.host }));
  }
  function leaveLobby(s) {
    for (const m in queues) queues[m] = queues[m].filter(x => x !== s);
    const r = s.room;
    if (r && !r.started) {
      r.players = r.players.filter(x => x !== s); s.room = null;
      if (!r.players.length || r.host === s) {
        r.players.forEach(p => { p.room = null; p.emit('err', 'Chủ phòng đã thoát, phòng đã đóng.'); });
        if (r.code) custom.delete(r.code);
      } else lobby(r);
    }
  }
  function leaveGame(s) {
    const r = s.room; if (!r || !r.started || r.over) return;
    if (r.mode === 'coop') {   // đồng đội thoát: báo cho người còn lại, trận tiếp tục
      s.room = null;
      r.players.forEach(p => { if (p !== s && p.room === r) p.emit('pleft'); });
      return;
    }
    s.hp = 0; s.room = null;
    broadcast(r, 'hp', { hp: hpTable(r) });
    check(r, s.team === 0 ? 1 : 0);
  }

  io.on('connection', (s) => {
    s.authN = 0; s.authT = 0;
    const throttle = () => { const t = Date.now(); if (t - s.authT > 60000) { s.authT = t; s.authN = 0; } return ++s.authN > 10; };

    // ----- Tài khoản -----
    s.on('register', (d) => {
      if (throttle()) return authErr(s, 'Thử quá nhiều lần, hãy đợi một phút.');
      const name = String((d && d.name) || ''), pw = String((d && d.pass) || '');
      if (!/^[A-Za-z0-9]{3,16}$/.test(name)) return authErr(s, 'Tên chỉ gồm chữ và số, dài 3–16 ký tự.');
      if (pw.length < 4 || pw.length > 64) return authErr(s, 'Mật khẩu phải từ 4 đến 64 ký tự.');
      const key = name.toLowerCase();
      if (db.accounts[key]) return authErr(s, 'Tên này đã có người dùng.');
      const salt = crypto.randomBytes(16).toString('hex');
      const idx = db.order++;
      const a = { name, salt, hash: hashPw(pw, salt), vip: idx < VIP_COUNT, idx, tokens: [], data: cleanData(d.data) };
      db.accounts[key] = a; mark(); flush();
      authOk(s, a, true);
    });
    s.on('login', (d) => {
      if (throttle()) return authErr(s, 'Thử quá nhiều lần, hãy đợi một phút.');
      const a = db.accounts[String((d && d.name) || '').toLowerCase()];
      const pw = String((d && d.pass) || '');
      if (!a || !crypto.timingSafeEqual(Buffer.from(hashPw(pw, a.salt)), Buffer.from(a.hash))) return authErr(s, 'Sai tên hoặc mật khẩu.');
      authOk(s, a, true);
    });
    s.on('tokenlogin', (d) => {
      if (throttle()) return;
      const a = db.accounts[String((d && d.n) || '').toLowerCase()];
      if (!a || !d.t || !(a.tokens || []).includes(sha(String(d.t)))) return authErr(s, 'Phiên đăng nhập đã hết hạn.');
      authOk(s, a, false);
    });
    // ----- Tặng Credits / A-Coins cho người chơi khác -----
    s.gN = 0; s.gT = 0;
    s.on('gift', (d) => {
      const res = (o) => s.emit('giftres', o);
      if (!s.acct) return res({ ok: false, err: 'Hãy đăng nhập trước khi tặng.' });
      const t = Date.now(); if (t - s.gT > 60000) { s.gT = t; s.gN = 0; }
      if (++s.gN > 10) return res({ ok: false, err: 'Tặng quá nhiều lần, hãy đợi một phút.' });
      const unit = d && d.unit === 'ac' ? 'ac' : 'cr', amt = Math.floor(+(d && d.amt));
      const label = unit === 'ac' ? 'A-Coins' : 'Credits', cap = unit === 'ac' ? 1e6 : 1e9;
      if (!(amt >= 1)) return res({ ok: false, err: 'Số lượng không hợp lệ.' });
      if (amt > cap) return res({ ok: false, err: 'Mỗi lần chỉ được tặng tối đa ' + cap.toLocaleString('en-US') + ' ' + label + '.' });
      const toName = String((d && d.to) || '').replace(/^@/, '');
      const r = db.accounts[toName.toLowerCase()];
      if (!r) return res({ ok: false, err: 'Không có người chơi tên "' + toName + '".' });
      const me = s.acct;
      if (r === me) return res({ ok: false, err: 'Bạn không thể tự tặng cho mình.' });
      if (!me.vip) {
        const bal = (me.data && Number(me.data[unit])) || 0;
        if (!(bal >= amt)) return res({ ok: false, err: 'Bạn không đủ ' + label + '.' });
        me.data[unit] = bal - amt;
      }
      r.data = r.data || {}; r.data[unit] = (Number(r.data[unit]) || 0) + amt;
      mark(); flush();
      (online.get(r.name.toLowerCase()) || []).forEach(c => c.emit('gifted', { from: s.disp, unit, amt }));
      res({ ok: true, unit, amt, to: (r.vip ? '@' : '') + r.name });
    });
    s.on('savedata', (d) => { if (!s.acct) return; const c = cleanData(d); if (c) { s.acct.data = c; mark(); } });

    // ----- Ghép trận / phòng -----
    const need = () => { if (!s.acct) { s.emit('err', 'Hãy đăng nhập trước khi chơi online.'); return false; } return true; };
    s.on('quick', (d) => {
      if (!need()) return;
      const mode = MODES[d && d.mode] ? d.mode : '1v1';
      if (s.room) return;
      leaveLobby(s); profile(s, d);
      const q = queues[mode]; q.push(s);
      const n = MODES[mode] * 2;
      if (q.length >= n) {
        const r = { mode, players: q.splice(0, n), started: false, over: false, code: null };
        r.players.forEach(p => { p.room = r; });
        startRoom(r);
      } else s.emit('status', 'Đang tìm trận ' + mode + ': ' + q.length + '/' + n + ' người...');
    });
    s.on('create', (d) => {
      if (!need() || s.room) return;
      leaveLobby(s); profile(s, d);
      const mode = MODES[d && d.mode] ? d.mode : '1v1';
      let c; do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (custom.has(c));
      const r = { mode, players: [s], host: s, started: false, over: false, code: c };
      s.room = r; custom.set(c, r); lobby(r);
    });
    s.on('join', (d) => {
      if (!need() || s.room) return;
      const c = String((d && d.code) || '').toUpperCase().slice(0, 8), r = custom.get(c);
      if (!r || r.started || r.players.length >= MODES[r.mode] * 2) return s.emit('err', 'Không tìm thấy phòng "' + c + '" hoặc phòng đã đầy.');
      profile(s, d); r.players.push(s); s.room = r;
      if (r.players.length >= MODES[r.mode] * 2) startRoom(r); else lobby(r);
    });
    s.on('startnow', () => {
      const r = s.room;
      if (!r || r.started || r.host !== s) return;
      if (r.players.length < 2) return s.emit('err', 'Cần ít nhất 2 người để bắt đầu.');
      startRoom(r);
    });
    s.on('cancel', () => leaveLobby(s));

    // ----- Trong trận -----
    const live = () => { const r = s.room; return r && r.started && !r.over && s.hp > 0 ? r : null; };
    s.on('st', (d) => {
      const r = live(); if (!r || !d) return;
      const t = Date.now(); if (t - s.lastSt < 20) return; s.lastSt = t;
      broadcast(r, 'st', { p: s.pid, x: num(d.x, 0, MAXW), y: num(d.y, -300, MAXH), f: d.f > 0 ? 1 : -1,
        a: num(d.a, -7, 7), i: d.i ? 1 : 0, w: /^[a-z0-9]{2,12}$/.test(d.w) ? d.w : 'pulse' }, s);
    });
    s.on('shot', (d) => {
      const r = live(); if (!r || !d || !/^[a-z0-9]{2,12}$/.test(d.w)) return;
      const t = Date.now(); if (t - s.shotT > 1000) { s.shotT = t; s.shotN = 0; }
      if (++s.shotN > (s.acct && s.acct.vip ? 400 : 70)) return;
      broadcast(r, 'shot', { p: s.pid, w: d.w, a: num(d.a, -7, 7) }, s);
    });
    // Sinh tồn 2 người: server chỉ chuyển tiếp tin nhắn giữa hai người (người chơi 1 là chủ, chạy bot)
    s.on('cp', (m) => {
      const r = s.room;
      if (!r || !r.started || r.over || (r.mode !== 'coop' && r.mode !== 'world') || !m || typeof m.t !== 'string') return;
      if (!['st', 'shot', 'bs', 'bf', 'bh', 'pd', 'rv', 'cend', 'us', 'uh'].includes(m.t)) return;
      const t = Date.now(); if (t - s.cpT > 1000) { s.cpT = t; s.cpN = 0; }
      if (++s.cpN > 400) return;
      try { if (JSON.stringify(m.d || {}).length > 12000) return; } catch (e) { return; }
      const o = r.players.find(p => p !== s && p.room === r);
      if (o) o.emit('cp', { t: m.t, d: m.d });
    });
    s.on('hit', (d) => {
      const r = live(); if (!r || !d) return;
      const tg = r.players.find(p => p.pid === d.t);
      if (!tg || tg.team === s.team || tg.hp <= 0) return;
      const dm = num(d.d, 0, 1200); if (!dm) return;
      if (!s.acct.vip) {   // tài khoản @ (admin) không bị giới hạn sát thương mỗi giây
        const t = Date.now(); if (t - s.hbt > 1000) { s.hbt = t; s.hbv = 0; }
        s.hbv += dm; if (s.hbv > 3500) return;
      }
      if (tg.god) return;   // admin bật bất tử
      tg.hp = Math.max(0, tg.hp - dm);
      broadcast(r, 'hp', { hp: hpTable(r) });
      if (tg.hp <= 0) check(r, s.team);
    });
    s.on('adm', (d) => { s.god = !!(s.acct && s.acct.vip && d && d.god); });   // chỉ tài khoản @ mới được bật
    s.on('heal', (d) => {
      const r = live(); if (!r) return;
      const t = Date.now(); if (t - s.lastHeal < 5000) return; s.lastHeal = t;
      s.hp = Math.min(s.mhp, s.hp + num(d && d.a, 0, s.mhp * 0.5));
      broadcast(r, 'hp', { hp: hpTable(r) });
    });
    const dropOnline = () => { const set = online.get(s.okey); if (set) { set.delete(s); if (!set.size) online.delete(s.okey); } };
    const leave = () => { leaveLobby(s); leaveGame(s); };
    s.on('leave', leave);
    s.on('disconnect', () => { leave(); dropOnline(); flush(); });
  });
  return { flush, db: () => db };
}

module.exports = { attach, ROB };

if (require.main === module) {
  const express = require('express');
  const http = require('http');
  const { Server } = require('socket.io');
  const app = express();
  app.get('/healthz', (req, res) => res.send('ok'));   // dùng cho kiểm tra sức khỏe / giữ server không ngủ
  app.use(express.static(path.join(__dirname, 'public')));
  const srv = http.createServer(app);
  const api = attach(new Server(srv));
  const stop = () => { api.flush(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const port = process.env.PORT || 3000;
  srv.listen(port, () => console.log('Mech Arena online chạy tại http://localhost:' + port));
}
