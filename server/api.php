<?php
declare(strict_types=1);

// API de synchronisation Mapog — PHP 8 + SQLite3, fichier unique.
// Déploiement : copier ce fichier à côté de index.html (webroot du LXC).
// La base est créée automatiquement dans ./data/ au premier appel
// → penser à bloquer /data/ dans nginx (cf. README).
//
// Actions (POST + JSON) :
//   ?action=register {username, password}        → {token, username}
//   ?action=login    {username, password}        → {token, username}
//   ?action=push     {cells: [[k,t],…]}  (auth)  → {added}
//   ?action=pull     {since}             (auth)  → {cells: [[k,t],…], since, more}
//   ?action=stats                        (auth)  → {cells}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // à restreindre à https://mapog.goret.click en prod
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const MAX_PUSH   = 5000;   // cellules max par requête push
const PULL_LIMIT = 50000;  // cellules max par réponse pull (le client boucle si more=true)

function out(array $data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function fail(string $msg, int $code = 400): never
{
    out(['error' => $msg], $code);
}

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir) && !mkdir($dataDir, 0750, true)) {
    fail('Impossible de créer le dossier data/', 500);
}

$db = new SQLite3($dataDir . '/mapog.db');
$db->busyTimeout(5000);
$db->exec('PRAGMA journal_mode = WAL');
$db->exec('CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash  TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
)');
// k = clé de cellule "latIdx_lngIdx" ; t = découverte côté client ;
// st = réception côté serveur (sert de curseur de pull, horloge fiable)
$db->exec('CREATE TABLE IF NOT EXISTS cells (
    user_id INTEGER NOT NULL,
    k       TEXT NOT NULL,
    t       INTEGER NOT NULL,
    st      INTEGER NOT NULL,
    PRIMARY KEY (user_id, k)
) WITHOUT ROWID');
$db->exec('CREATE INDEX IF NOT EXISTS idx_cells_user_st ON cells (user_id, st)');

function bearerToken(): ?string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        $h = apache_request_headers()['Authorization'] ?? '';
    }
    return preg_match('/^Bearer\s+([a-f0-9]{64})$/', $h, $m) ? $m[1] : null;
}

function auth(SQLite3 $db): array
{
    $token = bearerToken();
    if ($token === null) {
        fail('Non authentifié', 401);
    }
    $st = $db->prepare('SELECT id, username FROM users WHERE token = :t');
    $st->bindValue(':t', $token);
    $user = $st->execute()->fetchArray(SQLITE3_ASSOC);
    if (!$user) {
        fail('Token invalide', 401);
    }
    return $user;
}

$action = $_GET['action'] ?? '';
$body = json_decode(file_get_contents('php://input') ?: '{}', true);
if (!is_array($body)) {
    fail('JSON invalide');
}

switch ($action) {

    case 'register':
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_\-]{3,32}$/', $username)) {
            fail('Pseudo invalide (3-32 caractères : lettres, chiffres, _ ou -)');
        }
        if (strlen($password) < 8) {
            fail('Mot de passe trop court (8 caractères minimum)');
        }
        $token = bin2hex(random_bytes(32));
        $st = $db->prepare('INSERT INTO users (username, pass_hash, token, created_at) VALUES (:u, :p, :t, :c)');
        $st->bindValue(':u', $username);
        $st->bindValue(':p', password_hash($password, PASSWORD_DEFAULT));
        $st->bindValue(':t', $token);
        $st->bindValue(':c', time());
        if (@$st->execute() === false) {
            fail('Ce pseudo est déjà pris', 409);
        }
        out(['token' => $token, 'username' => $username]);

    case 'login':
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $st = $db->prepare('SELECT pass_hash, token, username FROM users WHERE username = :u');
        $st->bindValue(':u', $username);
        $user = $st->execute()->fetchArray(SQLITE3_ASSOC);
        if (!$user || !password_verify($password, $user['pass_hash'])) {
            fail('Pseudo ou mot de passe incorrect', 401);
        }
        // Le token n'est pas régénéré : les autres appareils restent connectés
        out(['token' => $user['token'], 'username' => $user['username']]);

    case 'push':
        $user = auth($db);
        $incoming = $body['cells'] ?? null;
        if (!is_array($incoming) || count($incoming) > MAX_PUSH) {
            fail('cells doit être un tableau de ' . MAX_PUSH . ' éléments max');
        }
        $now = time();
        $st = $db->prepare('INSERT OR IGNORE INTO cells (user_id, k, t, st) VALUES (:u, :k, :t, :st)');
        $added = 0;
        $db->exec('BEGIN');
        foreach ($incoming as $cell) {
            if (!is_array($cell) || count($cell) !== 2) {
                continue;
            }
            [$k, $t] = $cell;
            if (!is_string($k) || !preg_match('/^-?\d{1,7}_-?\d{1,7}$/', $k) || !is_numeric($t)) {
                continue; // cellule malformée : on l'ignore sans casser le lot
            }
            $st->bindValue(':u', $user['id'], SQLITE3_INTEGER);
            $st->bindValue(':k', $k);
            $st->bindValue(':t', (int)$t, SQLITE3_INTEGER);
            $st->bindValue(':st', $now, SQLITE3_INTEGER);
            $st->execute();
            $added += $db->changes();
            $st->reset();
        }
        $db->exec('COMMIT');
        out(['added' => $added]);

    case 'pull':
        $user = auth($db);
        $since = (int)($body['since'] ?? 0);
        $st = $db->prepare('SELECT k, t, st FROM cells WHERE user_id = :u AND st > :s ORDER BY st LIMIT ' . PULL_LIMIT);
        $st->bindValue(':u', $user['id'], SQLITE3_INTEGER);
        $st->bindValue(':s', $since, SQLITE3_INTEGER);
        $res = $st->execute();
        $cells = [];
        $newSince = $since;
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
            $cells[] = [$row['k'], $row['t']];
            $newSince = max($newSince, (int)$row['st']);
        }
        out(['cells' => $cells, 'since' => $newSince, 'more' => count($cells) === PULL_LIMIT]);

    case 'stats':
        $user = auth($db);
        $st = $db->prepare('SELECT COUNT(*) AS n FROM cells WHERE user_id = :u');
        $st->bindValue(':u', $user['id'], SQLITE3_INTEGER);
        $row = $st->execute()->fetchArray(SQLITE3_ASSOC);
        out(['cells' => (int)$row['n'], 'username' => $user['username']]);

    default:
        fail('Action inconnue', 404);
}
