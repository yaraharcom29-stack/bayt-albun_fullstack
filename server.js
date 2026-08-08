'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { Pool } = require('pg');

const ROOT = __dirname;
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';
const MAX_BODY_BYTES = 80 * 1024;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL غير موجود. أضيفي Neon connection string في ملف .env أو في Render Environment Variables.');
  process.exit(1);
}

const db = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000
});

db.on('error', error => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

const MENU = Object.freeze({
  espresso: { name: 'إسبريسو', price: 12, category: 'hot' },
  latte: { name: 'لاتيه', price: 18, category: 'hot' },
  cappuccino: { name: 'كابتشينو', price: 17, category: 'hot' },
  'turkish-coffee': { name: 'قهوة تركية', price: 15, category: 'hot' },
  mocha: { name: 'موكا', price: 20, category: 'hot' },
  'flat-white': { name: 'فلات وايت', price: 19, category: 'hot' },
  'iced-latte': { name: 'آيس لاتيه', price: 19, category: 'cold' },
  'cold-brew': { name: 'كولد برو', price: 22, category: 'cold' },
  frappe: { name: 'فرابيه', price: 21, category: 'cold' },
  'iced-mocha': { name: 'آيس موكا', price: 23, category: 'cold' },
  tiramisu: { name: 'تيراميسو', price: 26, category: 'sweets' },
  'oatmeal-cookies': { name: 'كوكيز الشوفان', price: 10, category: 'sweets' },
  'butter-croissant': { name: 'كرواسون بالزبدة', price: 12, category: 'sweets' },
  cheesecake: { name: 'تشيز كيك', price: 24, category: 'sweets' }
});

const rateBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateBuckets.entries()) {
    if (value.resetAt <= now) rateBuckets.delete(key);
  }
}, 60_000).unref();

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname, url);
    }

    if (pathname === '/admin' || pathname === '/admin/') {
      if (!requireAdmin(req, res)) return;
      return serveFile(res, path.join(ROOT, 'admin', 'index.html'));
    }

    if (pathname === '/admin/admin.css' || pathname === '/admin/admin.js') {
      if (!requireAdmin(req, res)) return;
      return serveFile(res, path.join(ROOT, 'admin', path.basename(pathname)));
    }

    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(res, path.join(ROOT, 'index.html'));
    }

    if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/assets/')) {
      const safePath = safeStaticPath(pathname);
      if (!safePath) return sendJson(res, 404, { error: 'Not found' });
      return serveFile(res, safePath);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'حدث خطأ داخلي في الخادم.' });
    else res.end();
  }
});

async function startServer() {
  try {
    await initializeDatabase();
    await db.query('SELECT 1');

    server.listen(PORT, HOST, () => {
      console.log(`\nبيت البُن يعمل الآن على: http://${HOST}:${PORT}`);
      console.log(`لوحة الإدارة: http://${HOST}:${PORT}/admin`);
      console.log('قاعدة البيانات: PostgreSQL (Neon)');
      if (ADMIN_PASSWORD === 'change-me-now') {
        console.warn('⚠ غيّري ADMIN_PASSWORD قبل نشر الموقع على الإنترنت.');
      }
      console.log('');
    });
  } catch (error) {
    console.error('❌ تعذر الاتصال بقاعدة PostgreSQL أو تهيئتها:', error.message);
    process.exit(1);
  }
}

async function handleApi(req, res, pathname, url) {
  const ip = getClientIp(req);

  if (pathname === '/api/health' && req.method === 'GET') {
    try {
      await db.query('SELECT 1');
      return sendJson(res, 200, { ok: true, service: 'bayt-albun', database: 'postgresql' });
    } catch (_) {
      return sendJson(res, 503, { ok: false, service: 'bayt-albun', database: 'unavailable' });
    }
  }

  if (pathname === '/api/menu' && req.method === 'GET') {
    return sendJson(res, 200, {
      items: Object.entries(MENU).map(([id, item]) => ({ id, ...item }))
    });
  }

  if (pathname === '/api/orders' && req.method === 'POST') {
    if (!allowRate(`order:${ip}`, 8, 10 * 60_000)) return sendJson(res, 429, { error: 'طلبات كثيرة جدًا. حاولي مرة أخرى بعد قليل.' });
    const body = await readJson(req);
    return await createOrder(res, body);
  }

  if (pathname === '/api/contact' && req.method === 'POST') {
    if (!allowRate(`contact:${ip}`, 6, 10 * 60_000)) return sendJson(res, 429, { error: 'محاولات كثيرة جدًا. حاولي مرة أخرى بعد قليل.' });
    const body = await readJson(req);
    return await createContactMessage(res, body);
  }

  if (pathname === '/api/newsletter' && req.method === 'POST') {
    if (!allowRate(`newsletter:${ip}`, 8, 10 * 60_000)) return sendJson(res, 429, { error: 'محاولات كثيرة جدًا. حاولي مرة أخرى بعد قليل.' });
    const body = await readJson(req);
    return await createNewsletterSubscription(res, body);
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;

    if (pathname === '/api/admin/summary' && req.method === 'GET') {
      const { rows } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','preparing','ready'))::int AS pending_orders,
          COUNT(*)::int AS total_orders,
          (SELECT COUNT(*)::int FROM contact_messages) AS messages,
          (SELECT COUNT(*)::int FROM newsletter_subscribers) AS subscribers
        FROM orders
      `);
      const row = rows[0];
      return sendJson(res, 200, {
        pendingOrders: row.pending_orders,
        totalOrders: row.total_orders,
        messages: row.messages,
        subscribers: row.subscribers
      });
    }

    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 300);
      const { rows: orders } = await db.query(`
        SELECT id, order_number, customer_name, phone, email, fulfillment_type, address, notes,
               subtotal, total, status,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at
        FROM orders
        ORDER BY id DESC
        LIMIT $1
      `, [limit]);

      if (orders.length) {
        const ids = orders.map(order => order.id);
        const { rows: itemRows } = await db.query(`
          SELECT order_id, product_id, product_name, unit_price, quantity, line_total
          FROM order_items
          WHERE order_id = ANY($1::int[])
          ORDER BY id
        `, [ids]);

        const itemsByOrder = new Map();
        for (const item of itemRows) {
          if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
          itemsByOrder.get(item.order_id).push(item);
        }
        for (const order of orders) order.items = itemsByOrder.get(order.id) || [];
      }

      return sendJson(res, 200, { orders });
    }

    if (pathname === '/api/admin/messages' && req.method === 'GET') {
      const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 300);
      const { rows: messages } = await db.query(`
        SELECT id, name, email, subject, message,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at
        FROM contact_messages
        ORDER BY id DESC
        LIMIT $1
      `, [limit]);
      return sendJson(res, 200, { messages });
    }

    if (pathname === '/api/admin/subscribers' && req.method === 'GET') {
      const limit = clamp(Number(url.searchParams.get('limit') || 100), 1, 300);
      const { rows: subscribers } = await db.query(`
        SELECT id, email,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at
        FROM newsletter_subscribers
        ORDER BY id DESC
        LIMIT $1
      `, [limit]);
      return sendJson(res, 200, { subscribers });
    }

    const statusMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
    if (statusMatch && req.method === 'PATCH') {
      const body = await readJson(req);
      const allowed = new Set(['pending', 'preparing', 'ready', 'completed', 'cancelled']);
      if (!allowed.has(body.status)) return sendJson(res, 400, { error: 'حالة الطلب غير صحيحة.' });
      const result = await db.query(
        'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id',
        [body.status, Number(statusMatch[1])]
      );
      if (!result.rowCount) return sendJson(res, 404, { error: 'الطلب غير موجود.' });
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'API route not found' });
}

async function createOrder(res, body) {
  const customerName = cleanText(body.customerName, 80);
  const phone = cleanText(body.phone, 30);
  const email = cleanText(body.email, 120);
  const fulfillmentType = body.fulfillmentType === 'delivery' ? 'delivery' : body.fulfillmentType === 'pickup' ? 'pickup' : '';
  const address = cleanText(body.address, 260);
  const notes = cleanText(body.notes, 500);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (customerName.length < 2) return sendJson(res, 400, { error: 'اكتبي اسم العميل.' });
  if (!isValidPhone(phone)) return sendJson(res, 400, { error: 'اكتبي رقم موبايل صحيح.' });
  if (email && !isValidEmail(email)) return sendJson(res, 400, { error: 'البريد الإلكتروني غير صحيح.' });
  if (!fulfillmentType) return sendJson(res, 400, { error: 'اختاري استلام من الفرع أو توصيل.' });
  if (fulfillmentType === 'delivery' && address.length < 8) return sendJson(res, 400, { error: 'اكتبي عنوان التوصيل بالتفصيل.' });
  if (!rawItems.length || rawItems.length > 30) return sendJson(res, 400, { error: 'أضيفي صنفًا واحدًا على الأقل للطلب.' });

  const normalized = new Map();
  for (const row of rawItems) {
    const productId = cleanText(row.productId, 60);
    const product = MENU[productId];
    const quantity = clamp(Math.trunc(Number(row.quantity || 0)), 1, 20);
    if (!product) return sendJson(res, 400, { error: 'يوجد صنف غير صالح في الطلب.' });
    normalized.set(productId, clamp((normalized.get(productId) || 0) + quantity, 1, 20));
  }

  const items = [...normalized.entries()].map(([productId, quantity]) => {
    const product = MENU[productId];
    return {
      productId,
      productName: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal: product.price * quantity
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = subtotal;
  const orderNumber = makeOrderNumber();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const orderResult = await client.query(`
      INSERT INTO orders (
        order_number, customer_name, phone, email, fulfillment_type, address, notes,
        subtotal, total, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING id
    `, [
      orderNumber,
      customerName,
      phone,
      email || null,
      fulfillmentType,
      fulfillmentType === 'delivery' ? address : null,
      notes || null,
      subtotal,
      total
    ]);

    const orderId = orderResult.rows[0].id;
    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [orderId, item.productId, item.productName, item.unitPrice, item.quantity, item.lineTotal]);
    }

    await client.query('COMMIT');
    return sendJson(res, 201, { ok: true, orderNumber, total, status: 'pending' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Order insert failed:', error);
    return sendJson(res, 500, { error: 'تعذر حفظ الطلب. حاولي مرة أخرى.' });
  } finally {
    client.release();
  }
}

async function createContactMessage(res, body) {
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120);
  const subject = cleanText(body.subject, 140);
  const message = cleanText(body.message, 2000);

  if (name.length < 2) return sendJson(res, 400, { error: 'اكتبي الاسم.' });
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'البريد الإلكتروني غير صحيح.' });
  if (subject.length < 2) return sendJson(res, 400, { error: 'اكتبي موضوع الرسالة.' });
  if (message.length < 5) return sendJson(res, 400, { error: 'اكتبي الرسالة.' });

  await db.query(`
    INSERT INTO contact_messages (name, email, subject, message)
    VALUES ($1, $2, $3, $4)
  `, [name, email, subject, message]);

  return sendJson(res, 201, { ok: true, message: 'تم استلام رسالتك بنجاح.' });
}

async function createNewsletterSubscription(res, body) {
  const email = cleanText(body.email, 120).toLowerCase();
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'البريد الإلكتروني غير صحيح.' });

  const result = await db.query(`
    INSERT INTO newsletter_subscribers (email)
    VALUES ($1)
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `, [email]);

  if (!result.rowCount) return sendJson(res, 200, { ok: true, alreadySubscribed: true });
  return sendJson(res, 201, { ok: true });
}

async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('pickup','delivery')),
      address TEXT,
      notes TEXT,
      subtotal DOUBLE PRECISION NOT NULL,
      total DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','completed','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit_price DOUBLE PRECISION NOT NULL,
      quantity INTEGER NOT NULL,
      line_total DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  `);
}

function makeOrderNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = crypto.randomInt(1000, 9999);
  return `BUN-${y}${m}${day}-${rand}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
}

function safeStaticPath(pathname) {
  const relative = pathname.replace(/^\/+/, '');
  const target = path.resolve(ROOT, relative);
  const allowedRoots = ['css', 'js', 'assets'].map(dir => path.resolve(ROOT, dir) + path.sep);
  if (!allowedRoots.some(root => target.startsWith(root))) return null;
  return target;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return requestAdminAuth(res);

  let decoded = '';
  try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); }
  catch (_) { return requestAdminAuth(res); }

  const split = decoded.indexOf(':');
  const user = split >= 0 ? decoded.slice(0, split) : decoded;
  const pass = split >= 0 ? decoded.slice(split + 1) : '';

  if (!safeEqual(user, ADMIN_USER) || !safeEqual(pass, ADMIN_PASSWORD)) return requestAdminAuth(res);
  return true;
}

function requestAdminAuth(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Bayt Al Bun Admin", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end('Admin authentication required');
  return false;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function allowRate(key, max, windowMs) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function isValidPhone(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function shutdown(signal) {
  console.log(`\n${signal}: إغلاق الخادم...`);
  server.close(async () => {
    try { await db.end(); } catch (_) {}
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
