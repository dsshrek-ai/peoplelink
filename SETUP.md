# PeopleLink — Setup

PeopleLink runs on **MyDataWorld** like TimeCraft and Temple Time: static
pages on GitHub Pages, one `api/api.php` on seniorfamily.org, and `pl_*`
tables in the shared MyDataWorld database. Login comes from My Apps Hub.

## 1. Database (phpMyAdmin)

Open phpMyAdmin → the MyDataWorld database → **SQL** tab, and run the
`Milestone A` block from [`api/schema.sql`](api/schema.sql). It creates the
five `pl_*` tables and registers PeopleLink in My Apps Hub.

Then grant yourself (and anyone else) access — the commented `INSERT INTO
app_access` at the bottom of that block, with the real username.

Later milestones add new dated blocks to `schema.sql`. **Always run a new
block before uploading the `api.php` that goes with it.**

## 2. API (seniorfamily.org)

Upload to a new folder `public_html/peoplelink-api/`:

- `api/api.php`
- `api/config.php` (git-ignored; same database settings as TimeCraft's —
  `config.example.php` shows the fields)
- `api/uploads/.htaccess` (keeps photo files from being opened directly;
  the folder is also created automatically on the first photo upload)

## 3. Front end (GitHub Pages)

Push this folder to `dsshrek-ai/peoplelink` and turn on Pages (Settings →
Pages → Deploy from a branch → `main` / root). The app is then at
`https://dsshrek-ai.github.io/peoplelink/`, which is the `launch_url` the
Hub tile opens.

When `js/*.js` or `style.css` change, bump the `?v=` on every page so phones
don't keep a stale copy.

## Notes

- Every person and group belongs to one login; `api.php` checks ownership on
  every request, so people can't see each other's lists.
- Photos are resized in the browser (so iPhone HEIC works), stored as JPEGs
  in `api/uploads/` under random 32-character names, and re-encoded by the
  server with GD.
- Notes are private and are never returned in the People list — only on the
  person's own page. So exports (built from the People list) and group shares
  (built server-side from basic fields only) can't include them.
- Journal entries, reminders (interval + follow-up date), relationships,
  households and activities are private too: nothing in the export or share
  code reads those tables. "Last contact" is the newest journal entry, and
  next-contact / overdue is worked out in the browser (`nextContact` in
  `js/app.js`).
- CSV import/export happens in the browser (`js/transfer.js`); the server
  only receives the already-decided create / merge / skip items, in batches
  of 200. Merge only fills empty fields and adds new phones/emails/addresses.

## Testing locally

`tests/api.test.mjs` (Milestone A), `tests/api-b.test.mjs` (Milestone B:
import engine and group sharing) and `tests/api-c.test.mjs` (Milestone C:
journal, reminders, relationships, households, activities) run the acceptance checks against a
**fresh** test database (Hub tables + `schema.sql`, users `alice` / `bob`
granted, `carol` not, all with password `pw`):

    node tests/api.test.mjs   http://127.0.0.1:8098/api/api.php path/to/small.jpg
    node tests/api-b.test.mjs http://127.0.0.1:8098/api/api.php path/to/small.jpg
    node tests/api-c.test.mjs http://127.0.0.1:8098/api/api.php path/to/small.jpg

(Use a fresh database for each file.)
