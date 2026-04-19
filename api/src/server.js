const path = require("node:path");
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const multipart = require("@fastify/multipart");
const rateLimit = require("@fastify/rate-limit");
const sharp = require("sharp");

const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.CONVERTER_API_KEY || "";

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "tiff"]);

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

app.register(multipart, {
  attachFieldsToBody: false,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),
    files: 1,
  },
});

app.addHook("preHandler", async (request, reply) => {
  const urlPath = String(request.url || "").split("?")[0];
  if (urlPath === "/health" || urlPath === "/api/v1/health") return;
  if (!API_KEY) return;

  const incoming = request.headers["x-api-key"];
  if (incoming !== API_KEY) {
    return reply.code(401).send({ error: "Invalid API key" });
  }
});

app.get("/health", async () => {
  return { ok: true };
});

app.get("/api/v1/health", async () => {
  return { ok: true };
});

app.post("/api/v1/convert", async (request, reply) => {
  const filePart = await request.file();
  if (!filePart) {
    return reply.code(400).send({ error: "Missing file field" });
  }

  const inputBuffer = await filePart.toBuffer();
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
  const outputBuffer = await pipeline.toFormat(format, outputOptions).toBuffer();
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

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`Converter API listening on ${HOST}:${PORT}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
