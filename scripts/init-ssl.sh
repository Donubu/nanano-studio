#!/bin/bash
set -e

DOMAIN="puerto.studio"
EMAIL="mgomez@puer.to"
COMPOSE_FILE="docker-compose.gcp.yml"

echo "=== SSL Init for $DOMAIN ==="

# Step 1: Create a temporary nginx config (HTTP only, no SSL)
mkdir -p nginx/conf.d
cat > nginx/conf.d/default.conf <<'TMPCONF'
server {
    listen 80;
    server_name puerto.studio;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Setting up SSL...';
        add_header Content-Type text/plain;
    }
}
TMPCONF

# Step 2: Start nginx only
docker compose -f $COMPOSE_FILE up -d nginx

# Step 3: Request certificate
docker compose -f $COMPOSE_FILE run --rm certbot certonly \
    --webroot -w /var/www/certbot \
    -d $DOMAIN \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email

# Step 4: Restore full nginx config with SSL
cat > nginx/conf.d/default.conf <<'SSLCONF'
server {
    listen 80;
    server_name puerto.studio;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name puerto.studio;

    ssl_certificate /etc/letsencrypt/live/puerto.studio/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/puerto.studio/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 100M;

    location / {
        proxy_pass http://puerto_studio:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }
}
SSLCONF

# Step 5: Restart everything
docker compose -f $COMPOSE_FILE down
echo ""
echo "=== SSL certificate obtained! ==="
echo "Now run: docker compose -f $COMPOSE_FILE up -d --build"
