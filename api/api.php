<?php
require_once __DIR__ . '/config.php';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

ini_set('display_errors', '0');
set_exception_handler(function ($e) {
  http_response_code(500);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['error' => 'Server error: ' . $e->getMessage()]);
  exit;
});

// CORS is not an authorization control (every data request still needs a
// valid login token), it just keeps other web sites from calling the API
// from a visitor's browser.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = defined('ALLOWED_ORIGINS') ? array_map('trim', explode(',', ALLOWED_ORIGINS)) : ['*'];
if (in_array('*', $allowed, true)) {
  header('Access-Control-Allow-Origin: *');
} elseif ($origin !== '' && in_array($origin, $allowed, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

function respond($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data);
  exit;
}

function fail(string $message, int $status = 400): void {
  respond(['ok' => false, 'error' => $message], $status);
}

function db(): mysqli {
  static $conn = null;
  if ($conn === null) {
    try {
      $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, defined('DB_PORT') ? DB_PORT : 3306);
      $conn->set_charset('utf8mb4');
    } catch (mysqli_sql_exception $e) {
      fail('Database connection failed', 500);
    }
  }
  return $conn;
}

function jsonBody(): array {
  $raw = file_get_contents('php://input');
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

// Prepared SELECT -> all rows.
function q(string $sql, string $types = '', array $params = []): array {
  $stmt = db()->prepare($sql);
  if ($types !== '') {
    $stmt->bind_param($types, ...$params);
  }
  $stmt->execute();
  $res = $stmt->get_result();
  $rows = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
  $stmt->close();
  return $rows;
}

// Prepared INSERT/UPDATE/DELETE -> insert id (0 when none).
function exec1(string $sql, string $types = '', array $params = []): int {
  $stmt = db()->prepare($sql);
  if ($types !== '') {
    $stmt->bind_param($types, ...$params);
  }
  $stmt->execute();
  $id = (int)$stmt->insert_id;
  $stmt->close();
  return $id;
}

// Prepared UPDATE/DELETE -> number of rows changed.
function execCount(string $sql, string $types = '', array $params = []): int {
  $stmt = db()->prepare($sql);
  if ($types !== '') {
    $stmt->bind_param($types, ...$params);
  }
  $stmt->execute();
  $n = (int)$stmt->affected_rows;
  $stmt->close();
  return $n;
}

function placeholders(array $values): string {
  return implode(',', array_fill(0, count($values), '?'));
}

// ---- Auth: shared MyDataWorld login + an app_access grant for 'peoplelink' ----
// The user id always comes from the validated session token, never from the
// request body, and every query below filters by it.

const APP_KEY = 'peoplelink';
const APP_NAME = 'PeopleLink';

function requireUser(): array {
  $header = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  if (!preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
    fail('Missing or invalid Authorization header', 401);
  }
  $rows = q(
    'SELECT u.id, u.username, u.display_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > NOW()',
    's', [$m[1]]
  );
  if (!$rows) {
    fail('Session expired or invalid -- please log in again', 401);
  }
  return $rows[0];
}

function hasAppAccess(int $userId): bool {
  return (bool)q(
    'SELECT 1 FROM app_access aa JOIN apps a ON a.id = aa.app_id WHERE aa.user_id = ? AND a.app_key = ?',
    'is', [$userId, APP_KEY]
  );
}

function logAppUsage(int $userId): void {
  try {
    exec1(
      'INSERT INTO app_usage_log (user_id, app_key, access_date, first_seen_at, last_seen_at, hit_count)
       VALUES (?, ?, CURDATE(), NOW(), NOW(), 1)
       ON DUPLICATE KEY UPDATE last_seen_at = NOW(), hit_count = hit_count + 1',
      'is', [$userId, APP_KEY]
    );
  } catch (mysqli_sql_exception $e) {
    // best-effort
  }
}

function requireMember(): array {
  $user = requireUser();
  if (!hasAppAccess((int)$user['id'])) {
    fail('Not authorized for ' . APP_NAME, 403);
  }
  logAppUsage((int)$user['id']);
  return $user;
}

// ---- Ownership checks ----

function ownPerson(int $userId, int $personId): array {
  $rows = q('SELECT * FROM pl_people WHERE id = ? AND user_id = ?', 'ii', [$personId, $userId]);
  if (!$rows) {
    fail('Person not found', 404);
  }
  return $rows[0];
}

function ownGroup(int $userId, int $groupId): array {
  $rows = q('SELECT * FROM pl_groups WHERE id = ? AND user_id = ?', 'ii', [$groupId, $userId]);
  if (!$rows) {
    fail('Group not found', 404);
  }
  return $rows[0];
}

// Keeps only the ids this user owns (silently drops anything else).
function ownedIds(int $userId, string $table, array $ids): array {
  $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($v) => $v > 0)));
  if (!$ids) {
    return [];
  }
  $rows = q("SELECT id FROM $table WHERE user_id = ? AND id IN (" . placeholders($ids) . ')',
            'i' . str_repeat('i', count($ids)), array_merge([$userId], $ids));
  return array_map(fn($r) => (int)$r['id'], $rows);
}

// ---- Validation ----

function strOrNull($v, int $max): ?string {
  $s = trim((string)($v ?? ''));
  return $s === '' ? null : mb_substr($s, 0, $max);
}

function colorOrNull($v): ?string {
  if ($v === null || $v === '') {
    return null;
  }
  if (!is_string($v) || !preg_match('/^#[0-9a-fA-F]{6}$/', $v)) {
    fail('Colors must look like #3366cc');
  }
  return strtolower($v);
}

// A month/day with an optional year. Returns [year|null, month|null, day|null];
// all null when the date is left blank.
function partialDate($d, string $what): array {
  if (!is_array($d)) {
    return [null, null, null];
  }
  $y = isset($d['year']) && $d['year'] !== '' && $d['year'] !== null ? (int)$d['year'] : null;
  $m = isset($d['month']) && $d['month'] !== '' && $d['month'] !== null ? (int)$d['month'] : null;
  $day = isset($d['day']) && $d['day'] !== '' && $d['day'] !== null ? (int)$d['day'] : null;
  if ($m === null && $day === null && $y === null) {
    return [null, null, null];
  }
  if ($m === null || $day === null) {
    fail("$what needs both a month and a day");
  }
  $maxYear = (int)date('Y') + 1;
  if ($y !== null && ($y < 1800 || $y > $maxYear)) {
    fail("$what year must be between 1800 and $maxYear");
  }
  // 2000 is a leap year, so Feb 29 is allowed when the year is unknown.
  if (!checkdate($m, $day, $y ?? 2000)) {
    fail("$what isn't a real date");
  }
  return [$y, $m, $day];
}

const PHONE_LABELS = ['mobile', 'home', 'work', 'main', 'other'];
const EMAIL_LABELS = ['home', 'work', 'other'];
const ADDRESS_LABELS = ['home', 'work', 'other'];
const STATUSES = ['active', 'archived', 'deceased'];

function labelOrOther($v, array $allowed): string {
  $v = strtolower(trim((string)($v ?? '')));
  return in_array($v, $allowed, true) ? $v : 'other';
}

// ---- Shaping ----

function dateJson($y, $m, $d): ?array {
  if ($m === null) {
    return null;
  }
  return ['Year' => $y !== null ? (int)$y : null, 'Month' => (int)$m, 'Day' => (int)$d];
}

function personJson(array $p, array $methods, array $addresses, array $groupIds, bool $withNotes): array {
  $out = [
    'Id'           => (int)$p['id'],
    'FirstName'    => $p['first_name'],
    'MiddleName'   => $p['middle_name'],
    'LastName'     => $p['last_name'],
    'Nickname'     => $p['nickname'],
    'Organization' => $p['organization'],
    'JobTitle'     => $p['job_title'],
    'Occupation'   => $p['occupation'],
    'Birthday'     => dateJson($p['birth_year'], $p['birth_month'], $p['birth_day']),
    'Anniversary'  => dateJson($p['anniv_year'], $p['anniv_month'], $p['anniv_day']),
    'Status'       => $p['status'],
    'Pinned'       => (bool)$p['is_pinned'],
    'PhotoKey'     => $p['photo_key'],
    'Phones'       => [],
    'Emails'       => [],
    'Addresses'    => [],
    'GroupIds'     => $groupIds,
    'UpdatedAt'    => $p['updated_at'],
  ];
  foreach ($methods as $m) {
    $out[$m['kind'] === 'phone' ? 'Phones' : 'Emails'][] = ['Label' => $m['label'], 'Value' => $m['value']];
  }
  foreach ($addresses as $a) {
    $out['Addresses'][] = [
      'Label' => $a['label'], 'Street' => $a['street'], 'City' => $a['city'], 'Region' => $a['region'],
      'PostalCode' => $a['postal_code'], 'Country' => $a['country'],
    ];
  }
  if ($withNotes) {
    $out['Notes'] = $p['notes'];
  }
  return $out;
}

function groupJson(array $g): array {
  return [
    'Id'          => (int)$g['id'],
    'Name'        => $g['name'],
    'Description' => $g['description'],
    'Color'       => $g['color'],
    'Icon'        => $g['icon'],
    'Archived'    => (bool)$g['is_archived'],
    'MemberCount' => (int)($g['member_count'] ?? 0),
  ];
}

// Loads people plus their phones/emails/addresses/groups in four queries.
function loadPeople(int $userId, ?array $onlyIds = null, bool $withNotes = false): array {
  $where = 'user_id = ?';
  $types = 'i';
  $params = [$userId];
  if ($onlyIds !== null) {
    if (!$onlyIds) {
      return [];
    }
    $where .= ' AND id IN (' . placeholders($onlyIds) . ')';
    $types .= str_repeat('i', count($onlyIds));
    $params = array_merge($params, $onlyIds);
  }
  $people = q("SELECT * FROM pl_people WHERE $where", $types, $params);
  if (!$people) {
    return [];
  }
  $ids = array_map(fn($p) => (int)$p['id'], $people);
  $in = placeholders($ids);
  $it = str_repeat('i', count($ids));

  $methods = [];
  foreach (q("SELECT * FROM pl_contact_methods WHERE person_id IN ($in) ORDER BY sort_order, id", $it, $ids) as $r) {
    $methods[(int)$r['person_id']][] = $r;
  }
  $addresses = [];
  foreach (q("SELECT * FROM pl_addresses WHERE person_id IN ($in) ORDER BY sort_order, id", $it, $ids) as $r) {
    $addresses[(int)$r['person_id']][] = $r;
  }
  $groups = [];
  foreach (q("SELECT group_id, person_id FROM pl_group_members WHERE person_id IN ($in)", $it, $ids) as $r) {
    $groups[(int)$r['person_id']][] = (int)$r['group_id'];
  }

  return array_map(fn($p) => personJson(
    $p, $methods[(int)$p['id']] ?? [], $addresses[(int)$p['id']] ?? [], $groups[(int)$p['id']] ?? [], $withNotes
  ), $people);
}

function loadGroups(int $userId): array {
  return array_map('groupJson', q(
    'SELECT g.*, (SELECT COUNT(*) FROM pl_group_members m JOIN pl_people p ON p.id = m.person_id
                  WHERE m.group_id = g.id AND p.status <> \'archived\') AS member_count
     FROM pl_groups g WHERE g.user_id = ? ORDER BY g.name',
    'i', [$userId]
  ));
}

// ---- People ----

function savePerson(int $userId, array $b): int {
  $id = (int)($b['id'] ?? 0);
  if ($id > 0) {
    ownPerson($userId, $id);
  }

  $first = strOrNull($b['firstName'] ?? null, 100);
  $middle = strOrNull($b['middleName'] ?? null, 100);
  $last = strOrNull($b['lastName'] ?? null, 100);
  $nick = strOrNull($b['nickname'] ?? null, 100);
  $org = strOrNull($b['organization'] ?? null, 150);
  $title = strOrNull($b['jobTitle'] ?? null, 150);
  $occupation = strOrNull($b['occupation'] ?? null, 150);
  $notes = strOrNull($b['notes'] ?? null, 65000);
  if ($first === null && $last === null && $nick === null && $org === null) {
    fail('Give this person a name (or at least an organization)');
  }
  [$by, $bm, $bd] = partialDate($b['birthday'] ?? null, 'Birthday');
  [$ay, $am, $ad] = partialDate($b['anniversary'] ?? null, 'Anniversary');

  $methods = [];
  foreach (['phones' => 'phone', 'emails' => 'email'] as $key => $kind) {
    foreach ((array)($b[$key] ?? []) as $row) {
      $value = strOrNull($row['value'] ?? null, 255);
      if ($value === null) {
        continue;
      }
      if ($kind === 'email' && strpos($value, '@') === false) {
        fail("\"$value\" doesn't look like an email address");
      }
      $methods[] = [$kind, labelOrOther($row['label'] ?? null, $kind === 'phone' ? PHONE_LABELS : EMAIL_LABELS), $value];
    }
  }
  $addresses = [];
  foreach ((array)($b['addresses'] ?? []) as $row) {
    $a = [
      labelOrOther($row['label'] ?? null, ADDRESS_LABELS),
      strOrNull($row['street'] ?? null, 255),
      strOrNull($row['city'] ?? null, 100),
      strOrNull($row['region'] ?? null, 100),
      strOrNull($row['postalCode'] ?? null, 20),
      strOrNull($row['country'] ?? null, 100),
    ];
    if ($a[1] === null && $a[2] === null && $a[3] === null && $a[4] === null && $a[5] === null) {
      continue;
    }
    $addresses[] = $a;
  }
  $groupIds = isset($b['groupIds']) ? ownedIds($userId, 'pl_groups', (array)$b['groupIds']) : null;

  $conn = db();
  $conn->begin_transaction();
  $fields = [$first, $middle, $last, $nick, $org, $title, $occupation, $by, $bm, $bd, $ay, $am, $ad, $notes];
  if ($id > 0) {
    exec1('UPDATE pl_people SET first_name = ?, middle_name = ?, last_name = ?, nickname = ?, organization = ?,
             job_title = ?, occupation = ?, birth_year = ?, birth_month = ?, birth_day = ?,
             anniv_year = ?, anniv_month = ?, anniv_day = ?, notes = ?
           WHERE id = ? AND user_id = ?',
          'sssssssiiiiiisii', array_merge($fields, [$id, $userId]));
    exec1('DELETE FROM pl_contact_methods WHERE person_id = ?', 'i', [$id]);
    exec1('DELETE FROM pl_addresses WHERE person_id = ?', 'i', [$id]);
  } else {
    $id = exec1('INSERT INTO pl_people (first_name, middle_name, last_name, nickname, organization, job_title, occupation,
                   birth_year, birth_month, birth_day, anniv_year, anniv_month, anniv_day, notes, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                'sssssssiiiiiisi', array_merge($fields, [$userId]));
  }
  foreach ($methods as $i => [$kind, $label, $value]) {
    exec1('INSERT INTO pl_contact_methods (person_id, kind, label, value, sort_order) VALUES (?, ?, ?, ?, ?)',
          'isssi', [$id, $kind, $label, $value, $i]);
  }
  foreach ($addresses as $i => $a) {
    exec1('INSERT INTO pl_addresses (person_id, label, street, city, region, postal_code, country, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'issssssi', array_merge([$id], $a, [$i]));
  }
  if ($groupIds !== null) {
    exec1('DELETE FROM pl_group_members WHERE person_id = ?', 'i', [$id]);
    foreach ($groupIds as $gid) {
      exec1('INSERT INTO pl_group_members (group_id, person_id) VALUES (?, ?)', 'ii', [$gid, $id]);
    }
  }
  $conn->commit();
  return $id;
}

function deletePeople(int $userId, array $ids): int {
  $ids = ownedIds($userId, 'pl_people', $ids);
  if (!$ids) {
    return 0;
  }
  $keys = q('SELECT photo_key FROM pl_people WHERE photo_key IS NOT NULL AND id IN (' . placeholders($ids) . ')',
            str_repeat('i', count($ids)), $ids);
  // Child rows (phones, emails, addresses, group memberships) cascade.
  $n = execCount('DELETE FROM pl_people WHERE user_id = ? AND id IN (' . placeholders($ids) . ')',
                 'i' . str_repeat('i', count($ids)), array_merge([$userId], $ids));
  foreach ($keys as $k) {
    deletePhotoFiles($k['photo_key']);
  }
  return $n;
}

// ---- Photos ----
// The browser resizes to JPEG before upload (iPhone HEIC included), sending
// a "full" (up to 800px) and a "thumb" (up to 240px). They're stored under a
// random 32-hex key in api/uploads (locked by .htaccess) and served by
// action=photo&k=<key>. The key is unguessable, which is what lets an <img>
// load it without a login header -- the same model as Temple Time's photos.

const PHOTO_FULL = 800;
const PHOTO_THUMB = 240;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function uploadDir(): string {
  $dir = __DIR__ . '/uploads';
  if (!is_dir($dir)) {
    mkdir($dir, 0750, true);
  }
  if (!file_exists($dir . '/.htaccess')) {
    file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
  }
  return $dir;
}

function photoPath(string $key, bool $thumb): string {
  return uploadDir() . '/' . $key . ($thumb ? '_t' : '') . '.jpg';
}

function deletePhotoFiles(?string $key): void {
  if (!$key || !preg_match('/^[0-9a-f]{32}$/', $key)) {
    return;
  }
  foreach ([false, true] as $thumb) {
    $p = photoPath($key, $thumb);
    if (is_file($p)) {
      unlink($p);
    }
  }
}

// Returns JPEG bytes no larger than $maxSide. With GD the image is re-encoded
// (which also strips anything that isn't image data); without GD a JPEG that
// is already small enough is accepted as-is.
function photoBytes(?array $file, int $maxSide): string {
  if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    fail('The photo didn\'t upload — please try again');
  }
  if ((int)$file['size'] > MAX_PHOTO_BYTES) {
    fail('That photo is too large');
  }
  $info = @getimagesize($file['tmp_name']);
  if (!is_array($info)) {
    fail('That file isn\'t a picture this app can use');
  }
  [$w, $h, $type] = $info;
  if (function_exists('imagecreatetruecolor')) {
    $src = null;
    switch ($type) {
      case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($file['tmp_name']); break;
      case IMAGETYPE_PNG: $src = @imagecreatefrompng($file['tmp_name']); break;
      case IMAGETYPE_WEBP: $src = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($file['tmp_name']) : null; break;
    }
    if (!$src) {
      fail('That file isn\'t a picture this app can use');
    }
    $scale = min(1.0, $maxSide / max($w, $h));
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    imagedestroy($src);
    ob_start();
    imagejpeg($dst, null, 85);
    $bytes = ob_get_clean();
    imagedestroy($dst);
    return $bytes;
  }
  if ($type !== IMAGETYPE_JPEG || max($w, $h) > $maxSide) {
    fail('Photos need to be resized before upload');
  }
  return file_get_contents($file['tmp_name']);
}

function setPhoto(int $userId, int $personId): string {
  $p = ownPerson($userId, $personId);
  $full = photoBytes($_FILES['full'] ?? null, PHOTO_FULL);
  $thumb = photoBytes($_FILES['thumb'] ?? null, PHOTO_THUMB);
  $key = bin2hex(random_bytes(16));
  if (file_put_contents(photoPath($key, false), $full) === false || file_put_contents(photoPath($key, true), $thumb) === false) {
    deletePhotoFiles($key);
    fail('Couldn\'t save the photo', 500);
  }
  exec1('UPDATE pl_people SET photo_key = ? WHERE id = ? AND user_id = ?', 'sii', [$key, $personId, $userId]);
  deletePhotoFiles($p['photo_key']);
  return $key;
}

// ---- Groups ----

function saveGroup(int $userId, array $b): int {
  $id = (int)($b['id'] ?? 0);
  if ($id > 0) {
    ownGroup($userId, $id);
  }
  $name = strOrNull($b['name'] ?? null, 100);
  if ($name === null) {
    fail('A group needs a name');
  }
  $clash = q('SELECT id FROM pl_groups WHERE user_id = ? AND name = ? AND id <> ?', 'isi', [$userId, $name, $id]);
  if ($clash) {
    fail("You already have a group called \"$name\"");
  }
  $desc = strOrNull($b['description'] ?? null, 2000);
  $color = colorOrNull($b['color'] ?? null);
  $icon = strOrNull($b['icon'] ?? null, 16);
  if ($id > 0) {
    exec1('UPDATE pl_groups SET name = ?, description = ?, color = ?, icon = ? WHERE id = ? AND user_id = ?',
          'ssssii', [$name, $desc, $color, $icon, $id, $userId]);
    return $id;
  }
  return exec1('INSERT INTO pl_groups (user_id, name, description, color, icon) VALUES (?, ?, ?, ?, ?)',
               'issss', [$userId, $name, $desc, $color, $icon]);
}

// ---- Router ----

$method = $_SERVER['REQUEST_METHOD'];
$isMultipart = $method === 'POST' && strpos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0;
$body = $method === 'POST' ? ($isMultipart ? $_POST : jsonBody()) : [];
$action = $method === 'GET' ? ($_GET['action'] ?? '') : ($body['action'] ?? '');

function member(): int {
  return (int)requireMember()['id'];
}

switch ($action) {

  case 'bootstrap': {
    $user = requireMember();
    $uid = (int)$user['id'];
    respond([
      'DisplayName' => $user['display_name'] ?: $user['username'],
      'Groups' => loadGroups($uid),
      'PeopleCount' => (int)q("SELECT COUNT(*) AS n FROM pl_people WHERE user_id = ? AND status <> 'archived'", 'i', [$uid])[0]['n'],
    ]);
  }

  case 'people': {
    $uid = member();
    respond(['People' => loadPeople($uid), 'Groups' => loadGroups($uid)]);
  }

  case 'person': {
    $uid = member();
    $id = (int)($_GET['id'] ?? 0);
    ownPerson($uid, $id);
    respond(['Person' => loadPeople($uid, [$id], true)[0], 'Groups' => loadGroups($uid)]);
  }

  case 'savePerson': {
    $uid = member();
    respond(['ok' => true, 'Id' => savePerson($uid, $body)]);
  }

  case 'setPinned': {
    $uid = member();
    $id = (int)($body['id'] ?? 0);
    ownPerson($uid, $id);
    exec1('UPDATE pl_people SET is_pinned = ? WHERE id = ? AND user_id = ?', 'iii', [!empty($body['pinned']) ? 1 : 0, $id, $uid]);
    respond(['ok' => true]);
  }

  case 'setStatus': {
    $uid = member();
    $status = (string)($body['status'] ?? '');
    if (!in_array($status, STATUSES, true)) {
      fail('Unknown status');
    }
    $ids = ownedIds($uid, 'pl_people', (array)($body['ids'] ?? []));
    $n = $ids ? execCount('UPDATE pl_people SET status = ? WHERE user_id = ? AND id IN (' . placeholders($ids) . ')',
                          'si' . str_repeat('i', count($ids)), array_merge([$status, $uid], $ids)) : 0;
    respond(['ok' => true, 'Changed' => $n]);
  }

  case 'deletePeople': {
    $uid = member();
    respond(['ok' => true, 'Deleted' => deletePeople($uid, (array)($body['ids'] ?? []))]);
  }

  // multipart: action, id, full, thumb
  case 'setPhoto': {
    $uid = member();
    respond(['ok' => true, 'PhotoKey' => setPhoto($uid, (int)($body['id'] ?? 0))]);
  }

  case 'removePhoto': {
    $uid = member();
    $p = ownPerson($uid, (int)($body['id'] ?? 0));
    exec1('UPDATE pl_people SET photo_key = NULL WHERE id = ? AND user_id = ?', 'ii', [(int)$p['id'], $uid]);
    deletePhotoFiles($p['photo_key']);
    respond(['ok' => true]);
  }

  // GET ?action=photo&k=<key>[&size=thumb] -- no login (see Photos above).
  case 'photo': {
    $key = (string)($_GET['k'] ?? '');
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) {
      fail('Not found', 404);
    }
    $path = photoPath($key, ($_GET['size'] ?? '') === 'thumb');
    if (!is_file($path)) {
      fail('Not found', 404);
    }
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($path));
    header('X-Content-Type-Options: nosniff');
    // A new photo always gets a new key, so a key's bytes never change.
    header('Cache-Control: private, max-age=31536000, immutable');
    readfile($path);
    exit;
  }

  case 'saveGroup': {
    $uid = member();
    respond(['ok' => true, 'Id' => saveGroup($uid, $body)]);
  }

  case 'setGroupArchived': {
    $uid = member();
    $g = ownGroup($uid, (int)($body['id'] ?? 0));
    exec1('UPDATE pl_groups SET is_archived = ? WHERE id = ? AND user_id = ?',
          'iii', [!empty($body['archived']) ? 1 : 0, (int)$g['id'], $uid]);
    respond(['ok' => true]);
  }

  // Deleting a group only removes the memberships; the people stay.
  case 'deleteGroup': {
    $uid = member();
    $g = ownGroup($uid, (int)($body['id'] ?? 0));
    exec1('DELETE FROM pl_groups WHERE id = ? AND user_id = ?', 'ii', [(int)$g['id'], $uid]);
    respond(['ok' => true]);
  }

  // { groupId, add: [personIds], remove: [personIds] }
  case 'groupMembers': {
    $uid = member();
    $g = ownGroup($uid, (int)($body['groupId'] ?? 0));
    $gid = (int)$g['id'];
    $add = ownedIds($uid, 'pl_people', (array)($body['add'] ?? []));
    $remove = ownedIds($uid, 'pl_people', (array)($body['remove'] ?? []));
    foreach ($add as $pid) {
      exec1('INSERT IGNORE INTO pl_group_members (group_id, person_id) VALUES (?, ?)', 'ii', [$gid, $pid]);
    }
    if ($remove) {
      exec1('DELETE FROM pl_group_members WHERE group_id = ? AND person_id IN (' . placeholders($remove) . ')',
            'i' . str_repeat('i', count($remove)), array_merge([$gid], $remove));
    }
    respond(['ok' => true]);
  }

  case 'login': {
    $username = trim((string)($body['username'] ?? ''));
    $password = (string)($body['password'] ?? '');
    if ($username === '' || $password === '') {
      fail('Username and password are required');
    }
    $rows = q('SELECT id, password_hash, display_name FROM users WHERE username = ?', 's', [$username]);
    $u = $rows[0] ?? null;
    if (!$u || $u['password_hash'] === null || !password_verify($password, $u['password_hash'])) {
      fail('Invalid username or password', 401);
    }
    $token = bin2hex(random_bytes(32));
    exec1('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
          'sii', [$token, (int)$u['id'], SESSION_LIFETIME_DAYS]);
    respond(['token' => $token, 'displayName' => $u['display_name']]);
  }

  default:
    respond(['ok' => false, 'error' => 'Unknown action: ' . $action], 404);
}
