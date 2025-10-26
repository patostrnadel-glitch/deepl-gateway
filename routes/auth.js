import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { db } from "../db.js";

const router = express.Router();

const SHARED_SECRET = process.env.SHARED_SECRET; // nastavíš v Render env
const JWT_SECRET = process.env.JWT_SECRET;       // nastavíš v Render env

function makeSignature(wp_user_id, email) {
  return crypto
    .createHmac("sha256", SHARED_SECRET)
    .update(`${wp_user_id}|${email}`)
    .digest("hex");
}

// pokúsi sa nájsť usera podľa wp_user_id, ak neexistuje -> vytvorí
async function findOrCreateUser(wp_user_id, email) {
  // skúsi nájsť
  const [rows] = await db.query(
    "SELECT id, wp_user_id, email FROM users WHERE wp_user_id = ?",
    [wp_user_id]
  );

  if (rows.length > 0) {
    return rows[0];
  }

  // nevie nájsť -> vytvor
  await db.query(
    "INSERT INTO users (wp_user_id, email) VALUES (?, ?)",
    [wp_user_id, email]
  );

  // načítaj znova
  const [rowsAfter] = await db.query(
    "SELECT id, wp_user_id, email FROM users WHERE wp_user_id = ?",
    [wp_user_id]
  );

  return rowsAfter[0];
}

router.post("/auth/wp-login-exchange", async (req, res) => {
  try {
    const { wp_user_id, email, signature } = req.body;

    if (!wp_user_id || !email || !signature) {
      return res.status(400).json({ error: "missing_fields" });
    }

    // over podpis
    const expected = makeSignature(wp_user_id, email);
    if (signature !== expected) {
      return res.status(403).json({ error: "bad_signature" });
    }

    // user v DB
    const user = await findOrCreateUser(wp_user_id, email);

    // vytvor krátkodobý JWT pre frontend (dashboard)
    const token = jwt.sign(
      {
        user_id: user.id,
        wp_user_id: user.wp_user_id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.json({ jwt: token });
  } catch (err) {
    console.error("wp-login-exchange error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
