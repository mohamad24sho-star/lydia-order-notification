const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const webpush = require("web-push");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  console.log(".env already exists; leaving it unchanged.");
  process.exit(0);
}
const keys = webpush.generateVAPIDKeys();
const pin = String(crypto.randomInt(100000, 999999));
const secret = crypto.randomBytes(48).toString("base64url");
const env = [
  "PORT=3000",
  "NODE_ENV=development",
  "BASE_URL=http://localhost:3000",
  `ADMIN_PIN=${pin}`,
  `ADMIN_SESSION_SECRET=${secret}`,
  "VAPID_SUBJECT=mailto:admin@example.com",
  `VAPID_PUBLIC_KEY=${keys.publicKey}`,
  `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  ""
].join("\n");
fs.writeFileSync(envPath, env, { mode: 0o600 });
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dataPath = path.join(dataDir, "orders.json");
if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify({ orders: [] }, null, 2));
console.log("\nLydia setup complete.");
console.log(`Admin PIN for this installation: ${pin}`);
console.log("BASE_URL is currently http://localhost:3000.");
console.log("Change BASE_URL, ADMIN_PIN, and VAPID_SUBJECT before deploying publicly.\n");
