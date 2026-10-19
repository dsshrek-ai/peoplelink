-- PeopleLink: one-time tidy-up of phone numbers saved before 2026-10-19.
-- Same rule the app now uses when saving:
--   10 digits                      -> (801) 555-1234
--   11 digits starting with 1      -> drop the 1 -> (801) 555-1234
--   7 digits                       -> 555-1234
-- Left alone: international numbers (starting with + but not +1), anything
-- containing letters (e.g. extensions or "ask for Bob"), and other lengths.
--
-- Run in phpMyAdmin (MyDataWorld database, SQL tab). Step 1 only looks;
-- step 2 changes. Safe to run again -- already-tidy numbers don't change.
-- Needs REGEXP_REPLACE (MariaDB 10.0.5+ / MySQL 8+). If phpMyAdmin says
-- the function doesn't exist, stop and say so.

-- ---- Step 1: preview what will change ----
SELECT p.first_name, p.last_name, c.value AS current_value,
  CASE
    WHEN LENGTH(REGEXP_REPLACE(c.value, '[^0-9]', '')) = 7
      THEN CONCAT(LEFT(REGEXP_REPLACE(c.value, '[^0-9]', ''), 3), '-', RIGHT(REGEXP_REPLACE(c.value, '[^0-9]', ''), 4))
    ELSE CONCAT('(', SUBSTRING(RIGHT(REGEXP_REPLACE(c.value, '[^0-9]', ''), 10), 1, 3), ') ',
                SUBSTRING(RIGHT(REGEXP_REPLACE(c.value, '[^0-9]', ''), 10), 4, 3), '-',
                SUBSTRING(RIGHT(REGEXP_REPLACE(c.value, '[^0-9]', ''), 10), 7, 4))
  END AS new_value
FROM pl_contact_methods c
JOIN pl_people p ON p.id = c.person_id
WHERE c.kind = 'phone'
  AND c.value NOT REGEXP '[A-Za-z]'
  AND (c.value NOT LIKE '+%' OR c.value LIKE '+1%')
  AND (LENGTH(REGEXP_REPLACE(c.value, '[^0-9]', '')) IN (7, 10)
       OR (LENGTH(REGEXP_REPLACE(c.value, '[^0-9]', '')) = 11 AND REGEXP_REPLACE(c.value, '[^0-9]', '') LIKE '1%'))
HAVING current_value <> new_value
ORDER BY p.last_name, p.first_name;

-- ---- Step 2: make the change (run after checking step 1) ----
UPDATE pl_contact_methods
SET value = CASE
    WHEN LENGTH(REGEXP_REPLACE(value, '[^0-9]', '')) = 7
      THEN CONCAT(LEFT(REGEXP_REPLACE(value, '[^0-9]', ''), 3), '-', RIGHT(REGEXP_REPLACE(value, '[^0-9]', ''), 4))
    ELSE CONCAT('(', SUBSTRING(RIGHT(REGEXP_REPLACE(value, '[^0-9]', ''), 10), 1, 3), ') ',
                SUBSTRING(RIGHT(REGEXP_REPLACE(value, '[^0-9]', ''), 10), 4, 3), '-',
                SUBSTRING(RIGHT(REGEXP_REPLACE(value, '[^0-9]', ''), 10), 7, 4))
  END
WHERE kind = 'phone'
  AND value NOT REGEXP '[A-Za-z]'
  AND (value NOT LIKE '+%' OR value LIKE '+1%')
  AND (LENGTH(REGEXP_REPLACE(value, '[^0-9]', '')) IN (7, 10)
       OR (LENGTH(REGEXP_REPLACE(value, '[^0-9]', '')) = 11 AND REGEXP_REPLACE(value, '[^0-9]', '') LIKE '1%'));

-- Household home phones, same rule.
UPDATE pl_households
SET phone = CASE
    WHEN LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 7
      THEN CONCAT(LEFT(REGEXP_REPLACE(phone, '[^0-9]', ''), 3), '-', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 4))
    ELSE CONCAT('(', SUBSTRING(RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10), 1, 3), ') ',
                SUBSTRING(RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10), 4, 3), '-',
                SUBSTRING(RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10), 7, 4))
  END
WHERE phone IS NOT NULL
  AND phone NOT REGEXP '[A-Za-z]'
  AND (phone NOT LIKE '+%' OR phone LIKE '+1%')
  AND (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) IN (7, 10)
       OR (LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 11 AND REGEXP_REPLACE(phone, '[^0-9]', '') LIKE '1%'));
