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
        serve_media($target);
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

/**
 * Movies and episodes open with their MP4 header, and a player draws nothing
 * until it has read all of it (1.4 MB to 13 MB measured on the episodes
 * checked). The panel throttles one download to 66-220 KB/s and refuses
 * parallel ranges, while this server pulls the same bytes at ~9 MB/s, so the
 * opening of every film is kept here.
 *
 * The first viewer no longer waits for that cache to be filled: the panel's
 * bytes are passed straight through to the browser and written into the cache
 * on the way past, so the picture starts at the panel's own first-byte time
 * and the head fills behind it. Once it is on disk a request is answered from
 * disk in ~0.02 s.
 */
function media_send_headers(int $start, ?int $last, int $total, string $type, bool $openEnded, bool $faststart = false): void
{
    // A request that begins mid-file is a range even when it has no end: a film
    // whose `moov` sits at the end asks for `bytes=S-`, and answering that with
    // 200 makes the player throw the tail away and start again at byte zero.
    //
    // The same is true of the first request. A film with its `moov` at the front
    // draws a frame from the opening, and the length-less 200 doubles this host's
    // egress (450 vs 230 KB/s), so it keeps that; a film whose `moov` sits after
    // several hundred megabytes of `mdat` can only be seeked when the answer
    // carries a length, and without one the player waits through the whole file.
    $declared = $total > 0 && $last !== null && ($start > 0 || !$faststart);
    if ($declared && $last !== null && $total > 0) {
        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $last . '/' . $total);
        // A declared length roughly halves this host's PHP egress (450 -> 230
        // KB/s, measured), so only bounded requests carry one.
        header('Content-Length: ' . ($last - $start + 1));
    } else {
        http_response_code(200);
    }
    header('Content-Type: ' . $type);
    header('Accept-Ranges: bytes');
    // Episode bytes are never worth caching — but `no-store` also drops egress
    // from ~450 KB/s to ~230 KB/s, so the player only gets `private`.
    header('Cache-Control: private, max-age=0');
}

/**
 * Asks the panel for a file's length with a one-byte range.
 *
 * Without it a bounded request carries no honest `Content-Range`, and a film
 * whose `moov` sits at the end (measured: `ftyp free mdat` on one 582 MB title)
 * has its tail request answered as if the file were two megabytes.
 */
function media_probe_total(string $target): int
{
    $total = 0;
    $ch = curl_init($target);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_RANGE => '0-0',
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$total): int {
            if (preg_match('#^content-range:\s*bytes\s+\d+-\d+/(\d+)#i', rtrim($line, "\r\n"), $m)) {
                $total = (int) $m[1];
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $data): int {
            return strlen($data);
        },
    ]);
    curl_exec($ch);
    curl_close($ch);
    return $total;
}

/** True when the film's `moov` sits at the front, so the opening is enough. */
function media_is_faststart(string $headFile): bool
{
    $handle = @fopen($headFile, 'rb');
    if (!$handle) {
        return false;
    }
    $chunk = (string) fread($handle, 1048576);
    fclose($handle);
    return $chunk !== '' && strpos($chunk, 'moov') !== false;
}

function serve_media(string $target): void
{
    $dir = media_cache_dir();
    // v2: entries written before the length was measured correctly claimed a
    // two-megabyte film and served a wrong Content-Range, so they are ignored.
    $key = sha1('v2|' . $target);
    $headFile = $dir . '/' . $key . '.head';
    $metaFile = $dir . '/' . $key . '.json';

    // One writer per stream: a player opens several range requests at once and
    // they would otherwise append into the same file twice.
    $lock = @fopen($dir . '/' . $key . '.lock', 'c');
    $writer = $lock ? flock($lock, LOCK_EX | LOCK_NB) : false;

    $meta = null;
    if (is_file($headFile) && is_file($metaFile)) {
        $meta = json_decode((string) @file_get_contents($metaFile), true);
        if (!is_array($meta) || (int) ($meta['head'] ?? -1) !== (int) @filesize($headFile)) {
            $meta = null;
        }
    }
    $headLen = $meta ? (int) $meta['head'] : 0;
    $total = $meta ? (int) $meta['total'] : 0;
    $type = $meta && !empty($meta['type']) ? (string) $meta['type'] : 'video/mp4';
    $faststart = $meta ? (bool) ($meta['faststart'] ?? false) : false;
    if ($meta) {
        @touch($headFile);
    }
    $range = trim((string) ($_SERVER['HTTP_RANGE'] ?? ''));
    // Only a bounded or mid-file request needs the exact length: a player's first
    // `bytes=0-` is answered without one, so a cold open must not pay for a probe.
    if ($total <= 0) {
        $total = media_probe_total($target);
    }
    $openEnded = $range === '' || (bool) preg_match('#^bytes=\d+-$#', $range);
    $start = 0;
    $last = $total > 0 ? $total - 1 : null;
    if ($range !== '' && preg_match('#bytes=(\d*)-(\d*)#', $range, $m)) {
        $start = $m[1] === '' ? 0 : (int) $m[1];
        $openEnded = $m[2] === '';
        if ($openEnded) {
            $last = $total > 0 ? $total - 1 : null;
        } else {
            $last = $total > 0 ? min((int) $m[2], $total - 1) : (int) $m[2];
        }
    }
    if ($total > 0 && ($start >= $total || ($last !== null && $start > $last))) {
        http_response_code(416);
        header('Content-Range: bytes */' . $total);
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return;
    }

    $state = [
        'sent' => false,
        'start' => $start,
        'last' => $last,
        'total' => $total,
        'type' => $type,
        'open' => $openEnded,
        'cache' => null,
        'left' => 0,
        'status' => 0,
        'fast' => $faststart,
    ];

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        media_send_headers($start, $last, $total, $type, $openEnded, $faststart);
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return;
    }

    // 1. Whatever the disk already holds goes out first — the warm path.
    $servedTo = $start - 1;
    if ($headLen > 0 && $start < $headLen) {
        media_send_headers($start, $last, $total, $type, $openEnded, $faststart);
        $state['sent'] = true;
        $localEnd = min($headLen - 1, $last === null ? $headLen - 1 : $last);
        $handle = @fopen($headFile, 'rb');
        if ($handle) {
            fseek($handle, $start);
            // 256 KB writes measured twice the throughput of fpassthru and of
            // 1 MB writes on this host (224 KB/s versus 458 KB/s).
            $pos = $start;
            while ($pos <= $localEnd && !feof($handle) && !connection_aborted()) {
                $chunk = fread($handle, (int) min(262144, $localEnd - $pos + 1));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                flush();
                $pos += strlen($chunk);
            }
            fclose($handle);
            $servedTo = $pos - 1;
        }
    }

    if ($last !== null && $servedTo >= $last) {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return;
    }

    // 2. The remainder streams from the panel, and the bytes that belong to the
    //    head are written into the cache while they travel.
    $from = $servedTo + 1;
    if ($writer && $from === $headLen && $headLen < MEDIA_HEAD_BYTES) {
        $append = @fopen($headFile, 'ab');
        if ($append) {
            $state['cache'] = $append;
            $state['left'] = MEDIA_HEAD_BYTES - $headLen;
        }
    }

    $ch = curl_init($target);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_RANGE => $last === null ? $from . '-' : $from . '-' . $last,
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$state): int {
            $trimmed = rtrim($line, "\r\n");
            // Some panels answer a film with a redirect to a second server. The
            // hop's headers describe the redirect, not the film, so they are
            // ignored and its body is dropped below.
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $trimmed, $m)) {
                $state['status'] = (int) $m[1];
                return strlen($line);
            }
            if ($state['status'] !== 200 && $state['status'] !== 206) {
                return strlen($line);
            }
            if (preg_match('#^content-range:\s*bytes\s+\d+-\d+/(\d+)#i', $trimmed, $m)) {
                if ((int) $state['total'] <= 0) {
                    $state['total'] = (int) $m[1];
                }
            } elseif (preg_match('#^content-length:\s*(\d+)#i', $trimmed, $m)) {
                // A bounded response's length is the size of that slice, never
                // the size of the film — using it made the bridge promise a
                // range inside a two-megabyte film and players refused it.
                if ((int) $state['total'] <= 0 && (int) $state['start'] === 0 && $state['last'] === null) {
                    $state['total'] = (int) $m[1];
                }
            } elseif (preg_match('#^content-type:\s*(.+)$#i', $trimmed, $m) && stripos($m[1], 'text/html') === false) {
                $state['type'] = trim($m[1]);
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $data) use (&$state): int {
            // Never pass a redirect's or an error page's body to the player, and
            // never write it into the cache: an offset in the middle of a film
            // would then be served from a file that starts with HTML.
            if ($state['status'] !== 200 && $state['status'] !== 206) {
                return strlen($data);
            }
            // The panel's headers arrive before its first body byte, so the
            // real length is known by now and the promise we make is exact.
            if (!$state['sent']) {
                media_send_headers(
                    (int) $state['start'],
                    $state['last'],
                    (int) $state['total'],
                    (string) $state['type'],
                    (bool) $state['open'],
                    (bool) $state['fast']
                );
                $state['sent'] = true;
            }
            if ($state['cache']) {
                $take = min(strlen($data), (int) $state['left']);
                if ($take > 0) {
                    @fwrite($state['cache'], $take === strlen($data) ? $data : substr($data, 0, $take));
                    $state['left'] -= $take;
                }
                if ((int) $state['left'] <= 0 || $take < strlen($data)) {
                    @fclose($state['cache']);
                    $state['cache'] = null;
                }
            }
            if (connection_aborted()) {
                // The viewer closed the tab or seeked away. Stop pulling from the
                // panel instead of holding this socket to the last byte: several
                // abandoned transfers per host exhaust the player's connections
                // and every later stream then waits for one that never ends.
                return 0;
            }
            echo $data;
            flush();
            return strlen($data);
        },
    ]);
    curl_exec($ch);
    curl_close($ch);

    // Nothing usable came back (a dead id answers 403, a dead source 502). Say
    // so instead of ending the request with an empty 200 the player waits on.
    if (!$state['sent'] && !headers_sent()) {
        http_response_code((int) $state['status'] >= 400 ? (int) $state['status'] : 502);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: private, max-age=0');
        echo 'stream unavailable';
    }

    if ($state['cache']) {
        @fclose($state['cache']);
        $state['cache'] = null;
    }
    if ($writer) {
        $head = (int) @filesize($headFile);
        if ($head > 0) {
            @file_put_contents($metaFile, json_encode([
                'total' => (int) $state['total'] > $head ? (int) $state['total'] : 0,
                'head' => $head,
                'type' => (string) $state['type'],
                'faststart' => media_is_faststart($headFile),
            ]));
            prune_media_cache($dir);
        }
    }
    if ($lock) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
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
