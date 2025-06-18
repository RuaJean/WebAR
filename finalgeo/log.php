<?php
// log.php - endpoint para recopilar registros desde el cliente WebXR
// Guarda cada línea en logs.txt dentro del mismo directorio.

date_default_timezone_set('UTC');
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(400);
    echo 'No data';
    exit;
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo 'Invalid JSON';
    exit;
}
$level   = $data['level']   ?? 'log';
$message = $data['message'] ?? '';
$time    = date('c');
$line    = "[$time][$level] $message\n";
file_put_contents(__DIR__ . '/logs.txt', $line, FILE_APPEND | LOCK_EX);
echo 'OK'; 