import jwt from "jsonwebtoken";

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "no_auth_header" });
  }

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "bad_auth_header" });
  }

  try {
    const data = jwt.verify(token, process.env.JWT_SECRET);
    // data = { user_id, wp_user_id, email, iat, exp }
    req.user = {
      user_id: data.user_id,
      wp_user_id: data.wp_user_id,
      email: data.email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token" });
  }
}
