// Wrist overlay preview key bindings:
// 1..7 inject mock entry groups, C clears mock feed, L cycles locale,
// S cycles size, B toggles dark background, D toggles devices,
// P toggles battery percent, M toggles mock/live mode.
// Mock-editing keys switch the preview back to mock.

mod fixtures;

use std::{
    fs,
    num::NonZeroU32,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use fixtures::MockPreview;
use softbuffer::{Context, Surface};
use vrcx_0_runtime_host::vr_overlay::{
    build_wrist_surface_model, default_preview_snapshot_path, WristOverlayFrameInput,
    WristOverlayPreviewSnapshot,
};
use vrcx_0_vr_overlay::{build_wrist_scene, OverlayRenderer, RgbaFrame, TinySkiaRenderer};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowAttributes, WindowId},
};

const REDRAW_INTERVAL: Duration = Duration::from_millis(100);

fn main() {
    let args = PreviewArgs::parse();
    let event_loop = EventLoop::new().expect("failed to create event loop");
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = PreviewApp::new(args);
    event_loop
        .run_app(&mut app)
        .expect("failed to run overlay preview");
}

#[derive(Clone, Debug)]
struct PreviewArgs {
    mode: PreviewMode,
    live_path: PathBuf,
}

impl PreviewArgs {
    fn parse() -> Self {
        let mut mode = PreviewMode::Mock;
        let mut live_path = default_preview_snapshot_path();
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--live" => mode = PreviewMode::Live,
                "--mock" => mode = PreviewMode::Mock,
                "--path" => {
                    if let Some(path) = args.next() {
                        live_path = PathBuf::from(path);
                    }
                }
                "--help" | "-h" => {
                    print_help();
                    std::process::exit(0);
                }
                _ => {}
            }
        }
        Self { mode, live_path }
    }
}

fn print_help() {
    println!("VRCX-0 wrist overlay preview");
    println!("  --mock          start with built-in mock feed");
    println!("  --live          read the live bridge JSON file");
    println!("  --path <path>   live JSON path");
}

struct PreviewApp {
    state: PreviewState,
    window: Option<Arc<Window>>,
    _context: Option<Context<Arc<Window>>>,
    surface: Option<Surface<Arc<Window>, Arc<Window>>>,
    last_redraw: Instant,
}

impl PreviewApp {
    fn new(args: PreviewArgs) -> Self {
        Self {
            state: PreviewState::new(args),
            window: None,
            _context: None,
            surface: None,
            last_redraw: Instant::now(),
        }
    }

    fn draw(&mut self) {
        let Some(window) = self.window.as_ref() else {
            return;
        };
        let Some(surface) = self.surface.as_mut() else {
            return;
        };
        let size = window.inner_size();
        let width = size.width.max(1);
        let height = size.height.max(1);
        let Some(width_nz) = NonZeroU32::new(width) else {
            return;
        };
        let Some(height_nz) = NonZeroU32::new(height) else {
            return;
        };
        if let Err(error) = surface.resize(width_nz, height_nz) {
            eprintln!("failed to resize preview surface: {error}");
            return;
        }

        let frame = match self.state.render_frame() {
            Ok(frame) => frame,
            Err(error) => {
                eprintln!("failed to render preview frame: {error}");
                return;
            }
        };
        let pixels = frame_to_surface_pixels(&frame, width, height);
        let mut buffer = match surface.buffer_mut() {
            Ok(buffer) => buffer,
            Err(error) => {
                eprintln!("failed to lock preview surface buffer: {error}");
                return;
            }
        };
        buffer.copy_from_slice(&pixels);
        if let Err(error) = buffer.present() {
            eprintln!("failed to present preview frame: {error}");
        }
    }

    fn update_title(&self) {
        if let Some(window) = &self.window {
            window.set_title(&format!(
                "VRCX-0 Wrist Overlay Preview - {}",
                self.state.status_text()
            ));
        }
    }
}

impl ApplicationHandler for PreviewApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attributes = WindowAttributes::default()
            .with_title("VRCX-0 Wrist Overlay Preview")
            .with_inner_size(LogicalSize::new(768.0, 768.0));
        let window = Arc::new(
            event_loop
                .create_window(attributes)
                .expect("failed to create preview window"),
        );
        let context = Context::new(window.clone()).expect("failed to create preview context");
        let surface =
            Surface::new(&context, window.clone()).expect("failed to create preview surface");
        self.window = Some(window);
        self._context = Some(context);
        self.surface = Some(surface);
        self.update_title();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                if let PhysicalKey::Code(code) = event.physical_key {
                    if self.state.handle_key(code) {
                        self.update_title();
                        if let Some(window) = &self.window {
                            window.request_redraw();
                        }
                    }
                }
            }
            WindowEvent::RedrawRequested => {
                self.draw();
                self.update_title();
            }
            WindowEvent::Resized(_) => {
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if self.last_redraw.elapsed() >= REDRAW_INTERVAL {
            self.last_redraw = Instant::now();
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreviewMode {
    Mock,
    Live,
}

struct PreviewState {
    mode: PreviewMode,
    live_path: PathBuf,
    mock: MockPreview,
    renderer: TinySkiaRenderer,
    last_live_frame: Option<WristOverlayFrameInput>,
    live_connected: bool,
}

impl PreviewState {
    fn new(args: PreviewArgs) -> Self {
        Self {
            mode: args.mode,
            live_path: args.live_path,
            mock: MockPreview::new(),
            renderer: TinySkiaRenderer::new(),
            last_live_frame: None,
            live_connected: false,
        }
    }

    fn render_frame(&mut self) -> Result<RgbaFrame, String> {
        let input = self.current_frame_input();
        let model = build_wrist_surface_model(input);
        self.renderer
            .render(&build_wrist_scene(&model))
            .map_err(|error| error.to_string())
    }

    fn current_frame_input(&mut self) -> WristOverlayFrameInput {
        match self.mode {
            PreviewMode::Mock => self.mock.frame_input(),
            PreviewMode::Live => self
                .read_live_frame()
                .or_else(|| self.last_live_frame.clone())
                .unwrap_or_else(|| self.mock.frame_input()),
        }
    }

    fn read_live_frame(&mut self) -> Option<WristOverlayFrameInput> {
        let bytes = match fs::read(&self.live_path) {
            Ok(bytes) => bytes,
            Err(_) => {
                self.live_connected = false;
                return None;
            }
        };
        let snapshot = match serde_json::from_slice::<WristOverlayPreviewSnapshot>(&bytes) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                self.live_connected = false;
                return None;
            }
        };
        if snapshot.version != WristOverlayPreviewSnapshot::VERSION {
            self.live_connected = false;
            return None;
        }
        let frame = snapshot.into_frame_input();
        self.live_connected = true;
        self.last_live_frame = Some(frame.clone());
        Some(frame)
    }

    fn handle_key(&mut self, key: KeyCode) -> bool {
        match key {
            KeyCode::KeyM => {
                self.mode = if self.mode == PreviewMode::Mock {
                    PreviewMode::Live
                } else {
                    PreviewMode::Mock
                };
                true
            }
            KeyCode::Digit1 => self.inject_mock(1),
            KeyCode::Digit2 => self.inject_mock(2),
            KeyCode::Digit3 => self.inject_mock(3),
            KeyCode::Digit4 => self.inject_mock(4),
            KeyCode::Digit5 => self.inject_mock(5),
            KeyCode::Digit6 => self.inject_mock(6),
            KeyCode::Digit7 => self.inject_mock(7),
            KeyCode::KeyC => {
                self.mode = PreviewMode::Mock;
                self.mock.clear();
                true
            }
            KeyCode::KeyL => {
                self.mode = PreviewMode::Mock;
                self.mock.cycle_locale();
                true
            }
            KeyCode::KeyS => {
                self.mode = PreviewMode::Mock;
                self.mock.cycle_size();
                true
            }
            KeyCode::KeyB => {
                self.mode = PreviewMode::Mock;
                self.mock.toggle_dark_background();
                true
            }
            KeyCode::KeyD => {
                self.mode = PreviewMode::Mock;
                self.mock.toggle_devices();
                true
            }
            KeyCode::KeyP => {
                self.mode = PreviewMode::Mock;
                self.mock.toggle_battery_percent();
                true
            }
            _ => false,
        }
    }

    fn inject_mock(&mut self, key: u32) -> bool {
        self.mode = PreviewMode::Mock;
        self.mock.inject(key);
        true
    }

    fn status_text(&self) -> String {
        match self.mode {
            PreviewMode::Mock => format!("Mock {}", self.mock.status_text()),
            PreviewMode::Live => format!(
                "Live {} ({})",
                if self.live_connected {
                    "connected"
                } else {
                    "waiting"
                },
                self.live_path.display()
            ),
        }
    }
}

fn frame_to_surface_pixels(frame: &RgbaFrame, surface_width: u32, surface_height: u32) -> Vec<u32> {
    let surface_width_usize = surface_width as usize;
    let surface_height_usize = surface_height as usize;
    let mut pixels = vec![0; surface_width_usize * surface_height_usize];
    if frame.size.width == 0 || frame.size.height == 0 || !frame.is_valid_len() {
        return pixels;
    }

    for y in 0..surface_height_usize {
        for x in 0..surface_width_usize {
            pixels[y * surface_width_usize + x] = checker_pixel(x, y);
        }
    }

    let frame_width = frame.size.width as usize;
    let frame_height = frame.size.height as usize;
    let scale = (surface_width as f32 / frame.size.width as f32)
        .min(surface_height as f32 / frame.size.height as f32);
    let draw_width = ((frame.size.width as f32 * scale).round() as usize).min(surface_width_usize);
    let draw_height =
        ((frame.size.height as f32 * scale).round() as usize).min(surface_height_usize);
    let offset_x = surface_width_usize.saturating_sub(draw_width) / 2;
    let offset_y = surface_height_usize.saturating_sub(draw_height) / 2;

    for dy in 0..draw_height {
        let sy = (dy * frame_height / draw_height).min(frame_height - 1);
        for dx in 0..draw_width {
            let sx = (dx * frame_width / draw_width).min(frame_width - 1);
            let source_index = (sy * frame_width + sx) * 4;
            let dest_index = (offset_y + dy) * surface_width_usize + offset_x + dx;
            let background = pixels[dest_index];
            pixels[dest_index] =
                alpha_blend_rgba(&frame.data[source_index..source_index + 4], background);
        }
    }

    pixels
}

fn checker_pixel(x: usize, y: usize) -> u32 {
    if ((x / 16) + (y / 16)).is_multiple_of(2) {
        0x202020
    } else {
        0x141414
    }
}

fn alpha_blend_rgba(source: &[u8], background: u32) -> u32 {
    let src_r = source[0] as u32;
    let src_g = source[1] as u32;
    let src_b = source[2] as u32;
    let src_a = source[3] as u32;
    let bg_r = (background >> 16) & 0xff;
    let bg_g = (background >> 8) & 0xff;
    let bg_b = background & 0xff;
    let inv_a = 255 - src_a;
    let r = (src_r * src_a + bg_r * inv_a) / 255;
    let g = (src_g * src_a + bg_g * inv_a) / 255;
    let b = (src_b * src_a + bg_b * inv_a) / 255;
    (r << 16) | (g << 8) | b
}
