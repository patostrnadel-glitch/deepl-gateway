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

// preflight handler
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://www.tvorai.cz");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res.sendStatus(200);
});

// JSON body
app.use(express.json({ limit: "10mb" })); // zväčšený limit pre obrázky

const PORT = process.env.PORT || 8080;

// healthcheck
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ===========================================================
// HELPERS
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

  if (!subs.length) {
    return { subscription: null, balance: null };
  }

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
// 1) /consume
app.post("/consume", async (req, res) => {
  try {
    const { wp_user_id, feature_type, estimated_cost, metadata } = req.body || {};

    if (!wp_user_id || !feature_type) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details: "wp_user_id and feature_type are required"
      });
    }

    // 💸 CENNÍK
    const PRICING = {
      translate_text: 10,
      gemini_chat: 5,
      heygen_video: 200,
      voice_tts: 2,
      photo_avatar: 50,
      kling_video: 250,
      kling_i2v: 300,   // 🆕 nový typ – Kling V2.1 image-to-video
      test_feature: 10
    };

    // === 1. vyrátaj cenu ===
    let finalCost;

    if (typeof estimated_cost === "number" && !Number.isNaN(estimated_cost)) {
      finalCost = estimated_cost;
    } else {
      if (feature_type === "kling_video" && metadata && metadata.duration) {
        const d = Number(metadata.duration);
        if (d === 5) {
          finalCost = 200;
        } else if (d === 10) {
          finalCost = 500;
        }
      }

      // fallback pre iné feature typy
      if (typeof finalCost === "undefined") {
        finalCost = PRICING[feature_type];
      }
    }

    if (typeof finalCost === "undefined") {
      return res.status(400).json({
        error: "UNKNOWN_FEATURE_TYPE",
        details: `No pricing rule for feature_type=${feature_type}`
      });
    }

    // user
    const user = await getUserByWpId(wp_user_id);
    if (!user) return res.status(400).json({ error: "USER_NOT_FOUND" });

    // subscription & balance
    const { subscription, balance } = await getActiveSubscriptionAndBalance(user.id);
    if (!subscription || !subscription.active)
      return res.status(403).json({ error: "NO_ACTIVE_SUBSCRIPTION" });
    if (!balance) return res.status(400).json({ error: "NO_BALANCE_RECORD" });

    if (balance.credits_remaining < finalCost)
      return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });

    // transakčne odpočítať
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
      if (currentBalance.credits_remaining < finalCost) {
        await connection.rollback();
        connection.release();
        return res.status(402).json({ error: "INSUFFICIENT_CREDITS" });
      }

      const newBalance = currentBalance.credits_remaining - Number(finalCost);

      await connection.execute(
        "UPDATE credit_balances SET credits_remaining = ?, updated_at = NOW() WHERE id = ?",
        [newBalance, currentBalance.id]
      );

      await connection.execute(
        "INSERT INTO usage_logs (user_id, feature_type, credits_spent, metadata) VALUES (?, ?, ?, ?)",
        [user.id, feature_type, finalCost, metadata ? JSON.stringify(metadata) : null]
      );

      await connection.commit();
      connection.release();

      return res.json({
        ok: true,
        credits_remaining: newBalance,
        charged: finalCost
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      console.error("TX ERROR", err.message);
      return res.status(500).json({ error: "TX_FAILED", detail: err.message });
    }
  } catch (err) {
    console.error("consume error", err.message);
    return res.status(500).json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// 2) /usage/:wp_user_id
app.get("/usage/:wp_user_id", async (req, res) => {
  try {
    const { wp_user_id } = req.params;
    const user = await getUserByWpId(wp_user_id);
    if (!user) return res.status(400).json({ error: "USER_NOT_FOUND" });

    const { subscription, balance } = await getActiveSubscriptionAndBalance(user.id);
    if (!subscription) return res.status(404).json({ error: "NO_ACTIVE_SUBSCRIPTION" });

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
    console.error("usage error", err.message);
    return res.status(500).json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// 3) /webhook/subscription-update
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

    if (!wp_user_id || !plan_id || !monthly_credit_limit || !cycle_start || !cycle_end) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details: "wp_user_id, plan_id, monthly_credit_limit, cycle_start, cycle_end are required"
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
      await db.execute("UPDATE users SET email = ? WHERE id = ?", [email, user.id]);
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
      [user.id, plan_id, monthly_credit_limit, cycle_start, cycle_end, active ? 1 : 0]
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
    console.error("webhook error", err.message);
    return res.status(500).json({ error: "SERVER_ERROR", detail: err.message });
  }
});

// ===========================================================
// AI ROUTES
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes);
app.use("/", photoAvatarRoutes);
app.use("/", klingRoutes);

// ===========================================================
// 🆕 4) KLING V2.1 IMAGE-TO-VIDEO ENDPOINT
import fetch from "node-fetch";

app.post("/kling-i2v/generate", async (req, res) => {
  try {
    const {
      image,
      prompt,
      mode = "Standard",
      duration = "5",
      guidance_scale = 0.5,
      negative_prompt = ""
    } = req.body;

    if (!image || !prompt) {
      return res.status(400).json({ ok: false, error: "MISSING_IMAGE_OR_PROMPT" });
    }

    const response = await fetch("https://api.novita.ai/v3/async/kling-v2.1-i2v", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.NOVITA_API_KEY}`
      },
      body: JSON.stringify({
        image,
        prompt,
        mode,
        duration,
        guidance_scale,
        negative_prompt
      })
    });

    const data = await response.json();

    if (data.task_id) {
      return res.json({ ok: true, generationId: data.task_id, status: "queued" });
    } else {
      return res.status(500).json({ ok: false, error: "NO_TASK_ID_RETURNED", raw: data });
    }
  } catch (err) {
    console.error("Kling I2V error", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ===========================================================
// ŠTART
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 API gateway running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB INIT FAILED", err.message);
    process.exit(1);
  });
