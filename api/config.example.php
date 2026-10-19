<?php
// Copy this file to config.php, fill in the real values, and upload config.php via FTP/File Manager.
// config.php is gitignored -- it should never be committed.

define('DB_HOST', 'localhost');
define('DB_NAME', 'PUT_YOUR_ACCOUNT_PREFIX_HERE_MyDataWorld');
define('DB_USER', 'PUT_YOUR_DB_USERNAME_HERE');
define('DB_PASS', 'PUT_YOUR_DB_PASSWORD_HERE');

// How long a login session stays valid.
define('SESSION_LIFETIME_DAYS', 30);

// Web sites allowed to call this API from a browser (comma-separated).
// GitHub Pages serves the app from https://dsshrek-ai.github.io.
define('ALLOWED_ORIGINS', 'https://dsshrek-ai.github.io');
