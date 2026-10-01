const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "flights.db"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS flights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  airline TEXT NOT NULL,
  flight_number TEXT NOT NULL,
  from_city TEXT NOT NULL,
  from_code TEXT NOT NULL,
  to_city TEXT NOT NULL,
  to_code TEXT NOT NULL,
  departure TEXT NOT NULL,
  arrival TEXT NOT NULL,
  duration TEXT NOT NULL,
  price REAL NOT NULL,
  seats INTEGER NOT NULL DEFAULT 0,
  travel_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pnr TEXT UNIQUE NOT NULL,
  flight_id INTEGER NOT NULL,
  user_id INTEGER,
  total_price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (flight_id) REFERENCES flights(id)
);

CREATE TABLE IF NOT EXISTS passengers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  passport TEXT NOT NULL,
  nationality TEXT NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

try {
  db.exec(`ALTER TABLE bookings ADD COLUMN user_id INTEGER`);
} catch (_) {}

const count = db.prepare("SELECT COUNT(*) AS c FROM flights").get().c;
if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO flights
    (airline, flight_number, from_city, from_code, to_city, to_code,
     departure, arrival, duration, price, seats, travel_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const flights = [
    ["بدر للطيران","J4-101","بورتسودان","PZU","القاهرة","CAI","08:00","10:30","2 ساعة 30 دقيقة",450,25,"2026-10-10"],
    ["تاركو للطيران","3T-202","بورتسودان","PZU","القاهرة","CAI","14:15","16:35","2 ساعة 20 دقيقة",420,18,"2026-10-10"],
    ["مصر للطيران","MS-303","بورتسودان","PZU","القاهرة","CAI","23:30","01:45","2 ساعة 15 دقيقة",510,12,"2026-10-10"],
    ["بدر للطيران","J4-404","بورتسودان","PZU","جدة","JED","10:00","11:45","ساعة 45 دقيقة",380,20,"2026-10-10"]
  ];

  const seed = db.transaction(() => {
    for (const f of flights) insert.run(...f);
  });
  seed();
}

module.exports = db;
