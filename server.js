const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("data.sqlite");
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("Set SESSION_SECRET to a random string at least 32 characters long.");
  process.exit(1);
}

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reseller',
  balance_paisa INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL,
  transaction_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

function money(paisa) { return (paisa / 100).toFixed(2); }
function toPaisa(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
  return Math.round(n * 100);
}
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, balance: money(u.balance_paisa) };
}
function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id, username, role, balance_paisa FROM users WHERE id = ?").get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "আগে লগইন করুন।" });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "শুধু অ্যাডমিন এই কাজ করতে পারবেন।" });
  next();
}
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(session({
  name: "reseller.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 8 }
}));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: true, legacyHeaders: false }));

// Create the first admin account from environment variables. Change its password after setup.
(async () => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (username && password) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (!existing) {
      const hash = await bcrypt.hash(password, 12);
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
      console.log(`Initial admin account created: ${username}`);
    }
  } else {
    console.warn("ADMIN_USERNAME/ADMIN_PASSWORD not set. Set them before first start to create an admin.");
  }
})();

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "ইউজারনেম ৩–২৪ অক্ষর; ইংরেজি অক্ষর, সংখ্যা বা _ ব্যবহার করুন।" });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "পাসওয়ার্ড কমপক্ষে ১০ অক্ষরের হতে হবে।" });
  if (username.toLowerCase() === String(process.env.ADMIN_USERNAME || "admin").toLowerCase()) return res.status(400).json({ error: "এই ইউজারনেম ব্যবহার করা যাবে না।" });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.json({ user: publicUser(currentUser(req)) });
  } catch {
    res.status(409).json({ error: "এই ইউজারনেম আগে থেকেই আছে।" });
  }
});
app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: "ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।" });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "লগইন করা যায়নি।" });
    req.session.userId = u.id;
    res.json({ user: publicUser(currentUser(req)) });
  });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/orders", requireAuth, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare(`SELECT orders.*, users.username FROM orders JOIN users ON users.id=orders.user_id ORDER BY orders.id DESC LIMIT 200`).all()
    : db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(req.user.id);
  res.json({ orders: rows.map(o => ({ ...o, amount: money(o.amount_paisa) })) });
});
app.post("/api/orders", requireAuth, (req, res) => {
  const product = String(req.body.product || "").trim().slice(0, 80);
  const customerRef = String(req.body.customerRef || "").trim().slice(0, 100);
  const amount = toPaisa(req.body.amount);
  if (!product || !customerRef || !amount) return res.status(400).json({ error: "পণ্যের নাম, কাস্টমার রেফারেন্স ও সঠিক মূল্য দিন।" });
  const createOrder = db.transaction(() => {
    const u = db.prepare("SELECT balance_paisa FROM users WHERE id = ?").get(req.user.id);
    if (u.balance_paisa < amount) throw new Error("ব্যালেন্স পর্যাপ্ত নয়। আগে পেমেন্ট রিকোয়েস্ট দিন।");
    db.prepare("UPDATE users SET balance_paisa = balance_paisa - ? WHERE id = ?").run(amount, req.user.id);
    db.prepare("INSERT INTO orders (user_id, product, customer_ref, amount_paisa) VALUES (?, ?, ?, ?)").run(req.user.id, product, customerRef, amount);
  });
  try { createOrder(); res.json({ ok: true, user: publicUser(currentUser(req)) }); }
  catch (e) { res.status(400).json({ error: e.message || "অর্ডার করা যায়নি।" }); }
});

app.get("/api/payments", requireAuth, (req, res) => {
  const rows = req.user.role === "admin"
    ? db.prepare("SELECT payments.*, users.username FROM payments JOIN users ON users.id=payments.user_id ORDER BY payments.id DESC LIMIT 200").all()
    : db.prepare("SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(req.user.id);
  res.json({ payments: rows.map(p => ({ ...p, amount: money(p.amount_paisa) })) });
});
app.post("/api/payments", requireAuth, (req, res) => {
  const method = String(req.body.method || "").trim();
  const amount = toPaisa(req.body.amount);
  const ref = String(req.body.transactionRef || "").trim().slice(0, 100);
  if (!["bKash", "Nagad", "Rocket", "Bank"].includes(method) || !amount || ref.length < 4) {
    return res.status(400).json({ error: "পেমেন্ট পদ্ধতি, সঠিক পরিমাণ এবং ট্রানজ্যাকশন রেফারেন্স দিন।" });
  }
  db.prepare("INSERT INTO payments (user_id, method, amount_paisa, transaction_ref) VALUES (?, ?, ?, ?)").run(req.user.id, method, amount, ref);
  res.json({ ok: true, message: "রিকোয়েস্ট জমা হয়েছে। অ্যাডমিন যাচাই না করা পর্যন্ত ব্যালেন্স যোগ হবে না।" });
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json({ users: db.prepare("SELECT id, username, role, balance_paisa, created_at FROM users ORDER BY id DESC").all().map(u => ({ ...u, balance: money(u.balance_paisa) })) });
});
app.post("/api/admin/payments/:id/decision", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body.decision;
  if (!Number.isInteger(id) || !["approve", "reject"].includes(decision)) return res.status(400).json({ error: "রিকোয়েস্ট সঠিক নয়।" });
  const action = db.transaction(() => {
    const p = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
    if (!p) throw new Error("পেমেন্ট রিকোয়েস্ট পাওয়া যায়নি।");
    if (p.status !== "pending") throw new Error("এই রিকোয়েস্ট আগে থেকেই নিষ্পত্তি হয়েছে।");
    if (decision === "approve") {
      db.prepare("UPDATE users SET balance_paisa = balance_paisa + ? WHERE id = ?").run(p.amount_paisa, p.user_id);
      db.prepare("UPDATE payments SET status = 'approved' WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(id);
    }
  });
  try { action(); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message || "আপডেট করা যায়নি।" }); }
});
app.post("/api/admin/users/:id/balance", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id), amount = toPaisa(req.body.amount);
  const direction = req.body.direction;
  if (!Number.isInteger(id) || !amount || !["add", "subtract"].includes(direction)) return res.status(400).json({ error: "পরিমাণ বা অ্যাকশন সঠিক নয়।" });
  const delta = direction === "add" ? amount : -amount;
  const result = db.prepare("UPDATE users SET balance_paisa = balance_paisa + ? WHERE id = ? AND balance_paisa + ? >= 0").run(delta, id, delta);
  if (!result.changes) return res.status(400).json({ error: "ইউজার পাওয়া যায়নি অথবা ব্যালেন্স কম।" });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Reseller panel running at http://localhost:${PORT}`));
