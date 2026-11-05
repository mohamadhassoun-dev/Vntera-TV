<?php
/**
 * Vntera panel bridge for Hostinger shared hosting (LiteSpeed + PHP).
 *
 * The IPTV panel is HTTP-only and sends no CORS headers, so the browser cannot
 * call it directly. .htaccess rewrites /xtream/<path> here and this script
 * streams the request to the allow-listed panel, keeping everything same-origin.
 *
 * Environment (hPanel → your site → Environment / PHP variables):
 *   PANEL_ORIGIN   e.g. http://ontvflix.cc:8080
 *   ALLOWED_HOSTS  comma-separated host:port list (defaults to PANEL_ORIGIN's host)
 */

declare(strict_types=1);

set_time_limit(0);
ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) {
    ob_end_clean();
}
cors();

// Answer the preflight here: forwarding it to the panel would 401.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const DEFAULT_PANEL = 'http://ontvflix.cc:8080';

/**
 * The Android/iOS shell runs the bundle on a local origin (http://localhost), so
 * its panel calls are cross-origin. No credentials or cookies are involved, so a
 * reflecting allow-origin is enough to let the WebView read the response.
 */
function cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    header('Access-Control-Allow-Origin: ' . ($origin !== '' ? $origin : '*'));
    header('Vary: Origin', false);
    header('Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS');
    header(
        'Access-Control-Allow-Headers: '
        . ($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? 'Accept, Content-Type, Range, Origin')
    );
    header(
        'Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Last-Modified'
    );
    header('Access-Control-Max-Age: 600');
}

function respond_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body);
    exit;
}

function panel_settings(): array
{
    $origin = getenv('PANEL_ORIGIN') ?: (isset($_SERVER['PANEL_ORIGIN']) ? $_SERVER['PANEL_ORIGIN'] : '');
    $origin = rtrim($origin !== '' ? $origin : DEFAULT_PANEL, '/');

    $raw = getenv('ALLOWED_HOSTS') ?: (isset($_SERVER['ALLOWED_HOSTS']) ? $_SERVER['ALLOWED_HOSTS'] : '');
    $allowed = array_values(array_filter(array_map('trim', explode(',', (string) $raw))));

    $parts = parse_url($origin);
    if (!is_array($parts) || empty($parts['host'])) {
        return ['error' => 'panel_origin_invalid', 'origin' => $origin, 'allowed' => $allowed];
    }
    $host = $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    if (!$allowed) {
        $allowed = [$host];
    }

    return ['origin' => $origin, 'host' => $host, 'allowed' => $allowed];
}

$panel = panel_settings();

if (isset($_GET['__health'])) {
    respond_json(200, [
        'ok' => !isset($panel['error']),
        'panel' => $panel['origin'] ?? '',
        'allowedHosts' => $panel['allowed'],
        'runtime' => 'php/' . PHP_VERSION,
    ]);
}

if (isset($panel['error'])) {
    respond_json(500, ['error' => $panel['error'], 'panel_origin' => $panel['origin']]);
}

if (!in_array($panel['host'], $panel['allowed'], true)) {
    error_log('[vntera] refusing panel host ' . $panel['host']);
    respond_json(502, ['error' => 'panel_host_not_allowed', 'host' => $panel['host']]);
}

// Path after /xtream/ plus the original query string.
$path = isset($_GET['__p']) ? (string) $_GET['__p'] : '';
unset($_GET['__p'], $_GET['__health']);
$query = http_build_query($_GET);
$target = $panel['origin'] . '/' . ltrim($path, '/') . ($query !== '' ? '?' . $query : '');

// Forward only what the panel needs; browser cookies and origins stay here.
$forward = ['Expect:'];
foreach (['HTTP_ACCEPT', 'HTTP_RANGE', 'HTTP_IF_RANGE', 'HTTP_IF_NONE_MATCH', 'HTTP_IF_MODIFIED_SINCE', 'CONTENT_TYPE'] as $key) {
    if (!empty($_SERVER[$key])) {
        $name = str_replace('HTTP_', '', $key);
        $forward[] = str_replace('_', '-', $name) . ': ' . $_SERVER[$key];
    }
}
$forward[] = 'Accept-Encoding: identity';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = '';
if ($method !== 'GET' && $method !== 'HEAD') {
    $body = file_get_contents('php://input') ?: '';
}

$sent = false;
$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $forward,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3,
    CURLOPT_CONNECTTIMEOUT => 15,
    // 0 = no limit: live segments and VOD streams stay open.
    CURLOPT_TIMEOUT => 0,
    CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$sent): int {
        $trimmed = rtrim($line, "\r\n");
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $trimmed, $m)) {
            http_response_code((int) $m[1]);
            return strlen($line);
        }
        if ($trimmed === '' || strpos($trimmed, ':') === false) {
            return strlen($line);
        }
        [$name, $value] = explode(':', $trimmed, 2);
        $name = strtolower(trim($name));
        $value = trim($value);
        // The browser must see this as same-origin: never leak panel cookies
        // or the panel's own CORS headers.
        if (in_array($name, ['set-cookie', 'access-control-allow-origin', 'transfer-encoding', 'connection', 'keep-alive'], true)) {
            return strlen($line);
        }
        if (in_array($name, ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'], true)) {
            header($name . ': ' . $value, $name !== 'content-type');
        }
        return strlen($line);
    },
    CURLOPT_WRITEFUNCTION => static function ($handle, string $data) use (&$sent): int {
        echo $data;
        flush();
        $sent = true;
        return strlen($data);
    },
]);

if ($body !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$ok = curl_exec($ch);
if ($ok === false) {
    $message = curl_error($ch);
    error_log('[vntera] panel request failed: ' . $message);
    if (!$sent && !headers_sent()) {
        respond_json(502, ['error' => 'panel_unreachable', 'message' => $message]);
    }
}
curl_close($ch);
