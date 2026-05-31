use encoding_rs::GBK;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
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
}

impl Default for Gdl90State {
    fn default() -> Self {
        Self {
            port: AtomicU16::new(0),
            stop: AtomicBool::new(false),
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
                crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
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
            if i < raw.len() { out.push(raw[i] ^ 0x20); }
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
    if u >= 0x80_0000 { u as i32 - 0x100_0000 } else { u as i32 }
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
    if body.len() < 27 { return None; }
    let lat = s24(body[4], body[5], body[6]) as f64 * (180.0 / 0x80_0000 as f64);
    let lon = s24(body[7], body[8], body[9]) as f64 * (180.0 / 0x80_0000 as f64);
    let alt_raw = ((body[10] as u16) << 4) | ((body[11] >> 4) as u16);
    let altitude_ft = if alt_raw == 0xfff { None } else { Some(alt_raw as f64 * 25.0 - 1000.0) };
    let misc = body[11] & 0x0f;
    let track_valid = (misc & 0x03) != 0;
    let gs_raw = ((body[13] as u16) << 4) | ((body[14] >> 4) as u16);
    let ground_speed_kt = if gs_raw == 0xfff { None } else { Some(gs_raw as f64) };
    let track_deg = if track_valid { Some(body[16] as f64 / 256.0 * 360.0) } else { None };
    let nic = (body[12] >> 4) & 0x0f;
    if nic == 0 && lat == 0.0 && lon == 0.0 { return None; }
    Some(OwnshipPosition { lat, lon, altitude_ft, track_deg, ground_speed_kt })
}

/// Scan a UDP datagram for the first valid GDL90 Ownship Report (msg 10).
fn parse_gdl90_datagram(buf: &[u8]) -> Option<OwnshipPosition> {
    let mut i = 0;
    while i < buf.len() {
        if buf[i] != 0x7e { i += 1; continue; }
        let frame_start = i + 1;
        i += 1;
        while i < buf.len() && buf[i] != 0x7e { i += 1; }
        if i >= buf.len() { break; }
        let between = &buf[frame_start..i];
        i += 1;
        if between.len() < 3 { continue; }
        let clear = gdl90_unstuff(between);
        if clear.len() < 3 { continue; }
        let payload = &clear[..clear.len() - 2];
        let fcs_lo = clear[clear.len() - 2];
        let fcs_hi = clear[clear.len() - 1];
        if gdl90_crc16(payload) != ((fcs_hi as u16) << 8 | fcs_lo as u16) { continue; }
        if payload.is_empty() { continue; }
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
    // Stop any existing listener.
    state.stop.store(true, Ordering::SeqCst);
    if port == 0 {
        state.port.store(0, Ordering::SeqCst);
        return Ok(());
    }
    let socket = UdpSocket::bind(format!("0.0.0.0:{port}"))
        .map_err(|e| format!("Cannot bind UDP port {port}: {e}"))?;
    socket.set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|e| format!("set_read_timeout: {e}"))?;
    state.stop.store(false, Ordering::SeqCst);
    state.port.store(port, Ordering::SeqCst);
    let stop_flag = Arc::clone(&*state);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if stop_flag.stop.load(Ordering::SeqCst) { break; }
            match socket.recv(&mut buf) {
                Ok(n) => {
                    if let Some(pos) = parse_gdl90_datagram(&buf[..n]) {
                        let _ = app.emit("gdl90-position", &pos);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
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
}

fn default_gdl90_port() -> u16 { 4000 }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            charts_directory: "charts".to_string(),
            csv_directory: "csv".to_string(),
            gdl90_port: default_gdl90_port(),
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
    #[serde(alias = "page_width")]
    page_width: f64,
    #[serde(alias = "page_height")]
    page_height: f64,
    #[serde(alias = "rmse_meters")]
    rmse_meters: Option<f64>,
    #[serde(alias = "control_point_count")]
    control_point_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeorefResult {
    chart_id: String,
    pages: Vec<GeorefPageResult>,
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

fn decode_gbk(bytes: &[u8]) -> String {
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

    let content = decode_gbk(&buffer);
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
        content: decode_gbk(&buffer),
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
                content: decode_gbk(&buffer),
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
            content: decode_gbk(&buffer),
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
    let Ok(metadata) = fs::metadata(pdf_path) else {
        return response(
            500,
            "text/plain; charset=utf-8",
            b"Failed to load PDF".to_vec(),
        );
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

            match fs::read(pdf_path) {
                Ok(bytes) => pdf_response(200, bytes, None, file_len),
                Err(_) => response(
                    500,
                    "text/plain; charset=utf-8",
                    b"Failed to load PDF".to_vec(),
                ),
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
            let read_result = File::open(pdf_path).and_then(|mut file| {
                file.seek(SeekFrom::Start(start))?;
                file.read_exact(&mut body)
            });

            match read_result {
                Ok(()) => pdf_response(
                    206,
                    body,
                    Some(format!("bytes {start}-{end}/{file_len}")),
                    byte_count,
                ),
                Err(_) => response(
                    500,
                    "text/plain; charset=utf-8",
                    b"Failed to load PDF".to_vec(),
                ),
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

fn run_georef_command_with_limits(cmd: &mut Command) -> Result<Output, String> {
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
    let deadline = Instant::now() + GEOREF_TIMEOUT;

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
                    GEOREF_TIMEOUT.as_secs(),
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
        let content = decode_gbk(&buffer);
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

    let mut cmd = if let Some(sidecar_path) = locate_georef_sidecar() {
        Command::new(sidecar_path)
    } else if !cfg!(debug_assertions) {
        return Err("georef sidecar not found in bundled application".to_string());
    } else {
        let script_path = locate_georef_script(&app).ok_or_else(|| {
            "georef runtime not found - bundle the sidecar or set GEOREF_SCRIPT_PATH in development"
                .to_string()
        })?;
        let python = std::env::var("GEOREF_PYTHON").unwrap_or_else(|_| "python3".to_string());
        let mut cmd = Command::new(python);
        cmd.arg(script_path);
        cmd
    };

    cmd.arg("--pdf")
        .arg(&pdf_path)
        .arg("--csv-dir")
        .arg(&csv_dir);

    // Resolve and pass all 航路点坐标 waypoint PDFs if provided.
    // Some airports split the coordinate table across multiple pages/files.
    let mut waypoint_files = waypoint_file_paths.unwrap_or_default();
    if let Some(wp_file) = waypoint_file_path {
        waypoint_files.push(wp_file);
    }
    waypoint_files.sort();
    waypoint_files.dedup();
    for wp_file in waypoint_files {
        if let Some(wp_path) = find_pdf_path(&charts_dir, &wp_file) {
            cmd.arg("--waypoint-pdf").arg(&wp_path);
        }
    }

    if let Some(page_number) = page_number {
        cmd.arg("--page").arg(page_number.to_string());
    }

    cmd.env("PYTHONDONTWRITEBYTECODE", "1");

    let output = run_georef_command_with_limits(&mut cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Georef runtime error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pages: Vec<GeorefPageResult> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse georef output: {e}"))?;

    Ok(GeorefResult { chart_id, pages })
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
