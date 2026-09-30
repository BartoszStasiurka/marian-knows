---
title: Nginx jako reverse proxy
tags: [ops, nginx]
---
# Nginx jako reverse proxy

Wszystkie aplikacje stoją za nginxem na serwerach `edge-1` i `edge-2`. Nginx terminuje TLS i przekazuje ruch do kontenerów aplikacji.

## Konfiguracja wirtualnego hosta

Pliki konfiguracyjne leżą w `/etc/nginx/sites-available/`, a aktywne są podlinkowane w `sites-enabled/`. Minimalna konfiguracja nowej aplikacji:

```nginx
server {
    listen 443 ssl http2;
    server_name app.kompas.dev;
    ssl_certificate /etc/letsencrypt/live/app.kompas.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.kompas.dev/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Przeładowanie po zmianach

Zawsze sprawdź składnię przed przeładowaniem: `sudo nginx -t`, a potem `sudo systemctl reload nginx`. Reload nie zrywa aktywnych połączeń, restart tak — unikaj restartu w godzinach pracy.

## Typowe problemy

- 502 Bad Gateway — aplikacja nie słucha na porcie z `proxy_pass`; sprawdź kontener.
- 413 Request Entity Too Large — zwiększ `client_max_body_size` w bloku `server`.
- Pętla przekierowań — brakuje nagłówka `X-Forwarded-Proto`, a aplikacja wymusza HTTPS.
