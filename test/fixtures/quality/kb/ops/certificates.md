---
title: Certyfikaty TLS
tags: [ops, tls]
---
# Certyfikaty TLS

Certyfikaty dla naszych domen pochodzą z Let's Encrypt i są ważne 90 dni. Odnawiamy je automatycznie przez certbota.

## Automatyczne odnawianie

Na serwerach edge działa timer systemd `certbot.timer`, który dwa razy dziennie próbuje odnowić certyfikaty wygasające w ciągu 30 dni. Po udanym odnowieniu hook `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` przeładowuje nginx.

## Ręczne odnowienie certyfikatu

Gdy automat zawiedzie (np. zmienił się DNS), odnów certyfikat ręcznie:

```bash
sudo certbot renew --cert-name app.kompas.dev --force-renewal
sudo systemctl reload nginx
```

Nowy certyfikat dla nowej domeny: `sudo certbot certonly --webroot -w /var/www/acme -d nowa.kompas.dev`.

## Monitoring wygasania

Blackbox exporter sprawdza daty ważności. Alert `CertExpiringSoon` pojawia się, gdy do wygaśnięcia zostało mniej niż 14 dni — to znaczy, że automatyczne odnawianie nie działa od dwóch tygodni i trzeba to sprawdzić.
