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
use vrcx_0_vr_overlay::{
    FavoriteFriendsPanelModel, MainSurfaceModel, SlintPanelPointerEvent, SlintPanelRenderStats,
    WristSurfaceModel,
};

use crate::render::{DevtoolRenderer, RenderedPng};

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
        render_current_png(&app, &mut renderer)?.bytes,
    )?);

    app.select(SurfaceKind::Wrist, "i18n");
    written.push(write_dump_png(
        out_dir,
        "wrist-i18n.png",
        render_current_png(&app, &mut renderer)?.bytes,
    )?);

    app.select(SurfaceKind::Toast, mock::toast::default_scenario_key());
    written.push(write_dump_png(
        out_dir,
        "hmd.png",
        render_current_png(&app, &mut renderer)?.bytes,
    )?);

    app.select(SurfaceKind::Toast, "i18n");
    written.push(write_dump_png(
        out_dir,
        "hmd-i18n.png",
        render_current_png(&app, &mut renderer)?.bytes,
    )?);

    app.select(SurfaceKind::Friends, mock::friends::default_scenario_key());
    renderer.reset_panel();
    written.push(write_dump_png(
        out_dir,
        "panel.png",
        render_current_png(&app, &mut renderer)?.bytes,
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
    Friends,
    Toast,
    Wrist,
}

impl SurfaceKind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "friends" => Some(Self::Friends),
            "toast" | "hmd" | "main" => Some(Self::Toast),
            "wrist" => Some(Self::Wrist),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Friends => "friends",
            Self::Toast => "toast",
            Self::Wrist => "wrist",
        }
    }
}

struct AppState {
    surface: SurfaceKind,
    friends_scenario: String,
    toast_scenario: String,
    wrist_scenario: String,
    friends: FavoriteFriendsPanelModel,
    toast: MainSurfaceModel,
    wrist: WristSurfaceModel,
    injected_toasts: usize,
}

impl AppState {
    fn new() -> Self {
        let friends_scenario = mock::friends::default_scenario_key().to_string();
        let toast_scenario = mock::toast::default_scenario_key().to_string();
        let wrist_scenario = mock::wrist::default_scenario_key().to_string();
        Self {
            surface: SurfaceKind::Friends,
            friends: mock::friends::build(&friends_scenario),
            toast: mock::toast::build(&toast_scenario),
            wrist: mock::wrist::build(&wrist_scenario),
            friends_scenario,
            toast_scenario,
            wrist_scenario,
            injected_toasts: 0,
        }
    }

    fn select(&mut self, surface: SurfaceKind, scenario: &str) {
        self.surface = surface;
        match surface {
            SurfaceKind::Friends => {
                self.friends_scenario = mock::friends::normalize_scenario(scenario).to_string();
            }
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
            SurfaceKind::Friends => {
                self.friends = mock::friends::build(&self.friends_scenario);
            }
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
            SurfaceKind::Friends => &self.friends_scenario,
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
                "friends": scenario_json(mock::friends::scenario_infos()),
                "toast": scenario_json(mock::toast::scenario_infos()),
                "wrist": scenario_json(mock::wrist::scenario_infos())
            },
            "friends": {
                "selectedCategory": self.friends.selected_category_key,
                "rows": self.friends.rows.len()
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

#[derive(Debug, Deserialize)]
struct InputRequest {
    action: String,
    #[serde(default)]
    x: f32,
    #[serde(default)]
    y: f32,
    #[serde(default)]
    delta: Option<f32>,
    #[serde(default)]
    delta_x: Option<f32>,
    #[serde(default)]
    delta_y: Option<f32>,
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
                if surface == SurfaceKind::Friends {
                    renderer.reset_panel();
                }
                json_response(200, app.state_json())
            } else {
                json_response(400, json!({ "error": "unknown surface" }))
            }
        }),
        (&Method::Post, "/api/input") => json_post::<InputRequest, _>(request, |input| {
            if app.surface != SurfaceKind::Friends {
                return json_response(
                    409,
                    json!({
                        "error": "input is only available for friends surface",
                        "state": app.state_json()
                    }),
                );
            }
            match dispatch_panel_input(renderer, &input) {
                Ok(result) => {
                    json_response(200, json!({ "state": app.state_json(), "result": result }))
                }
                Err(error) => json_response(400, json!({ "error": error })),
            }
        }),
        (&Method::Post, "/api/toast") => json_post::<ToastRequest, _>(request, |input| {
            app.apply_toast_action(&input.action);
            json_response(200, app.state_json())
        }),
        (&Method::Post, "/api/reset") => {
            app.reset_current();
            if app.surface == SurfaceKind::Friends {
                renderer.reset_panel();
            }
            json_response(200, app.state_json())
        }
        _ => json_response(404, json!({ "error": "not found" })),
    }
}

fn dispatch_panel_input(
    renderer: &mut DevtoolRenderer,
    input: &InputRequest,
) -> Result<serde_json::Value, String> {
    let event = slint_panel_event_from_input(input)?;
    renderer.dispatch_panel_input(event)?;
    Ok(json!({
        "event": slint_event_name(event),
        "x": input.x,
        "y": input.y,
        "deltaX": input.delta_x.unwrap_or_default(),
        "deltaY": input.delta_y.or(input.delta).unwrap_or_default()
    }))
}

fn slint_panel_event_from_input(input: &InputRequest) -> Result<SlintPanelPointerEvent, String> {
    match input.action.as_str() {
        "move" | "hover" | "mousemove" => Ok(SlintPanelPointerEvent::Moved {
            x: input.x,
            y: input.y,
        }),
        "down" | "press" | "mousedown" | "pointerdown" => Ok(SlintPanelPointerEvent::Pressed {
            x: input.x,
            y: input.y,
        }),
        "up" | "release" | "mouseup" | "pointerup" => Ok(SlintPanelPointerEvent::Released {
            x: input.x,
            y: input.y,
        }),
        "scroll" | "wheel" | "touchScroll" => Ok(SlintPanelPointerEvent::Scrolled {
            x: input.x,
            y: input.y,
            delta_x: input.delta_x.unwrap_or_default(),
            delta_y: input.delta_y.or(input.delta).unwrap_or_default(),
        }),
        "exit" | "leave" | "mouseleave" => Ok(SlintPanelPointerEvent::Exited),
        other => Err(format!("unknown input action: {other}")),
    }
}

fn slint_event_name(event: SlintPanelPointerEvent) -> &'static str {
    match event {
        SlintPanelPointerEvent::Moved { .. } => "moved",
        SlintPanelPointerEvent::Pressed { .. } => "pressed",
        SlintPanelPointerEvent::Released { .. } => "released",
        SlintPanelPointerEvent::Scrolled { .. } => "scrolled",
        SlintPanelPointerEvent::Exited => "exited",
    }
}

fn render_current_png(
    app: &AppState,
    renderer: &mut DevtoolRenderer,
) -> Result<RenderedPng, String> {
    match app.surface {
        SurfaceKind::Friends => renderer.friends_png(&app.friends),
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
    let mut response = bytes_response(200, "image/png", rendered.bytes)
        .with_header(header("Cache-Control", "no-store, max-age=0"));
    if let Some(stats) = rendered.stats {
        response = add_render_stats_headers(response, stats);
    }
    response
}

fn add_render_stats_headers(
    response: Response<Cursor<Vec<u8>>>,
    stats: SlintPanelRenderStats,
) -> Response<Cursor<Vec<u8>>> {
    response
        .with_header(header(
            "X-Render-Elapsed-Us",
            &stats.elapsed.as_micros().to_string(),
        ))
        .with_header(header("X-Dirty-Area", &stats.dirty_area.to_string()))
        .with_header(header("X-Dirty-Rects", &stats.dirty_rects.to_string()))
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
        for surface in [SurfaceKind::Friends, SurfaceKind::Toast, SurfaceKind::Wrist] {
            let scenario = match surface {
                SurfaceKind::Friends => mock::friends::default_scenario_key(),
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

    #[test]
    fn slint_panel_input_mapping_preserves_pointer_coordinates() {
        let input = InputRequest {
            action: "move".to_string(),
            x: 321.5,
            y: 123.25,
            delta: None,
            delta_x: None,
            delta_y: None,
        };

        assert_eq!(
            slint_panel_event_from_input(&input).unwrap(),
            SlintPanelPointerEvent::Moved {
                x: 321.5,
                y: 123.25
            }
        );
    }

    #[test]
    fn slint_panel_input_mapping_passes_raw_scroll_delta() {
        let input = InputRequest {
            action: "wheel".to_string(),
            x: 20.0,
            y: 30.0,
            delta: None,
            delta_x: Some(-12.0),
            delta_y: Some(144.0),
        };

        assert_eq!(
            slint_panel_event_from_input(&input).unwrap(),
            SlintPanelPointerEvent::Scrolled {
                x: 20.0,
                y: 30.0,
                delta_x: -12.0,
                delta_y: 144.0
            }
        );
    }

    #[test]
    fn friends_mock_category_rows_are_still_available_for_future_panel_model() {
        let all_rows = mock::friends::rows_for_category("many", "all");
        let travelers = mock::friends::rows_for_category("many", "group:remote:Travelers");

        assert!(!travelers.is_empty());
        assert!(travelers.len() < all_rows.len());
        assert!(travelers.iter().all(|row| row.is_traveling));
    }

    #[test]
    fn friends_many_groups_mock_exercises_category_scroll() {
        let mut app = AppState::new();
        app.select(SurfaceKind::Friends, "manyGroups");
        let mock_group_count = app
            .friends
            .categories
            .iter()
            .filter(|category| {
                category.key.starts_with("group:friend:mock_group_")
                    || category.key.starts_with("group:local:mock_local_")
            })
            .count();
        assert_eq!(mock_group_count, 42);
        assert!(app.friends.categories.len() > 42);
    }

    #[test]
    fn friends_same_instance_mock_defaults_to_same_instance_rows() {
        let mut app = AppState::new();
        app.select(SurfaceKind::Friends, "sameInstance");

        assert_eq!(app.friends.selected_category_key, "sameInstance");
        assert!(!app.friends.rows.is_empty());
        let section_count = app
            .friends
            .rows
            .iter()
            .filter(|row| row.section_label.is_some())
            .count();
        assert!(section_count >= 3);
        assert!(app.friends.rows.iter().any(|row| {
            row.section_label
                .as_deref()
                .is_some_and(|label| label == "The Black Cat")
        }));
        assert!(app
            .friends
            .rows
            .iter()
            .filter(|row| !row.user_id.is_empty())
            .all(|row| !row.is_traveling && row.location_text != "Private"));

        let same_instance_count = app
            .friends
            .categories
            .iter()
            .find(|category| category.key == "sameInstance")
            .map(|category| category.count)
            .expect("same instance category");
        assert_eq!(
            same_instance_count,
            app.friends
                .rows
                .iter()
                .filter(|row| !row.user_id.is_empty())
                .count()
        );
    }
}
