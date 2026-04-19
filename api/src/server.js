const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const formbody = require("@fastify/formbody");
const multipart = require("@fastify/multipart");
const rateLimit = require("@fastify/rate-limit");
const sharp = require("sharp");
const { openDb } = require("./db");

const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "converter.sqlite");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CREDIT_COST = Number(process.env.CREDIT_COST || 1);
const ALLOW_GLOBAL_API_KEY = String(process.env.ALLOW_GLOBAL_API_KEY || "0") === "1";
const GLOBAL_API_KEY = process.env.CONVERTER_API_KEY || "";

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "tiff"]);

const db = openDb(DB_PATH);

const stmtGetKey = db.prepare(`
  SELECT api_keys.id AS key_id, api_keys.active AS key_active, customers.id AS customer_id, customers.credits AS credits
  FROM api_keys
  JOIN customers ON customers.id = api_keys.customer_id
  WHERE api_keys.key_hash = ?
  LIMIT 1
`);

const stmtTouchKey = db.prepare(`
  UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?
`);

function parseCorsOrigins(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value === "*") {
    return { mode: "any" };
  }

  let parts = [];
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) parts = parsed.map(String);
    } catch {
      parts = [];
    }
  } else {
    parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const origins = parts
    .map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  if (!origins.length) return null;
  return { mode: "list", origins: new Set(origins) };
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseQuality(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < 1 || parsed > 100) return undefined;
  return parsed;
}

function buildOutputName(inputName, format) {
  const ext = format === "jpeg" ? "jpg" : format;
  const parsed = path.parse(inputName || "converted");
  const name = parsed.name || "converted";
  return `${name}.${ext}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function randomApiKey() {
  // Prefix helps humans identify keys in logs/support tickets.
  const raw = crypto.randomBytes(24).toString("base64url");
  return `cv_${raw}`;
}

function extractApiKeyFromRequest(request) {
  const auth = String(request.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) return m[1].trim();

  const headerKey = request.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) return headerKey.trim();

  return "";
}

function urlPathname(url) {
  return String(url || "").split("?")[0];
}

function requireAdmin(request, reply) {
  if (!ADMIN_TOKEN) {
    return reply.code(503).send({ error: "Admin API is not configured" });
  }
  const token = String(request.headers["x-admin-token"] || "");
  if (token !== ADMIN_TOKEN) {
    return reply.code(401).send({ error: "Invalid admin token" });
  }
}

app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX || 120),
  timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
});

const corsCfg = parseCorsOrigins(process.env.CORS_ORIGIN);
if (corsCfg?.mode === "any") {
  app.register(cors, { origin: true });
} else if (corsCfg?.mode === "list") {
  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return cb(null, corsCfg.origins.has(origin));
    },
  });
}

app.register(formbody);
app.register(multipart, {
  attachFieldsToBody: false,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),
    files: 1,
  },
});

app.addHook("preHandler", async (request, reply) => {
  const p = urlPathname(request.url);
  if (p === "/health" || p === "/api/v1/health") return;
  if (p.startsWith("/api/v1/admin/")) return;

  // Optional legacy mode: single shared key (not recommended for paid tiers)
  if (ALLOW_GLOBAL_API_KEY && GLOBAL_API_KEY) {
    const incoming = extractApiKeyFromRequest(request);
    if (incoming !== GLOBAL_API_KEY) {
      return reply.code(401).send({ error: "Invalid API key" });
    }
    return;
  }

  const apiKey = extractApiKeyFromRequest(request);
  if (!apiKey || !apiKey.startsWith("cv_")) {
    return reply.code(401).send({ error: "Missing or invalid API key" });
  }

  const keyHash = sha256Hex(apiKey);
  const row = stmtGetKey.get(keyHash);
  if (!row || !row.key_active) {
    return reply.code(401).send({ error: "Invalid API key" });
  }
  if (row.credits < CREDIT_COST) {
    return reply.code(402).send({ error: "Insufficient credits" });
  }

  request.customer = { id: row.customer_id, credits: row.credits };
  request.apiKeyRecord = { id: row.key_id };
});

app.get("/health", async () => {
  return { ok: true };
});

app.get("/api/v1/health", async () => {
  return { ok: true };
});

app.post("/api/v1/admin/keys", async (request, reply) => {
  const gate = requireAdmin(request, reply);
  if (gate) return gate;

  const body = request.body && typeof request.body === "object" ? request.body : {};
  const credits = Number(body.credits ?? 0);
  const email = body.email ? String(body.email) : null;
  const note = body.note ? String(body.note) : null;
  const label = body.label ? String(body.label) : null;

  if (!Number.isInteger(credits) || credits < 0) {
    return reply.code(400).send({ error: "credits must be a non-negative integer" });
  }

  const apiKey = randomApiKey();
  const keyHash = sha256Hex(apiKey);

  const insert = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO customers (email, note, credits) VALUES (?, ?, ?)")
      .run(email, note, credits);
    const customerId = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO api_keys (customer_id, key_hash, label) VALUES (?, ?, ?)").run(customerId, keyHash, label);
    return customerId;
  });

  const customerId = insert();

  return reply.code(201).send({
    customerId,
    credits,
    apiKey,
    hint: "Store apiKey securely; it cannot be retrieved later.",
  });
});

app.post("/api/v1/admin/credits", async (request, reply) => {
  const gate = requireAdmin(request, reply);
  if (gate) return gate;

  const body = request.body && typeof request.body === "object" ? request.body : {};
  const customerId = Number(body.customerId);
  const delta = Number(body.delta);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return reply.code(400).send({ error: "customerId must be a positive integer" });
  }
  if (!Number.isInteger(delta) || delta === 0) {
    return reply.code(400).send({ error: "delta must be a non-zero integer" });
  }

  const info = db.prepare("UPDATE customers SET credits = credits + ? WHERE id = ?").run(delta, customerId);
  if (info.changes === 0) {
    return reply.code(404).send({ error: "Customer not found" });
  }

  const row = db.prepare("SELECT id, credits FROM customers WHERE id = ?").get(customerId);
  return { ok: true, customerId: row.id, credits: row.credits };
});

app.post("/api/v1/convert", async (request, reply) => {
  if (ALLOW_GLOBAL_API_KEY && GLOBAL_API_KEY) {
    // Legacy mode: no credits, no DB mutation.
  } else if (!request.customer || !request.apiKeyRecord) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const filePart = await request.file();
  if (!filePart) {
    return reply.code(400).send({ error: "Missing file field" });
  }

  const formatRaw = String(request.query.format || "").toLowerCase();
  const format = formatRaw || "png";

  if (!SUPPORTED_FORMATS.has(format)) {
    return reply.code(400).send({
      error: "Unsupported format",
      supportedFormats: Array.from(SUPPORTED_FORMATS),
    });
  }

  const width = parsePositiveInt(request.query.width);
  const height = parsePositiveInt(request.query.height);
  const quality = parseQuality(request.query.quality);

  const inputBuffer = await filePart.toBuffer();

  const convert = async () => {
    let pipeline = sharp(inputBuffer, { animated: true });
    if (width || height) {
      pipeline = pipeline.resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const outputOptions = quality ? { quality } : {};
    return pipeline.toFormat(format, outputOptions).toBuffer();
  };

  let outputBuffer;
  try {
    if (ALLOW_GLOBAL_API_KEY && GLOBAL_API_KEY) {
      outputBuffer = await convert();
    } else {
      const spend = db.transaction(() => {
        const row = db.prepare("SELECT credits FROM customers WHERE id = ?").get(request.customer.id);
        if (!row) {
          const err = new Error("customer missing");
          err.code = "CUSTOMER_MISSING";
          throw err;
        }
        if (row.credits < CREDIT_COST) {
          const err = new Error("insufficient credits");
          err.code = "INSUFFICIENT_CREDITS";
          throw err;
        }

        const info = db
          .prepare("UPDATE customers SET credits = credits - ? WHERE id = ? AND credits >= ?")
          .run(CREDIT_COST, request.customer.id, CREDIT_COST);
        if (info.changes !== 1) {
          const err = new Error("insufficient credits");
          err.code = "INSUFFICIENT_CREDITS";
          throw err;
        }

        stmtTouchKey.run(request.apiKeyRecord.id);
      });

      spend();

      try {
        outputBuffer = await convert();
      } catch (convErr) {
        db.prepare("UPDATE customers SET credits = credits + ? WHERE id = ?").run(CREDIT_COST, request.customer.id);
        throw convErr;
      }
    }
  } catch (err) {
    if (err?.code === "INSUFFICIENT_CREDITS") {
      return reply.code(402).send({ error: "Insufficient credits" });
    }
    throw err;
  }

  const outputName = buildOutputName(filePart.filename, format);
  const contentType = `image/${format === "jpeg" ? "jpeg" : format}`;

  reply.header("Content-Type", contentType);
  reply.header("Content-Disposition", `attachment; filename="${outputName}"`);
  return reply.send(outputBuffer);
});

app.setErrorHandler((err, _request, reply) => {
  if (err.code === "FST_REQ_FILE_TOO_LARGE") {
    return reply.code(413).send({ error: "File is too large" });
  }

  app.log.error(err);
  return reply.code(500).send({ error: "Internal conversion error" });
});

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`Converter API listening on ${HOST}:${PORT}`);
    app.log.info(`Billing DB: ${DB_PATH}`);
    if (ALLOW_GLOBAL_API_KEY && GLOBAL_API_KEY) {
      app.log.warn("ALLOW_GLOBAL_API_KEY is enabled: paid credits enforcement is bypassed for all requests.");
    } else if (GLOBAL_API_KEY && !ALLOW_GLOBAL_API_KEY) {
      app.log.warn("CONVERTER_API_KEY is set but ignored unless ALLOW_GLOBAL_API_KEY=1");
    }
    if (!ADMIN_TOKEN) {
      app.log.warn("ADMIN_TOKEN is not set: /api/v1/admin/* endpoints are disabled");
    }
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
