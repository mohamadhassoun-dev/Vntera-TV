# Panel proxy

`panel-proxy.worker.js` is a Cloudflare Worker that forwards `/xtream/*` to the
OTT panel. It exists because the panel is HTTP-only and CORS-free, which a page
served over HTTPS cannot call directly.

## Deploy

1. Create `wrangler.toml` in the repo root:

   ```toml
   name = "vntera-panel-proxy"
   main = "server/panel-proxy.worker.js"
   compatibility_date = "2025-01-01"

   [vars]
   PANEL_ORIGIN = "http://ontvflix.cc:8080"
   ALLOWED_HOSTS = "ontvflix.cc:8080"
   ```

2. `npx wrangler deploy`
3. Route the Worker on the same hostname as the app at path `/xtream/*`
   (Workers route `example.com/xtream/*`).
4. Build the app with `VITE_API_BASE=/xtream` (the default).

The Worker refuses hosts that are not in `ALLOWED_HOSTS`, strips cookies and
sets `no-store`. Anyone with the URL can proxy the panel through it, exactly as
the panel itself is public to whoever holds credentials, so keep the allow-list
to your provider only.

## Any other host

Nginx/Caddy equivalent:

```
location /xtream/ {
  proxy_pass http://ontvflix.cc:8080/;
  proxy_set_header Host ontvflix.cc:8080;
  proxy_ssl_server_name on;
  add_header Access-Control-Allow-Origin $http_origin always;
}
```
