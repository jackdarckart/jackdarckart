-- Converter Studio cloud presets (Cloudflare D1).
-- Stores only mastering slider values and Auto-Enhance preferences per account.
-- Audio files and rendered masters are never uploaded.
-- Apply with: wrangler d1 migrations apply quantum-vault-db [--remote]

CREATE TABLE IF NOT EXISTS studio_presets (
  user_id TEXT PRIMARY KEY,
  preset_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
