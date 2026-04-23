use encoding_rs::GBK;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{http::Response, AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";

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

fn handle_pdf_request(app: &AppHandle, request_path: &str) -> Response<Vec<u8>> {
    let encoded_filename = request_path.trim_start_matches('/').trim();
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
    let Some(pdf_path) = find_pdf_path(&charts_dir, filename) else {
        return response(
            404,
            "text/plain; charset=utf-8",
            b"PDF file not found".to_vec(),
        );
    };

    match fs::read(pdf_path) {
        Ok(bytes) => response(200, "application/pdf", bytes),
        Err(_) => response(
            500,
            "text/plain; charset=utf-8",
            b"Failed to load PDF".to_vec(),
        ),
    }
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("chart-pdf", |context, request| {
            handle_pdf_request(context.app_handle(), request.uri().path())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            read_chart_sources
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
