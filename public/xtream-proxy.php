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

// How much of an episode's opening is cached, and the cache's disk ceiling.
const MEDIA_HEAD_BYTES = 20 * 1024 * 1024;
const MEDIA_CACHE_LIMIT = 3221225472; // 3 GB

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

/**
 * Cheap "does this stream deliver bytes" check for the in-app stream checker.
 *
 * A browser cannot answer that itself: an open-ended MP4 answer is endless, and
 * every attempt spends one of the account's connection slots for as long as it
 * runs. This opens the panel stream on the server, keeps the first 32 KB, hangs
 * up and reports what it saw, so one check is one short request.
 */
function probe_stream(string $target): array
{
    $started = microtime(true);
    $status = 0;
    $type = '';
    $bytes = 0;
    $ch = curl_init($target);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_RANGE => '0-65535',
        CURLOPT_HTTPHEADER => ['Accept: */*'],
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$status, &$type): int {
            $trimmed = rtrim($line, "\r\n");
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $trimmed, $m)) {
                $status = (int) $m[1];
            } elseif (preg_match('#^content-type:\s*(.+)$#i', $trimmed, $m)) {
                $type = trim($m[1]);
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $data) use (&$bytes): int {
            $bytes += strlen($data);
            // Enough to prove the stream delivers; do not download the file.
            return $bytes >= 32768 ? 0 : strlen($data);
        },
    ]);
    $ok = curl_exec($ch);
    $errno = curl_errno($ch);
    curl_close($ch);

    $ms = (int) round((microtime(true) - $started) * 1000);
    $html = $type !== '' && stripos($type, 'text/html') !== false;
    $reached = $status >= 200 && $status < 400;
    $working = $reached && $bytes > 0 && !$html;
    $reason = '';
    if (!$working) {
        if ($errno === 28) {
            $reason = 'timeout';
        } elseif (!$reached) {
            $reason = $status > 0 ? 'http_' . $status : 'network';
        } elseif ($html) {
            $reason = 'html';
        } else {
            $reason = $bytes === 0 ? 'empty' : 'network';
        }
    }

    return [
        'ok' => $working,
        'status' => $status,
        'bytes' => $bytes,
        'ms' => $ms,
        'type' => $type,
        'reason' => $reason,
    ];
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

// The health checker asks this one to open a stream and report, not to stream it.
if ($path === '__probe') {
    $probePath = ltrim((string) ($_GET['path'] ?? ''), '/');
    if (
        !preg_match('#^(live|movie|series|hls)/#', $probePath)
        || strpos($probePath, '..') !== false
        || strpos($probePath, '://') !== false
    ) {
        respond_json(400, ['ok' => false, 'status' => 0, 'bytes' => 0, 'ms' => 0, 'reason' => 'bad_path']);
    }
    respond_json(200, probe_stream($panel['origin'] . '/' . $probePath));
}

$query = http_build_query($_GET);
$target = $panel['origin'] . '/' . ltrim($path, '/') . ($query !== '' ? '?' . $query : '');

/**
 * Media goes straight to the panel.
 *
 * Relaying a movie or a live transport stream through PHP halved the delivered
 * bitrate (a 3 MB range took 13 s instead of 5 s) and delayed a live tune by
 * eight seconds before the first byte, which is what made channels look dead.
 * The panel serves the same bytes at full speed and already answers with
 * `Access-Control-Allow-Origin: *`, so a redirect keeps the browser's own
 * streaming logic (Range requests, workers) talking to the origin that has the
 * file. The relay stays for the JSON API, which the browser cannot call directly
 * once this site is HTTPS (an HTTP panel URL is mixed content) — so an HTTPS
 * request keeps the old path instead of being redirected into a block.
 */
$isMedia = (bool) preg_match('#^(movie|series|live|hls)/#', ltrim($path, '/'));
$https = ($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string) ($_SERVER['HTTPS'] ?? '')) !== 'off';
if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
    $https = true;
}
if ($isMedia && !$https) {
    header('Cache-Control: no-store');
    // Films and episodes are progressive MP4s that a player cannot start until
    // it has read the whole movie header, so those two go through the head cache
    // below. Live transport streams and HLS segments have no such header and are
    // fastest straight from the panel.
    if (preg_match('#^(series|movie)/#', ltrim($path, '/')) === 1) {
        serve_series($target);
        exit;
    }
    header('Location: ' . $target, true, 302);
    exit;
}

/**
 * Series episodes open with a huge MP4 header.
 *
 * The files are faststart, but their moov box measured 1.4 MB to 13 MB on the
 * episodes checked, and a browser cannot draw a frame until it has all of it.
 * The panel throttles one download to 66-220 KB/s and refuses parallel ranges
 * (HTTP 406), so fetching that header straight from the panel took a minute or
 * more and the player never left its buffering card. This server pulls the same
 * bytes at ~20 MB/s, so the head of an episode is cached here and served at the
 * client's own link speed; everything past the head streams from the panel.
 */
function media_cache_dir(): string
{
    $dir = dirname(__DIR__) . '/.mediacache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

/** Oldest episodes are dropped once the cache passes its cap. */
function prune_media_cache(string $dir): void
{
    $files = glob($dir . '/*');
    if (!$files) {
        return;
    }
    $total = 0;
    $entries = [];
    foreach ($files as $file) {
        $size = (int) @filesize($file);
        $total += $size;
        $entries[] = [(int) @filemtime($file), $file, $size];
    }
    if ($total <= MEDIA_CACHE_LIMIT) {
        return;
    }
    sort($entries);
    foreach ($entries as $entry) {
        if ($total <= MEDIA_CACHE_LIMIT * 0.8) {
            break;
        }
        if (@unlink($entry[1])) {
            $total -= $entry[2];
        }
    }
}

/** Caches the opening bytes of one episode; null when they cannot be fetched. */
function series_head(string $target): ?array
{
    $dir = media_cache_dir();
    $key = sha1($target);
    $headFile = $dir . '/' . $key . '.head';
    $metaFile = $dir . '/' . $key . '.json';
    if (is_file($headFile) && is_file($metaFile)) {
        $meta = json_decode((string) @file_get_contents($metaFile), true);
        if (is_array($meta) && (int) $meta['head'] === (int) @filesize($headFile)) {
            @touch($headFile);
            return [$headFile, $meta];
        }
    }

    // A browser opens several range requests at once, so two processes can race
    // for the same episode. Each one writes its own temporary file and the last
    // rename wins; a shared `.part` left a half-written head behind and the
    // episode then fell back to the panel and stalled.
    $tmp = $headFile . '.part.' . getmypid() . '.' . mt_rand(1000, 9999);
    $out = @fopen($tmp, 'wb');
    if (!$out) {
        return null;
    }
    // Ask the panel for the file's length first: a range that runs past the end
    // of a short episode is refused outright, and that refusal used to send the
    // episode back down the slow relay path.
    $probe = curl_init($target);
    $probeTotal = 0;
    curl_setopt_array($probe, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_RANGE => '0-0',
        CURLOPT_NOBODY => false,
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$probeTotal): int {
            if (preg_match('#^content-range:\s*bytes\s+\d+-\d+/(\d+)#i', rtrim($line, "\r\n"), $m)) {
                $probeTotal = (int) $m[1];
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $data): int {
            return strlen($data);
        },
    ]);
    curl_exec($probe);
    curl_close($probe);
    $headWant = $probeTotal > 0 ? min(MEDIA_HEAD_BYTES, $probeTotal) : MEDIA_HEAD_BYTES;

    $total = 0;
    $type = 'video/mp4';
    $ch = curl_init($target);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_RANGE => '0-' . max(0, $headWant - 1),
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$type, &$total): int {
            $trimmed = rtrim($line, "\r\n");
            if (preg_match('#^content-range:\s*bytes\s+\d+-\d+/(\d+)#i', $trimmed, $m)) {
                $total = (int) $m[1];
            } elseif (preg_match('#^content-type:\s*(.+)$#i', $trimmed, $m) && stripos($m[1], 'text/html') === false) {
                $type = trim($m[1]);
            }
            return strlen($line);
        },
        CURLOPT_FILE => $out,
    ]);
    $ok = curl_exec($ch);
    curl_close($ch);
    fclose($out);
    if ($ok === false || !is_file($tmp) || (int) @filesize($tmp) < 65536) {
        @unlink($tmp);
        // Another process may have finished the same head while this one failed.
        if (is_file($headFile) && (int) @filesize($headFile) >= 65536) {
            $meta = json_decode((string) @file_get_contents($metaFile), true);
            if (is_array($meta)) {
                return [$headFile, $meta];
            }
        }
        return null;
    }
    if (!@rename($tmp, $headFile)) {
        @unlink($tmp);
        if (!is_file($headFile)) {
            return null;
        }
    }
    $head = (int) filesize($headFile);
    $meta = ['total' => max($total, $head), 'head' => $head, 'type' => $type];
    @file_put_contents($metaFile, json_encode($meta));
    prune_media_cache($dir);
    return [$headFile, $meta];
}

/** True when an episode's `moov` sits in its opening, so a 200 can start it. */
function series_is_faststart(string $headFile): bool
{
    $handle = @fopen($headFile, 'rb');
    if (!$handle) {
        return false;
    }
    $chunk = (string) fread($handle, 1048576);
    fclose($handle);
    return $chunk !== '' && strpos($chunk, 'moov') !== false;
}

function serve_series(string $target): void
{
    $cached = series_head($target);
    if ($cached === null) {
        // The head could not be cached just now. Relay the bytes rather than
        // sending the browser to the panel, which may refuse another range.
        header('Cache-Control: private, max-age=0');
        $ch = curl_init($target);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 0,
            CURLOPT_WRITEFUNCTION => static function ($handle, string $data): int {
                echo $data;
                flush();
                return strlen($data);
            },
        ]);
        if (!empty($_SERVER['HTTP_RANGE'])) {
            curl_setopt($ch, CURLOPT_RANGE, str_replace('bytes=', '', (string) $_SERVER['HTTP_RANGE']));
        }
        curl_exec($ch);
        curl_close($ch);
        return;
    }
    [$headFile, $meta] = $cached;
    $total = (int) $meta['total'];
    $headLen = (int) $meta['head'];

    $range = (string) ($_SERVER['HTTP_RANGE'] ?? '');
    $start = 0;
    $end = $total - 1;
    if ($range !== '' && preg_match('#bytes=(\d*)-(\d*)#', $range, $m)) {
        $start = $m[1] === '' ? 0 : (int) $m[1];
        $end = $m[2] === '' ? $total - 1 : min((int) $m[2], $total - 1);
    }
    if ($start >= $total || $start > $end) {
        http_response_code(416);
        header('Content-Range: bytes */' . $total);
        return;
    }

    // A player's first request is open-ended (`bytes=0-`), and answering that
    // with a declared length drops this host's PHP egress from ~450 KB/s to
    // ~230 KB/s — measured four times, both ways. The whole file is streamed
    // either way, so an unlengthy 200 costs nothing and doubles the rate the
    // header arrives at; bounded requests keep their exact 206.
    $openEnded = $range === '' || (bool) preg_match('#^bytes=0-$#', trim($range));
    // A film whose `moov` sits after hundreds of megabytes of media data cannot
    // start from a length-less 200: the player reads the file from the front and
    // never reaches the header. Answering the opening as a bounded 206 lets it
    // ask for the tail at once.
    if ($openEnded && !series_is_faststart($headFile)) {
        $end = min($end, $headLen - 1);
        $openEnded = false;
    }
    $length = $end - $start + 1;
    http_response_code($range !== '' && !$openEnded ? 206 : 200);
    header('Content-Type: ' . ((string) ($meta['type'] ?: 'video/mp4')));
    header('Accept-Ranges: bytes');
    if (!$openEnded) {
        header('Content-Length: ' . $length);
    }
    if ($range !== '' && !$openEnded) {
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $total);
    }
    // Episode bytes are never worth caching — but `no-store` also drops this
    // host's PHP egress from ~450 KB/s to ~230 KB/s, so the player only gets
    // `private` instead.
    header('Cache-Control: private, max-age=0');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        return;
    }

    // The cached head first: this is what the player needs before a frame.
    if ($start < $headLen) {
        $localEnd = min($end, $headLen - 1);
        $handle = @fopen($headFile, 'rb');
        if ($handle) {
            fseek($handle, $start);
            // 256 KB writes measured twice the throughput of fpassthru and of
            // 1 MB writes on this host (224 KB/s versus 458 KB/s).
            $left = $localEnd - $start + 1;
            while ($left > 0 && !feof($handle)) {
                $chunk = fread($handle, (int) min(262144, $left));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                flush();
                $left -= strlen($chunk);
            }
            fclose($handle);
        }
        $start = $localEnd + 1;
    }
    if ($start > $end) {
        return;
    }

    // Everything past the head streams from the panel, as before.
    $ch = curl_init($target);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_RANGE => $start . '-' . $end,
        CURLOPT_WRITEFUNCTION => static function ($handle, string $data): int {
            echo $data;
            flush();
            return strlen($data);
        },
    ]);
    curl_exec($ch);
    curl_close($ch);
}

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
