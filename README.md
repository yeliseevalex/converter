# Converter Project

This repository now includes:

- static frontend in the root directory
- backend API in `api/` for server-side conversion

## API quick start

Requirements:

- Node.js **20+** (the API dependencies expect modern Node)

1. Install dependencies:

```bash
cd api
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

Set at least:

- `ADMIN_TOKEN` (secret used to create customer keys)
- `DB_PATH` (SQLite file path on disk)

3. Start API:

```bash
npm start
```

API default address: `http://127.0.0.1:3001`

Health check:

```bash
curl http://127.0.0.1:3001/health
```

There is also:

```bash
curl http://127.0.0.1:3001/api/v1/health
```

### CORS (optional)

If your frontend is hosted on a **different origin** than the API, set `CORS_ORIGIN` in `api/.env`:

- **Allow any origin** (ok for experiments, not recommended for production):

```env
CORS_ORIGIN=*
```

- **Allow specific origins** (recommended):

```env
CORS_ORIGIN=https://example.com,https://www.example.com
```

Convert endpoint:

```bash
curl -X POST "http://127.0.0.1:3001/api/v1/convert?format=webp&quality=85&width=1600" \
  -H "Authorization: Bearer cv_REPLACE_ME" \
  -F "file=@/path/to/input.jpg" \
  --output output.webp
```

Supported output formats: `jpeg`, `png`, `webp`, `avif`, `gif`, `tiff`

### Paid access + credits (built-in)

The API uses SQLite (`DB_PATH`) to store:

- customers + remaining credits
- API keys (stored as **SHA-256 hashes**; plaintext key is returned only once)

Create a customer + API key:

```bash
curl -sS -X POST "http://127.0.0.1:3001/api/v1/admin/keys" \
  -H "x-admin-token: replace-with-long-random-admin-token" \
  -H "content-type: application/json" \
  -d "{\"credits\":1000,\"email\":\"user@example.com\",\"label\":\"paid-plan\"}"
```

Add/remove credits later:

```bash
curl -sS -X POST "http://127.0.0.1:3001/api/v1/admin/credits" \
  -H "x-admin-token: replace-with-long-random-admin-token" \
  -H "content-type: application/json" \
  -d "{\"customerId\":1,\"delta\":500}"
```

Notes:

- Each successful conversion spends `CREDIT_COST` credits (default `1`). If conversion fails after credits were deducted, the API attempts to refund that spend.
- Legacy shared key mode still exists for emergencies: set `ALLOW_GLOBAL_API_KEY=1` and `CONVERTER_API_KEY=...` (this bypasses credits for everyone).

## Hetzner setup (systemd)

Copy `deploy/converter-api.service` to `/etc/systemd/system/converter-api.service`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable converter-api
sudo systemctl restart converter-api
sudo systemctl status converter-api
```

Expected server paths:

- repo: `/srv/projects/converter`
- API env file: `/srv/projects/converter/api/.env`
- SQLite file: `/srv/projects/converter/api/data/converter.sqlite` (ensure `www-data` can write this folder)

## CI/CD

GitHub Action `.github/workflows/deploy.yml` now does:

1. SSH to server
2. `git pull origin main`
3. `cd api && npm ci --omit=dev`
4. `systemctl restart converter-api`
5. `curl` health check against `http://127.0.0.1:$PORT/health` (reads `PORT=` from `/srv/projects/converter/api/.env` when present)

Note: do **not** `source` the whole `.env` in bash if values can contain spaces. Quote them (example: `RATE_LIMIT_WINDOW="1 minute"`).
