import http from "node:http";
import Stripe from "stripe";
import { WebSocketServer } from "ws";

// ---------------------------------------------------------------- configuração (variáveis de ambiente)
const port = process.env.PORT || 8080;
const KEY = process.env.STRIPE_SECRET_KEY || "";
const stripe = KEY ? new Stripe(KEY) : null;           // sem chave = salas grátis (modo desenvolvimento)
const PRICE = parseInt(process.env.ROOM_PRICE_CENTS || "990", 10);   // preço em centavos (990 = R$ 9,90)
const DAYS = parseInt(process.env.ROOM_DAYS || "30", 10);            // dias de duração da sala paga
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");     // ex.: https://radio-amigos-server.onrender.com
const ROOM_RE = /^[A-Z0-9-]{4,20}$/;
const DAY_MS = 86400000;

const rooms = new Map();        // código -> Set<ws> (quem está na sala agora)
const paid = new Map();         // código -> quando expira (ms): cache das salas pagas
const unpaidUntil = new Map();  // código -> até quando lembrar que "não é paga" (evita consultar o Stripe toda hora)

// ---------------------------------------------------------------- salas pagas
// O próprio Stripe é o "banco de dados": cada pagamento leva o código da sala nos metadados.
async function isRoomActive(room) {
  if (!stripe) return true;
  const exp = paid.get(room);
  if (exp) {
    if (exp > Date.now()) return true;
    paid.delete(room);
  }
  const neg = unpaidUntil.get(room);
  if (neg && neg > Date.now()) return false;
  try {
    const res = await stripe.paymentIntents.search({
      query: `status:'succeeded' AND metadata['app']:'radioamigos' AND metadata['room']:'${room}'`,
      limit: 10,
    });
    let best = 0;
    for (const pi of res.data) best = Math.max(best, pi.created * 1000);
    if (best && best + DAYS * DAY_MS > Date.now()) {
      paid.set(room, best + DAYS * DAY_MS);
      return true;
    }
  } catch (e) {
    console.error("Stripe search:", e.message);
  }
  unpaidUntil.set(room, Date.now() + 15000);
  return false;
}

// ---------------------------------------------------------------- HTTP (pagamento)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 15;
}
function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function page(res, title, text) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0f2c;color:#fff;font-family:sans-serif;text-align:center;padding:24px">
<div><h1>${title}</h1><p style="opacity:.8">${text}</p></div></body>`);
}
async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error("corpo grande demais");
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  try {
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200); return res.end("Rádio Amigos OK"); }
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/config") {
      return send(res, 200, { payments: !!stripe, priceCents: PRICE, days: DAYS, currency: "BRL" });
    }
    if (req.method === "GET" && url.pathname === "/pago") {
      return page(res, "Pagamento recebido ✅", "Pode voltar para o app Rádio Amigos. Sua sala será liberada em instantes.");
    }
    if (req.method === "GET" && url.pathname === "/cancelado") {
      return page(res, "Pagamento cancelado", "Nada foi cobrado. Volte ao app Rádio Amigos para tentar de novo.");
    }

    // Cria o pagamento (Stripe Checkout) para uma sala nova
    if (req.method === "POST" && url.pathname === "/checkout") {
      if (limited(ip)) return send(res, 429, { error: "Muitas tentativas. Tente de novo mais tarde." });
      const body = await readJson(req);
      const room = String(body.room || "").trim().toUpperCase();
      if (!ROOM_RE.test(room)) return send(res, 400, { error: "Use de 4 a 20 letras ou números." });
      if (!stripe) return send(res, 200, { free: true, room });
      if (!BASE_URL) return send(res, 500, { error: "Servidor sem BASE_URL configurada." });
      if (await isRoomActive(room)) return send(res, 409, { error: "Esse código já está em uso. Escolha outro." });

      const make = (methods) => stripe.checkout.sessions.create({
        mode: "payment",
        locale: "pt-BR",
        payment_method_types: methods,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "brl",
            unit_amount: PRICE,
            product_data: { name: `Rádio Amigos — sala ${room} (${DAYS} dias)` },
          },
        }],
        metadata: { app: "radioamigos", room },
        payment_intent_data: { metadata: { app: "radioamigos", room } },
        success_url: `${BASE_URL}/pago`,
        cancel_url: `${BASE_URL}/cancelado`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
      let session;
      try {
        session = await make(["card", "pix"]);
      } catch (e) {
        console.error("Checkout com Pix falhou, tentando só cartão:", e.message);
        session = await make(["card"]);
      }
      return send(res, 200, { url: session.url, sessionId: session.id, room });
    }

    // O app pergunta se o pagamento já caiu
    if (req.method === "GET" && url.pathname === "/checkout-status") {
      if (!stripe) return send(res, 200, { paid: true });
      const id = String(url.searchParams.get("session") || "");
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return send(res, 400, { error: "sessão inválida" });
      const s = await stripe.checkout.sessions.retrieve(id);
      if (!s.metadata || s.metadata.app !== "radioamigos") return send(res, 404, { error: "não encontrada" });
      const room = s.metadata.room;
      if (s.payment_status === "paid") {
        const exp = s.created * 1000 + DAYS * DAY_MS;
        paid.set(room, Math.max(paid.get(room) || 0, exp));
        unpaidUntil.delete(room);
        return send(res, 200, { paid: true, room, expiresAt: exp });
      }
      return send(res, 200, { paid: false, status: s.status });
    }

    send(res, 404, { error: "não encontrado" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Erro interno. Tente de novo." });
  }
});

// ---------------------------------------------------------------- WebSocket (áudio)
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.room = null;
  ws.on("message", async (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === "join") {
        const room = String(msg.room || "").trim().toUpperCase();
        if (!ROOM_RE.test(room)) {
          ws.send(JSON.stringify({ type: "error", message: "Use um código de 4 a 20 letras/números." }));
          return;
        }
        if (!(await isRoomActive(room))) {
          ws.send(JSON.stringify({ type: "error", message: "Sala não encontrada ou expirada. Crie uma sala na aba Salas." }));
          return;
        }
        ws.room = room;
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws);
        ws.send(JSON.stringify({ type: "joined", room }));
      }
      return;
    }
    if (!ws.room) return;
    for (const peer of rooms.get(ws.room) || []) {
      if (peer !== ws && peer.readyState === 1) peer.send(data, { binary: true });
    }
  });
  ws.on("close", () => {
    if (!ws.room) return;
    const set = rooms.get(ws.room);
    if (set) { set.delete(ws); if (!set.size) rooms.delete(ws.room); }
  });
});

// Fecha as salas pagas que expiraram
setInterval(() => {
  if (!stripe) return;
  const now = Date.now();
  for (const [room, set] of rooms) {
    const exp = paid.get(room);
    if (exp && exp < now) {
      for (const w of set) {
        try { w.send(JSON.stringify({ type: "error", message: "A sala expirou." })); w.close(); } catch {}
      }
      rooms.delete(room);
      paid.delete(room);
    }
  }
}, 60000);

server.listen(port, () => console.log(`Rádio Amigos server na porta ${port} · pagamentos: ${stripe ? "ligados" : "desligados"}`));
