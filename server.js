import express from "express";
import cors from "cors";
import helmet from "helmet";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

import deeplRoutes from "./routes/deepl.js";
import elevenRoutes from "./routes/elevenlabs.js";
import geminiRoutes from "./routes/gemini.js";
import heygenRoutes from "./routes/heygen.js";
import photoAvatarRoutes from "./routes/photoAvatar.js";
import klingRoutes from "./routes/kling.js";

// Načítaj .env premenné (lokálne). Na Renderi to číta z Environment Variables.
dotenv.config();

// ====== DB PRIPOJENIE =====================================
// Hodnoty nebudú natvrdo v kóde. Budú v env premenných:
// DB_HOST, DB_USER, DB_PASS, DB_NAME
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
};

let db;
async function initDB() {
  db = await mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  console.log("✅ DB pool ready");
}
// ===========================================================

const app = express();

// bezpečnostné hlavičky
app.use(helmet());

// CORS – povolíme tvoj web
app.use(
  cors({
    origin: "https://www.tvorai.cz",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// preflight handler pre všetky cesty
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://www.tvorai.cz");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res.sendStatus(200);
});

// JSON body
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// healthcheck
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ===========================================================
// HELPER: získa interný user z tabuľky `users` podľa wp_user_id
async function getUserByWpId(wp_user_id) {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE wp_user_id = ? LIMIT 1",
    [wp_user_id]
  );
  return rows.length ? rows[0] : null;
}

// HELPER: načítaj aktívne predplatné a kredity
async function getActiveSubscriptionAndBalance(user_id) {
  // zistíme aktívne predplatné
  const [subs] = await db.execute(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND active = 1
     ORDER BY id DESC
     LIMIT 1`,
    [user_id]
  );

  if (!subs.length) {
    return { subscription: null, balance: null };
  }

  const subscription = subs[0];

  // zistíme zostatok kreditov
  const [balances] = await db.execute(
    `SELECT * FROM credit_balances
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [user_id]
  );

  const balance = balances.length ? balances[0] : null;

  return { subscription, balance };
}

// ===========================================================
// 1) /consume  -> použitie AI funkcie, odpočíta kredity a zaloguje
//
// Request body očakáva:
// {
//   "wp_user_id": 123,
//   "feature_type": "translate_text" | "gemini_chat" | "heygen_video" | "kling_video" | ...,
//   "estimated_cost": 200,        // (voliteľné) konkrétna cena volania v kreditoch
//   "metadata": {
//       "duration": 5,           // napr. pri kling_video vieme 5s alebo 10s
//       ...hocičo ďalšie
//   }
// }
//
// Ako rátame cenu (finalCost):
// 1. Ak prišlo estimated_cost z WordPressu -> použijeme to (napr. 200 alebo 500)
// 2. Inak, ak feature_type === "kling_video" a metadata.duration existuje:
//        duration 5s  -> 200 kreditov
//        duration 10s -> 500 kreditov
// 3. Inak fallback: použijeme PRICING[feature_type]
// ===========================================================
app.post("/consume", async (req, res) => {
  try {
    const {
      wp_user_id,
      feature_type,
      estimated_cost, // môže prísť z WordPressu (200 alebo 500)
      metadata
    } = req.body || {};

    // 0. validácia vstupu
    if (!wp_user_id || !feature_type) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details: "wp_user_id and feature_type are required"
      });
    }

    // 💸 CENNÍK ZA FUNKCIE (fallback ceny)
    // Toto sú defaulty, použijú sa ak nemáme nič špecifické.
    const PRICING = {
      translate_text: 10,   // preklad textu (DeepL klon)
      gemini_chat: 5,       // AI chat
      heygen_video: 200,    // video avatar generácia
      voice_tts: 2,         // text -> hlas
      photo_avatar: 50,     // AI fotka/avatar
      kling_video: 250,     // fallback pre KLING
      test_feature: 10      // test
    };

    // === 1. vyrátaj finalCost ===
    let finalCost;

    // (A) Ak klient poslal explicitne estimated_cost (napr. WP snippet dá 200 alebo 500),
    //     použijeme ho.
    if (typeof estimated_cost === "number" && !Number.isNaN(estimated_cost)) {
      finalCost = estimated_cost;
    } else {
      // (B) Ak je to KLING video a máme metadata.duration,
      //     urč cenu podľa dĺžky:
      //     5s  -> 200 kreditov
      //     10s -> 500 kreditov
      if (feature_type === "kling_video" && metadata && metadata.duration) {
        const d = Number(metadata.duration);
        if (d === 5) {
          finalCost = 200;
        } else if (d === 10) {
          finalCost = 500;
        }
      }

      // (C) Fallback: ak stále nemáme finalCost, použi PRICING[feature_type]
      if (typeof finalCost === "undefined") {
        finalCost = PRICING[feature_type];
      }
    }

    // Ak ani teraz nemáme cenu, nevieme účtovať
    if (typeof finalCost === "undefined") {
      return res.status(400).json({
        error: "UNKNOWN_FEATURE_TYPE",
        details: `No pricing rule for feature_type=${feature_type} and no usable estimated_cost`
      });
    }

    // 1. nájdeme usera podľa wp_user_id
    const user = await getUserByWpId(wp_user_id);
    if (!user) {
      return res.status(400).json({ error: "USER_NOT_FOUND" });
    }

    // 2. nájdeme aktívne predplatné + balance
    const { subscription, balance } = await getActiveSubscriptionAndBalance(user.id);

    if (!subscription || !subscription.active) {
      return res.status(403).json({ error: "NO_ACTIVE_SUBSCRIPTION" });
    }

    if (!balance) {
      return res.status(400).json({ error: "NO_BALANCE_RECORD" });
    }

    // 3. kontrola kreditov
    if (balance.credits_remaining < finalCost) {
      return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });
    }

    // 4. odpočítanie kreditov + zápis do usage_logs (transakčne)
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // znovu načítaj balance FOR UPDATE (lock)
      const [balRows] = await connection.execute(
        "SELECT * FROM credit_balances WHERE id = ? FOR UPDATE",
        [balance.id]
      );

      if (!balRows.length) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ error: "BALANCE_NOT_FOUND_AGAIN" });
      }

      const currentBalance = balRows[0];

      if (currentBalance.credits_remaining < finalCost) {
        await connection.rollback();
        connection.release();
        return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });
      }

      const newBalance = currentBalance.credits_remaining - Number(finalCost);

      // update credit_balances
      await connection.execute(
        "UPDATE credit_balances SET credits_remaining = ?, updated_at = NOW() WHERE id = ?",
        [newBalance, currentBalance.id]
      );

      // insert usage_logs
      await connection.execute(
        "INSERT INTO usage_logs (user_id, feature_type, credits_spent, metadata) VALUES (?, ?, ?, ?)",
        [
          user.id,
          feature_type,
          finalCost,
          metadata ? JSON.stringify(metadata) : null
        ]
      );

      await connection.commit();
      connection.release();

      // vraciame info naspäť
      return res.json({
        ok: true,
        credits_remaining: newBalance,
        charged: finalCost
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      console.error("TX ERROR", err.message, err.stack);
      return res.status(500).json({ error: "TX_FAILED", detail: err.message });
    }
  } catch (err) {
    console.error("consume error", err.message, err.stack);
    return res
      .status(500)
      .json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// 2) /usage/:wp_user_id  -> dashboard pre usera
//
// vráti:
// {
//   plan_id: "...",
//   credits_remaining: 39000,
//   monthly_credit_limit: 40000,
//   cycle_end: "2025-11-26 ...",
//   recent_usage: [ { timestamp, feature_type, credits_spent }, ... ]
// }
app.get("/usage/:wp_user_id", async (req, res) => {
  try {
    const { wp_user_id } = req.params;

    const user = await getUserByWpId(wp_user_id);
    if (!user) {
      return res.status(400).json({ error: "USER_NOT_FOUND" });
    }

    const { subscription, balance } = await getActiveSubscriptionAndBalance(
      user.id
    );

    if (!subscription) {
      return res.status(404).json({ error: "NO_ACTIVE_SUBSCRIPTION" });
    }

    // načítame posledné použitia
    const [logs] = await db.execute(
      `SELECT timestamp, feature_type, credits_spent
       FROM usage_logs
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 10`,
      [user.id]
    );

    return res.json({
      plan_id: subscription.plan_id,
      credits_remaining: balance ? balance.credits_remaining : 0,
      monthly_credit_limit: subscription.monthly_credit_limit,
      cycle_end: subscription.cycle_end,
      recent_usage: logs
    });
  } catch (err) {
    console.error("usage error", err.message, err.stack);
    return res
      .status(500)
      .json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// 3) /webhook/subscription-update
//
// Toto zavolá WordPress/MemberPress, keď niekto kúpi alebo zmení plán.
// Očakávame body:
// {
//   "wp_user_id": 123,
//   "email": "user@example.com",
//   "plan_id": "pro",
//   "monthly_credit_limit": 40000,
//   "cycle_start": "2025-10-26 10:00:00",
//   "cycle_end": "2025-11-26 10:00:00",
//   "active": true
// }
//
// Logika:
// - ak user ešte neexistuje v `users`, vytvor ho
// - vytvor/aktualizuj subscriptions
// - ak začína nové billing obdobie => nastav credit_balances.credits_remaining = monthly_credit_limit
app.post("/webhook/subscription-update", async (req, res) => {
  try {
    const {
      wp_user_id,
      email,
      plan_id,
      monthly_credit_limit,
      cycle_start,
      cycle_end,
      active
    } = req.body;

    if (
      !wp_user_id ||
      !plan_id ||
      !monthly_credit_limit ||
      !cycle_start ||
      !cycle_end
    ) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details:
          "wp_user_id, plan_id, monthly_credit_limit, cycle_start, cycle_end are required"
      });
    }

    // 1. user existuje?
    let user = await getUserByWpId(wp_user_id);

    if (!user) {
      // vytvor nového usera
      const [result] = await db.execute(
        "INSERT INTO users (wp_user_id, email) VALUES (?, ?)",
        [wp_user_id, email || null]
      );

      const insertedId = result.insertId;
      const [rows] = await db.execute(
        "SELECT * FROM users WHERE id = ? LIMIT 1",
        [insertedId]
      );
      user = rows[0];
    } else {
      // user existuje -> môžeš prípadne aktualizovať email, ak chceš
      if (email && email !== user.email) {
        await db.execute("UPDATE users SET email = ? WHERE id = ?", [
          email,
          user.id
        ]);
      }
    }

    // 2. zapíš subscription
    await db.execute(
      `INSERT INTO subscriptions
        (user_id, plan_id, monthly_credit_limit, cycle_start, cycle_end, active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        plan_id = VALUES(plan_id),
        monthly_credit_limit = VALUES(monthly_credit_limit),
        cycle_start = VALUES(cycle_start),
        cycle_end = VALUES(cycle_end),
        active = VALUES(active)`,
      [
        user.id,
        plan_id,
        monthly_credit_limit,
        cycle_start,
        cycle_end,
        active ? 1 : 0
      ]
    );

    // 3. nastav / obnov credit_balances pre toto nové obdobie
    await db.execute(
      `INSERT INTO credit_balances
        (user_id, cycle_start, credits_remaining, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
        cycle_start = VALUES(cycle_start),
        credits_remaining = VALUES(credits_remaining),
        updated_at = NOW()`,
      [user.id, cycle_start, monthly_credit_limit]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("webhook error", err.message, err.stack);
    return res
      .status(500)
      .json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// API routy na tvoje AI služby
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes);
app.use("/", photoAvatarRoutes);
app.use("/", klingRoutes);

// štart
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 API gateway running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB INIT FAILED", err.message, err.stack);
    process.exit(1);
  });
