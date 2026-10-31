"use strict";
/* Gerador de QR Code (modo byte, UTF-8, versões 1 a 40). Sem dependências e sem rede:
 * roda 100% no navegador e funciona com a CSP do site (script do próprio domínio).
 * Uso: QR.draw(canvas, "texto", 260)  ou  const q = QR.make("texto"); q.size; q.get(x, y). */
(() => {
  const ECC = { L: 0, M: 1, Q: 2, H: 3 };
  const FMT = [1, 0, 3, 2];
  const EPB = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NBK = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
  const rawModules = (v) => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataWords = (v, e) => Math.floor(rawModules(v) / 8) - EPB[e][v] * NBK[e][v];

  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
  const rsDiv = (deg) => {
    const r = new Array(deg).fill(0); r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = mul(root, 2); }
    return r;
  };
  const rsRem = (data, div) => {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
    return r;
  };

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  const make = (text, level) => {
    const e = ECC[level || "M"];
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let ver = 1;
    for (; ver <= 40; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataWords(ver, e) * 8) break;
    if (ver > 40) throw new Error("Texto grande demais para um QR Code.");

    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    const cap = dataWords(ver, e) * 8;
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    const nb = NBK[e][ver], eb = EPB[e][ver], raw = Math.floor(rawModules(ver) / 8), ns = nb - (raw % nb), sl = Math.floor(raw / nb);
    const div = rsDiv(eb), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = data.slice(k, k + sl - eb + (i < ns ? 0 : 1)); k += d.length;
      const ecc = rsRem(d, div); if (i < ns) d.push(0);
      blocks.push(d.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sl - eb || j >= ns) all.push(b[i]); });

    const n = ver * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fn = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
    const pos = [];
    if (na) {
      const step = ver === 32 ? 26 : Math.ceil((n - 13) / (na * 2 - 2)) * 2;
      pos.push(6);
      for (let p = n - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    }
    pos.forEach((cx, i) => pos.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const fmt = (mask) => {
      const d = (FMT[e] << 3) | mask;
      let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bt = ((d << 10) | r) ^ 0x5412, g = (i) => ((bt >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, g(i));
      set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) set(8, n - 15 + i, g(i));
      set(8, n - 8, true);
    };
    fmt(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const bt = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const b = ((bt >>> i) & 1) !== 0, a = n - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
    }
    let bi = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - v : v;
        if (!fn[y][x] && bi < all.length * 8) { m[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }

    const applied = (k) => m.map((row, y) => row.map((v, x) => v !== (!fn[y][x] && MASKS[k](x, y))));
    const penalty = (g) => {
      let p = 0, dark = 0;
      for (let t = 0; t < 2; t++) for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          const c = t ? g[b][a] : g[a][b], q = t ? g[b - 1][a] : g[a][b - 1];
          if (c === q) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (g[y][x]) dark++;
        if (y < n - 1 && x < n - 1 && g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) p += 3;
      }
      for (let a = 0; a < n; a++) {
        let rs = "", cs = "";
        for (let b = 0; b < n; b++) { rs += g[a][b] ? 1 : 0; cs += g[b][a] ? 1 : 0; }
        p += 40 * ((rs.match(/(?=10111010000|00001011101)/g) || []).length + (cs.match(/(?=10111010000|00001011101)/g) || []).length);
      }
      return p + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
    };
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) { const p = penalty(applied(k)); if (p < bestP) { bestP = p; best = k; } }
    const g = applied(best);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m[y][x] = g[y][x];
    fmt(best);
    return { size: n, version: ver, get: (x, y) => m[y][x] };
  };

  // Desenha o QR num <canvas> (fundo branco, margem de 4 módulos, que os leitores exigem).
  const draw = (cv, text, px) => {
    const q = make(text, "M"), quiet = 4, total = q.size + quiet * 2;
    const s = Math.max(2, Math.floor((px || 260) / total));
    cv.width = cv.height = total * s;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000";
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) g.fillRect((x + quiet) * s, (y + quiet) * s, s, s);
    return cv;
  };

  window.QR = { make, draw };
})();
