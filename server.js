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
// ➕ nový route súbor
import heygentexttoVideoRoutes from "./routes/heygentexttoVideo.js";

dotenv.config();

// ====== DB PRIPOJENIE =====================================
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
};

let db;
async function initDB() {
  db = await mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  console.log("✅ DB pool ready");
}
// ===========================================================

const app = express();

// bezpečnostné hlavičky
app.use(helmet());

// CORS – povolíme tvoj web ai.developerska.eu
app.use(
  cors({
    origin: "https://www.tvorai.cz",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// preflight handler
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://www.tvorai.cz");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res.sendStatus(200);
});

app.use(express.json({ limit: "1mb" }));
const PORT = process.env.PORT || 8080;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ===========================================================
// Helpery pre DB
async function getUserByWpId(wp_user_id) {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE wp_user_id = ? LIMIT 1",
    [wp_user_id]
  );
  return rows.length ? rows[0] : null;
}

async function getActiveSubscriptionAndBalance(user_id) {
  const [subs] = await db.execute(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND active = 1
     ORDER BY id DESC
     LIMIT 1`,
    [user_id]
  );

  if (!subs.length) return { subscription: null, balance: null };
  const subscription = subs[0];

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
// /consume – odpočíta kredity
app.post("/consume", async (req, res) => {
  try {
    const { wp_user_id, feature_type, metadata } = req.body;

    if (!wp_user_id || !feature_type) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details: "wp_user_id and feature_type are required",
      });
    }

    const PRICING = {
      translate_text: 10,
      gemini_chat: 5,
      heygen_video: 200,
      voice_tts: 2,
      photo_avatar: 50,
      test_feature: 10,
    };

    const estimated_cost = PRICING[feature_type];
    if (typeof estimated_cost === "undefined") {
      return res.status(400).json({
        error: "UNKNOWN_FEATURE_TYPE",
        details: `No pricing rule for feature_type=${feature_type}`,
      });
    }

    const user = await getUserByWpId(wp_user_id);
    if (!user) return res.status(400).json({ error: "USER_NOT_FOUND" });

    const { subscription, balance } = await getActiveSubscriptionAndBalance(
      user.id
    );

    if (!subscription || !subscription.active)
      return res.status(403).json({ error: "NO_ACTIVE_SUBSCRIPTION" });
    if (!balance)
      return res.status(400).json({ error: "NO_BALANCE_RECORD" });
    if (balance.credits_remaining < estimated_cost)
      return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

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
      if (currentBalance.credits_remaining < estimated_cost) {
        await connection.rollback();
        connection.release();
        return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });
      }

      const newBalance =
        currentBalance.credits_remaining - Number(estimated_cost);

      await connection.execute(
        "UPDATE credit_balances SET credits_remaining = ?, updated_at = NOW() WHERE id = ?",
        [newBalance, currentBalance.id]
      );

      await connection.execute(
        "INSERT INTO usage_logs (user_id, feature_type, credits_spent, metadata) VALUES (?, ?, ?, ?)",
        [
          user.id,
          feature_type,
          estimated_cost,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      await connection.commit();
      connection.release();

      return res.json({ ok: true, credits_remaining: newBalance });
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
// /usage/:wp_user_id – zobraz kredity
app.get("/usage/:wp_user_id", async (req, res) => {
  try {
    const { wp_user_id } = req.params;
    const user = await getUserByWpId(wp_user_id);
    if (!user) return res.status(400).json({ error: "USER_NOT_FOUND" });

    const { subscription, balance } = await getActiveSubscriptionAndBalance(
      user.id
    );
    if (!subscription)
      return res.status(404).json({ error: "NO_ACTIVE_SUBSCRIPTION" });

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
      recent_usage: logs,
    });
  } catch (err) {
    console.error("usage error", err.message, err.stack);
    return res
      .status(500)
      .json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// webhook/subscription-update
app.post("/webhook/subscription-update", async (req, res) => {
  try {
    const {
      wp_user_id,
      email,
      plan_id,
      monthly_credit_limit,
      cycle_start,
      cycle_end,
      active,
    } = req.body;

    if (!wp_user_id || !plan_id || !monthly_credit_limit || !cycle_start || !cycle_end) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details:
          "wp_user_id, plan_id, monthly_credit_limit, cycle_start, cycle_end are required",
      });
    }

    let user = await getUserByWpId(wp_user_id);
    if (!user) {
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
    } else if (email && email !== user.email) {
      await db.execute("UPDATE users SET email = ? WHERE id = ?", [
        email,
        user.id,
      ]);
    }

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
        active ? 1 : 0,
      ]
    );

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
// API ROUTES
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes);
app.use("/", photoAvatarRoutes);
// ➕ nový text-to-video endpoint
app.use("/", heygentexttoVideoRoutes);

// ===========================================================
// Štart servera
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
