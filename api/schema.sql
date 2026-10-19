-- PeopleLink — adds to the shared MyDataWorld database.
-- `users`, `sessions`, `apps`, `app_access` and `app_usage_log` already exist
-- (My Apps Hub) — do NOT recreate them.
--
-- Run each dated block ONCE in phpMyAdmin's SQL tab, in order, BEFORE
-- uploading the api.php that needs it.
--
-- Every pl_* row belongs to exactly one login: people and groups carry
-- user_id, and their child rows are only ever reached through an owned
-- person/group (api.php checks that on every request).

-- ---------- 2026-10-18: Milestone A — people, groups, photos ----------

CREATE TABLE pl_people (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  first_name    VARCHAR(100) NULL,
  middle_name   VARCHAR(100) NULL,
  last_name     VARCHAR(100) NULL,
  nickname      VARCHAR(100) NULL,      -- preferred name
  organization  VARCHAR(150) NULL,
  job_title     VARCHAR(150) NULL,
  occupation    VARCHAR(150) NULL,
  -- Birthdays/anniversaries are split so a year can be unknown (Google
  -- Contacts allows "--MM-DD").
  birth_year    SMALLINT NULL,
  birth_month   TINYINT NULL,
  birth_day     TINYINT NULL,
  anniv_year    SMALLINT NULL,
  anniv_month   TINYINT NULL,
  anniv_day     TINYINT NULL,
  status        ENUM('active','archived','deceased') NOT NULL DEFAULT 'active',
  is_pinned     TINYINT(1) NOT NULL DEFAULT 0,
  notes         TEXT NULL,              -- private; never shared or exported by default
  photo_key     CHAR(32) NULL,          -- random name of the photo files in api/uploads
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY (user_id, status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phones and emails, any number per person, each with a label.
CREATE TABLE pl_contact_methods (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  person_id   INT NOT NULL,
  kind        ENUM('phone','email') NOT NULL,
  label       VARCHAR(40) NULL,
  value       VARCHAR(255) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  KEY (person_id, kind),
  FOREIGN KEY (person_id) REFERENCES pl_people(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pl_addresses (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  person_id    INT NOT NULL,
  label        VARCHAR(40) NULL,
  street       VARCHAR(255) NULL,       -- may hold two lines
  city         VARCHAR(100) NULL,
  region       VARCHAR(100) NULL,       -- state / province
  postal_code  VARCHAR(20) NULL,
  country      VARCHAR(100) NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  KEY (person_id),
  FOREIGN KEY (person_id) REFERENCES pl_people(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group names are unique per login so they map cleanly to Google Contacts
-- labels on import/export.
CREATE TABLE pl_groups (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  name         VARCHAR(100) NOT NULL,
  description  TEXT NULL,
  color        CHAR(7) NULL,
  icon         VARCHAR(16) NULL,        -- an emoji
  is_archived  TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_name (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pl_group_members (
  group_id    INT NOT NULL,
  person_id   INT NOT NULL,
  added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, person_id),
  KEY (person_id),
  FOREIGN KEY (group_id)  REFERENCES pl_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES pl_people(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register the app with My Apps Hub (safe to re-run), then grant yourself
-- access. Change the username to your MyDataWorld login.
INSERT INTO apps (app_key, name, is_public, description, icon_emoji, icon_color_class, launch_url, sso_enabled) VALUES
  ('peoplelink', 'PeopleLink', 0,
   'More than contacts — connections. Keep the people in your life organized in groups, with photos, birthdays and notes.',
   '🤝', 'icon-teal', 'https://dsshrek-ai.github.io/peoplelink/', 1)
ON DUPLICATE KEY UPDATE
  name             = VALUES(name),
  description      = VALUES(description),
  icon_emoji       = VALUES(icon_emoji),
  icon_color_class = VALUES(icon_color_class),
  launch_url       = VALUES(launch_url),
  sso_enabled      = VALUES(sso_enabled);

-- INSERT INTO app_access (user_id, app_id)
-- SELECT u.id, a.id FROM users u JOIN apps a ON a.app_key = 'peoplelink'
-- WHERE u.username = 'you@example.com'
-- ON DUPLICATE KEY UPDATE user_id = app_access.user_id;

-- ---------- 2026-10-19: Milestone B — group sharing (copy, not sync) ----------
-- Import/export need no tables. A share is a snapshot: the sender's basic
-- contact fields (names, phones, emails, addresses -- never notes, dates,
-- pins or groups) are frozen into `payload` when the invitation is sent.
-- Accepting copies them into the recipient's own records; nothing links
-- the two sides afterwards. Photo files, when included, are copied at send
-- time under new keys (so the sender changing a photo later doesn't
-- matter) and deleted again if the invitation is declined or cancelled.

CREATE TABLE pl_share_invitations (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  from_user_id       INT NOT NULL,
  to_user_id         INT NOT NULL,
  group_name         VARCHAR(100) NOT NULL,
  group_description  TEXT NULL,
  group_color        CHAR(7) NULL,
  group_icon         VARCHAR(16) NULL,
  payload            MEDIUMTEXT NOT NULL,   -- JSON array of basic contacts
  people_count       INT NOT NULL DEFAULT 0,
  include_photos     TINYINT(1) NOT NULL DEFAULT 0,
  status             ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  result_summary     VARCHAR(255) NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at       TIMESTAMP NULL DEFAULT NULL,
  KEY (to_user_id, status),
  KEY (from_user_id, status),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
