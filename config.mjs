// All real values come from env (Vercel project env vars in production,
// .env.local for dev). This file is committed and holds no secrets.
export const config = {
  databaseUrl: process.env.TTT_DATABASE_URL,
  // Display names are not secrets — edit here and push; auto-deploy ships it.
  players: {
    X: { name: "Anay", token: process.env.TTT_TOKEN_X },
    O: { name: "Jake", token: process.env.TTT_TOKEN_O },
  },
  // Max banked moves per player — stops a prompt backlog from turning into a
  // 20-minute play session.
  creditCap: Number(process.env.TTT_CREDIT_CAP ?? 3),
  timezone: process.env.TTT_TIMEZONE ?? "America/New_York",
};
