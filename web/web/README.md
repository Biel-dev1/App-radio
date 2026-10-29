# Duelo de Minas — versão web

Site estático (sem build). Pasta de publicação: `web`.

## Cloudflare Pages
1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → repositório `App-radio`.
2. Framework preset: **None**. Build command: *(vazio)*. Build output directory: **web**.
3. Deploy. O site ganha um endereço `https://NOME.pages.dev`.
4. **Render → Environment**: adicione `ALLOWED_ORIGINS` = o endereço do site (sem `/` no fim; vários separados por vírgula, ex. `https://NOME.pages.dev,https://seudominio.com.br`). Faça o Manual Deploy do servidor com o `server.js` novo. Sem isso o site não conecta.
5. Supabase → Auth → URL Configuration: coloque o endereço do site em *Site URL* e *Redirect URLs* (e-mail de confirmação).
6. (Opcional) domínio próprio: Pages → Custom domains. Depois inclua o domínio também em `ALLOWED_ORIGINS`.

Se mudar o endereço do servidor ou do Supabase, edite `config.js` **e** a linha `connect-src` em `_headers`.

## Segurança já incluída
- CSP estrita (`_headers`): só scripts e estilos do próprio site, sem inline.
- Texto de jogador sempre via `textContent` (sem XSS), HSTS, sem frames, sem referrer.
- Servidor aceita WebSocket só dos domínios em `ALLOWED_ORIGINS`.
- Saldo, apostas e resultado seguem decididos só pelo servidor.
