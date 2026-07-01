use encoding_rs::GBK;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{
    http::{Request, Response},
    AppHandle, Emitter, Manager,
};

const CONFIG_FILE: &str = "config.json";
const CORS_EXPOSE_HEADERS: &str = "Accept-Ranges, Content-Encoding, Content-Length, Content-Range";
const GEOREF_SIDECAR_NAME: &str = "georef-sidecar";
const MAX_FULL_PDF_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PDF_RANGE_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const GEOREF_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_GEOREF_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const GEOREF_CACHE_DIR: &str = "georef-cache";
const GEOREF_CACHE_VERSION: &str = "reference-symbol-matcher-v2";
const GEOREF_PRELOAD_BATCH_SIZE: usize = 16;
const GEOREF_PRELOAD_MAX_WORKERS: usize = 4;

#[derive(Default)]
struct PdfPathCache {
    paths: Mutex<HashMap<String, PathBuf>>,
}

/// Shared state for the GDL90 UDP listener thread.
struct Gdl90State {
    /// Port currently being listened on (0 = stopped).
    port: AtomicU16,
    /// Signal the listener thread to stop.
    stop: AtomicBool,
    /// Bumped every time a listener is (re)started or stopped. Each thread
    /// captures the generation it was spawned with and exits as soon as the
    /// shared value moves past it, so a restart can never leave the previous
    /// thread alive racing on an overlapping socket.
    generation: AtomicU64,
}

#[derive(Default)]
struct GeorefPreloadState {
    running: AtomicBool,
    use_multiprocess: AtomicBool,
    worker_count: AtomicUsize,
    started_jobs: AtomicUsize,
    active_jobs: AtomicUsize,
    total_jobs: AtomicUsize,
    processed_jobs: AtomicUsize,
    failed_jobs: AtomicUsize,
}

impl Default for Gdl90State {
    fn default() -> Self {
        Self {
            port: AtomicU16::new(0),
            stop: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        }
    }
}

// ── GDL90 parsing ────────────────────────────────────────────────────────────

/// CRC-CCITT (polynomial 0x1021).
fn gdl90_crc16(data: &[u8]) -> u16 {
    static TABLE: std::sync::OnceLock<[u16; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u16; 256];
        for (i, entry) in t.iter_mut().enumerate() {
            let mut crc: u16 = (i as u16) << 8;
            for _ in 0..8 {
                crc = if crc & 0x8000 != 0 {
                    (crc << 1) ^ 0x1021
                } else {
                    crc << 1
                };
            }
            *entry = crc;
        }
        t
    });
    let mut crc: u16 = 0;
    for &b in data {
        crc = table[((crc >> 8) & 0xff) as usize] ^ ((crc << 8) & 0xffff) ^ b as u16;
    }
    crc
}

/// Remove HDLC byte stuffing.
fn gdl90_unstuff(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == 0x7d {
            i += 1;
            if i < raw.len() {
                out.push(raw[i] ^ 0x20);
            }
        } else {
            out.push(raw[i]);
        }
        i += 1;
    }
    out
}

/// Signed 24-bit from big-endian bytes.
fn s24(a: u8, b: u8, c: u8) -> i32 {
    let u = ((a as u32) << 16) | ((b as u32) << 8) | (c as u32);
    if u >= 0x80_0000 {
        u as i32 - 0x100_0000
    } else {
        u as i32
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnshipPosition {
    lat: f64,
    lon: f64,
    altitude_ft: Option<f64>,
    track_deg: Option<f64>,
    ground_speed_kt: Option<f64>,
}

/// Parse a GDL90 Ownship Report body (27 bytes after msgID).
fn decode_ownship_body(body: &[u8]) -> Option<OwnshipPosition> {
    if body.len() < 27 {
        return None;
    }
    let lat = s24(body[4], body[5], body[6]) as f64 * (180.0 / 0x80_0000 as f64);
    let lon = s24(body[7], body[8], body[9]) as f64 * (180.0 / 0x80_0000 as f64);
    let alt_raw = ((body[10] as u16) << 4) | ((body[11] >> 4) as u16);
    let altitude_ft = if alt_raw == 0xfff {
        None
    } else {
        Some(alt_raw as f64 * 25.0 - 1000.0)
    };
    let misc = body[11] & 0x0f;
    let track_valid = (misc & 0x03) != 0;
    let gs_raw = ((body[13] as u16) << 4) | ((body[14] >> 4) as u16);
    let ground_speed_kt = if gs_raw == 0xfff {
        None
    } else {
        Some(gs_raw as f64)
    };
    let track_deg = if track_valid {
        Some(body[16] as f64 / 256.0 * 360.0)
    } else {
        None
    };
    let nic = (body[12] >> 4) & 0x0f;
    if nic == 0 && lat == 0.0 && lon == 0.0 {
        return None;
    }
    Some(OwnshipPosition {
        lat,
        lon,
        altitude_ft,
        track_deg,
        ground_speed_kt,
    })
}

/// Scan a UDP datagram for the first valid GDL90 Ownship Report (msg 10).
fn parse_gdl90_datagram(buf: &[u8]) -> Option<OwnshipPosition> {
    let mut i = 0;
    while i < buf.len() {
        if buf[i] != 0x7e {
            i += 1;
            continue;
        }
        let frame_start = i + 1;
        i += 1;
        while i < buf.len() && buf[i] != 0x7e {
            i += 1;
        }
        if i >= buf.len() {
            break;
        }
        let between = &buf[frame_start..i];
        i += 1;
        if between.len() < 3 {
            continue;
        }
        let clear = gdl90_unstuff(between);
        if clear.len() < 3 {
            continue;
        }
        let payload = &clear[..clear.len() - 2];
        let fcs_lo = clear[clear.len() - 2];
        let fcs_hi = clear[clear.len() - 1];
        if gdl90_crc16(payload) != ((fcs_hi as u16) << 8 | fcs_lo as u16) {
            continue;
        }
        if payload.is_empty() {
            continue;
        }
        if (payload[0] & 0x7f) == 10 && payload.len() >= 28 {
            if let Some(pos) = decode_ownship_body(&payload[1..]) {
                return Some(pos);
            }
        }
    }
    None
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Start listening for GDL90 UDP packets on `port` and emit
/// `"gdl90-position"` events to the frontend. Calling this again with a
/// different port (or with port=0 to stop) first stops the previous listener.
#[tauri::command]
fn start_gdl90_listener(app: AppHandle, port: u16) -> Result<(), String> {
    let state = app.state::<Arc<Gdl90State>>();
    // Invalidate any existing listener: bumping the generation makes the
    // previous thread (if any) exit on its next loop iteration regardless of
    // how the stop flag is toggled below.
    let my_gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.stop.store(true, Ordering::SeqCst);
    if port == 0 {
        state.port.store(0, Ordering::SeqCst);
        return Ok(());
    }
    let socket = UdpSocket::bind(format!("0.0.0.0:{port}"))
        .map_err(|e| format!("Cannot bind UDP port {port}: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|e| format!("set_read_timeout: {e}"))?;
    state.stop.store(false, Ordering::SeqCst);
    state.port.store(port, Ordering::SeqCst);
    let stop_flag = Arc::clone(&*state);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if stop_flag.stop.load(Ordering::SeqCst)
                || stop_flag.generation.load(Ordering::SeqCst) != my_gen
            {
                break;
            }
            match socket.recv(&mut buf) {
                Ok(n) => {
                    if let Some(pos) = parse_gdl90_datagram(&buf[..n]) {
                        let _ = app.emit("gdl90-position", &pos);
                    }
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_gdl90_listener(app: AppHandle) {
    let state = app.state::<Arc<Gdl90State>>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.stop.store(true, Ordering::SeqCst);
    state.port.store(0, Ordering::SeqCst);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    charts_directory: String,
    csv_directory: String,
    #[serde(default = "default_gdl90_port")]
    gdl90_port: u16,
    #[serde(default = "default_preload_georeferences")]
    preload_georeferences: bool,
}

fn default_gdl90_port() -> u16 {
    4000
}
fn default_preload_georeferences() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            charts_directory: "charts".to_string(),
            csv_directory: "csv".to_string(),
            gdl90_port: default_gdl90_port(),
            preload_georeferences: default_preload_georeferences(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartSource {
    format: String,
    airport_icao: Option<String>,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartSourcesResponse {
    sources: Vec<ChartSource>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeorefPageResult {
    page: u32,
    georeferenced: bool,
    transform: Option<[f64; 6]>,
    #[serde(alias = "transform_type")]
    transform_type: Option<String>,
    #[serde(alias = "high_accuracy_transform")]
    high_accuracy_transform: Option<serde_json::Value>,
    #[serde(alias = "page_width")]
    page_width: f64,
    #[serde(alias = "page_height")]
    page_height: f64,
    #[serde(alias = "rmse_meters")]
    rmse_meters: Option<f64>,
    #[serde(alias = "max_error_meters")]
    max_error_meters: Option<f64>,
    #[serde(alias = "inlier_count")]
    inlier_count: Option<u32>,
    #[serde(alias = "control_point_count")]
    control_point_count: u32,
    #[serde(alias = "control_points")]
    control_points: Option<serde_json::Value>,
    #[serde(alias = "vector_paths")]
    vector_paths: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeorefResult {
    chart_id: String,
    pages: Vec<GeorefPageResult>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeorefPreloadRequest {
    #[allow(dead_code)]
    chart_id: String,
    file_path: String,
    #[serde(default)]
    waypoint_file_paths: Vec<String>,
    page_number: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeorefCacheStatus {
    ready: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeorefCacheSummary {
    ready: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeorefPreloadStatus {
    running: bool,
    use_multiprocess: bool,
    worker_count: usize,
    started_jobs: usize,
    active_jobs: usize,
    total_jobs: usize,
    processed_jobs: usize,
    failed_jobs: usize,
}

fn response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
        .header("Access-Control-Allow-Headers", "Range")
        .header("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS)
        .body(body)
        .unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap())
}

fn pdf_response(
    status: u16,
    body: Vec<u8>,
    content_range: Option<String>,
    content_length: u64,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", "application/pdf")
        .header("Accept-Ranges", "bytes")
        .header("Content-Encoding", "identity")
        .header("Content-Length", content_length.to_string())
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
        .header("Access-Control-Allow-Headers", "Range")
        .header("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);

    if let Some(content_range) = content_range {
        builder = builder.header("Content-Range", content_range);
    }

    builder
        .body(body)
        .unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap())
}

fn app_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(CONFIG_FILE))
}

fn read_config(app: &AppHandle) -> AppConfig {
    let Ok(path) = app_config_path(app) else {
        return AppConfig::default();
    };

    let Ok(content) = fs::read_to_string(path) else {
        return AppConfig::default();
    };

    let Ok(saved) = serde_json::from_str::<AppConfig>(&content) else {
        return AppConfig::default();
    };

    AppConfig {
        charts_directory: if saved.charts_directory.is_empty() {
            AppConfig::default().charts_directory
        } else {
            saved.charts_directory
        },
        csv_directory: if saved.csv_directory.is_empty() {
            AppConfig::default().csv_directory
        } else {
            saved.csv_directory
        },
        gdl90_port: saved.gdl90_port,
        preload_georeferences: saved.preload_georeferences,
    }
}

fn resolve_config_path(dir_path: &str) -> PathBuf {
    let path = PathBuf::from(dir_path);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn validate_directory(label: &str, dir_path: &str) -> Result<(), String> {
    let resolved = resolve_config_path(dir_path);
    let metadata =
        fs::metadata(&resolved).map_err(|error| format!("{label} directory: {}", error))?;

    if !metadata.is_dir() {
        return Err(format!("{label} directory: Path is not a directory"));
    }

    fs::read_dir(&resolved).map_err(|error| format!("{label} directory: {}", error))?;

    Ok(())
}

fn decode_csv_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);

    if let Ok(content) = std::str::from_utf8(bytes) {
        return content.to_string();
    }

    let (content, _, _) = GBK.decode(bytes);
    content.into_owned()
}

fn airport_icao_from_dir_name(path: &Path) -> Option<String> {
    let dir_name = path.file_name()?.to_string_lossy();
    let trimmed = dir_name.trim();

    if trimmed.len() == 4 && trimmed.chars().all(|ch| ch.is_ascii_alphabetic()) {
        Some(trimmed.to_uppercase())
    } else {
        None
    }
}

fn detect_format(csv_dir: &Path) -> &'static str {
    let charts_csv = csv_dir.join("Charts.csv");
    let Ok(buffer) = fs::read(charts_csv) else {
        return "new";
    };

    let content = decode_csv_text(&buffer);
    let trimmed = content.trim();
    let lines: Vec<&str> = trimmed.lines().collect();

    if lines.len() <= 1 {
        return "new";
    }

    if lines
        .first()
        .map(|header| header.to_lowercase().contains("airporticao"))
        .unwrap_or(false)
    {
        "old"
    } else {
        "new"
    }
}

fn load_old_format(csv_dir: &Path) -> Result<Vec<ChartSource>, String> {
    let buffer = fs::read(csv_dir.join("Charts.csv")).map_err(|error| error.to_string())?;
    Ok(vec![ChartSource {
        format: "old".to_string(),
        airport_icao: None,
        content: decode_csv_text(&buffer),
    }])
}

fn load_new_format(csv_dir: &Path) -> Result<Vec<ChartSource>, String> {
    let entries = fs::read_dir(csv_dir).map_err(|error| error.to_string())?;
    let mut sources = Vec::new();

    if let Some(airport_icao) = airport_icao_from_dir_name(csv_dir) {
        if let Ok(buffer) = fs::read(csv_dir.join("Charts.csv")) {
            sources.push(ChartSource {
                format: "new".to_string(),
                airport_icao: Some(airport_icao),
                content: decode_csv_text(&buffer),
            });
        }
    }

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let airport_icao = entry.file_name().to_string_lossy().to_string();
        let charts_csv = entry.path().join("Charts.csv");
        let Ok(buffer) = fs::read(charts_csv) else {
            continue;
        };

        sources.push(ChartSource {
            format: "new".to_string(),
            airport_icao: Some(airport_icao),
            content: decode_csv_text(&buffer),
        });
    }

    Ok(sources)
}

fn load_sources_from_directory(csv_dir: &Path) -> Vec<ChartSource> {
    let result = if detect_format(csv_dir) == "old" {
        load_old_format(csv_dir)
    } else {
        load_new_format(csv_dir)
    };

    result.unwrap_or_default()
}

fn canonical_base(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

fn existing_safe_path(base_dir: &Path, relative_path: &Path) -> Option<PathBuf> {
    let base = canonical_base(base_dir)?;
    let candidate = base_dir.join(relative_path);
    let canonical_candidate = candidate.canonicalize().ok()?;

    if canonical_candidate.starts_with(base) {
        Some(canonical_candidate)
    } else {
        None
    }
}

fn find_pdf_path(charts_dir: &Path, filename: &str) -> Option<PathBuf> {
    let mut filenames = vec![filename.to_string()];

    if filename.contains('_') {
        filenames.push(filename.replace('_', "/"));
        filenames.push(filename.replace('_', ""));
    }

    for try_filename in filenames {
        if try_filename.len() >= 5
            && try_filename.as_bytes().get(4) == Some(&b'-')
            && try_filename
                .chars()
                .take(4)
                .all(|ch| ch.is_ascii_uppercase())
        {
            let icao_code = &try_filename[0..4];
            let nested = Path::new(icao_code).join(&try_filename);
            if let Some(path) = existing_safe_path(charts_dir, &nested) {
                return Some(path);
            }
        }

        if let Some(path) = existing_safe_path(charts_dir, Path::new(&try_filename)) {
            return Some(path);
        }

        let Ok(entries) = fs::read_dir(charts_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            let nested = Path::new(&entry.file_name()).join(&try_filename);
            if let Some(path) = existing_safe_path(charts_dir, &nested) {
                return Some(path);
            }
        }
    }

    None
}

fn cache_key(charts_dir: &Path, filename: &str) -> String {
    format!("{}:{filename}", charts_dir.display())
}

fn cached_pdf_path(app: &AppHandle, charts_dir: &Path, filename: &str) -> Option<PathBuf> {
    let key = cache_key(charts_dir, filename);
    let cache = app.state::<PdfPathCache>();

    if let Ok(paths) = cache.paths.lock() {
        if let Some(path) = paths.get(&key) {
            if path.is_file() {
                return Some(path.clone());
            }
        }
    }

    let path = find_pdf_path(charts_dir, filename)?;

    if let Ok(mut paths) = cache.paths.lock() {
        paths.insert(key, path.clone());
    }

    Some(path)
}

#[derive(Debug)]
enum RangeRequest {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

fn parse_range_header(range_header: Option<&str>, file_len: u64) -> RangeRequest {
    let Some(range_header) = range_header else {
        return RangeRequest::Full;
    };

    if file_len == 0 {
        return RangeRequest::Full;
    }

    let Some(range_spec) = range_header.trim().strip_prefix("bytes=") else {
        return RangeRequest::Full;
    };

    if range_spec.contains(',') {
        return RangeRequest::Full;
    }

    let Some((start_part, end_part)) = range_spec.split_once('-') else {
        return RangeRequest::Full;
    };

    if start_part.is_empty() {
        let Ok(suffix_len) = end_part.parse::<u64>() else {
            return RangeRequest::Full;
        };

        if suffix_len == 0 {
            return RangeRequest::Unsatisfiable;
        }

        let start = file_len.saturating_sub(suffix_len);
        return RangeRequest::Partial {
            start,
            end: file_len - 1,
        };
    }

    let Ok(start) = start_part.parse::<u64>() else {
        return RangeRequest::Full;
    };

    if start >= file_len {
        return RangeRequest::Unsatisfiable;
    }

    let end = if end_part.is_empty() {
        file_len - 1
    } else {
        let Ok(end) = end_part.parse::<u64>() else {
            return RangeRequest::Full;
        };
        end.min(file_len - 1)
    };

    if end < start {
        return RangeRequest::Unsatisfiable;
    }

    RangeRequest::Partial { start, end }
}

fn serve_pdf_file(pdf_path: &Path, range_header: Option<&str>) -> Response<Vec<u8>> {
    let server_error = || {
        response(
            500,
            "text/plain; charset=utf-8",
            b"Failed to load PDF".to_vec(),
        )
    };

    // Open the file once and derive its length from the open descriptor. Reading
    // through this same handle guarantees the Content-Length / Content-Range we
    // advertise matches the bytes we actually return, even if the file is
    // truncated or replaced between stat and read.
    let Ok(mut file) = File::open(pdf_path) else {
        return server_error();
    };
    let Ok(metadata) = file.metadata() else {
        return server_error();
    };
    let file_len = metadata.len();

    match parse_range_header(range_header, file_len) {
        RangeRequest::Full => {
            if file_len > MAX_FULL_PDF_RESPONSE_BYTES {
                return response(
                    413,
                    "text/plain; charset=utf-8",
                    b"PDF is too large for a full response; retry with byte ranges".to_vec(),
                );
            }

            let mut bytes = Vec::new();
            match file.read_to_end(&mut bytes) {
                Ok(_) => {
                    let len = bytes.len() as u64;
                    pdf_response(200, bytes, None, len)
                }
                Err(_) => server_error(),
            }
        }
        RangeRequest::Unsatisfiable => Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{file_len}"))
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .header("Access-Control-Allow-Headers", "Range")
            .header("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap()),
        RangeRequest::Partial { start, end } => {
            let byte_count = end - start + 1;
            if byte_count > MAX_PDF_RANGE_RESPONSE_BYTES {
                return response(
                    413,
                    "text/plain; charset=utf-8",
                    b"Requested PDF range is too large".to_vec(),
                );
            }

            let Ok(byte_count_usize) = usize::try_from(byte_count) else {
                return response(
                    416,
                    "text/plain; charset=utf-8",
                    b"Requested range is too large".to_vec(),
                );
            };

            let mut body = vec![0; byte_count_usize];
            let read_result = file
                .seek(SeekFrom::Start(start))
                .and_then(|_| file.read_exact(&mut body));

            match read_result {
                Ok(()) => pdf_response(
                    206,
                    body,
                    Some(format!("bytes {start}-{end}/{file_len}")),
                    byte_count,
                ),
                Err(_) => server_error(),
            }
        }
    }
}

fn read_limited_output<R: Read>(mut reader: R, limit: usize) -> Vec<u8> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }

        let remaining = limit.saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..read.min(remaining)]);
        }
    }

    output
}

fn join_output(handle: thread::JoinHandle<Vec<u8>>) -> Vec<u8> {
    handle.join().unwrap_or_default()
}

fn run_georef_command_with_limits(cmd: &mut Command, timeout: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to run georef runtime: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture georef stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture georef stderr".to_string())?;
    let stdout_thread = thread::spawn(move || read_limited_output(stdout, MAX_GEOREF_OUTPUT_BYTES));
    let stderr_thread = thread::spawn(move || read_limited_output(stderr, MAX_GEOREF_OUTPUT_BYTES));
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(Output {
                    status,
                    stdout: join_output(stdout_thread),
                    stderr: join_output(stderr_thread),
                });
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_output(stdout_thread);
                let stderr = String::from_utf8_lossy(&join_output(stderr_thread)).to_string();
                return Err(format!(
                    "Georef runtime timed out after {} seconds{}",
                    timeout.as_secs(),
                    if stderr.is_empty() {
                        String::new()
                    } else {
                        format!(": {stderr}")
                    }
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_output(stdout_thread);
                let _ = join_output(stderr_thread);
                return Err(format!("Failed to wait for georef runtime: {error}"));
            }
        }
    }
}

fn handle_pdf_request(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method().as_str() == "OPTIONS" {
        return response(204, "text/plain; charset=utf-8", Vec::new());
    }

    let encoded_filename = request.uri().path().trim_start_matches('/').trim();
    let Ok(filename) = percent_decode_str(encoded_filename).decode_utf8() else {
        return response(
            400,
            "text/plain; charset=utf-8",
            b"Invalid PDF path".to_vec(),
        );
    };

    let filename = filename.trim();
    if filename.is_empty() {
        return response(
            400,
            "text/plain; charset=utf-8",
            b"Missing PDF filename".to_vec(),
        );
    }

    let config = read_config(app);
    let charts_dir = resolve_config_path(&config.charts_directory);
    let Some(pdf_path) = cached_pdf_path(app, &charts_dir, filename) else {
        return response(
            404,
            "text/plain; charset=utf-8",
            b"PDF file not found".to_vec(),
        );
    };

    let range_header = request
        .headers()
        .get("Range")
        .and_then(|value| value.to_str().ok());

    serve_pdf_file(&pdf_path, range_header)
}

#[tauri::command]
fn get_config(app: AppHandle) -> AppConfig {
    read_config(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let mut errors = Vec::new();

    if let Err(error) = validate_directory("Charts", &config.charts_directory) {
        errors.push(error);
    }

    if let Err(error) = validate_directory("CSV", &config.csv_directory) {
        errors.push(error);
    }

    if !errors.is_empty() {
        return Err(format!("Invalid directories: {}", errors.join(", ")));
    }

    let config_path = app_config_path(&app)?;
    let content = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(config_path, content).map_err(|error| error.to_string())?;

    if let Ok(mut paths) = app.state::<PdfPathCache>().paths.lock() {
        paths.clear();
    }

    Ok(config)
}

#[tauri::command]
fn read_chart_sources(app: AppHandle) -> ChartSourcesResponse {
    let config = read_config(&app);
    let csv_dir = resolve_config_path(&config.csv_directory);
    let charts_dir = resolve_config_path(&config.charts_directory);

    let primary_sources = load_sources_from_directory(&csv_dir);
    let sources = if !primary_sources.is_empty() || csv_dir == charts_dir {
        primary_sources
    } else {
        load_sources_from_directory(&charts_dir)
    };

    ChartSourcesResponse { sources }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AirportCoord {
    icao: String,
    lat: f64,
    lon: f64,
}

fn parse_dms_to_decimal(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let mut chars = s.chars();
    let hemi = chars.next()?;
    let digits: String = chars.filter(|c| c.is_ascii_digit()).collect();
    let (deg_digits, sign) = match hemi {
        'N' | 'n' => (2usize, 1.0f64),
        'S' | 's' => (2, -1.0),
        'E' | 'e' => (3, 1.0),
        'W' | 'w' => (3, -1.0),
        _ => return None,
    };
    if digits.len() < deg_digits {
        return None;
    }
    let deg: f64 = digits[..deg_digits].parse().ok()?;
    let min: f64 = if digits.len() >= deg_digits + 2 {
        digits[deg_digits..deg_digits + 2].parse().ok()?
    } else {
        0.0
    };
    let sec: f64 = if digits.len() >= deg_digits + 4 {
        digits[deg_digits + 2..deg_digits + 4].parse().ok()?
    } else {
        0.0
    };
    Some(sign * (deg + min / 60.0 + sec / 3600.0))
}

fn load_airport_coords_from_csv(csv_dir: &Path) -> Vec<AirportCoord> {
    for filename in &["AD_HP.csv", "airport.csv", "Airport.csv"] {
        let path = csv_dir.join(filename);
        let Ok(buffer) = fs::read(&path) else {
            continue;
        };
        let content = decode_csv_text(&buffer);
        let mut lines = content.lines();
        let header_line = match lines.next() {
            Some(h) => h,
            None => continue,
        };
        let headers: Vec<&str> = header_line.split(',').collect();
        let find_col = |keywords: &[&str]| -> Option<usize> {
            headers.iter().position(|h| {
                let h = h.trim().to_lowercase();
                keywords.iter().any(|kw| h.contains(kw))
            })
        };
        let icao_col = find_col(&["code_id", "icao", "ident"]);
        let lat_col = find_col(&["geo_lat", "lat_accuracy"]);
        let lon_col = find_col(&["geo_lon", "geo_long", "lon_accuracy", "long_accuracy"]);
        let (Some(icao_col), Some(lat_col), Some(lon_col)) = (icao_col, lat_col, lon_col) else {
            continue;
        };
        let mut coords = Vec::new();
        for line in lines {
            let fields: Vec<&str> = line.split(',').collect();
            let icao = fields.get(icao_col).unwrap_or(&"").trim().to_uppercase();
            if icao.len() != 4 || !icao.chars().all(|c| c.is_ascii_alphanumeric()) {
                continue;
            }
            let lat_raw = fields.get(lat_col).unwrap_or(&"").trim();
            let lon_raw = fields.get(lon_col).unwrap_or(&"").trim();
            let (Some(lat), Some(lon)) =
                (parse_dms_to_decimal(lat_raw), parse_dms_to_decimal(lon_raw))
            else {
                continue;
            };
            coords.push(AirportCoord { icao, lat, lon });
        }
        if !coords.is_empty() {
            return coords;
        }
    }
    Vec::new()
}

#[tauri::command]
fn read_airport_coords(app: AppHandle) -> Vec<AirportCoord> {
    let config = read_config(&app);
    let csv_dir = resolve_config_path(&config.csv_directory);
    let mut coords = load_airport_coords_from_csv(&csv_dir);
    if coords.is_empty() {
        let charts_dir = resolve_config_path(&config.charts_directory);
        coords = load_airport_coords_from_csv(&charts_dir);
    }
    coords
}

fn locate_georef_script(app: &AppHandle) -> Option<PathBuf> {
    // Allow override via env var for development convenience.
    if cfg!(debug_assertions) {
        if let Ok(env_path) = std::env::var("GEOREF_SCRIPT_PATH") {
            let p = PathBuf::from(env_path);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    // Bundled resource path. Tauri may preserve the configured relative path.
    if let Ok(resource_dir) = app.path().resource_dir() {
        for p in [
            resource_dir.join("georef_script.py"),
            resource_dir.join("resources").join("georef_script.py"),
        ] {
            if p.is_file() {
                return Some(p);
            }
        }
    }

    // Development fallbacks for `tauri dev`, regardless of whether the process
    // starts from the repository root or the Rust crate directory.
    for p in [
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("georef_script.py"),
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("src-tauri")
            .join("resources")
            .join("georef_script.py"),
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("resources")
            .join("georef_script.py"),
    ] {
        if p.is_file() {
            return Some(p);
        }
    }

    None
}

fn georef_sidecar_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "georef-sidecar.exe"
    } else {
        GEOREF_SIDECAR_NAME
    }
}

fn locate_georef_sidecar() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        if let Ok(env_path) = std::env::var("GEOREF_SIDECAR_PATH") {
            let p = PathBuf::from(env_path);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;
    let p = exe_dir.join(georef_sidecar_file_name());
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn file_fingerprint(path: &Path) -> String {
    let Ok(metadata) = fs::metadata(path) else {
        return format!("missing:{}", path.display());
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| format!("{}:{}", duration.as_secs(), duration.subsec_nanos()))
        .unwrap_or_else(|| "unknown".to_string());
    format!("{}:{}:{modified}", path.display(), metadata.len())
}

fn georef_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(GEOREF_CACHE_DIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn georef_cache_key(
    pdf_path: &Path,
    csv_dir: &Path,
    waypoint_paths: &[PathBuf],
    page_number: Option<u32>,
) -> String {
    let mut hasher = DefaultHasher::new();
    GEOREF_CACHE_VERSION.hash(&mut hasher);
    file_fingerprint(pdf_path).hash(&mut hasher);
    csv_dir.display().to_string().hash(&mut hasher);
    for filename in &["DESIGNATED_POINT.csv", "VOR.csv"] {
        file_fingerprint(&csv_dir.join(filename)).hash(&mut hasher);
    }
    for waypoint_path in waypoint_paths {
        file_fingerprint(waypoint_path).hash(&mut hasher);
    }
    page_number.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn georef_cache_path(
    app: &AppHandle,
    pdf_path: &Path,
    csv_dir: &Path,
    waypoint_paths: &[PathBuf],
    page_number: Option<u32>,
) -> Result<PathBuf, String> {
    Ok(georef_cache_root(app)?.join(format!(
        "{}.json",
        georef_cache_key(pdf_path, csv_dir, waypoint_paths, page_number)
    )))
}

fn read_cached_georef(cache_path: &Path) -> Option<Vec<GeorefPageResult>> {
    let content = fs::read_to_string(cache_path).ok()?;
    serde_json::from_str::<Vec<GeorefPageResult>>(&content).ok()
}

fn write_cached_georef(cache_path: &Path, pages: &[GeorefPageResult]) {
    if let Ok(content) = serde_json::to_string(pages) {
        let _ = fs::write(cache_path, content);
    }
}

fn georef_json_number(value: &serde_json::Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| v.as_f64()))
        .filter(|value| value.is_finite())
}

fn page_has_display_gcp_overlay(page: &GeorefPageResult) -> bool {
    let Some(points) = page
        .control_points
        .as_ref()
        .and_then(|value| value.as_array())
    else {
        return false;
    };

    let used_points: Vec<&serde_json::Value> = points
        .iter()
        .filter(|point| {
            point
                .get("used")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        })
        .collect();
    let source_points: Vec<&serde_json::Value> = if used_points.len() >= 2 {
        used_points
    } else {
        points.iter().collect()
    };

    let mut unique_points: Vec<(f64, f64, f64, f64)> = Vec::new();
    for point in source_points {
        let Some(pdf_x) = georef_json_number(point, &["mupdfX", "mupdf_x"]) else {
            continue;
        };
        let Some(pdf_y) = georef_json_number(point, &["mupdfY", "mupdf_y"]) else {
            continue;
        };
        let Some(lon) = georef_json_number(point, &["lon", "longitude"]) else {
            continue;
        };
        let Some(lat) = georef_json_number(point, &["lat", "latitude"]) else {
            continue;
        };

        let already_seen = unique_points.iter().any(|(_, _, seen_lon, seen_lat)| {
            (seen_lon - lon).abs() < 1e-6 && (seen_lat - lat).abs() < 1e-6
        });
        if !already_seen {
            unique_points.push((pdf_x, pdf_y, lon, lat));
        }
    }

    if unique_points.len() < 2 {
        return false;
    }

    let mut max_pdf_span = 0.0_f64;
    let mut max_world_span = 0.0_f64;
    for index in 0..unique_points.len() {
        let (pdf_x, pdf_y, lon, lat) = unique_points[index];
        for next_index in (index + 1)..unique_points.len() {
            let (next_pdf_x, next_pdf_y, next_lon, next_lat) = unique_points[next_index];
            max_pdf_span = max_pdf_span.max((pdf_x - next_pdf_x).hypot(pdf_y - next_pdf_y));
            max_world_span = max_world_span.max((lon - next_lon).hypot(lat - next_lat));
        }
    }

    max_pdf_span > 1.0 && max_world_span > 1e-6
}

fn resolve_waypoint_paths(
    charts_dir: &Path,
    waypoint_file_paths: Option<Vec<String>>,
    waypoint_file_path: Option<String>,
) -> Vec<PathBuf> {
    let mut waypoint_files = waypoint_file_paths.unwrap_or_default();
    if let Some(wp_file) = waypoint_file_path {
        waypoint_files.push(wp_file);
    }
    waypoint_files.sort();
    waypoint_files.dedup();

    let mut waypoint_paths: Vec<PathBuf> = waypoint_files
        .into_iter()
        .filter_map(|wp_file| find_pdf_path(charts_dir, &wp_file))
        .collect();
    waypoint_paths.sort();
    waypoint_paths.dedup();
    waypoint_paths
}

fn build_georef_command(app: &AppHandle) -> Result<Command, String> {
    let use_dev_script =
        cfg!(debug_assertions) && std::env::var("GEOREF_USE_SIDECAR").ok().as_deref() != Some("1");

    if use_dev_script {
        let script_path = locate_georef_script(app).ok_or_else(|| {
            "georef runtime not found - bundle the sidecar or set GEOREF_SCRIPT_PATH in development"
                .to_string()
        })?;
        let python = std::env::var("GEOREF_PYTHON").unwrap_or_else(|_| "python3".to_string());
        let mut cmd = Command::new(python);
        cmd.arg(script_path);
        Ok(cmd)
    } else if let Some(sidecar_path) = locate_georef_sidecar() {
        Ok(Command::new(sidecar_path))
    } else if !cfg!(debug_assertions) {
        Err("georef sidecar not found in bundled application".to_string())
    } else {
        let script_path = locate_georef_script(app).ok_or_else(|| {
            "georef runtime not found - bundle the sidecar or set GEOREF_SCRIPT_PATH in development"
                .to_string()
        })?;
        let python = std::env::var("GEOREF_PYTHON").unwrap_or_else(|_| "python3".to_string());
        let mut cmd = Command::new(python);
        cmd.arg(script_path);
        Ok(cmd)
    }
}

fn georeference_chart_blocking(
    app: AppHandle,
    chart_id: String,
    file_path: String,
    waypoint_file_paths: Option<Vec<String>>,
    waypoint_file_path: Option<String>,
    page_number: Option<u32>,
) -> Result<GeorefResult, String> {
    let config = read_config(&app);
    let charts_dir = resolve_config_path(&config.charts_directory);
    let csv_dir = resolve_config_path(&config.csv_directory);

    let pdf_path = find_pdf_path(&charts_dir, &file_path)
        .ok_or_else(|| format!("PDF not found: {file_path}"))?;
    let waypoint_paths =
        resolve_waypoint_paths(&charts_dir, waypoint_file_paths, waypoint_file_path);
    let cache_path = georef_cache_path(&app, &pdf_path, &csv_dir, &waypoint_paths, page_number)?;
    if let Some(pages) = read_cached_georef(&cache_path) {
        return Ok(GeorefResult { chart_id, pages });
    }

    let mut cmd = build_georef_command(&app)?;

    cmd.arg("--pdf")
        .arg(&pdf_path)
        .arg("--csv-dir")
        .arg(&csv_dir);

    for waypoint_path in &waypoint_paths {
        cmd.arg("--waypoint-pdf").arg(waypoint_path);
    }

    if let Some(page_number) = page_number {
        cmd.arg("--page").arg(page_number.to_string());
    }

    cmd.env("PYTHONDONTWRITEBYTECODE", "1");

    let output = run_georef_command_with_limits(&mut cmd, GEOREF_TIMEOUT)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Georef runtime error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pages: Vec<GeorefPageResult> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse georef output: {e}"))?;
    write_cached_georef(&cache_path, &pages);

    Ok(GeorefResult { chart_id, pages })
}

#[derive(Debug, Deserialize)]
struct GeorefBatchJobResult {
    id: usize,
    ok: bool,
    #[serde(default)]
    pages: Option<Vec<GeorefPageResult>>,
    #[serde(default)]
    #[allow(dead_code)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeorefBatchOutput {
    results: Vec<GeorefBatchJobResult>,
}

/// A single resolved preload job: a PDF whose georeference is not yet cached.
struct PreloadJob {
    pdf_path: PathBuf,
    waypoint_paths: Vec<PathBuf>,
    page_number: Option<u32>,
    cache_path: PathBuf,
}

struct GeorefBatchStats {
    processed: usize,
    failed: usize,
}

static GEOREF_BATCH_COUNTER: AtomicU64 = AtomicU64::new(0);

fn georef_preload_worker_count(use_multiprocess: bool, job_count: usize) -> usize {
    if job_count == 0 {
        return 0;
    }

    if !use_multiprocess {
        return 1;
    }

    let configured_workers = std::env::var("GEOREF_PRELOAD_WORKERS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0);
    let worker_limit = configured_workers.unwrap_or(GEOREF_PRELOAD_MAX_WORKERS);
    let cores = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(worker_limit);

    cores.min(worker_limit).min(job_count).max(1)
}

/// Run one batch of preload jobs in a single sidecar invocation, then write a
/// per-chart cache file for each job that succeeded. One process startup pays
/// for the whole slice instead of one startup per chart.
fn run_georef_batch(app: &AppHandle, csv_dir: &Path, jobs: &[PreloadJob]) -> GeorefBatchStats {
    if jobs.is_empty() {
        return GeorefBatchStats {
            processed: 0,
            failed: 0,
        };
    }

    let manifest_jobs: Vec<serde_json::Value> = jobs
        .iter()
        .enumerate()
        .map(|(index, job)| {
            let waypoints: Vec<String> = job
                .waypoint_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            serde_json::json!({
                "id": index,
                "pdf": job.pdf_path.to_string_lossy(),
                "waypoint_pdfs": waypoints,
                "page": job.page_number,
            })
        })
        .collect();

    let manifest = serde_json::json!({
        "csv_dir": csv_dir.to_string_lossy(),
        "jobs": manifest_jobs,
    });
    let Ok(manifest_text) = serde_json::to_string(&manifest) else {
        return GeorefBatchStats {
            processed: jobs.len(),
            failed: jobs.len(),
        };
    };

    let unique = GEOREF_BATCH_COUNTER.fetch_add(1, Ordering::SeqCst);
    let manifest_path =
        std::env::temp_dir().join(format!("georef-batch-{}-{unique}.json", std::process::id()));
    if fs::write(&manifest_path, manifest_text).is_err() {
        return GeorefBatchStats {
            processed: jobs.len(),
            failed: jobs.len(),
        };
    }

    let result = (|| -> Result<GeorefBatchOutput, String> {
        let mut cmd = build_georef_command(app)?;
        cmd.arg("--batch").arg(&manifest_path);
        cmd.env("PYTHONDONTWRITEBYTECODE", "1");
        // Process startup is paid once; allow generous per-job headroom.
        let timeout = Duration::from_secs(30 + 20 * jobs.len() as u64);
        let output = run_georef_command_with_limits(&mut cmd, timeout)?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str::<GeorefBatchOutput>(&stdout).map_err(|error| error.to_string())
    })();

    let _ = fs::remove_file(&manifest_path);

    match result {
        Ok(output) => {
            let mut failed = jobs.len().saturating_sub(output.results.len());
            for job_result in output.results {
                if !job_result.ok {
                    if let Some(error) = job_result.error {
                        eprintln!("Georef preload job {} failed: {error}", job_result.id);
                    }
                    failed += 1;
                    continue;
                }
                if let (Some(pages), Some(job)) = (job_result.pages, jobs.get(job_result.id)) {
                    write_cached_georef(&job.cache_path, &pages);
                } else {
                    failed += 1;
                }
            }

            GeorefBatchStats {
                processed: jobs.len(),
                failed,
            }
        }
        Err(error) => {
            eprintln!("Georef preload batch failed: {error}");
            GeorefBatchStats {
                processed: jobs.len(),
                failed: jobs.len(),
            }
        }
    }
}

/// Resolve preload requests to uncached jobs and process them across worker
/// threads, each running its slice as a single batched sidecar invocation.
fn run_georef_preload(
    app: AppHandle,
    requests: Vec<GeorefPreloadRequest>,
    use_multiprocess: bool,
    preload_state: Arc<GeorefPreloadState>,
) {
    let config = read_config(&app);
    let charts_dir = resolve_config_path(&config.charts_directory);
    let csv_dir = resolve_config_path(&config.csv_directory);

    let mut jobs: Vec<PreloadJob> = Vec::new();
    for request in requests {
        let Some(pdf_path) = find_pdf_path(&charts_dir, &request.file_path) else {
            continue;
        };
        let waypoint_paths =
            resolve_waypoint_paths(&charts_dir, Some(request.waypoint_file_paths), None);
        let Ok(cache_path) = georef_cache_path(
            &app,
            &pdf_path,
            &csv_dir,
            &waypoint_paths,
            request.page_number,
        ) else {
            continue;
        };
        if read_cached_georef(&cache_path).is_some() {
            continue;
        }
        jobs.push(PreloadJob {
            pdf_path,
            waypoint_paths,
            page_number: request.page_number,
            cache_path,
        });
    }

    if jobs.is_empty() {
        preload_state.worker_count.store(0, Ordering::SeqCst);
        preload_state.started_jobs.store(0, Ordering::SeqCst);
        preload_state.active_jobs.store(0, Ordering::SeqCst);
        preload_state.total_jobs.store(0, Ordering::SeqCst);
        preload_state.processed_jobs.store(0, Ordering::SeqCst);
        preload_state.failed_jobs.store(0, Ordering::SeqCst);
        return;
    }

    let total_jobs = jobs.len();
    let workers = georef_preload_worker_count(use_multiprocess, total_jobs);

    preload_state.worker_count.store(workers, Ordering::SeqCst);
    preload_state.started_jobs.store(0, Ordering::SeqCst);
    preload_state.active_jobs.store(0, Ordering::SeqCst);
    preload_state.total_jobs.store(total_jobs, Ordering::SeqCst);
    preload_state.processed_jobs.store(0, Ordering::SeqCst);
    preload_state.failed_jobs.store(0, Ordering::SeqCst);

    let csv_dir = Arc::new(csv_dir);
    let job_queue = Arc::new(Mutex::new(jobs));
    let mut handles = Vec::new();

    for _ in 0..workers {
        let app = app.clone();
        let csv_dir = Arc::clone(&csv_dir);
        let job_queue = Arc::clone(&job_queue);
        let preload_state = Arc::clone(&preload_state);
        handles.push(thread::spawn(move || loop {
            let batch = {
                let Ok(mut queue) = job_queue.lock() else {
                    return;
                };
                let mut batch = Vec::with_capacity(GEOREF_PRELOAD_BATCH_SIZE);
                for _ in 0..GEOREF_PRELOAD_BATCH_SIZE {
                    let Some(job) = queue.pop() else {
                        break;
                    };
                    batch.push(job);
                }
                batch
            };

            if batch.is_empty() {
                return;
            }

            let batch_len = batch.len();
            preload_state
                .started_jobs
                .fetch_add(batch_len, Ordering::SeqCst);
            preload_state
                .active_jobs
                .fetch_add(batch_len, Ordering::SeqCst);

            let stats = run_georef_batch(&app, &csv_dir, &batch);
            preload_state
                .processed_jobs
                .fetch_add(stats.processed, Ordering::SeqCst);
            preload_state
                .failed_jobs
                .fetch_add(stats.failed, Ordering::SeqCst);
            preload_state
                .active_jobs
                .fetch_sub(batch_len, Ordering::SeqCst);
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }
}

fn georef_request_cache_ready(
    app: &AppHandle,
    charts_dir: &Path,
    csv_dir: &Path,
    file_path: String,
    waypoint_file_paths: Option<Vec<String>>,
    waypoint_file_path: Option<String>,
    page_number: Option<u32>,
) -> bool {
    let Some(pdf_path) = find_pdf_path(charts_dir, &file_path) else {
        return false;
    };
    let waypoint_paths =
        resolve_waypoint_paths(charts_dir, waypoint_file_paths, waypoint_file_path);
    let Ok(cache_path) = georef_cache_path(app, &pdf_path, csv_dir, &waypoint_paths, page_number)
    else {
        return false;
    };
    read_cached_georef(&cache_path)
        .map(|pages| {
            pages.iter().any(|page| {
                page_has_display_gcp_overlay(page)
                    && page_number
                        .map(|wanted| wanted == page.page)
                        .unwrap_or(true)
            })
        })
        .unwrap_or(false)
}

#[tauri::command]
fn get_georeference_cache_status(
    app: AppHandle,
    file_path: String,
    waypoint_file_paths: Option<Vec<String>>,
    waypoint_file_path: Option<String>,
    page_number: Option<u32>,
) -> GeorefCacheStatus {
    let config = read_config(&app);
    let charts_dir = resolve_config_path(&config.charts_directory);
    let csv_dir = resolve_config_path(&config.csv_directory);
    let ready = georef_request_cache_ready(
        &app,
        &charts_dir,
        &csv_dir,
        file_path,
        waypoint_file_paths,
        waypoint_file_path,
        page_number,
    );
    GeorefCacheStatus { ready }
}

#[tauri::command]
fn get_georeference_cache_summary(
    app: AppHandle,
    requests: Vec<GeorefPreloadRequest>,
) -> GeorefCacheSummary {
    let config = read_config(&app);
    let charts_dir = resolve_config_path(&config.charts_directory);
    let csv_dir = resolve_config_path(&config.csv_directory);
    let total = requests.len();
    let ready = requests
        .into_iter()
        .filter(|request| {
            georef_request_cache_ready(
                &app,
                &charts_dir,
                &csv_dir,
                request.file_path.clone(),
                Some(request.waypoint_file_paths.clone()),
                None,
                request.page_number,
            )
        })
        .count();

    GeorefCacheSummary { ready, total }
}

#[tauri::command]
fn get_georeference_preload_status(app: AppHandle) -> GeorefPreloadStatus {
    let state = app.state::<Arc<GeorefPreloadState>>();
    GeorefPreloadStatus {
        running: state.running.load(Ordering::SeqCst),
        use_multiprocess: state.use_multiprocess.load(Ordering::SeqCst),
        worker_count: state.worker_count.load(Ordering::SeqCst),
        started_jobs: state.started_jobs.load(Ordering::SeqCst),
        active_jobs: state.active_jobs.load(Ordering::SeqCst),
        total_jobs: state.total_jobs.load(Ordering::SeqCst),
        processed_jobs: state.processed_jobs.load(Ordering::SeqCst),
        failed_jobs: state.failed_jobs.load(Ordering::SeqCst),
    }
}

#[tauri::command]
fn preload_georeference_charts(
    app: AppHandle,
    requests: Vec<GeorefPreloadRequest>,
    use_multiprocess: Option<bool>,
) -> Result<(), String> {
    let state = app.state::<Arc<GeorefPreloadState>>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let preload_state = Arc::clone(&*state);
    let use_multiprocess = use_multiprocess.unwrap_or(true);
    preload_state
        .use_multiprocess
        .store(use_multiprocess, Ordering::SeqCst);
    preload_state.worker_count.store(0, Ordering::SeqCst);
    preload_state.started_jobs.store(0, Ordering::SeqCst);
    preload_state.active_jobs.store(0, Ordering::SeqCst);
    preload_state.total_jobs.store(0, Ordering::SeqCst);
    preload_state.processed_jobs.store(0, Ordering::SeqCst);
    preload_state.failed_jobs.store(0, Ordering::SeqCst);

    thread::spawn(move || {
        run_georef_preload(app, requests, use_multiprocess, Arc::clone(&preload_state));
        preload_state.worker_count.store(0, Ordering::SeqCst);
        preload_state.active_jobs.store(0, Ordering::SeqCst);
        preload_state.running.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
async fn georeference_chart(
    app: AppHandle,
    chart_id: String,
    file_path: String,
    waypoint_file_paths: Option<Vec<String>>,
    waypoint_file_path: Option<String>,
    page_number: Option<u32>,
) -> Result<GeorefResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        georeference_chart_blocking(
            app,
            chart_id,
            file_path,
            waypoint_file_paths,
            waypoint_file_path,
            page_number,
        )
    })
    .await
    .map_err(|error| format!("Georef task failed: {error}"))?
}

pub fn run() {
    tauri::Builder::default()
        .manage(PdfPathCache::default())
        .manage(Arc::new(Gdl90State::default()))
        .manage(Arc::new(GeorefPreloadState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("chart-pdf", |context, request| {
            handle_pdf_request(context.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            read_chart_sources,
            read_airport_coords,
            get_georeference_cache_status,
            get_georeference_cache_summary,
            get_georeference_preload_status,
            preload_georeference_charts,
            georeference_chart,
            start_gdl90_listener,
            stop_gdl90_listener
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_byte_ranges() {
        match parse_range_header(Some("bytes=10-19"), 100) {
            RangeRequest::Partial { start, end } => {
                assert_eq!(start, 10);
                assert_eq!(end, 19);
            }
            other => panic!("unexpected range result: {other:?}"),
        }

        match parse_range_header(Some("bytes=-10"), 100) {
            RangeRequest::Partial { start, end } => {
                assert_eq!(start, 90);
                assert_eq!(end, 99);
            }
            other => panic!("unexpected suffix range result: {other:?}"),
        }

        assert!(matches!(
            parse_range_header(Some("bytes=100-200"), 100),
            RangeRequest::Unsatisfiable
        ));
    }

    #[test]
    fn parses_dms_without_multibyte_panics() {
        assert!(parse_dms_to_decimal("东1160000").is_none());
        assert_eq!(parse_dms_to_decimal("N400000"), Some(40.0));
        assert_eq!(parse_dms_to_decimal("W1163000"), Some(-116.5));
    }

    #[test]
    fn decodes_csv_text_as_utf8_or_gbk() {
        assert_eq!(
            decode_csv_text("ChartTypeEx_CH\n机场细则\n".as_bytes()),
            "ChartTypeEx_CH\n机场细则\n"
        );

        let (gbk_bytes, _, _) = GBK.encode("ChartTypeEx_CH\n机场细则\n");
        assert_eq!(
            decode_csv_text(gbk_bytes.as_ref()),
            "ChartTypeEx_CH\n机场细则\n"
        );
    }

    #[test]
    fn rejects_paths_outside_base() {
        let base = std::env::temp_dir().join(format!("chart-viewer-test-{}", std::process::id()));
        let nested = base.join("charts");
        fs::create_dir_all(&nested).expect("create test directory");
        fs::write(nested.join("chart.pdf"), b"%PDF").expect("create test pdf");

        let inside = existing_safe_path(&base, Path::new("charts/chart.pdf"));
        assert!(inside.is_some());

        let outside = existing_safe_path(&base, Path::new("../chart.pdf"));
        assert!(outside.is_none());

        let _ = fs::remove_dir_all(base);
    }
}
