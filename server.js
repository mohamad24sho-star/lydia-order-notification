require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const webpush = require("web-push");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "orders.json");

if (!ADMIN_PIN || !SESSION_SECRET) {
  console.error("Missing ADMIN_PIN or ADMIN_SESSION_SECRET. Run: npm run setup");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ orders: [] }, null, 2));

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

let database;
try {
  database = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!database || !Array.isArray(database.orders)) database = { orders: [] };
} catch {
  database = { orders: [] };
}
function persist() {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(database, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function safeOrder(order) {
  return {
    id: order.id,
    customerName: order.customerName || "",
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    readyAt: order.readyAt || null
  };
}
function normalizeId(value) {
  const id = String(value || "").trim().replace(/^#/, "").toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(id)) return null;
  return id;
}
function findOrder(id) {
  return database.orders.find(o => o.id === id);
}
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function validSession(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = sign(parts[0]);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return Number(payload.exp) > Date.now();
  } catch { return false; }
}
function requireAdmin(req, res, next) {
  const token = req.cookies?.lydia_admin || parseCookies(req.headers.cookie || "").lydia_admin;
  if (!validSession(token)) return res.status(401).json({ error: "يلزم تسجيل دخول المشرف." });
  next();
}
function parseCookies(header) {
  const out = {};
  header.split(";").forEach(part => {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return out;
}
function orderRoom(id) { return `order:${id}`; }

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const server = http.createServer(app);
const io = new Server(server);

app.get("/api/config", (req, res) => {
  res.json({ vapidPublicKey: VAPID_PUBLIC_KEY, pushEnabled, appName: "Lydia" });
});

app.post("/api/admin/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  loginAttempts = loginAttempts.filter(a => now - a.time < 15 * 60 * 1000);
  if (loginAttempts.filter(a => a.ip === ip).length >= 12) {
    return res.status(429).json({ error: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا." });
  }
  const supplied = String(req.body?.pin || "");
  if (supplied !== ADMIN_PIN) {
    loginAttempts.push({ ip, time: now });
    return res.status(401).json({ error: "رمز الدخول غير صحيح." });
  }
  res.setHeader("Set-Cookie", `lydia_admin=${encodeURIComponent(makeSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ ok: true });
});
let loginAttempts = [];

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  res.setHeader("Set-Cookie", `lydia_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ ok: true });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  res.json({ orders: [...database.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(safeOrder) });
});

app.post("/api/admin/orders", requireAdmin, (req, res) => {
  const requested = req.body?.id ? normalizeId(req.body.id) : null;
  if (req.body?.id && !requested) return res.status(400).json({ error: "رقم الطلب يجب أن يتكون من 2 إلى 32 حرفًا أو رقمًا إنجليزيًا أو - أو _." });
  let id = requested;
  if (!id) {
    do { id = String(crypto.randomInt(100, 1000)); } while (findOrder(id));
  }
  if (findOrder(id)) return res.status(409).json({ error: "رقم الطلب موجود مسبقًا. اختر رقمًا آخر." });
  const customerName = String(req.body?.customerName || "").trim().slice(0, 80);
  const now = new Date().toISOString();
  const order = { id, customerName, status: "preparing", createdAt: now, updatedAt: now, readyAt: null, subscriptions: [] };
  database.orders.push(order); persist();
  res.status(201).json({ order: safeOrder(order), url: orderUrl(req, id) });
});

app.patch("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const id = normalizeId(req.params.id);
  const order = id && findOrder(id);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود." });
  const status = req.body?.status;
  if (!["preparing", "ready", "picked_up"].includes(status)) return res.status(400).json({ error: "حالة الطلب غير صالحة." });
  const wasReady = order.status === "ready";
  order.status = status;
  order.updatedAt = new Date().toISOString();
  if (status === "ready") order.readyAt = order.updatedAt;
  if (status !== "ready") order.readyAt = null;
  persist();
  const publicData = safeOrder(order);
  io.to(orderRoom(id)).emit("order:update", publicData);
  if (status === "ready" && !wasReady) await sendReadyPush(order, req);
  res.json({ order: publicData });
});

app.get("/api/orders/:id", (req, res) => {
  const id = normalizeId(req.params.id);
  const order = id && findOrder(id);
  if (!order) return res.status(404).json({ error: "لم نعثر على هذا الطلب. تأكد من الرقم أو امسح رمز QR الصحيح." });
  res.json({ order: safeOrder(order), pushEnabled });
});

app.post("/api/orders/:id/subscribe", async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: "إشعارات الخلفية غير مفعلة على الخادم حاليًا." });
  const id = normalizeId(req.params.id);
  const order = id && findOrder(id);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود." });
  const sub = req.body?.subscription;
  if (!sub || typeof sub.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) {
    return res.status(400).json({ error: "بيانات الاشتراك غير صالحة." });
  }
  order.subscriptions ||= [];
  order.subscriptions = order.subscriptions.filter(s => s.endpoint !== sub.endpoint);
  order.subscriptions.push(sub);
  order.updatedAt = new Date().toISOString();
  persist();
  res.json({ ok: true });
});

app.get("/api/admin/orders/:id/qr", requireAdmin, async (req, res) => {
  const id = normalizeId(req.params.id);
  const order = id && findOrder(id);
  if (!order) return res.status(404).send("Order not found");
  const url = orderUrl(req, id);
  res.type("png");
  try { res.send(await QRCode.toBuffer(url, { type: "png", width: 360, margin: 2, errorCorrectionLevel: "M" })); }
  catch { res.status(500).send("Could not generate QR"); }
});

function orderUrl(req, id) {
  const origin = BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${origin}/?order=${encodeURIComponent(id)}`;
}

async function sendReadyPush(order, req) {
  if (!pushEnabled || !order.subscriptions?.length) return;
  const url = orderUrl(req, order.id);
  const payload = JSON.stringify({
    title: "Lydia — طلبك جاهز! 🎉",
    body: order.customerName ? `أهلًا ${order.customerName}، طلبك رقم #${order.id} جاهز للاستلام.` : `طلبك رقم #${order.id} جاهز للاستلام.`,
    orderId: order.id,
    url
  });
  const retained = [];
  await Promise.allSettled(order.subscriptions.map(async sub => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 * 60, urgency: "high" });
      retained.push(sub);
    } catch (err) {
      if (err.statusCode !== 404 && err.statusCode !== 410) retained.push(sub);
    }
  }));
  order.subscriptions = retained;
  persist();
}

io.on("connection", socket => {
  socket.on("order:join", value => {
    const id = normalizeId(value);
    if (id && findOrder(id)) socket.join(orderRoom(id));
  });
});

app.get("/health", (req, res) => res.json({ ok: true, service: "lydia" }));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "المسار غير موجود." });
  res.sendFile(path.join(__dirname, "public", "index.html"), err => { if (err) next(err); });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Lydia is running on port ${PORT}`);
  console.log(`Customer page: ${BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`Admin page: ${BASE_URL || `http://localhost:${PORT}`}/admin`);
  console.log(`Push notifications: ${pushEnabled ? "enabled" : "disabled"}`);
});
