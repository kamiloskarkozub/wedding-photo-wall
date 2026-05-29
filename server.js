const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

const STORAGE_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || ROOT;

const DATA_DIR = path.join(STORAGE_ROOT, "data");
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");

const PHOTOS_PATH = path.join(DATA_DIR, "photos.json");
const SECRETS_PATH = path.join(DATA_DIR, "secrets.json");

const PORT = Number(process.env.PORT || 4173);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 80 * 1024 * 1024);
const MAX_SINGLE_FILE_BYTES = Number(process.env.MAX_SINGLE_FILE_BYTES || 25 * 1024 * 1024);

const SITE_TITLE = process.env.SITE_TITLE || "Zdjęcia z wesela";
const COUPLE_NAMES = process.env.COUPLE_NAMES || "Nasze wesele";
const WEDDING_DATE = process.env.WEDDING_DATE || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);
const EXTENSION_BY_TYPE = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"]
]);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const generatedSecrets = loadOrCreateSecrets();
const WEDDING_TOKEN = process.env.WEDDING_TOKEN || generatedSecrets.weddingToken;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || generatedSecrets.adminToken;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || generatedSecrets.adminPassword;

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "Coś poszło nie tak po stronie serwera." });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const localBaseUrl = `http://localhost:${PORT}`;
  console.log(`Wedding Photo Wall is running on ${localBaseUrl}`);
  console.log(`Guest page: ${localBaseUrl}/w/${WEDDING_TOKEN}`);
  console.log(`Admin page: ${localBaseUrl}/admin`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
  }
});

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, url, pathname);
    return;
  }

  if (pathname.startsWith("/media/")) {
    await handleMedia(req, res, url, pathname);
    return;
  }

  await servePublic(req, res, pathname);
}

async function handleApi(req, res, url, pathname) {
  if (req.method === "GET" && pathname === "/api/config") {
    if (!hasGuestAccess(url)) return sendJson(res, 403, { error: "Ten link nie jest aktywny." });
    return sendJson(res, 200, {
      siteTitle: SITE_TITLE,
      coupleNames: COUPLE_NAMES,
      weddingDate: WEDDING_DATE,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxSingleFileBytes: MAX_SINGLE_FILE_BYTES
    });
  }

  if (req.method === "GET" && pathname === "/api/photos") {
    if (!hasViewAccess(url)) return sendJson(res, 403, { error: "Brak dostępu do galerii." });
    return sendJson(res, 200, { photos: readPhotos().sort(sortNewestFirst) });
  }

  if (req.method === "POST" && pathname === "/api/photos") {
    if (!hasGuestAccess(url)) return sendJson(res, 403, { error: "Ten link nie pozwala dodawać zdjęć." });
    return handleUpload(req, res);
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    return handleAdminLogin(req, res);
  }

  if (req.method === "GET" && pathname === "/api/admin") {
    if (!hasAdminAccess(url)) return sendJson(res, 403, { error: "Brak dostępu do panelu." });
    const guestUrl = `${baseUrlFor(req)}/w/${encodeURIComponent(WEDDING_TOKEN)}`;
    return sendJson(res, 200, {
      siteTitle: SITE_TITLE,
      coupleNames: COUPLE_NAMES,
      weddingDate: WEDDING_DATE,
      guestUrl,
      qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=18&data=${encodeURIComponent(guestUrl)}`,
      photoCount: readPhotos().length,
      limits: {
        maxUploadBytes: MAX_UPLOAD_BYTES,
        maxSingleFileBytes: MAX_SINGLE_FILE_BYTES
      }
    });
  }

  const deleteMatch = pathname.match(/^\/api\/photos\/([a-f0-9-]+)$/i);
  if (req.method === "DELETE" && deleteMatch) {
    if (!hasAdminAccess(url)) return sendJson(res, 403, { error: "Tylko panel admina może usuwać zdjęcia." });
    return deletePhoto(req, res, deleteMatch[1]);
  }

  sendJson(res, 404, { error: "Nie znaleziono endpointu." });
}

async function handleAdminLogin(req, res) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.startsWith("application/json")) {
    return sendJson(res, 415, { error: "Logowanie wymaga danych JSON." });
  }

  let payload;
  try {
    const body = await readBody(req, 8 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendJson(res, 400, { error: "Nie udało się odczytać formularza logowania." });
  }

  if (!sameSecret(payload.password, ADMIN_PASSWORD)) {
    return sendJson(res, 401, { error: "Nieprawidłowe hasło administratora." });
  }

  sendJson(res, 200, { adminToken: ADMIN_TOKEN });
}

async function handleUpload(req, res) {
  try {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return sendJson(res, 415, { error: "Formularz musi uzywac multipart/form-data." });
    }

    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const { files, fields } = parseMultipart(body, contentType);
    const imageFiles = files.filter((file) => file.data.length > 0);

    if (imageFiles.length === 0) {
      return sendJson(res, 400, { error: "Wybierz przynajmniej jedno zdjęcie." });
    }

    const guestName = cleanText(fields.guestName || "", 80);
    const note = cleanText(fields.note || "", 180);
    const saved = [];
    const rejected = [];
    const photos = readPhotos();
    const folder = dateFolder();
    const targetDir = path.join(UPLOADS_DIR, folder);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const file of imageFiles) {
      const originalName = cleanFilename(file.filename || "zdjęcie");
      const ext = extensionFor(file);
      const normalizedType = normalizedContentType(file, ext);

      if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
        rejected.push({ name: originalName, reason: "Nieobsługiwany format pliku." });
        continue;
      }

      if (file.data.length > MAX_SINGLE_FILE_BYTES) {
        rejected.push({ name: originalName, reason: "Plik jest za duży." });
        continue;
      }

      const id = crypto.randomUUID();
      const filename = `${id}${ext}`;
      const relativePath = path.join(folder, filename).replace(/\\/g, "/");
      fs.writeFileSync(path.join(targetDir, filename), file.data);

      const photo = {
        id,
        originalName,
        filename,
        relativePath,
        contentType: normalizedType,
        size: file.data.length,
        guestName,
        note,
        uploadedAt: new Date().toISOString()
      };

      photos.push(photo);
      saved.push(publicPhoto(photo));
    }

    writePhotos(photos);
    const status = saved.length > 0 ? 201 : 400;
    sendJson(res, status, {
      saved,
      rejected,
      photos: readPhotos().sort(sortNewestFirst).map(publicPhoto)
    });
  } catch (error) {
    if (error.statusCode === 413) {
      return sendJson(res, 413, { error: "Paczkę zdjęć trzeba podzielić na mniejsze porcje." });
    }
    throw error;
  }
}

async function deletePhoto(req, res, id) {
  const photos = readPhotos();
  const index = photos.findIndex((photo) => photo.id === id);

  if (index === -1) {
    return sendJson(res, 404, { error: "Nie znaleziono zdjęcia." });
  }

  const [photo] = photos.splice(index, 1);
  const filePath = safeUploadPath(photo.relativePath);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  writePhotos(photos);
  sendJson(res, 200, { ok: true });
}

async function handleMedia(req, res, url, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Metoda nie jest obsługiwana." });
  }

  if (!hasViewAccess(url)) {
    return sendJson(res, 403, { error: "Brak dostępu do pliku." });
  }

  const id = pathname.slice("/media/".length);
  const photo = readPhotos().find((item) => item.id === id);
  if (!photo) return sendJson(res, 404, { error: "Nie znaleziono zdjęcia." });

  const filePath = safeUploadPath(photo.relativePath);
  if (!filePath || !fs.existsSync(filePath)) {
    return sendJson(res, 404, { error: "Plik zdjęcia nie istnieje." });
  }

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": photo.contentType || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename="${encodeHeaderFilename(photo.originalName)}"`
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

async function servePublic(req, res, pathname) {
  const spaRoutes = pathname === "/" || pathname.startsWith("/w/") || pathname === "/admin" || pathname.startsWith("/admin/");
  const relativePath = spaRoutes ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, 404, "Not found");
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function hasGuestAccess(url) {
  return url.searchParams.get("token") === WEDDING_TOKEN;
}

function hasAdminAccess(url) {
  return url.searchParams.get("admin") === ADMIN_TOKEN;
}

function sameSecret(input, expected) {
  const left = Buffer.from(String(input || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hasViewAccess(url) {
  return hasGuestAccess(url) || hasAdminAccess(url);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Payload too large");
        error.statusCode = 413;
        req.destroy(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error("Missing multipart boundary");
    error.statusCode = 400;
    throw error;
  }

  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const bodyText = body.toString("latin1");
  const rawParts = bodyText.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (let rawPart of rawParts) {
    rawPart = rawPart.replace(/^\r\n/, "");
    const headerEnd = rawPart.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = rawPart.slice(0, headerEnd);
    let payload = rawPart.slice(headerEnd + 4);
    if (payload.endsWith("\r\n")) payload = payload.slice(0, -2);

    const headers = Object.fromEntries(
      headerText.split("\r\n").map((line) => {
        const separator = line.indexOf(":");
        if (separator === -1) return [line.toLowerCase(), ""];
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      })
    );

    const disposition = parseDisposition(headers["content-disposition"] || "");
    if (!disposition.name) continue;

    const payloadBuffer = Buffer.from(payload, "latin1");
    if (disposition.filename !== undefined) {
      files.push({
        fieldName: disposition.name,
        filename: disposition.filename,
        contentType: (headers["content-type"] || "application/octet-stream").toLowerCase(),
        data: payloadBuffer
      });
    } else {
      fields[disposition.name] = payloadBuffer.toString("utf8").trim();
    }
  }

  return { fields, files };
}

function parseDisposition(value) {
  const result = {};
  const parts = value.split(";").map((part) => part.trim());

  for (const part of parts.slice(1)) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey.trim();
    let parsedValue = rawValue.join("=").trim();
    if (parsedValue.startsWith('"') && parsedValue.endsWith('"')) {
      parsedValue = parsedValue.slice(1, -1);
    }
    result[key] = parsedValue.replace(/\\"/g, '"');
  }

  return result;
}

function readPhotos() {
  return readJson(PHOTOS_PATH, []);
}

function writePhotos(photos) {
  const tmpPath = `${PHOTOS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(photos, null, 2));
  fs.renameSync(tmpPath, PHOTOS_PATH);
}

function publicPhoto(photo) {
  return {
    id: photo.id,
    originalName: photo.originalName,
    contentType: photo.contentType,
    size: photo.size,
    guestName: photo.guestName,
    note: photo.note,
    uploadedAt: photo.uploadedAt
  };
}

function sortNewestFirst(a, b) {
  return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
}

function loadOrCreateSecrets() {
  const existing = readJson(SECRETS_PATH, null);
  if (existing && existing.weddingToken && existing.adminToken && existing.adminPassword) return existing;

  const secrets = {
    weddingToken: existing?.weddingToken || token(18),
    adminToken: existing?.adminToken || token(20),
    adminPassword: existing?.adminPassword || token(10),
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2));
  return secrets;
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function token(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function dateFolder() {
  return new Date().toISOString().slice(0, 10);
}

function extensionFor(file) {
  const fromType = EXTENSION_BY_TYPE.get((file.contentType || "").toLowerCase());
  const fromName = path.extname(file.filename || "").toLowerCase();
  if (fromType) return fromType;
  if (ALLOWED_EXTENSIONS.has(fromName)) return fromName;
  return "";
}

function normalizedContentType(file, ext) {
  if (EXTENSION_BY_TYPE.has(file.contentType)) return file.contentType;
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".heic") return "image/heic";
  if (ext === ".heif") return "image/heif";
  return "application/octet-stream";
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanFilename(filename) {
  const base = String(filename || "zdjęcie").split(/[\\/]/).pop();
  return cleanText(base, 120) || "zdjęcie";
}

function encodeHeaderFilename(filename) {
  return cleanFilename(filename).replace(/["\r\n]/g, "_");
}

function safeUploadPath(relativePath) {
  const filePath = path.resolve(UPLOADS_DIR, relativePath || "");
  return filePath.startsWith(UPLOADS_DIR) ? filePath : null;
}

function baseUrlFor(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
