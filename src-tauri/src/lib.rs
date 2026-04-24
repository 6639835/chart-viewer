use encoding_rs::GBK;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    http::{Request, Response},
    AppHandle, Manager,
};

const CONFIG_FILE: &str = "config.json";

#[derive(Default)]
struct PdfPathCache {
    paths: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    charts_directory: String,
    csv_directory: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            charts_directory: "charts".to_string(),
            csv_directory: "csv".to_string(),
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

fn response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
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
        .header("Content-Length", content_length.to_string())
        .header("Access-Control-Allow-Origin", "*");

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
        RangeRequest::Full => match fs::read(pdf_path) {
            Ok(bytes) => pdf_response(200, bytes, None, file_len),
            Err(_) => response(
                500,
                "text/plain; charset=utf-8",
                b"Failed to load PDF".to_vec(),
            ),
        },
        RangeRequest::Unsatisfiable => Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{file_len}"))
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap()),
        RangeRequest::Partial { start, end } => {
            let byte_count = end - start + 1;
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

fn handle_pdf_request(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
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

pub fn run() {
    tauri::Builder::default()
        .manage(PdfPathCache::default())
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
            read_chart_sources
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
