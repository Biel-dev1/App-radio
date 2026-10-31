"use strict";
/* Ícones do site (traço, 24x24), no mesmo estilo do app. Sem imagens nem rede: SVG criado pelo JS (compatível com a CSP).
 * Uso: Icon("bomb", 20). Itens: "c:cx,cy,r" = círculo; "f:cx,cy,r" = círculo cheio; resto = path. */
(() => {
  const I = {
    home: ["M4 11l8-7 8 7M6 10v9.5h12V10"],
    users: ["c:9,8.5,3.2", "M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5", "M15.8 5.4a3.1 3.1 0 010 6M17.6 14.6c1.9.6 2.9 2.2 2.9 4.9"],
    trophy: ["M8 4h8v5a4 4 0 01-8 0zM8 6H5v1.5A3 3 0 008 10.5M16 6h3v1.5a3 3 0 01-3 3M12 13v4M8.5 20h7M10 17h4"],
    profile: ["c:12,8,3.5", "M5 20c0-3.6 3-6 7-6s7 2.4 7 6"],
    wallet: ["M4 7.5A2.5 2.5 0 016.5 5H18v3M4 7.5V17a2 2 0 002 2h13a1 1 0 001-1V9a1 1 0 00-1-1H6.5A2.5 2.5 0 014 7.5z", "f:16.5,13.5,1"],
    plus: ["M12 5v14M5 12h14"],
    bomb: ["f:10.5,14,6", "M15 9.5l3-3M18.5 3.5v2M19.5 7h2M16 3.5l1 1"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    blast: ["M12 3l1.8 5.2L19 6.5l-2.7 4.6L21 14l-5.3.6L14.5 20 12 15.5 9.5 20l-1.2-5.4L3 14l4.7-2.9L5 6.5l5.2 1.7z"],
    camera: ["M4 8.5A1.5 1.5 0 015.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z", "c:12,12.7,3.2"],
    edit: ["M5 19l.8-3.8L16 5a1.9 1.9 0 012.7 2.7L8.5 17.9zM14.5 6.5l3 3"],
    at: ["c:12,12,3.5", "M15.5 12v1.2a2.3 2.3 0 004.5 0V12a8 8 0 10-3.2 6.4"],
    lock: ["M5 13a2 2 0 012-2h10a2 2 0 012 2v5.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 18.5z", "M8 11V8a4 4 0 018 0v3"],
    logout: ["M10 4.5H6a1 1 0 00-1 1v13a1 1 0 001 1h4M14 8l4 4-4 4M18 12H9"],
    trash: ["M5 7h14M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7M10.5 11v5M13.5 11v5"],
    up: ["M12 19V6M6.5 11.5L12 6l5.5 5.5"],
    x: ["M6 6l12 12M18 6L6 18"],
    copy: ["M9 9h8.5a1.5 1.5 0 011.5 1.5V19a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 018 19V10a1 1 0 011-1z", "M15 9V6.5A1.5 1.5 0 0013.5 5h-7A1.5 1.5 0 005 6.5v7A1.5 1.5 0 006.5 15H8"],
    verified: ["M12 3l7 3v5.5c0 4.2-2.9 7.3-7 9-4.1-1.7-7-4.8-7-9V6z", "M8.8 12l2.2 2.2 4.2-4.4"],
  };
  const NS = "http://www.w3.org/2000/svg";
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  window.Icon = (name, size) => {
    const s = el("svg", { viewBox: "0 0 24 24", width: size || 20, height: size || 20, fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" });
    s.setAttribute("class", "ic");
    for (const it of I[name] || []) {
      const m = /^([cf]):(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(it);
      if (m) s.append(el("circle", Object.assign({ cx: m[2], cy: m[3], r: m[4] }, m[1] === "f" ? { fill: "currentColor" } : {})));
      else s.append(el("path", { d: it }));
    }
    return s;
  };
})();
