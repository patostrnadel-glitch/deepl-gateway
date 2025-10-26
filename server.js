import express from "express";
import cors from "cors";
import helmet from "helmet";

// DB pool (musíš vytvoriť súbor db.js podľa návodu)
import { db } from "./db.js";

// middleware na overenie JWT (musíš vytvoriť authMiddleware.js)
import { authMiddleware } from "./authMiddleware.js";

// routy pre autentifikáciu / výmenu za JWT (musíš vytvoriť routes/auth.js)
import authRoutes from "./routes/auth.js";

import deeplRoutes from "./routes/deepl.js";
import elevenRoutes from "./routes/elevenlabs.js";
import geminiRoutes from "./routes/gemini.js";
import heygenRoutes from "./routes/heygen.js";
import photoAvatarRoutes from "./routes/photoAvatar.js"; // musí sedieť s názvom súboru

const app = express();

// bezpečnostné hlavičky
app.use(helmet());

// CORS – aktuálne povoľujeme len tvoj web ai.developerska.eu
// POZOR: pri prvom testovaní (napr. z Postmana alebo z inej domény) ti to môže blokovať.
// Ak by ti to robilo problém pri vývoji, dočasne zmeň origin na "*".
app.use(
  cors({
    origin: "https://ai.developerska.eu",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// preflight handler pre všetky cesty
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://ai.developerska.eu");
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

/**
 * AUTH ROUTES
 * -----------
 * /auth/wp-login-exchange -> WordPress nám pošle wp_user_id + email + signature
 * my mu vrátime krátkodobé JWT
 */
app.use("/", authRoutes);

/**
 * USER SELF ROUTES
 * ----------------
 * Toto je len príprava.
 * /me bude chránené JWTčkom (authMiddleware)
 * Zatiaľ tu necháme jednoduchú verziu, aby si vedel otestovať end-to-end po pridaní authMiddleware.
 *
 * Keď už budeš mať authMiddleware.js hotový a fungujúci,
 * /me ti vráti info o userovi z tokenu.
 */
app.get("/me", authMiddleware, async (req, res) => {
  // req.user prichádza z authMiddleware po overení JWT
  // tu neskôr načítame aj token balance z DB, zatiaľ iba základ
  res.json({
    email: req.user.email,
    wp_user_id: req.user.wp_user_id,
    user_id: req.user.user_id,
    tokens: 0, // placeholder, tokeny pridáme v ďalšom kroku
  });
});

// API routy pre tvoje AI služby
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes);
app.use("/", photoAvatarRoutes);

// štart
app.listen(PORT, () => {
  console.log(`🚀 API gateway running on port ${PORT}`);
});
