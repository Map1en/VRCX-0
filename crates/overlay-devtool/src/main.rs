mod mock;
mod render;

use std::{
    env, fs,
    io::Cursor,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use vrcx_0_vr_overlay::{MainSurfaceModel, WristSurfaceModel};

use crate::render::{backdrop_sheet_png, DevtoolRenderer, RenderedPng};

const INDEX_HTML: &str = include_str!("../web/index.html");
const DEFAULT_DUMP_DIR: &str = "target/overlay-devtool";

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match parse_mode(env::args().skip(1))
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?
    {
        DevtoolMode::Server => run_server(),
        DevtoolMode::Dump { out_dir } => run_dump(&out_dir),
    }
}

enum DevtoolMode {
    Server,
    Dump { out_dir: PathBuf },
}

fn parse_mode(args: impl IntoIterator<Item = String>) -> Result<DevtoolMode, String> {
    let mut args = args.into_iter();
    let Some(first) = args.next() else {
        return Ok(DevtoolMode::Server);
    };
    match first.as_str() {
        "--dump" => {
            let out_dir = args
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_DUMP_DIR));
            if let Some(extra) = args.next() {
                return Err(format!("unexpected argument: {extra}"));
            }
            Ok(DevtoolMode::Dump { out_dir })
        }
        "--help" | "-h" => Err("usage: vrcx-0-overlay-devtool [--dump [out_dir]]".to_string()),
        other => Err(format!("unknown argument: {other}")),
    }
}

fn run_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let port = env::var("VRCX_OVERLAY_DEVTOOL_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(47391);
    let address = format!("127.0.0.1:{port}");
    let server = Server::http(&address)?;
    let mut app = AppState::new();
    let mut renderer = DevtoolRenderer::new();
    println!("VRCX-0 overlay devtool: http://{address}");
    for mut request in server.incoming_requests() {
        let response = handle_request(&mut app, &mut renderer, &mut request);
        if let Err(error) = request.respond(response) {
            eprintln!("failed to respond to overlay devtool request: {error}");
        }
    }
    Ok(())
}

fn run_dump(out_dir: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    fs::create_dir_all(out_dir)?;
    let mut app = AppState::new();
    let mut renderer = DevtoolRenderer::new();
    let mut written = Vec::new();

    app.select(SurfaceKind::Wrist, mock::wrist::default_scenario_key());
    written.push(write_dump_png(
        out_dir,
        "wrist.png",
        backdrop_sheet_png(&render_current_png(&app, &mut renderer)?.bytes)?,
    )?);

    app.select(SurfaceKind::Wrist, "light");
    written.push(write_dump_png(
        out_dir,
        "wrist-light.png",
        backdrop_sheet_png(&render_current_png(&app, &mut renderer)?.bytes)?,
    )?);

    app.select(SurfaceKind::Wrist, "i18n");
    written.push(write_dump_png(
        out_dir,
        "wrist-i18n.png",
        backdrop_sheet_png(&render_current_png(&app, &mut renderer)?.bytes)?,
    )?);

    app.select(SurfaceKind::Wrist, "video");
    written.push(write_dump_png(
        out_dir,
        "wrist-video.png",
        backdrop_sheet_png(&render_current_png(&app, &mut renderer)?.bytes)?,
    )?);

    app.select(SurfaceKind::Toast, mock::toast::default_scenario_key());
    written.push(write_dump_png(
        out_dir,
        "hmd.png",
        backdrop_sheet_png(&render_current_png(&app, &mut renderer)?.bytes)?,
    )?);

    app.select(SurfaceKind::Toast, "i18n");
    written.push(write_dump_png(
        out_dir,
        "hmd-i18n.png",
        backdrop_sheet_png(&render_current_png(&app, &mut renderer)?.bytes)?,
    )?);

    for path in written {
        println!("{}", path.display());
    }
    Ok(())
}

fn write_dump_png(out_dir: &Path, name: &str, png: Vec<u8>) -> Result<PathBuf, std::io::Error> {
    let path = out_dir.join(name);
    fs::write(&path, png)?;
    Ok(path)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SurfaceKind {
    Toast,
    Wrist,
}

impl SurfaceKind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "toast" | "hmd" | "main" => Some(Self::Toast),
            "wrist" => Some(Self::Wrist),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Toast => "toast",
            Self::Wrist => "wrist",
        }
    }
}

struct AppState {
    surface: SurfaceKind,
    toast_scenario: String,
    wrist_scenario: String,
    toast: MainSurfaceModel,
    wrist: WristSurfaceModel,
    injected_toasts: usize,
}

impl AppState {
    fn new() -> Self {
        let toast_scenario = mock::toast::default_scenario_key().to_string();
        let wrist_scenario = mock::wrist::default_scenario_key().to_string();
        Self {
            surface: SurfaceKind::Toast,
            toast: mock::toast::build(&toast_scenario),
            wrist: mock::wrist::build(&wrist_scenario),
            toast_scenario,
            wrist_scenario,
            injected_toasts: 0,
        }
    }

    fn select(&mut self, surface: SurfaceKind, scenario: &str) {
        self.surface = surface;
        match surface {
            SurfaceKind::Toast => {
                self.toast_scenario = mock::toast::normalize_scenario(scenario).to_string();
            }
            SurfaceKind::Wrist => {
                self.wrist_scenario = mock::wrist::normalize_scenario(scenario).to_string();
            }
        }
        self.reset_current();
    }

    fn reset_current(&mut self) {
        match self.surface {
            SurfaceKind::Toast => {
                self.toast = mock::toast::build(&self.toast_scenario);
                self.injected_toasts = 0;
            }
            SurfaceKind::Wrist => {
                self.wrist = mock::wrist::build(&self.wrist_scenario);
            }
        }
    }

    fn apply_toast_action(&mut self, action: &str) {
        match action {
            "append" => {
                mock::toast::append_mock_toast(&mut self.toast, self.injected_toasts);
                self.injected_toasts += 1;
            }
            "clear" => {
                self.toast.toasts.clear();
            }
            _ => {}
        }
    }

    fn current_scenario(&self) -> &str {
        match self.surface {
            SurfaceKind::Toast => &self.toast_scenario,
            SurfaceKind::Wrist => &self.wrist_scenario,
        }
    }

    fn state_json(&self) -> serde_json::Value {
        json!({
            "surface": self.surface.as_str(),
            "scenario": self.current_scenario(),
            "renderer": "slint",
            "debug": cfg!(debug_assertions),
            "scenarios": {
                "toast": scenario_json(mock::toast::scenario_infos()),
                "wrist": scenario_json(mock::wrist::scenario_infos())
            },
            "toast": {
                "toasts": self.toast.toasts.len()
            }
        })
    }
}

#[derive(Deserialize)]
struct SelectRequest {
    surface: String,
    scenario: String,
}

#[derive(Deserialize)]
struct ToastRequest {
    action: String,
}

fn handle_request(
    app: &mut AppState,
    renderer: &mut DevtoolRenderer,
    request: &mut Request,
) -> Response<Cursor<Vec<u8>>> {
    let path = request.url().split('?').next().unwrap_or(request.url());
    match (request.method(), path) {
        (&Method::Get, "/") | (&Method::Get, "/index.html") => {
            text_response(200, "text/html; charset=utf-8", INDEX_HTML)
        }
        (&Method::Get, "/api/state") => json_response(200, app.state_json()),
        (&Method::Get, "/frame.png") => match render_current_png(app, renderer) {
            Ok(rendered) => png_response(rendered),
            Err(error) => json_response(500, json!({ "error": error })),
        },
        (&Method::Post, "/api/select") => json_post::<SelectRequest, _>(request, |input| {
            if let Some(surface) = SurfaceKind::parse(&input.surface) {
                app.select(surface, &input.scenario);
                json_response(200, app.state_json())
            } else {
                json_response(400, json!({ "error": "unknown surface" }))
            }
        }),
        (&Method::Post, "/api/toast") => json_post::<ToastRequest, _>(request, |input| {
            app.apply_toast_action(&input.action);
            json_response(200, app.state_json())
        }),
        (&Method::Post, "/api/reset") => {
            app.reset_current();
            json_response(200, app.state_json())
        }
        _ => json_response(404, json!({ "error": "not found" })),
    }
}

fn render_current_png(
    app: &AppState,
    renderer: &mut DevtoolRenderer,
) -> Result<RenderedPng, String> {
    match app.surface {
        SurfaceKind::Toast => renderer.main_png(&app.toast),
        SurfaceKind::Wrist => renderer.wrist_png(&app.wrist),
    }
}

fn json_post<T, F>(request: &mut Request, on_ok: F) -> Response<Cursor<Vec<u8>>>
where
    T: DeserializeOwned,
    F: FnOnce(T) -> Response<Cursor<Vec<u8>>>,
{
    match read_json::<T>(request) {
        Ok(input) => on_ok(input),
        Err(error) => json_response(400, json!({ "error": error })),
    }
}

fn read_json<T: DeserializeOwned>(request: &mut Request) -> Result<T, String> {
    let mut body = String::new();
    request
        .as_reader()
        .read_to_string(&mut body)
        .map_err(|error| format!("read request body failed: {error}"))?;
    serde_json::from_str(&body).map_err(|error| format!("invalid JSON: {error}"))
}

fn scenario_json(infos: &[mock::ScenarioInfo]) -> serde_json::Value {
    serde_json::Value::Array(
        infos
            .iter()
            .map(|info| json!({ "key": info.key, "label": info.label }))
            .collect(),
    )
}

fn text_response(status: u16, content_type: &str, body: &str) -> Response<Cursor<Vec<u8>>> {
    bytes_response(status, content_type, body.as_bytes().to_vec())
}

fn json_response(status: u16, value: serde_json::Value) -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"error\":\"json\"}".to_vec());
    bytes_response(status, "application/json; charset=utf-8", body)
}

fn png_response(rendered: RenderedPng) -> Response<Cursor<Vec<u8>>> {
    bytes_response(200, "image/png", rendered.bytes)
        .with_header(header("Cache-Control", "no-store, max-age=0"))
}

fn bytes_response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Cursor<Vec<u8>>> {
    Response::from_data(body)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", content_type))
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid HTTP header")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_all_mock_surfaces_to_png() {
        let mut app = AppState::new();
        let mut renderer = DevtoolRenderer::new();
        for surface in [SurfaceKind::Toast, SurfaceKind::Wrist] {
            let scenario = match surface {
                SurfaceKind::Toast => mock::toast::default_scenario_key(),
                SurfaceKind::Wrist => mock::wrist::default_scenario_key(),
            };
            app.select(surface, scenario);
            let png = render_current_png(&app, &mut renderer)
                .expect("render PNG")
                .bytes;
            assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        }
    }
}
