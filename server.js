const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const catalogImageGalleries = require("./Js/catalog-image-galleries");

const app = express();
const root = __dirname;
app.set("trust proxy", 1);
const dataDir = process.env.ZAAI_DATA_DIR
  ? path.resolve(process.env.ZAAI_DATA_DIR)
  : path.join(root, ".data");
const uploadDir = process.env.ZAAI_UPLOAD_DIR
  ? path.resolve(process.env.ZAAI_UPLOAD_DIR)
  : path.join(root, "uploads");
const backupDir = process.env.ZAAI_BACKUP_DIR
  ? path.resolve(process.env.ZAAI_BACKUP_DIR)
  : path.join(dataDir, "backups");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const port = Number(process.env.PORT || 5510);
const dbPath = path.join(dataDir, "zaai.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'men',
    original_price INTEGER NOT NULL DEFAULT 1000,
    sale_price INTEGER NOT NULL DEFAULT 800,
    sizes TEXT NOT NULL DEFAULT '[]',
    colors TEXT NOT NULL DEFAULT '[]',
    images TEXT NOT NULL DEFAULT '[]',
    gallery_customized INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_key TEXT NOT NULL UNIQUE,
    title_ar TEXT NOT NULL DEFAULT '',
    title_en TEXT NOT NULL DEFAULT '',
    content_ar TEXT NOT NULL DEFAULT '',
    content_en TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    video TEXT NOT NULL DEFAULT '',
    button_text_ar TEXT NOT NULL DEFAULT '',
    button_text_en TEXT NOT NULL DEFAULT '',
    button_link TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1,
    draft TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    governorate TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    subtotal INTEGER NOT NULL DEFAULT 0,
    delivery_fee INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    governorate TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    used_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (!db.pragma("table_info(products)").some((column) => column.name === "gallery_customized")) {
  db.exec("ALTER TABLE products ADD COLUMN gallery_customized INTEGER NOT NULL DEFAULT 0");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
  const parts = String(encoded).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const derived = crypto.scryptSync(password, parts[1], 64);
  const actual = Buffer.from(parts[2], "hex");
  return derived.length === actual.length && crypto.timingSafeEqual(derived, actual);
}

function randomSecret() {
  const secretPath = path.join(dataDir, "session.secret");
  if (process.env.ZAAI_SESSION_SECRET) return process.env.ZAAI_SESSION_SECRET;
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

function ensureOwner() {
  const existing = db.prepare("SELECT * FROM owner LIMIT 1").get();
  const email = process.env.ZAAI_OWNER_EMAIL || "owner@zaai.store";
  let password = process.env.ZAAI_OWNER_PASSWORD;
  if (!password) password = crypto.randomBytes(12).toString("base64url");
  if (existing) {
    return db.prepare("SELECT * FROM owner WHERE id=?").get(existing.id);
  }
  db.prepare("INSERT INTO owner (email,password_hash,role) VALUES (?,?,?)")
    .run(email.toLowerCase(), hashPassword(password), "owner");
  if (!process.env.ZAAI_OWNER_PASSWORD) {
    console.log("\nZAAI first owner account created:");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log("Change this password after the first login.\n");
  }
}

ensureOwner();

function createDatabaseBackup() {
  db.pragma("wal_checkpoint(PASSIVE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `zaai-${stamp}.sqlite`;
  const backupPath = path.join(backupDir, filename);
  fs.copyFileSync(dbPath, backupPath);
  fs.chmodSync(backupPath, 0o600);

  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^zaai-.+\.sqlite$/.test(name))
    .map((name) => ({ name, time: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const old of backups.slice(30)) {
    fs.rmSync(path.join(backupDir, old.name), { force: true });
  }
  return { filename, backupPath };
}

createDatabaseBackup();

const seedCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
const catalogVariants = [
  { id: "royal", nameAr: "أزرق ملكي", nameEn: "Royal blue", hex: "#0f4fa3", image: "image/man/ازرق ملكي/ازرق ملكي.webp", sprite: "image/man/ازرق ملكي/ازرق ملكي 360 .webp" },
  { id: "sky", nameAr: "أزرق سماوي", nameEn: "Sky blue", hex: "#69aee0", image: "image/man/ازرق سماوي/سماوي.webp", sprite: "image/man/ازرق سماوي/سماوي 360 درجة.webp" },
  { id: "black", nameAr: "أسود", nameEn: "Black", hex: "#202124", image: "image/man/اسود/اسود.webp", sprite: "image/man/اسود/اسود 360.webp" },
  { id: "wine", nameAr: "نبتي بنفسجي داكن", nameEn: "Dark wine", hex: "#4a2437", image: "image/man/النبيتي البنفسجي الداكن/النبيتي البنفسجي الداكن.webp", sprite: "image/man/النبيتي البنفسجي الداكن/النبيتي البنفسجي الداكن 360webp.webp" },
  { id: "slate", nameAr: "رمادي مزرق", nameEn: "Blue grey", hex: "#626d79", image: "image/man/رمادي مزرق/رمادي مزرق.webp", sprite: "image/man/رمادي مزرق/رمادي مزرق 360.webp" },
  { id: "light-royal", nameAr: "أزرق ملكي فاتح", nameEn: "Light royal", hex: "#799bd1", image: "image/man/ازرق ملكي فاتح/ازرق ملكي فاتح .webp", sprite: "image/man/ازرق ملكي فاتح/ازرق ملكي فاتح.webp" }
];
const catalogMigrated = db.prepare("SELECT value FROM settings WHERE key=?").get("catalog_migrated");
if (!catalogMigrated) {
  const insertProduct = db.prepare(`
    INSERT INTO products (name,description,category,original_price,sale_price,sizes,colors,images,stock,status,featured,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const legacyProduct = db.prepare(`
    SELECT * FROM products
    WHERE name=? AND category=? AND images LIKE ?
    ORDER BY id ASC LIMIT 1
  `).get("ZAAI Scrub Set", "men", "%product1%");

  catalogVariants.forEach((variant, index) => {
    const existingVariant = db.prepare("SELECT id FROM products WHERE name=? AND category=?")
      .get(`ZAAI Scrub Set — ${variant.nameAr}`, "men");
    if (existingVariant) return;
    insertProduct.run(
      `ZAAI Scrub Set — ${variant.nameAr}`,
      "طقم طبي بتصميم معاصر، مقطّع لراحة الحركة وأناقة الحضور طوال اليوم.",
      "men",
      legacyProduct?.original_price || 1000,
      legacyProduct?.sale_price || 800,
      JSON.stringify(["XS", "S", "M", "L", "XL"]),
      JSON.stringify([variant]),
      JSON.stringify([variant.image]),
      legacyProduct?.stock || 50,
      "published",
      index === 0 ? 1 : 0,
      index + 1
    );
  });

  db.prepare("INSERT INTO settings(key,value) VALUES (?,?)")
    .run("catalog_migrated", JSON.stringify(true));
}

if (!db.prepare("SELECT value FROM settings WHERE key=?").get("catalog_product_galleries_migrated")) {
  const products = db.prepare("SELECT id,colors,images FROM products WHERE category='men'").all();
  const updateImages = db.prepare("UPDATE products SET images=?,gallery_customized=1,updated_at=CURRENT_TIMESTAMP WHERE id=?");

  products.forEach((product) => {
    const colors = parseJson(product.colors, []);
    const images = parseJson(product.images, []);
    const colorId = colors.find((color) => color && typeof color === "object")?.id;
    const variant = catalogVariants.find((item) => item.id === colorId);
    const gallery = catalogImageGalleries[colorId];
    if (!variant || !gallery || images.length !== 1 || images[0] !== variant.image) return;
    updateImages.run(JSON.stringify(gallery), product.id);
  });

  db.prepare("INSERT INTO settings(key,value) VALUES (?,?)")
    .run("catalog_product_galleries_migrated", JSON.stringify(true));
}

const defaultProductInformation = {
  title: {
    ar: "تفاصيل المنتج والعناية",
    en: "PRODUCT DETAILS & CARE"
  },
  material: {
    title: { ar: "الخامة والتركيب", en: "MATERIAL & FABRIC" },
    items: [
      { ar: "72% بوليستر", en: "72% Polyester" },
      { ar: "21% رايون", en: "21% Rayon" },
      { ar: "7% سباندكس", en: "7% Spandex" },
      { ar: "مزيج أقمشة عالي الجودة.", en: "High-Quality Fabric Blend" }
    ]
  },
  care: {
    title: { ar: "تعليمات العناية", en: "CARE INSTRUCTIONS" },
    items: [
      { ar: "يُغسل في الغسالة بماء بارد، بحد أقصى 30 درجة مئوية.", en: "Machine Wash Cold (Max 30°C / 86°F)." },
      { ar: "يُغسل من الداخل إلى الخارج مع ألوان مشابهة.", en: "Wash Inside-Out with Similar Colors." },
      { ar: "يُمنع استخدام المبيضات.", en: "Do Not Bleach." }
    ]
  },
  manufacturing: {
    title: { ar: "التصنيع", en: "MADE IN EGYPT" },
    items: [
      { ar: "صُنع بحب في مصر.", en: "Made with love in Egypt." }
    ]
  }
};

const defaultSettings = {
  siteName: "ZAAI STORE",
  whatsapp: "+201022591767",
  email: "",
  address: "المنصورة، مصر",
  currency: "EGP",
  defaultLanguage: "ar",
  primaryColor: "#98866a",
  accentColor: "#171717",
  productInformationDefaults: defaultProductInformation
};
const upsertSetting = db.prepare(`
  INSERT INTO settings(key,value) VALUES (?,?)
  ON CONFLICT(key) DO NOTHING
`);
Object.entries(defaultSettings).forEach(([key, value]) => upsertSetting.run(key, JSON.stringify(value)));

const sectionCount = db.prepare("SELECT COUNT(*) AS count FROM sections").get().count;
const insertSection = db.prepare(`
  INSERT OR IGNORE INTO sections(section_key,title_ar,title_en,content_ar,content_en,image,video,button_text_ar,button_text_en,button_link,sort_order,visible)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`);
[
  ["home","الرئيسية","Home","إطلالة احترافية براحة تليق بك","A polished look with comfort made for you","image/man/product1.jpg","","استكشف المنتج","Explore","/","1",1],
  ["product-lab","مختبر المنتج","Product Lab","اكتشف تفاصيل منتجات ZAAI عن قرب.","Discover ZAAI product details up close.","image/man/product1.jpg","","استكشف","Explore","#product-lab","2",1],
  ["about","عن ZAAI","About ZAAI","مصمم لراحتك. مصنوع بثقة.","Designed for comfort. Made with confidence.","image/about video.mp4","","اكتشف ZAAI","Discover ZAAI","#about","3",1],
  ["order-now","اطلب الآن","Order Now","اكتشف أزياء طبية صُممت لراحتك وثقتك وأدائك كل يوم.","Discover medical wear designed for your comfort, confidence, and performance.","image/order-now.mp4","","اطلب الآن","Order Now","#products","4",1],
  ["services","الخدمات","Services","أكثر من مجرد أزياء طبية.","More than medical wear.","","","استكشف الخدمات","Explore services","#services","5",1],
  ["products","اكتشف أسلوبك","Discover your style","اكتشف مجموعتنا واستمتع بتجربة مشاهدة كل التفاصيل.","Discover our collection and enjoy every detail.","","","تصفح المنتجات","Shop","#products","6",1],
  ["contact","تواصل معنا","Get in touch","نحن هنا لمساعدتك.","We are here to help.","image/contact/contact 2.jpeg","","ابدأ المحادثة","Start a chat","https://wa.me/201022591767","7",1]
].forEach((row) => insertSection.run(...row));

const offersSectionOrderMigration = "homepage-products-after-offers-v1";
const offersSectionOrderApplied = db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(offersSectionOrderMigration);
if (!offersSectionOrderApplied) {
  const sections = db.prepare("SELECT id,section_key FROM sections ORDER BY sort_order ASC,id ASC").all();
  const productsIndex = sections.findIndex((section) => section.section_key === "products");
  if (productsIndex < 0) throw new Error("Cannot apply homepage section order: products section is missing.");
  if (productsIndex > 0) sections.unshift(sections.splice(productsIndex, 1)[0]);

  const updateSectionOrder = db.prepare("UPDATE sections SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
  const markMigrationApplied = db.prepare("INSERT INTO schema_migrations(name) VALUES (?)");
  const applyOffersSectionOrderMigration = db.transaction(() => {
    sections.forEach((section, index) => updateSectionOrder.run(index + 1, section.id));
    markMigrationApplied.run(offersSectionOrderMigration);
  });
  applyOffersSectionOrderMigration();
}

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Cache-Control, x-csrf-token");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(session({
  name: "zaai_owner",
  secret: randomSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "محاولات تسجيل دخول كثيرة. حاول مرة أخرى لاحقًا." }
});

function ensureCsrf(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const token = req.get("x-csrf-token");
  if (!req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "انتهت جلسة الحماية. أعد تحميل الصفحة." });
  }
  return next();
}

function requireOwner(req, res, next) {
  if (!req.session.ownerId) {
    if (req.accepts("html")) return res.redirect("/admin/login");
    return res.status(401).json({ error: "يتطلب تسجيل دخول المالك." });
  }
  const owner = db.prepare("SELECT id,email,role FROM owner WHERE id=?").get(req.session.ownerId);
  if (!owner || owner.role !== "owner") {
    req.session.destroy(() => {});
    if (req.accepts("html")) return res.redirect("/admin/login");
    return res.status(403).json({ error: "غير مصرح." });
  }
  req.owner = owner;
  next();
}

function getJsonRow(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function audit(action, entity, entityId = "", details = {}) {
  db.prepare("INSERT INTO audit_log(action,entity,entity_id,details) VALUES (?,?,?,?)")
    .run(action, entity, String(entityId), JSON.stringify(details));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function getProductInformationDefaults() {
  const setting = db.prepare("SELECT value FROM settings WHERE key=?").get("productInformationDefaults");
  const information = parseJson(setting?.value, defaultProductInformation);
  return information && typeof information === "object" && !Array.isArray(information)
    ? information
    : defaultProductInformation;
}

function normalizeProduct(row, productInformation = getProductInformationDefaults()) {
  if (!row) return row;
  return {
    ...row,
    sizes: parseJson(row.sizes, []),
    colors: parseJson(row.colors, []),
    images: parseJson(row.images, []),
    gallery_customized: Boolean(row.gallery_customized),
    productInformation
  };
}

function normalizeProducts(rows) {
  const productInformation = getProductInformationDefaults();
  return rows.map((row) => normalizeProduct(row, productInformation));
}

app.get("/api/admin/csrf", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.json({ csrfToken: req.session.csrfToken });
});

app.post("/api/admin/login", loginLimiter, ensureCsrf, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "أدخل البريد الإلكتروني وكلمة المرور." });
  const owner = db.prepare("SELECT * FROM owner WHERE email=?").get(email);
  if (!owner || !verifyPassword(password, owner.password_hash)) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "تعذر بدء الجلسة." });
    req.session.ownerId = owner.id;
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "تعذر حفظ الجلسة." });
      audit("login", "owner", owner.id, { email: owner.email });
      res.json({ ok: true, csrfToken: req.session.csrfToken });
    });
  });
});

app.post("/api/admin/logout", ensureCsrf, requireOwner, (req, res) => {
  audit("logout", "owner", req.owner.id);
  req.session.destroy(() => res.json({ ok: true }));
});

app.put("/api/admin/account/password", ensureCsrf, requireOwner, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (newPassword.length < 12) return res.status(400).json({ error: "يجب أن تكون كلمة المرور الجديدة 12 حرفًا على الأقل." });
  const owner = db.prepare("SELECT * FROM owner WHERE id=?").get(req.owner.id);
  if (!verifyPassword(currentPassword, owner.password_hash)) {
    return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة." });
  }
  db.prepare("UPDATE owner SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(hashPassword(newPassword), owner.id);
  audit("password_change", "owner", owner.id);
  res.json({ ok: true });
});

app.get("/admin/login", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  if (req.session.ownerId) return res.redirect("/admin");
  res.sendFile(path.join(root, "admin", "login.html"));
});

app.get("/admin", requireOwner, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.sendFile(path.join(root, "admin", "dashboard.html"));
});
app.get("/admin/", requireOwner, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.sendFile(path.join(root, "admin", "dashboard.html"));
});

app.get(/^\/product\/[^/]+\/?$/, (req, res, next) => {
  fs.readFile(path.join(root, "index.html"), "utf8", (error, html) => {
    if (error) return next(error);
    const headIndex = html.indexOf("<head>");
    if (headIndex === -1) return next(new Error("Could not find <head> in index.html."));
    const insertionPoint = headIndex + "<head>".length;
    const page = html.includes('<base href="/">')
      ? html
      : `${html.slice(0, insertionPoint)}\n        <base href="/">${html.slice(insertionPoint)}`;
    res.type("html").send(page);
  });
});

app.use("/admin", express.static(path.join(root, "admin"), { extensions: ["html"] }));
app.use("/uploads", express.static(uploadDir));

app.get("/api/admin/me", requireOwner, (req, res) => {
  res.json({ owner: { id: req.owner.id, email: req.owner.email, role: req.owner.role }, csrfToken: req.session.csrfToken });
});

app.get("/api/admin/backups", requireOwner, (req, res) => {
  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^zaai-.+\.sqlite$/.test(name))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(backups);
});

app.post("/api/admin/backups", ensureCsrf, requireOwner, (req, res) => {
  const backup = createDatabaseBackup();
  audit("backup", "database", "", { filename: backup.filename });
  res.status(201).json({ name: path.basename(backup.backupPath) });
});

app.get("/api/admin/backups/:name", requireOwner, (req, res) => {
  const name = path.basename(String(req.params.name || ""));
  if (!/^zaai-.+\.sqlite$/.test(name)) return res.status(400).json({ error: "اسم النسخة الاحتياطية غير صالح." });
  const backupPath = path.join(backupDir, name);
  if (!fs.existsSync(backupPath)) return res.status(404).json({ error: "النسخة الاحتياطية غير موجودة." });
  res.download(backupPath, name);
});

app.get("/api/admin/overview", requireOwner, (req, res) => {
  const productStats = db.prepare(`
    SELECT COUNT(*) count,
      SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) published,
      SUM(CASE WHEN status!='published' THEN 1 ELSE 0 END) unpublished
    FROM products
  `).get();
  const orderStats = db.prepare(`
    SELECT COUNT(*) count,
      SUM(CASE WHEN status='New' THEN 1 ELSE 0 END) new_count
    FROM orders
  `).get();
  res.json({
    products: productStats,
    orders: orderStats,
    customers: db.prepare("SELECT COUNT(*) count FROM customers").get().count,
    media: db.prepare("SELECT COUNT(*) count FROM media").get().count,
    recentAudit: getJsonRow("SELECT * FROM audit_log ORDER BY id DESC LIMIT 8")
  });
});

app.get("/api/admin/products", requireOwner, (req, res) => {
  const search = `%${String(req.query.search || "").trim()}%`;
  const status = String(req.query.status || "");
  let sql = "SELECT * FROM products WHERE name LIKE ? ";
  const params = [search];
  if (status) { sql += "AND status=? "; params.push(status); }
  sql += "ORDER BY sort_order ASC, id DESC";
  res.json(normalizeProducts(db.prepare(sql).all(...params)));
});

app.post("/api/admin/products", ensureCsrf, requireOwner, (req, res) => {
  const body = req.body;
  if (!String(body.name || "").trim()) return res.status(400).json({ error: "اسم المنتج مطلوب." });
  const result = db.prepare(`
    INSERT INTO products(name,description,category,original_price,sale_price,sizes,colors,images,gallery_customized,stock,status,featured,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    body.name.trim(),
    String(body.description || "").trim(),
    body.category || "men",
    Number(body.original_price || 0),
    Number(body.sale_price || 0),
    JSON.stringify(body.sizes || []),
    JSON.stringify(body.colors || []),
    JSON.stringify(body.images || []),
    1,
    Number(body.stock || 0),
    body.status || "draft",
    body.featured ? 1 : 0,
    Number(body.sort_order || 0)
  );
  audit("create", "product", result.lastInsertRowid, { name: body.name });
  res.status(201).json(normalizeProduct(db.prepare("SELECT * FROM products WHERE id=?").get(result.lastInsertRowid)));
});

app.put("/api/admin/products/:id", ensureCsrf, requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM products WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "المنتج غير موجود." });
  const body = req.body;
  db.prepare(`
    UPDATE products SET name=?,description=?,category=?,original_price=?,sale_price=?,sizes=?,colors=?,images=?,gallery_customized=?,stock=?,status=?,featured=?,sort_order=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    String(body.name || existing.name).trim(),
    String(body.description ?? existing.description).trim(),
    body.category || existing.category,
    Number(body.original_price ?? existing.original_price),
    Number(body.sale_price ?? existing.sale_price),
    JSON.stringify(body.sizes ?? parseJson(existing.sizes, [])),
    JSON.stringify(body.colors ?? parseJson(existing.colors, [])),
    JSON.stringify(body.images ?? parseJson(existing.images, [])),
    body.images === undefined ? Number(existing.gallery_customized) : 1,
    Number(body.stock ?? existing.stock),
    body.status || existing.status,
    body.featured === undefined ? existing.featured : (body.featured ? 1 : 0),
    Number(body.sort_order ?? existing.sort_order),
    id
  );
  audit("update", "product", id, { name: body.name || existing.name });
  res.json(normalizeProduct(db.prepare("SELECT * FROM products WHERE id=?").get(id)));
});

app.delete("/api/admin/products/:id", ensureCsrf, requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM products WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "المنتج غير موجود." });
  db.prepare("DELETE FROM products WHERE id=?").run(id);
  audit("delete", "product", id, { name: existing.name });
  res.json({ ok: true });
});

app.get("/api/admin/orders", requireOwner, (req, res) => {
  const search = `%${String(req.query.search || "").trim()}%`;
  res.json(db.prepare(`
    SELECT * FROM orders
    WHERE order_number LIKE ? OR customer_name LIKE ? OR phone LIKE ?
    ORDER BY id DESC
  `).all(search, search, search).map((row) => ({ ...row, items: parseJson(row.items, []) })));
});

app.patch("/api/admin/orders/:id", ensureCsrf, requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["New", "Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "حالة الطلب غير صحيحة." });
  const result = db.prepare("UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.body.status, id);
  if (!result.changes) return res.status(404).json({ error: "الطلب غير موجود." });
  audit("update", "order", id, { status: req.body.status });
  res.json({ ok: true });
});

app.get("/api/admin/customers", requireOwner, (req, res) => {
  const search = `%${String(req.query.search || "").trim()}%`;
  const customers = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM orders o WHERE o.phone=c.phone) order_count
    FROM customers c
    WHERE c.name LIKE ? OR c.phone LIKE ?
    ORDER BY c.updated_at DESC
  `).all(search, search);
  res.json(customers);
});

app.get("/api/admin/customer-orders/:phone", requireOwner, (req, res) => {
  res.json(db.prepare("SELECT * FROM orders WHERE phone=? ORDER BY id DESC").all(req.params.phone)
    .map((row) => ({ ...row, items: parseJson(row.items, []) })));
});

app.get("/api/admin/settings", requireOwner, (req, res) => {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  const settings = {};
  rows.forEach((row) => { settings[row.key] = parseJson(row.value, row.value); });
  res.json(settings);
});

app.put("/api/admin/settings", ensureCsrf, requireOwner, (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO settings(key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  const transaction = db.transaction(() => {
    Object.entries(req.body).forEach(([key, value]) => upsert.run(key, JSON.stringify(value)));
  });
  transaction();
  audit("update", "settings", "", req.body);
  res.json({ ok: true });
});

app.get("/api/admin/sections", requireOwner, (req, res) => {
  res.json(db.prepare("SELECT * FROM sections ORDER BY sort_order ASC,id ASC").all().map((row) => ({
    ...row,
    draft: parseJson(row.draft, {})
  })));
});

app.post("/api/admin/sections", ensureCsrf, requireOwner, (req, res) => {
  const body = req.body;
  if (!body.section_key) return res.status(400).json({ error: "مفتاح السكشن مطلوب." });
  const result = db.prepare(`
    INSERT INTO sections(section_key,title_ar,title_en,content_ar,content_en,image,video,button_text_ar,button_text_en,button_link,sort_order,visible,draft)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    body.section_key,
    body.title_ar || "",
    body.title_en || "",
    body.content_ar || "",
    body.content_en || "",
    body.image || "",
    body.video || "",
    body.button_text_ar || "",
    body.button_text_en || "",
    body.button_link || "",
    Number(body.sort_order || 0),
    body.visible === false ? 0 : 1,
    JSON.stringify(body.draft || {})
  );
  audit("create", "section", result.lastInsertRowid, { section_key: body.section_key });
  res.status(201).json(db.prepare("SELECT * FROM sections WHERE id=?").get(result.lastInsertRowid));
});

app.put("/api/admin/sections/reorder", ensureCsrf, requireOwner, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ error: "ترتيب السكشنات مطلوب." });
  const existingIds = new Set(db.prepare("SELECT id FROM sections").all().map((row) => row.id));
  if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id)) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "قائمة ترتيب السكشنات غير كاملة أو تحتوي على عناصر غير صالحة." });
  }
  const updateSort = db.prepare("UPDATE sections SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
  const transaction = db.transaction(() => {
    ids.forEach((id, index) => updateSort.run(index + 1, id));
  });
  transaction();
  audit("reorder", "sections", "", { ids });
  res.json({ ok: true });
});

app.put("/api/admin/sections/:id", ensureCsrf, requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM sections WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "السكشن غير موجود." });
  const body = req.body;
  db.prepare(`
    UPDATE sections SET title_ar=?,title_en=?,content_ar=?,content_en=?,image=?,video=?,
      button_text_ar=?,button_text_en=?,button_link=?,sort_order=?,visible=?,
      draft=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(
    body.title_ar ?? existing.title_ar,
    body.title_en ?? existing.title_en,
    body.content_ar ?? existing.content_ar,
    body.content_en ?? existing.content_en,
    body.image ?? existing.image,
    body.video ?? existing.video,
    body.button_text_ar ?? existing.button_text_ar,
    body.button_text_en ?? existing.button_text_en,
    body.button_link ?? existing.button_link,
    Number(body.sort_order ?? existing.sort_order),
    body.visible === undefined ? existing.visible : (body.visible ? 1 : 0),
    JSON.stringify(body.draft ?? parseJson(existing.draft, {})),
    id
  );
  audit("update", "section", id);
  res.json(db.prepare("SELECT * FROM sections WHERE id=?").get(id));
});

app.delete("/api/admin/sections/:id", ensureCsrf, requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT section_key FROM sections WHERE id=?").get(id);
  if (existing && ["home","product-lab","about","order-now","services","products","contact"].includes(existing.section_key)) {
    return res.status(400).json({ error: "لا يمكن حذف سكشن أساسي من الموقع." });
  }
  if (!db.prepare("DELETE FROM sections WHERE id=?").run(id).changes) return res.status(404).json({ error: "السكشن غير موجود." });
  audit("delete", "section", id);
  res.json({ ok: true });
});

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (/^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)) callback(null, true);
    else callback(new Error("يسمح بالصور والفيديوهات فقط."));
  }
});

app.get("/api/admin/media", requireOwner, (req, res) => {
  const search = `%${String(req.query.search || "").trim()}%`;
  res.json(db.prepare("SELECT * FROM media WHERE filename LIKE ? OR original_name LIKE ? ORDER BY id DESC")
    .all(search, search));
});

app.post("/api/admin/media", ensureCsrf, requireOwner, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "لم يتم إرسال ملف." });
  const extension = path.extname(req.file.originalname);
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
  fs.renameSync(req.file.path, path.join(uploadDir, storedName));
  const url = `/uploads/${storedName}`;
  const result = db.prepare(`
    INSERT INTO media(filename,original_name,mime_type,size,url,used_by)
    VALUES (?,?,?,?,?,?)
  `).run(storedName, req.file.originalname, req.file.mimetype, req.file.size, url, "");
  audit("upload", "media", result.lastInsertRowid, { filename: storedName });
  res.status(201).json(db.prepare("SELECT * FROM media WHERE id=?").get(result.lastInsertRowid));
});

app.delete("/api/admin/media/:id", ensureCsrf, requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const media = db.prepare("SELECT * FROM media WHERE id=?").get(id);
  if (!media) return res.status(404).json({ error: "الملف غير موجود." });
  const inProducts = db.prepare("SELECT COUNT(*) AS count FROM products WHERE images LIKE ? OR colors LIKE ?")
    .get(`%${media.url}%`, `%${media.url}%`).count;
  const inSections = db.prepare("SELECT COUNT(*) AS count FROM sections WHERE image=? OR video=?")
    .get(media.url, media.url).count;
  if (inProducts || inSections) {
    return res.status(409).json({ error: "لا يمكن حذف هذا الملف لأنه مستخدم حاليًا في موقعك." });
  }
  fs.rmSync(path.join(uploadDir, media.filename), { force: true });
  db.prepare("DELETE FROM media WHERE id=?").run(id);
  audit("delete", "media", id, { filename: media.filename });
  res.json({ ok: true });
});

app.get("/api/store/settings", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const rows = db.prepare("SELECT key,value FROM settings").all();
  const settings = {};
  rows.forEach((row) => { settings[row.key] = parseJson(row.value, row.value); });
  res.json(settings);
});

app.get("/api/store/products", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json(normalizeProducts(
    db.prepare("SELECT * FROM products WHERE status='published' ORDER BY sort_order ASC,id DESC").all()
  ));
});

app.get("/api/store/sections", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json(db.prepare("SELECT * FROM sections WHERE visible=1 ORDER BY sort_order ASC,id ASC").all());
});

app.post("/api/store/orders", (req, res) => {
  const body = req.body;
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  const governorate = String(body.governorate || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!name || !phone || !address || !governorate || !items.length) {
    return res.status(400).json({ error: "يرجى إدخال بيانات الطلب كاملة." });
  }
  const giftQuantity = items.reduce((sum, item) => sum + (item.promotionGift ? Math.max(0, Math.floor(Number(item.quantity) || 0)) : 0), 0);
  const paidQuantity = items.reduce((sum, item) => sum + (item.promotionGift ? 0 : Math.max(0, Math.floor(Number(item.quantity) || 0))), 0);
  const allowedGifts = Math.floor(paidQuantity / 5);
  if (giftQuantity > allowedGifts) {
    return res.status(400).json({ error: "عدد الهدايا يتجاوز عدد الهدايا المستحق من العرض." });
  }
  const paidUnits = [];
  items.forEach((item) => {
    if (item.promotionGift) return;
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    const price = Math.max(0, Number(item.price) || 800);
    for (let index = 0; index < quantity; index += 1) paidUnits.push({ price, charge: price });
  });
  const giftSlots = Math.floor(paidUnits.length / 5);
  const bundleCandidates = paidUnits.slice(giftSlots * 5);
  for (let index = 0; index + 1 < bundleCandidates.length; index += 2) {
    const first = bundleCandidates[index];
    const second = bundleCandidates[index + 1];
    const regularTotal = first.price + second.price;
    first.charge = Math.round((1500 * first.price / regularTotal) * 100) / 100;
    second.charge = 1500 - first.charge;
  }
  const subtotal = paidUnits.reduce((sum, unit) => sum + unit.charge, 0);
  const deliveryFee = 0;
  const total = subtotal + deliveryFee;
  const orderNumber = `ZA-${Date.now().toString().slice(-8)}-${crypto.randomInt(10, 99)}`;
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO customers(name,phone,governorate,address,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,governorate=excluded.governorate,address=excluded.address,updated_at=CURRENT_TIMESTAMP")
      .run(name, phone, governorate, address);
    const result = db.prepare(`
      INSERT INTO orders(order_number,customer_name,phone,governorate,address,items,subtotal,delivery_fee,total,status)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(orderNumber, name, phone, governorate, address, JSON.stringify(items), subtotal, deliveryFee, total, "New");
    return result.lastInsertRowid;
  });
  const orderId = transaction();
  audit("create", "order", orderId, { order_number: orderNumber, phone });
  res.status(201).json({ ok: true, orderNumber, total });
});

app.use(express.static(root, {
  index: "index.html",
  extensions: ["html"]
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "غير موجود." });
  next();
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message) {
    if (req.path.startsWith("/api/admin")) return res.status(400).json({ error: error.message || "تعذر رفع الملف." });
  }
  next(error);
});

app.listen(port, () => {
  console.log(`ZAAI is running at http://127.0.0.1:${port}`);
  console.log(`Owner login: http://127.0.0.1:${port}/admin/login`);
});
