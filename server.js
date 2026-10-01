const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./database");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "flight-booking-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.use(express.static(path.join(__dirname, "public")));

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: "يجب تسجيل الدخول أولاً" });
  }
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/search-flights", (req, res) => {
  const { from = "", to = "", date = "" } = req.query;

  let sql = "SELECT * FROM flights WHERE 1=1";
  const params = [];

  if (from.trim()) {
    sql += " AND (from_city LIKE ? OR from_code LIKE ?)";
    const v = `%${from.trim()}%`;
    params.push(v, v);
  }

  if (to.trim()) {
    sql += " AND (to_city LIKE ? OR to_code LIKE ?)";
    const v = `%${to.trim()}%`;
    params.push(v, v);
  }

  if (date.trim()) {
    sql += " AND travel_date = ?";
    params.push(date.trim());
  }

  sql += " ORDER BY price ASC";

  const rows = db.prepare(sql).all(...params);
  res.json({ success: true, count: rows.length, data: rows });
});

app.get("/api/flights/:id", (req, res) => {
  const flight = db.prepare("SELECT * FROM flights WHERE id = ?").get(req.params.id);
  if (!flight) return res.status(404).json({ success: false, message: "الرحلة غير موجودة" });
  res.json({ success: true, data: flight });
});

app.post("/api/register", async (req, res) => {
  try {
    const { first_name, last_name, email, phone, password } = req.body;

    if (!first_name || !last_name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: "يرجى إكمال جميع الحقول" });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    }

    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email.trim().toLowerCase());
    if (exists) {
      return res.status(409).json({ success: false, message: "البريد الإلكتروني مستخدم بالفعل" });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users (first_name,last_name,email,phone,password)
      VALUES (?,?,?,?,?)
    `).run(first_name.trim(), last_name.trim(), email.trim().toLowerCase(), phone.trim(), hash);

    req.session.userId = result.lastInsertRowid;
    res.json({
      success: true,
      user: { id: result.lastInsertRowid, first_name, last_name, email, phone }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء الحساب" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").trim().toLowerCase());

    if (!user || !(await bcrypt.compare(password || "", user.password))) {
      return res.status(401).json({ success: false, message: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }

    req.session.userId = user.id;
    res.json({
      success: true,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "حدث خطأ أثناء تسجيل الدخول" });
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });

  const user = db.prepare(`
    SELECT id, first_name, last_name, email, phone, created_at
    FROM users WHERE id = ?
  `).get(req.session.userId);

  if (!user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/my-account", requireLogin, (req, res) => {
  const user = db.prepare(`
    SELECT id, first_name, last_name, email, phone, created_at
    FROM users WHERE id = ?
  `).get(req.session.userId);

  res.json({ success: true, user });
});

function makePNR() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

app.post("/api/bookings", requireLogin, (req, res) => {
  const { flight_id, passenger } = req.body;

  if (!flight_id || !passenger) {
    return res.status(400).json({ success: false, message: "بيانات الحجز ناقصة" });
  }

  const flight = db.prepare("SELECT * FROM flights WHERE id = ?").get(flight_id);
  if (!flight) return res.status(404).json({ success: false, message: "الرحلة غير موجودة" });
  if (flight.seats <= 0) return res.status(409).json({ success: false, message: "لا توجد مقاعد متاحة" });

  let pnr = makePNR();
  while (db.prepare("SELECT id FROM bookings WHERE pnr = ?").get(pnr)) pnr = makePNR();

  const transaction = db.transaction(() => {
    const booking = db.prepare(`
      INSERT INTO bookings (pnr, flight_id, user_id, total_price, status)
      VALUES (?, ?, ?, ?, 'confirmed')
    `).run(pnr, flight.id, req.session.userId, flight.price);

    db.prepare(`
      INSERT INTO passengers
      (booking_id, first_name, last_name, phone, email, passport, nationality)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      booking.lastInsertRowid,
      passenger.first_name,
      passenger.last_name,
      passenger.phone,
      passenger.email,
      passenger.passport,
      passenger.nationality
    );

    db.prepare("UPDATE flights SET seats = seats - 1 WHERE id = ? AND seats > 0").run(flight.id);
  });

  transaction();
  res.json({ success: true, pnr });
});

app.get("/api/my-bookings", requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      b.id, b.pnr, b.total_price, b.status, b.created_at,
      f.airline, f.flight_number, f.from_city, f.from_code,
      f.to_city, f.to_code, f.departure, f.arrival, f.duration, f.travel_date,
      p.first_name, p.last_name, p.phone, p.email, p.passport, p.nationality
    FROM bookings b
    JOIN flights f ON f.id = b.flight_id
    LEFT JOIN passengers p ON p.booking_id = b.id
    WHERE b.user_id = ?
    ORDER BY b.id DESC
  `).all(req.session.userId);

  res.json({ success: true, data: rows });
});

app.get("/api/bookings/:pnr", (req, res) => {
  const row = db.prepare(`
    SELECT
      b.id, b.pnr, b.total_price, b.status, b.created_at,
      f.airline, f.flight_number, f.from_city, f.from_code,
      f.to_city, f.to_code, f.departure, f.arrival, f.duration, f.travel_date,
      p.first_name, p.last_name, p.phone, p.email, p.passport, p.nationality
    FROM bookings b
    JOIN flights f ON f.id = b.flight_id
    LEFT JOIN passengers p ON p.booking_id = b.id
    WHERE b.pnr = ?
  `).get(req.params.pnr.toUpperCase());

  if (!row) return res.status(404).json({ success: false, message: "الحجز غير موجود" });
  res.json({ success: true, data: row });
});

app.delete("/api/bookings/:pnr", requireLogin, (req, res) => {
  const booking = db.prepare(`
    SELECT * FROM bookings
    WHERE pnr = ? AND user_id = ?
  `).get(req.params.pnr.toUpperCase(), req.session.userId);

  if (!booking) return res.status(404).json({ success: false, message: "الحجز غير موجود" });
  if (booking.status === "cancelled") {
    return res.status(400).json({ success: false, message: "الحجز ملغى بالفعل" });
  }

  const transaction = db.transaction(() => {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
    db.prepare("UPDATE flights SET seats = seats + 1 WHERE id = ?").run(booking.flight_id);
  });

  transaction();
  res.json({ success: true, message: "تم إلغاء الحجز" });
});

app.listen(PORT, () => {
  console.log(`رحلتي السودان يعمل على http://localhost:${PORT}`);
});
