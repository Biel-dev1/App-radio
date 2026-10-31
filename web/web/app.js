"use strict";
/* Duelo de Minas — versão web.
 * Segurança: todo texto vindo de jogadores é inserido com textContent (nunca innerHTML),
 * não há scripts nem estilos inline (CSP), e o servidor continua decidindo saldo, apostas e resultado. */
(() => {
  const C = window.CONFIG;
  const app = document.getElementById("app");
  const toastBox = document.getElementById("toasts");

  // ------------------------------------------------------------ utilidades
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  const money = (c) => "R$ " + (Number(c || 0) / 100).toFixed(2).replace(".", ",");
  const parseCents = (s) => {
    const n = Number(String(s).trim().replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  };
  const randomCode = () => {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const a = new Uint32Array(6);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => abc[x % abc.length]).join("");
  };
  const toast = (msg) => {
    const t = h("div", { class: "toast", text: msg });
    toastBox.append(t);
    setTimeout(() => t.remove(), 4500);
  };
  const busy = (btn, on) => {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) btn.dataset.busy = "1"; else delete btn.dataset.busy;
  };
  const unlockAll = () => document.querySelectorAll("[data-busy]").forEach((b) => busy(b, false));
  const initial = (n) => (String(n || "?").trim()[0] || "?").toUpperCase();
  const avatar = (name, url, big) => {
    const ok = typeof url === "string" && url.startsWith(C.SUPABASE_URL + "/storage/");
    return h("div", { class: "av" + (big ? " big" : "") }, ok ? h("img", { src: url, alt: "", referrerPolicy: "no-referrer" }) : initial(name));
  };
  const nameBadge = (name, verified) => h("span", {}, name || "Jogador", verified ? h("span", { class: "badge", text: "✔" }) : null);

  let modalClose = null;
  const modal = (title, body, actions) => {
    if (modalClose) modalClose();
    const ov = h("div", { class: "ov" });
    const close = () => { ov.remove(); if (modalClose === close) modalClose = null; };
    const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, h("h2", { text: title }), body, actions ? h("div", {}, actions(close)) : null);
    ov.append(box);
    document.body.append(ov);
    modalClose = close;
    return close;
  };
  const btn = (label, fn, cls) => h("button", { class: "btn " + (cls || ""), type: "button", onclick: fn, text: label });
  const confirmBox = (title, msg, okLabel, fn, danger) =>
    modal(title, h("p", { class: "dim", text: msg }), (close) => [
      btn(okLabel, () => { close(); fn(); }, danger ? "danger" : ""),
      btn("Cancelar", close, "ghost"),
    ]);

  // ------------------------------------------------------------ sessão + API (Supabase)
  const SKEY = "dm_session";
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (_) { sess = null; }
  const saveSess = (o) => {
    sess = {
      access: o.access_token, refresh: o.refresh_token,
      exp: Date.now() + (o.expires_in || 3600) * 1000,
      uid: (o.user && o.user.id) || (sess && sess.uid), email: (o.user && o.user.email) || (sess && sess.email),
    };
    try { localStorage.setItem(SKEY, JSON.stringify(sess)); } catch (_) {}
  };
  const clearSess = () => { sess = null; try { localStorage.removeItem(SKEY); } catch (_) {} };

  class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  const friendly = (code, body) => {
    let msg = "", ec = "";
    try { const o = JSON.parse(body); msg = o.msg || o.message || o.error_description || o.error || ""; ec = o.error_code || o.code || ""; } catch (_) {}
    const low = (msg + " " + ec).toLowerCase();
    if (low.includes("invalid login") || low.includes("invalid_credentials")) return "E-mail ou senha incorretos.";
    if (low.includes("already registered") || low.includes("user_already_exists")) return "Esse e-mail já tem conta. Toque em Entrar.";
    if (low.includes("weak_password") || low.includes("password should be")) return "Senha fraca. Use pelo menos 10 caracteres com letras e números.";
    if (low.includes("email_not_confirmed") || low.includes("not confirmed")) return "Confirme seu e-mail para entrar (veja sua caixa de entrada).";
    if (low.includes("rate limit") || low.includes("over_request_rate_limit") || code === 429) return "Muitas tentativas. Espere um pouco e tente de novo.";
    if (low.includes("captcha")) return "Verificação de segurança necessária. Tente de novo em instantes.";
    if (ec === "P0001" && msg) return msg;
    if (code === 401) return "Sessão expirada. Entre de novo.";
    return "Algo deu errado (código " + code + "). Tente de novo.";
  };

  const rawFetch = async (method, path, body, bearer) => {
    const headers = { apikey: C.SUPABASE_KEY };
    if (bearer) headers.Authorization = "Bearer " + bearer;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(C.SUPABASE_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer" });
    return { code: r.status, text: await r.text() };
  };
  let refreshing = null;
  const refreshNow = () => {
    if (!sess || !sess.refresh) return Promise.resolve(false);
    if (!refreshing) {
      refreshing = rawFetch("POST", "/auth/v1/token?grant_type=refresh_token", { refresh_token: sess.refresh })
        .then((r) => {
          if (r.code >= 200 && r.code < 300) { saveSess(JSON.parse(r.text)); return true; }
          if (r.code >= 400 && r.code < 500) clearSess();
          return false;
        }).catch(() => false).finally(() => { refreshing = null; });
    }
    return refreshing;
  };
  const token = async () => {
    if (!sess) throw new ApiError(401, "Sessão expirada. Entre de novo.");
    if (Date.now() > sess.exp - 60000 && !(await refreshNow())) throw new ApiError(401, "Sessão expirada. Entre de novo.");
    return sess.access;
  };
  const call = async (method, path, body) => {
    let t = await token();
    let r = await rawFetch(method, path, body, t);
    if (r.code === 401 && (await refreshNow())) r = await rawFetch(method, path, body, sess.access);
    if (r.code < 200 || r.code >= 300) throw new ApiError(r.code, friendly(r.code, r.text));
    return r.text ? JSON.parse(r.text) : null;
  };
  const api = {
    async signIn(email, pass) {
      const r = await rawFetch("POST", "/auth/v1/token?grant_type=password", { email, password: pass });
      if (r.code < 200 || r.code >= 300) throw new ApiError(r.code, friendly(r.code, r.text));
      saveSess(JSON.parse(r.text));
    },
    async signUp(email, pass) {
      const r = await rawFetch("POST", "/auth/v1/signup", { email, password: pass });
      if (r.code < 200 || r.code >= 300) throw new ApiError(r.code, friendly(r.code, r.text));
      const o = JSON.parse(r.text);
      if (o.access_token) { saveSess(o); return true; }
      return false;
    },
    async signOut() { try { if (sess) await rawFetch("POST", "/auth/v1/logout", undefined, sess.access); } catch (_) {} clearSess(); },
    async profile() {
      const a = await call("GET", "/rest/v1/profiles?select=*&id=eq." + encodeURIComponent(sess.uid));
      if (!a.length) throw new ApiError(404, "Perfil não encontrado. Saia e entre de novo.");
      return a[0];
    },
    ranking: () => call("GET", "/rest/v1/ranking?select=*&order=position.asc,display_name.asc&limit=10"),
    verifiedIds: async () => {
      try { const a = await call("POST", "/rest/v1/rpc/verified_ids", {}); return new Set(a.map((v) => (v && typeof v === "object" ? v.verified_ids || v.id : v))); } catch (_) { return new Set(); }
    },
    acceptTerms: (v) => call("POST", "/rest/v1/rpc/accept_terms", { p_version: v }),
    completeProfile: (name, bio) => call("POST", "/rest/v1/rpc/complete_profile", { p_display_name: name, p_bio: bio, p_country: "BR", p_avatar_url: null }),
    hasPin: async () => { try { return (await call("POST", "/rest/v1/rpc/has_security_pin", {})) === true; } catch (_) { return false; } },
    setPin: (pin, cur) => call("POST", "/rest/v1/rpc/set_my_security_pin", { p_pin: pin, p_current: cur || null }),
    changeUsername: (u) => call("POST", "/rest/v1/rpc/change_username", { p_username: u }),
    deleteAccount: async () => { await call("POST", "/rest/v1/rpc/delete_my_account", {}); clearSess(); },
  };
  const bg = async (fn, ok, fail) => {
    try { const r = await fn(); if (ok) ok(r); }
    catch (e) {
      if (e instanceof ApiError && e.code === 401 && !sess) { toast(e.message); S.me = null; Game.stop(); show(); return; }
      toast(e instanceof ApiError ? e.message : "Sem conexão. Tente de novo.");
      if (fail) fail(e);
    }
  };

  // ------------------------------------------------------------ conexão em tempo real
  const Game = {
    ws: null, connected: false, wanted: false, attempt: 0, state: null, offset: 0, tickFn: null, lastStatus: "", animDone: false,
    cfg: { minDepositCents: 1000, feePercent: 25, minStakeCents: 100, maxStakeCents: 50000, maxMines: 10 },
    start() { if (this.wanted && this.ws) return; this.wanted = true; this.attempt = 0; this.open(); },
    stop() { this.wanted = false; this.connected = false; this.state = null; try { if (this.ws) this.ws.close(1000); } catch (_) {} this.ws = null; },
    open() {
      if (!this.wanted) return;
      let w;
      try { w = new WebSocket(C.WS_URL); } catch (_) { return this.lost(null); }
      this.ws = w;
      w.onopen = async () => {
        try { w.send(JSON.stringify({ type: "auth", token: await token() })); } catch (_) { try { w.close(); } catch (__) {} }
      };
      w.onmessage = (ev) => { if (w === this.ws) { let o; try { o = JSON.parse(ev.data); } catch (_) { return; } this.handle(o); } };
      w.onclose = () => this.lost(w);
      w.onerror = () => {};
    },
    // Ao voltar para a aba: se a conexão caiu ou ficou escondida mais de 15 s, reconecta já.
    reconnectNow(force) {
      if (!this.wanted) return;
      if (this.connected && !force) return;
      clearTimeout(this.retryTimer);
      const old = this.ws; this.ws = null; this.connected = false;
      try { if (old) old.close(1000); } catch (_) {}
      this.attempt = 0; this.open();
    },
    lost(w) {
      if (w && w !== this.ws) return;
      this.connected = false;
      if (this.wanted) { this.attempt++; this.retryTimer = setTimeout(() => this.open(), Math.min(15000, 1500 * this.attempt)); }
    },
    send(type, extra) {
      if (!this.ws || !this.connected || this.ws.readyState !== 1) return false;
      this.ws.send(JSON.stringify(Object.assign({ type }, extra || {})));
      return true;
    },
    handle(o) {
      switch (o.type) {
        case "hello": {
          this.connected = true; this.attempt = 0;
          for (const k of Object.keys(this.cfg)) if (o[k] != null) this.cfg[k] = o[k];
          this.send("sync");
          break;
        }
        case "state":
          this.state = o.room || null;
          if (this.state) this.offset = (this.state.serverNow || Date.now()) - Date.now();
          closeSearching();
          if (this.state) renderRoom();
          break;
        case "matchmaking_searching": showSearching(o.stakeCents, o.mines); break;
        case "matchmaking_cancelled": closeSearching(); break;
        case "withdraw_success": toast("Pedido de saque de " + money(o.cents) + " enviado!"); refreshProfile(); break;
        case "profile_updated": refreshProfile(); break;
        case "room_info": showJoinConfirm(o); break;
        case "room_closed": this.state = null; S.inRoom = false; toast(o.message || "A sala foi encerrada."); refreshProfile(true); break;
        case "left": if (S.inRoom) { this.state = null; S.inRoom = false; this.lastStatus = ""; refreshProfile(true); } break;
        case "error": unlockAll(); toast(o.message || "Algo deu errado."); break;
        case "pix_deposit": showPix(o); break;
        case "deposit_status": if (o.status === "credited") { if (S.onCredit) S.onCredit(o.identifier); refreshProfile(); } break;
      }
    },
  };
  const secondsLeft = (dl) => Math.max(0, Math.floor((dl - (Date.now() + Game.offset) + 999) / 1000));
  setInterval(() => { if (Game.tickFn) Game.tickFn(); }, 250);

  // ------------------------------------------------------------ estado + roteamento
  const S = { me: null, tab: 0, inRoom: false, onCredit: null };
  const refreshProfile = (goMain) => bg(() => api.profile(), (p) => { S.me = p; if (goMain) { S.tab = 0; show(); } else updateBalance(); });
  const updateBalance = () => document.querySelectorAll("[data-bal]").forEach((e) => { e.textContent = money(S.me && S.me.balance_cents); });

  const show = () => {
    Game.tickFn = null; S.inRoom = false; closeModal();
    if (!sess) return viewAuth();
    if (!S.me) return viewLoading();
    if (S.me.terms_version !== window.TERMS_VERSION) return viewTerms();
    if (!S.me.profile_done) return viewSetup();
    Game.start();
    if (Game.state) return renderRoom();
    viewMain();
  };
  const closeModal = () => { if (modalClose) modalClose(); };
  const mount = (...nodes) => { app.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); window.scrollTo(0, 0); };

  const viewLoading = () => {
    mount(h("h1", { class: "center mt20", text: "Duelo de Minas" }), h("p", { class: "dim center", text: "Carregando…" }));
    bg(() => api.profile(), (p) => { S.me = p; show(); }, () => {
      if (!sess) return show();
      mount(h("h1", { class: "center mt20", text: "Duelo de Minas" }), h("p", { class: "dim center", text: "Sem conexão." }), btn("Tentar de novo", viewLoading));
    });
  };

  const logout = () => { Game.stop(); closeSearching(); bg(() => api.signOut(), () => { S.me = null; show(); }); };

  // ------------------------------------------------------------ login / cadastro
  const viewAuth = () => {
    let signup = false;
    const email = h("input", { type: "email", autocomplete: "email", placeholder: "seu@email.com", maxLength: 120 });
    const pass = h("input", { type: "password", autocomplete: "current-password", placeholder: "Senha", maxLength: 72 });
    const note = h("p", { class: "faint" });
    const go = btn("Entrar", async () => {
      const e = email.value.trim(), p = pass.value;
      if (!e.includes("@") || p.length < 8) return toast("Informe e-mail e senha (mínimo 8 caracteres).");
      busy(go, true);
      await bg(async () => (signup ? api.signUp(e, p) : (await api.signIn(e, p), true)), (ok) => {
        if (ok) { S.me = null; show(); }
        else { toast("Conta criada! Confirme seu e-mail e depois entre."); signup = false; paint(); busy(go, false); }
      }, () => busy(go, false));
    });
    const toggle = h("button", { class: "link", type: "button" });
    const paint = () => {
      go.textContent = signup ? "Criar conta" : "Entrar";
      toggle.textContent = signup ? "Já tenho conta" : "Criar conta nova";
      pass.autocomplete = signup ? "new-password" : "current-password";
      note.textContent = signup ? "Use 10+ caracteres com letras e números. O Duelo de Minas é só para maiores de 18 anos." : "";
    };
    toggle.onclick = () => { signup = !signup; paint(); };
    paint();
    mount(h("h1", { class: "center mt20", text: "Duelo de Minas" }), h("p", { class: "dim center", text: "Entre para jogar seu x1." }),
      h("div", { class: "card" }, h("div", { class: "label", text: "E-MAIL" }), email, h("div", { class: "label", text: "SENHA" }), pass, note, go, h("div", { class: "center" }, toggle)));
  };

  const viewTerms = () => {
    const chk = h("input", { type: "checkbox", id: "okterms" });
    const go = btn("Aceitar e continuar", () => {
      if (!chk.checked) return toast("Marque que leu e aceita os termos.");
      busy(go, true);
      bg(async () => { await api.acceptTerms(window.TERMS_VERSION); return api.profile(); }, (p) => { S.me = p; show(); }, () => busy(go, false));
    });
    mount(h("h1", { text: "Termos de uso" }), h("div", { class: "card" }, h("div", { class: "pre", text: window.TERMS_TEXT }),
      h("label", { class: "check", for: "okterms" }, chk, h("span", { class: "dim", text: "Li e aceito os termos e declaro ter 18 anos ou mais." })), go,
      btn("Sair", logout, "ghost")));
  };

  const viewSetup = () => {
    const name = h("input", { maxLength: 20, placeholder: "Como você quer ser chamado" });
    const bio = h("textarea", { maxLength: 200, rows: 3, placeholder: "Fale um pouco sobre você (opcional)" });
    const go = btn("Concluir", () => {
      const n = name.value.trim();
      if (n.length < 3) return toast("O nome precisa ter pelo menos 3 letras.");
      busy(go, true);
      bg(async () => { await api.completeProfile(n, bio.value.trim()); return api.profile(); }, (p) => { S.me = p; show(); }, () => busy(go, false));
    });
    mount(h("h1", { text: "Seu perfil" }), h("p", { class: "dim", text: "Antes de jogar, conte quem você é." }),
      h("div", { class: "card" }, h("div", { class: "label", text: "NOME DE EXIBIÇÃO" }), name, h("div", { class: "label", text: "BIO" }), bio, go, btn("Sair", logout, "ghost")));
  };

  // ------------------------------------------------------------ telas principais
  const header = () => h("div", { class: "top" }, avatar(S.me.display_name, S.me.avatar_url),
    h("div", { class: "who" }, h("span", { class: "dim", text: greeting() }), h("b", { text: S.me.display_name || "Jogador" })),
    h("button", { class: "bal", type: "button", "data-bal": "1", text: money(S.me.balance_cents), onclick: showDeposit, "aria-label": "Adicionar saldo" }));
  const greeting = () => { const x = new Date().getHours(); return x < 12 ? "Bom dia" : x < 18 ? "Boa tarde" : "Boa noite"; };

  const viewMain = () => {
    const tabs = ["Lobby", "Amigos", "Ranking", "Perfil"];
    const content = h("div");
    const nav = h("nav", { class: "nav" }, tabs.map((t, i) => h("button", { type: "button", class: i === S.tab ? "on" : "", text: t, onclick: () => { S.tab = i; viewMain(); } })));
    mount(header(), content, nav);
    [tabLobby, tabFriends, tabRanking, tabProfile][S.tab](content);
  };

  let lobbyMines = 5;
  const tabLobby = (root) => {
    const stake = h("input", { inputMode: "decimal", placeholder: "Ex.: 2,00", maxLength: 9 });
    const info = h("p", { class: "dim center mt8" });
    const calc = () => {
      const c = parseCents(stake.value);
      info.textContent = c ? "Total: " + money(c + feeOf(c)) + " (com taxa) • Vencedor leva: " + money(c * 2) : "Mínimo " + money(Game.cfg.minStakeCents) + " • Máximo " + money(Game.cfg.maxStakeCents);
    };
    stake.addEventListener("input", calc); calc();
    const chips = (list, get, set, fmt) => {
      const row = h("div", { class: "chips" });
      const paint = () => row.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.v === String(get())));
      list.forEach((v) => row.append(h("button", { class: "chip", type: "button", "data-v": v, text: fmt(v), onclick: () => { set(v); paint(); } })));
      paint(); return row;
    };
    const go = btn("ENCONTRAR PARTIDA", () => {
      const c = parseCents(stake.value);
      if (!c || c < Game.cfg.minStakeCents || c > Game.cfg.maxStakeCents) return toast("O valor precisa ficar entre " + money(Game.cfg.minStakeCents) + " e " + money(Game.cfg.maxStakeCents) + ".");
      if ((S.me.balance_cents || 0) < c + feeOf(c)) return toast("Saldo insuficiente (" + money(S.me.balance_cents) + "). Adicione saldo para buscar partida.");
      if (!Game.send("find_match", { stakeCents: c, mines: lobbyMines })) toast("Conectando ao servidor… tente em instantes.");
    });
    root.append(h("div", { class: "card" }, h("h2", { text: "Encontrar Partida" }), h("p", { class: "dim", text: "Dispute contra outros jogadores online." }),
      h("div", { class: "label", text: "QUANTIDADE DE MINAS" }), chips([1, 3, 5, 7, 10], () => lobbyMines, (v) => { lobbyMines = v; }, String),
      h("div", { class: "label", text: "VALOR DO X1 (R$)" }), stake,
      chips([2, 5, 10, 20], () => null, (v) => { stake.value = v + ",00"; calc(); }, (v) => "R$ " + v), info, go));
  };
  const feeOf = (c) => Math.round((c * Game.cfg.feePercent) / 100);

  const tabFriends = (root) => {
    root.append(h("h1", { text: "Amigos" }), h("p", { class: "dim", text: "Jogue um x1 com um amigo: crie uma sala ou entre com o código." }),
      h("div", { class: "card" }, h("p", { class: "dim", text: "Saldo: " }, h("b", { "data-bal": "1", text: money(S.me.balance_cents) })),
        h("h2", { text: "Criar sala" }), h("p", { class: "dim", text: "Defina nome, valor e minas. Depois é só passar o código." }), btn("Criar sala", showCreateRoom)),
      h("div", { class: "card" }, h("h2", { text: "Entrar em uma sala" }), h("p", { class: "dim", text: "Recebeu um código de um amigo? Digite aqui." }), btn("Entrar com código", showJoinCode, "ghost")));
  };

  const tabRanking = (root) => {
    const box = h("div", { class: "list", text: "Carregando…" });
    root.append(h("h1", { text: "Ranking" }), h("p", { class: "dim", text: "Top 10 global do Duelo de Minas." }), h("div", { class: "card" }, box));
    bg(async () => [await api.ranking(), await api.verifiedIds()], ([list, ver]) => {
      box.replaceChildren(...(list.length ? list.map((o, i) => h("div", { class: "item" }, h("div", { class: "pos", text: String(o.position || i + 1) }), avatar(o.display_name, o.avatar_url),
        h("div", { class: "name" }, h("b", {}, nameBadge(o.display_name, ver.has(o.id)))), h("div", { class: "dim", text: (o.wins || 0) + " vitórias" }))) : [h("p", { class: "dim", text: "Ainda sem jogadores no ranking." })]));
    }, () => { box.textContent = "Não foi possível carregar o ranking."; });
  };

  const tabProfile = (root) => {
    const p = S.me;
    root.append(h("div", { class: "card center" }, avatar(p.display_name, p.avatar_url, true), h("h2", { class: "mt14" }, nameBadge(p.display_name, p.verified)),
      h("p", { class: "dim", text: "@" + (p.username || "") }), p.bio ? h("p", { class: "dim", text: p.bio }) : null,
      h("p", { class: "big", "data-bal": "1", text: money(p.balance_cents) }), btn("Adicionar saldo", showDeposit), btn("Sacar saldo", showWithdraw, "ghost")),
      h("div", { class: "card" }, btn("Senha de 6 dígitos", showPinSetup, "ghost"), btn("Alterar @usuário", showChangeUsername, "ghost"), btn("Sair da conta", logout, "ghost"),
        btn("Excluir minha conta", () => confirmBox("Excluir conta?", "Isso apaga seu perfil e não dá para desfazer. Contas com partida em andamento não podem ser apagadas.", "Excluir", () => bg(() => api.deleteAccount(), () => { Game.stop(); S.me = null; show(); }), true), "danger")));
  };

  // ------------------------------------------------------------ modais (saldo, pin, salas)
  const pinInput = (ph) => h("input", { type: "password", inputMode: "numeric", autocomplete: "off", maxLength: 6, placeholder: ph || "6 dígitos", pattern: "[0-9]*" });
  const digits6 = (s) => /^\d{6}$/.test(s);

  const askPin = (title, msg, fn) => {
    const pin = pinInput();
    modal(title, h("div", {}, h("p", { class: "dim", text: msg }), pin), (close) => [
      btn("Confirmar", () => { if (!digits6(pin.value)) return toast("Digite sua senha de 6 números."); const v = pin.value; close(); fn(v); }), btn("Cancelar", close, "ghost")]);
    setTimeout(() => pin.focus(), 50);
  };

  const showPinSetup = () => bg(api.hasPin, (has) => {
    const cur = has ? pinInput("Senha atual") : null, p1 = pinInput("Nova senha"), p2 = pinInput("Repita a nova senha");
    modal(has ? "Trocar senha de 6 dígitos" : "Cadastrar senha de 6 dígitos", h("div", {}, h("p", { class: "dim", text: "Ela autoriza pagamentos e saques. Só números." }), cur, h("div", { class: "mt8" }, p1), h("div", { class: "mt8" }, p2)), (close) => [
      btn("Salvar", () => {
        if (!digits6(p1.value)) return toast("A senha precisa ter exatamente 6 números.");
        if (p1.value !== p2.value) return toast("As senhas não coincidem.");
        if (cur && !digits6(cur.value)) return toast("Digite a senha atual.");
        bg(() => api.setPin(p1.value, cur ? cur.value : null), () => { close(); toast("Senha salva!"); });
      }), btn("Cancelar", close, "ghost")]);
  });

  const showChangeUsername = () => {
    const u = h("input", { maxLength: 20, value: S.me.username || "", autocapitalize: "none", autocomplete: "off" });
    modal("Alterar @usuário", u, (close) => [btn("Salvar", () => bg(() => api.changeUsername(u.value.trim().toLowerCase()), () => { close(); refreshProfile(); toast("Usuário alterado."); })), btn("Cancelar", close, "ghost")]);
  };

  const showDeposit = () => {
    const min = Game.cfg.minDepositCents;
    const amount = h("input", { inputMode: "decimal", placeholder: "0,00", maxLength: 9 });
    const cpf = h("input", { inputMode: "numeric", placeholder: "CPF (só números)", maxLength: 14, autocomplete: "off" });
    const chips = h("div", { class: "chips" }, [10, 20, 50, 100].map((v) => h("button", { class: "chip", type: "button", text: "R$ " + v, onclick: () => { amount.value = v + ",00"; } })));
    modal("Adicionar saldo", h("div", {}, h("div", { class: "label", text: "VALOR (R$)" }), amount, chips, h("div", { class: "label", text: "CPF DO PAGADOR" }), cpf,
      h("p", { class: "faint", text: "Depósito mínimo: " + money(min) + ". Após gerar o Pix, pague e o saldo entra sozinho." })), (close) => [
      btn("Gerar Pix", () => {
        const c = parseCents(amount.value), d = cpf.value.replace(/\D/g, "");
        if (!c || c < min) return toast("O depósito mínimo é " + money(min) + ".");
        if (d.length !== 11) return toast("Informe um CPF válido com 11 dígitos.");
        if (!Game.send("deposit", { cents: c, cpf: d })) return toast("Conectando ao servidor… tente em instantes.");
        close();
      }), btn("Cancelar", close, "ghost")]);
  };

  const showPix = (o) => {
    if (!o.pixCode) return toast("Não veio o código Pix.");
    const done = h("p", { class: "dim center", text: "Aguardando o pagamento…" });
    const close = modal("Pague com Pix " + money(o.cents), h("div", {}, h("p", { class: "dim", text: "Copie o código e cole no app do seu banco (Pix Copia e Cola)." }), h("div", { class: "code", text: o.pixCode }), done), (cl) => [
      btn("Copiar código", async (ev) => { try { await navigator.clipboard.writeText(o.pixCode); ev.target.textContent = "Copiado ✔"; } catch (_) { toast("Não deu para copiar. Selecione o texto."); } }),
      btn("Fechar", () => { cl(); S.onCredit = null; Game.send("deposit_cancel", { identifier: o.identifier }); }, "ghost")]);
    S.onCredit = (id) => { if (id === o.identifier) { done.textContent = "Pagamento recebido! Seu saldo foi atualizado ✔"; done.className = "ok center"; S.onCredit = null; } };
    void close;
  };

  const showWithdraw = () => {
    const amount = h("input", { inputMode: "decimal", placeholder: "Mínimo R$ 20,00", maxLength: 9 });
    const type = h("select", { class: "chip" }, [["cpf", "CPF"], ["cnpj", "CNPJ"], ["email", "E-mail"], ["phone", "Telefone"], ["random", "Chave aleatória"]].map(([v, t]) => h("option", { value: v, text: t })));
    const key = h("input", { placeholder: "Sua chave Pix", maxLength: 140, autocomplete: "off" });
    modal("Sacar saldo", h("div", {}, h("p", { class: "dim", text: "Saldo: " + money(S.me.balance_cents) }), h("div", { class: "label", text: "VALOR (R$)" }), amount, h("div", { class: "label", text: "TIPO DA CHAVE" }), type, h("div", { class: "label", text: "CHAVE PIX" }), key), (close) => [
      btn("Continuar", () => {
        const c = parseCents(amount.value);
        if (!c || c < 2000) return toast("O saque mínimo é R$ 20,00.");
        if (c > (S.me.balance_cents || 0)) return toast("Saldo insuficiente.");
        if (key.value.trim().length < 3) return toast("Informe a chave Pix.");
        const k = key.value.trim(), t = type.value;
        close();
        askPin("Confirmar saque", "Digite sua senha de 6 dígitos para sacar " + money(c) + ":", (pin) => { if (!Game.send("withdraw", { cents: c, pixType: t, pixKey: k, pin })) toast("Conectando ao servidor… tente em instantes."); });
      }), btn("Cancelar", close, "ghost")]);
  };

  const showCreateRoom = () => {
    if (!Game.connected) return toast("Conectando ao servidor… tente em instantes.");
    let mines = 5;
    const name = h("input", { maxLength: 24, placeholder: "Ex.: Duelo dos amigos" });
    const stake = h("input", { inputMode: "decimal", placeholder: "Ex.: 2,00", maxLength: 9 });
    const code = h("input", { maxLength: 20, value: randomCode(), autocapitalize: "characters", autocomplete: "off" });
    const num = h("div", { class: "big", text: String(mines) });
    const calc = h("p", { class: "dim" });
    const upd = () => { const c = parseCents(stake.value); calc.textContent = c ? "Cada jogador paga " + money(c + feeOf(c)) + ". O vencedor leva " + money(c * 2) + "." : "Mínimo " + money(Game.cfg.minStakeCents) + " • máximo " + money(Game.cfg.maxStakeCents); };
    stake.addEventListener("input", upd); upd();
    const codeBox = h("div", { hidden: true }, h("div", { class: "label", text: "CÓDIGO DA SALA" }), code);
    const custom = h("button", { class: "link", type: "button", text: "Personalizar código", onclick: () => { codeBox.hidden = false; custom.hidden = true; } });
    modal("Criar sala", h("div", {}, h("p", { class: "faint", text: "Só entra quem tiver o código da sala." }), h("div", { class: "label", text: "NOME DA SALA" }), name, h("div", { class: "label", text: "VALOR DO X1 (R$)" }), stake, calc,
      h("div", { class: "label", text: "MINAS POR JOGADOR" }), h("div", { class: "row" }, btn("−", () => { if (mines > 1) num.textContent = String(--mines); }, "ghost"), num, btn("+", () => { if (mines < Game.cfg.maxMines) num.textContent = String(++mines); }, "ghost")),
      custom, codeBox), (close) => [
      btn("Criar sala", () => {
        const n = name.value.trim(), c = parseCents(stake.value), cd = code.value.trim().toUpperCase();
        if (n.length < 3) return toast("Dê um nome para a sala (mínimo 3 letras).");
        if (!c || c < Game.cfg.minStakeCents || c > Game.cfg.maxStakeCents) return toast("O valor precisa estar entre " + money(Game.cfg.minStakeCents) + " e " + money(Game.cfg.maxStakeCents) + ".");
        if (!/^[A-Z0-9]{4,20}$/.test(cd)) return toast("O código precisa ter de 4 a 20 letras ou números.");
        if (Game.send("create", { name: n, code: cd, stakeCents: c, mines, isPublic: false })) close();
      }), btn("Voltar", close, "ghost")]);
  };

  let joinCode = "";
  const showJoinCode = () => {
    if (!Game.connected) return toast("Conectando ao servidor… tente em instantes.");
    const e = h("input", { maxLength: 20, placeholder: "CÓDIGO", autocapitalize: "characters", autocomplete: "off", class: "center" });
    e.addEventListener("input", () => { e.value = e.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(); });
    modal("Entrar em uma sala", h("div", {}, h("p", { class: "dim", text: "Digite o código que seu adversário te passou." }), e), (close) => [
      btn("Continuar", () => { if (e.value.length < 4) return toast("Digite o código completo (4 a 20 letras ou números)."); joinCode = e.value; if (Game.send("join_info", { code: joinCode })) close(); }), btn("Cancelar", close, "ghost")]);
    setTimeout(() => e.focus(), 50);
  };
  const showJoinConfirm = (o) => {
    const line = (k, v, b) => h("div", { class: "row" }, h("span", { class: "dim", text: k }), h(b ? "b" : "span", { text: v }));
    modal("Entrar na sala?", h("div", {}, line("Sala", o.name, 1), line("Criada por", o.creator), line("Minas", String(o.mines)), line("Aposta", money(o.stakeCents)), line("Taxa", money(o.feeCents)),
      line("Total a pagar", money(o.stakeCents + o.feeCents), 1), line("Quem vencer leva", money(o.stakeCents * 2), 1)), (close) => [
      btn("Entrar", () => { Game.send("join", { code: o.code || joinCode }); close(); }), btn("Não", close, "ghost")]);
  };

  // busca de partida
  let searching = null;
  const showSearching = (stake, mines) => {
    closeSearching();
    const t = h("div", { class: "timer", text: "00:00" });
    const t0 = Date.now();
    const iv = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); t.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }, 1000);
    const close = modal("Procurando adversário", h("div", {}, h("p", { class: "dim center", text: mines + " minas • Aposta: " + money(stake) }), t, h("p", { class: "dim center", text: "Buscando jogadores online…" })), () => [btn("Cancelar busca", () => { Game.send("cancel_match"); closeSearching(); }, "ghost")]);
    searching = () => { clearInterval(iv); close(); };
  };
  const closeSearching = () => { if (searching) { const s = searching; searching = null; s(); } };

  // ------------------------------------------------------------ sala / partida
  const leave = () => {
    const st = Game.state ? Game.state.status : "";
    const msg = st === "playing" ? "Se você sair agora, perde a partida e o valor apostado." : st === "checkout" || st === "placing" ? "Se você sair agora, a partida é cancelada e o valor pago volta para o seu saldo." : "Deseja sair da sala?";
    confirmBox("Sair da sala?", msg, "Sair", () => Game.send("leave"), true);
  };
  const leaveBtn = (label) => btn(label || "Sair da sala", leave, "ghost");
  const players = (st) => st.players || [];
  const board = (cls, fill, onTap) => {
    const g = h("div", { class: "board " + (cls || "") });
    for (let i = 0; i < 25; i++) {
      const c = h("button", { type: "button", class: "cell", "aria-label": "Casa " + (i + 1), disabled: !onTap });
      fill(c, i);
      if (onTap) c.addEventListener("click", () => onTap(i, c));
      g.append(c);
    }
    return g;
  };
  const mark = (c, cls, sym) => { c.classList.add(cls); c.textContent = sym; };
  const has = (arr, i) => Array.isArray(arr) && arr.includes(i);

  const renderRoom = () => {
    const st = Game.state;
    if (!st) return;
    S.inRoom = true; closeModal();
    const animate = st.status !== Game.lastStatus;
    if (animate) Game.animDone = false;
    Game.lastStatus = st.status; Game.tickFn = null;
    const view = { waiting: roomWaiting, lobby: roomLobby, checkout: roomCheckout, placing: roomPlacing, playing: roomPlaying }[st.status] || roomOver;
    mount(...view(st));
  };
  const roomHeader = (st, sub) => [h("h1", { text: st.name }), h("p", { class: "dim", text: sub }), h("p", { class: "dim", text: st.mines + " minas • Valor " + money(st.stakeCents) + " • Taxa " + money(st.feeCents) })];

  const roomWaiting = (st) => [...roomHeader(st, "Aguardando seu adversário entrar…"),
    h("div", { class: "card center" }, h("div", { class: "label", text: "CÓDIGO DA SALA" }), h("div", { class: "big", text: st.code }), h("p", { class: "faint", text: "Só entra quem tiver o código da sala." }),
      btn("Copiar código", async (ev) => { try { await navigator.clipboard.writeText(st.code); ev.target.textContent = "Copiado ✔"; } catch (_) { toast("Não deu para copiar."); } })), leaveBtn()];

  const vsRow = (st, extra) => {
    const row = h("div", { class: "vs" });
    players(st).forEach((p, i) => {
      if (i === 1) row.append(h("div", { class: "x", text: "VS" }));
      const [t, ok] = extra(p);
      row.append(h("div", {}, avatar(p.name, p.avatar, true), h("div", { class: "mt8" }, h("b", {}, nameBadge(p.name, p.verified))), h("div", { class: ok ? "ok faint" : "faint", text: t })));
    });
    return row;
  };
  const meOf = (st) => players(st).find((p) => p.id === st.you);

  const roomLobby = (st) => {
    const me = meOf(st);
    return [...roomHeader(st, "Sala completa! Confirmem para começar."), h("div", { class: "card" }, vsRow(st, (p) => (p.confirmed ? ["Confirmou", true] : ["Aguardando…", false]))),
      me && me.confirmed ? h("p", { class: "dim center mt20", text: "Aguardando o adversário confirmar a partida…" }) : btn("Confirmar partida", () => Game.send("confirm")), leaveBtn()];
  };

  const roomCheckout = (st) => {
    const me = meOf(st), total = st.stakeCents + st.feeCents;
    const timer = h("p", { class: "dim center mt14" });
    Game.tickFn = () => { if (st.deadline) timer.textContent = "Tempo para pagar: " + secondsLeft(st.deadline) + "s"; };
    const pay = btn("Pagar " + money(total), async () => {
      busy(pay, true);
      const has = await api.hasPin();
      busy(pay, false);
      if (!has) { toast("Cadastre sua senha de 6 dígitos primeiro."); return showPinSetup(); }
      askPin("Confirmar pagamento", "Digite sua senha de 6 dígitos para pagar " + money(total) + ":", (pin) => { busy(pay, true); Game.send("pay", { pin }); });
    });
    return [...roomHeader(st, "Pagamento da partida"), h("div", { class: "card" }, h("p", { text: "Valor do x1: " + money(st.stakeCents) }), h("p", { text: "Taxa do app: " + money(st.feeCents) }), h("p", { class: "big", text: "Total: " + money(total) }),
      h("p", { class: "faint", text: "O vencedor leva " + money(st.stakeCents * 2) + ". Se a partida for cancelada antes de começar, o valor volta para o seu saldo." })),
      h("p", { class: "dim mt14" }, "Seu saldo: ", h("b", { "data-bal": "1", text: money(S.me.balance_cents) })),
      me && me.paid ? h("p", { class: "ok center mt14", text: "✔ Pagamento feito. Aguardando o adversário pagar…" }) : pay, timer, leaveBtn("Cancelar e sair")];
  };

  const roomPlacing = (st) => {
    const me = meOf(st), need = st.mines, timer = h("p", { class: "dim center mt14" });
    Game.tickFn = () => { if (st.deadline) timer.textContent = "Tempo: " + secondsLeft(st.deadline) + "s"; };
    if (me && me.placed) {
      return [h("h1", { text: "Esconda suas minas" }), h("p", { class: "ok", text: "✔ Minas escondidas" }), board("", (c, i) => { if (has(st.myMines, i)) mark(c, "bomb", "💣"); }, null),
        h("p", { class: "dim center mt14", text: "Aguardando o adversário terminar a configuração das minas" }), timer, leaveBtn("Cancelar e sair")];
    }
    const sel = new Set();
    const counter = h("p", { class: "center mt14", text: "0 / " + need });
    const go = btn("Confirmar minas", () => {
      if (sel.size !== need) return toast("Escolha exatamente " + need + " casa(s).");
      busy(go, true); Game.send("place_mines", { cells: [...sel] });
    });
    go.disabled = true;
    const bd = board("", () => {}, (i, c) => {
      if (sel.has(i)) { sel.delete(i); c.classList.remove("sel"); c.textContent = ""; }
      else if (sel.size < need) { sel.add(i); mark(c, "sel", "💣"); }
      counter.textContent = sel.size + " / " + need; go.disabled = sel.size !== need;
    });
    return [h("h1", { text: "Esconda suas minas" }), h("p", { class: "dim", text: "Escolha " + need + " casa(s) do SEU tabuleiro. O adversário vai tentar adivinhar onde elas estão." }), bd, counter, go, timer, leaveBtn("Cancelar e sair")];
  };

  const ANIM_MS = 3500;
  const roomPlaying = (st) => {
    const ps = players(st), opp = ps.find((p) => p.id !== st.you);
    const startedAt = st.startedAt || 0;
    if (!Game.animDone && startedAt && Date.now() + Game.offset < startedAt + ANIM_MS) {
      const title = h("h1", { class: "center mt20", text: "Sorteando quem começa…" }), who = h("p", { class: "big", text: "" });
      const first = (ps.find((p) => p.id === st.first) || {}).name || "";
      Game.tickFn = () => {
        const now = Date.now() + Game.offset, end = startedAt + ANIM_MS;
        if (now >= end) { Game.animDone = true; Game.tickFn = null; renderRoom(); }
        else if (now >= end - 900) { who.textContent = st.first === st.you ? "Você começa!" : first + " começa"; title.textContent = "Sorteado!"; }
        else who.textContent = (ps[Math.floor(now / 140) % Math.max(1, ps.length)] || {}).name || "";
      };
      return [title, who];
    }
    const myTurn = st.turn === st.you, timer = h("div", { class: "timer" });
    Game.tickFn = () => { if (st.deadline) { const s = secondsLeft(st.deadline); timer.textContent = s + "s"; timer.classList.toggle("bad", s <= 5); } };
    const opBoard = board("", (c, i) => { if (has(st.myPicks, i)) mark(c, "okc", "✔"); }, myTurn ? (i, c) => { if (!has(st.myPicks, i) && Game.send("pick", { cell: i })) c.textContent = "…"; } : null);
    const myBoard = board("small", (c, i) => {
      const bomb = has(st.myMines, i), hit = has(st.hitsOnMe, i);
      if (bomb && hit) mark(c, "bomb", "💥"); else if (bomb) mark(c, "sel", "💣"); else if (hit) mark(c, "okc", "✔");
    }, null);
    return [h("h2", { text: st.name }), h("p", { class: myTurn ? "ok" : "dim", text: myTurn ? "Sua vez! Abra uma casa do tabuleiro do adversário." : "Vez de " + ((opp && opp.name) || "adversário") + "…" }), timer,
      h("div", { class: "duel" }, h("div", {}, h("div", { class: "label", text: "TABULEIRO DE " + String((opp && opp.name) || "ADVERSÁRIO").toUpperCase() }), opBoard), h("div", {}, h("div", { class: "label", text: "SEU TABULEIRO" }), myBoard)), leaveBtn("Desistir e sair")];
  };

  const roomOver = (st) => {
    const res = st.result || {}, won = !!res.youWon, rm = st.rematch || {};
    const why = { mina: won ? "O adversário abriu uma mina." : "Você abriu uma mina.", tempo: "O tempo/casas acabaram.", abandono: won ? "O adversário saiu da partida." : "Você saiu da partida." }[res.reason] || "";
    const note = st.opponentLeft ? "O adversário saiu da sala." : rm.you ? "Revanche pedida. Aguardando o adversário…" : rm.opp ? "O adversário pediu revanche!" : "";
    const opp = res.oppMines || [];
    return [h("div", { class: "big mt20", text: won ? "🏆" : "✖" }), h("h1", { class: "center " + (won ? "ok" : "bad"), text: won ? "Você ganhou!" : "Você perdeu" }), why ? h("p", { class: "dim center", text: why }) : null,
      h("p", { class: "big", text: won ? "+ " + money(res.prizeCents) + " no seu saldo" : "- " + money(st.stakeCents + st.feeCents) }),
      opp.length ? [h("div", { class: "label", text: "MINAS DO ADVERSÁRIO" }), board("small", (c, i) => { if (has(opp, i)) mark(c, "bomb", "💣"); else if (has(st.myPicks, i)) mark(c, "okc", "✔"); }, null)] : null,
      note ? h("p", { class: "dim center mt14", text: note }) : null, !st.opponentLeft && !rm.you ? btn("Pedir revanche", () => Game.send("rematch")) : null,
      btn(won ? "Terminar partida" : "Voltar para o Lobby", () => Game.send("leave"), "ghost")];
  };

  // ------------------------------------------------------------ início
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!sess || !Game.wanted) return;
    if (!Game.connected || (hiddenAt && Date.now() - hiddenAt > 15000)) Game.reconnectNow(true);
    else Game.send("sync");
  });
  show();
})();
