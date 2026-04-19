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
  -H "x-api-key: replace-with-long-random-key" \
  -F "file=@/path/to/input.jpg" \
  --output output.webp
```

Supported output formats: `jpeg`, `png`, `webp`, `avif`, `gif`, `tiff`

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

## CI/CD

GitHub Action `.github/workflows/deploy.yml` now does:

1. SSH to server
2. `git pull origin main`
3. `cd api && npm ci --omit=dev`
4. `systemctl restart converter-api`
5. `curl` health check against `http://127.0.0.1:$PORT/health` (reads `PORT=` from `/srv/projects/converter/api/.env` when present)

Note: do **not** `source` the whole `.env` in bash if values can contain spaces. Quote them (example: `RATE_LIMIT_WINDOW="1 minute"`).
