use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender, TryRecvError};
use std::time::{Duration, Instant};

use ash::vk::{self, Handle as _};
use openxr as xr;
use openxr::sys::Handle as _;
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::super::{
    policy::WristVisibilityPolicy,
    types::{
        BackendStartError, OverlayPlacement, OverlaySurfaceConfig, VrDeviceSnapshot, VrDeviceStatus,
    },
};
use super::backend::load_entry;
use super::graphics::VulkanContext;
use super::input::{Hand, OverlayInput};

const VIEW_TYPE: xr::ViewConfigurationType = xr::ViewConfigurationType::PRIMARY_STEREO;
const OVERLAY_LAYERS_PLACEMENT: u32 = 100;
const IDLE_POLL_INTERVAL: Duration = Duration::from_millis(50);

pub(super) enum SessionCommand {
    RegisterSurface {
        config: OverlaySurfaceConfig,
        reply: Sender<Result<(), String>>,
    },
    UnregisterSurface {
        surface_id: OverlaySurfaceId,
        reply: Sender<Result<(), String>>,
    },
    UpdateFrame {
        surface_id: OverlaySurfaceId,
        frame: RgbaFrame,
    },
    Show {
        surface_id: OverlaySurfaceId,
    },
    Hide {
        surface_id: OverlaySurfaceId,
    },
    SnapshotDevices {
        reply: Sender<Result<Vec<VrDeviceSnapshot>, String>>,
    },
    Stop,
}

pub(super) fn run(
    commands: Receiver<SessionCommand>,
    init_reply: Sender<Result<(), BackendStartError>>,
) {
    let context = match SessionContext::initialize() {
        Ok(context) => context,
        Err(error) => {
            let _ = init_reply.send(Err(error));
            return;
        }
    };
    let _ = init_reply.send(Ok(()));
    match context.run_loop(commands) {
        Ok(()) => tracing::debug!("OpenXR overlay session stopped"),
        Err(error) => tracing::warn!(error = %error, "OpenXR overlay session ended"),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Attachment {
    Head,
    Hand(Hand),
}

struct SurfaceState {
    config: OverlaySurfaceConfig,
    attachment: Attachment,
    pose: xr::Posef,
    swapchain: xr::Swapchain<xr::Vulkan>,
    images: Vec<vk::Image>,
    width: u32,
    height: u32,
    policy: WristVisibilityPolicy,
    pending_frame: Option<RgbaFrame>,
    uploaded: bool,
    visible: bool,
    requested_visible: bool,
}

struct SessionContext {
    surfaces: HashMap<OverlaySurfaceId, SurfaceState>,
    input: OverlayInput,
    view_space: xr::Space,
    local_space: xr::Space,
    frame_stream: xr::FrameStream<xr::Vulkan>,
    frame_waiter: xr::FrameWaiter,
    session: xr::Session<xr::Vulkan>,
    vk: VulkanContext,
    instance: xr::Instance,
    blend_mode: xr::EnvironmentBlendMode,
    state: xr::SessionState,
    session_running: bool,
    last_predicted_display_time: xr::Time,
}

impl SessionContext {
    fn initialize() -> Result<Self, BackendStartError> {
        let entry = load_entry()?;
        let available = entry.enumerate_extensions().map_err(|error| {
            BackendStartError::transient(format!("failed to enumerate OpenXR extensions: {error}"))
        })?;
        if !available.extx_overlay {
            return Err(BackendStartError::permanent(
                "OpenXR runtime does not support XR_EXTX_overlay".to_string(),
            ));
        }
        if !available.khr_vulkan_enable2 {
            return Err(BackendStartError::permanent(
                "OpenXR runtime does not support XR_KHR_vulkan_enable2".to_string(),
            ));
        }

        let mut extensions = xr::ExtensionSet::default();
        extensions.extx_overlay = true;
        extensions.khr_vulkan_enable2 = true;
        let instance = entry
            .create_instance(
                &xr::ApplicationInfo {
                    application_name: "VRCX-0",
                    ..Default::default()
                },
                &extensions,
                &[],
            )
            .map_err(|error| {
                BackendStartError::transient(format!("xrCreateInstance failed: {error}"))
            })?;

        let system = instance
            .system(xr::FormFactor::HEAD_MOUNTED_DISPLAY)
            .map_err(|error| {
                BackendStartError::transient(format!("OpenXR headset unavailable: {error}"))
            })?;
        let blend_mode = instance
            .enumerate_environment_blend_modes(system, VIEW_TYPE)
            .ok()
            .and_then(|modes| modes.first().copied())
            .unwrap_or(xr::EnvironmentBlendMode::OPAQUE);
        instance
            .graphics_requirements::<xr::Vulkan>(system)
            .map_err(|error| {
                BackendStartError::transient(format!(
                    "failed to query OpenXR Vulkan requirements: {error}"
                ))
            })?;

        let vk = VulkanContext::new(&instance, system)?;
        let (session, frame_waiter, frame_stream) = create_overlay_session(&instance, system, &vk)?;
        let local_space = session
            .create_reference_space(xr::ReferenceSpaceType::LOCAL, xr::Posef::IDENTITY)
            .map_err(|error| {
                BackendStartError::transient(format!("failed to create LOCAL space: {error}"))
            })?;
        let view_space = session
            .create_reference_space(xr::ReferenceSpaceType::VIEW, xr::Posef::IDENTITY)
            .map_err(|error| {
                BackendStartError::transient(format!("failed to create VIEW space: {error}"))
            })?;
        let input = OverlayInput::new(&instance, &session).map_err(BackendStartError::transient)?;

        tracing::info!("OpenXR overlay session created (XR_EXTX_overlay)");
        Ok(Self {
            surfaces: HashMap::new(),
            input,
            view_space,
            local_space,
            frame_stream,
            frame_waiter,
            session,
            vk,
            instance,
            blend_mode,
            state: xr::SessionState::UNKNOWN,
            session_running: false,
            last_predicted_display_time: xr::Time::from_nanos(0),
        })
    }

    fn run_loop(mut self, commands: Receiver<SessionCommand>) -> Result<(), String> {
        let mut event_buffer = xr::EventDataBuffer::new();
        loop {
            loop {
                match commands.try_recv() {
                    Ok(SessionCommand::Stop) => {
                        self.shutdown();
                        return Ok(());
                    }
                    Ok(command) => self.handle_command(command),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        self.shutdown();
                        return Ok(());
                    }
                }
            }

            while let Some(event) = self
                .instance
                .poll_event(&mut event_buffer)
                .map_err(|error| format!("xrPollEvent failed: {error}"))?
            {
                match event {
                    xr::Event::SessionStateChanged(changed) => {
                        self.state = changed.state();
                        tracing::debug!(state = ?self.state, "OpenXR overlay session state changed");
                        match self.state {
                            xr::SessionState::READY => {
                                self.session
                                    .begin(VIEW_TYPE)
                                    .map_err(|error| format!("xrBeginSession failed: {error}"))?;
                                self.session_running = true;
                            }
                            xr::SessionState::STOPPING => {
                                self.session_running = false;
                                let _ = self.session.end();
                                return Err(
                                    "OpenXR runtime stopped the overlay session".to_string()
                                );
                            }
                            xr::SessionState::EXITING | xr::SessionState::LOSS_PENDING => {
                                self.session_running = false;
                                return Err("OpenXR overlay session is exiting".to_string());
                            }
                            _ => {}
                        }
                    }
                    xr::Event::InstanceLossPending(_) => {
                        return Err("OpenXR instance loss pending".to_string());
                    }
                    _ => {}
                }
            }

            if self.session_running {
                self.frame()?;
            } else {
                std::thread::sleep(IDLE_POLL_INTERVAL);
            }
        }
    }

    fn frame(&mut self) -> Result<(), String> {
        let frame_state = self
            .frame_waiter
            .wait()
            .map_err(|error| format!("xrWaitFrame failed: {error}"))?;
        self.frame_stream
            .begin()
            .map_err(|error| format!("xrBeginFrame failed: {error}"))?;
        let display_time = frame_state.predicted_display_time;
        self.last_predicted_display_time = display_time;

        if let Err(error) = self.input.sync(&self.session) {
            tracing::debug!(error = %error, "xrSyncActions failed");
        }

        let now = Instant::now();
        for surface in self.surfaces.values_mut() {
            match surface.attachment {
                Attachment::Head => {
                    surface.visible = surface.requested_visible;
                }
                Attachment::Hand(hand) => {
                    if self.input.activation_pressed(
                        &self.session,
                        hand,
                        surface.config.activation_button,
                    ) {
                        surface.policy.open(now);
                    }
                    let present = self
                        .input
                        .hand_located(hand, &self.local_space, display_time);
                    surface.visible = surface.policy.evaluate(now, present);
                }
            }
            if surface.visible && surface.pending_frame.is_some() {
                if let Err(error) = upload_surface_frame(&mut self.vk, surface) {
                    tracing::warn!(
                        error = %error,
                        surface_id = surface.config.surface_id.as_str(),
                        "failed to upload wrist overlay frame"
                    );
                }
            }
        }

        let mut quads = Vec::new();
        if frame_state.should_render {
            for surface in self.surfaces.values() {
                if !surface.visible || !surface.uploaded {
                    continue;
                }
                let space = match surface.attachment {
                    Attachment::Head => &self.view_space,
                    Attachment::Hand(hand) => self.input.grip_space(hand),
                };
                let aspect = surface.height as f32 / surface.width.max(1) as f32;
                quads.push(
                    xr::CompositionLayerQuad::<xr::Vulkan>::new()
                        .layer_flags(xr::CompositionLayerFlags::BLEND_TEXTURE_SOURCE_ALPHA)
                        .space(space)
                        .eye_visibility(xr::EyeVisibility::BOTH)
                        .sub_image(
                            xr::SwapchainSubImage::new()
                                .swapchain(&surface.swapchain)
                                .image_array_index(0)
                                .image_rect(xr::Rect2Di {
                                    offset: xr::Offset2Di { x: 0, y: 0 },
                                    extent: xr::Extent2Di {
                                        width: surface.width as i32,
                                        height: surface.height as i32,
                                    },
                                }),
                        )
                        .pose(surface.pose)
                        .size(xr::Extent2Df {
                            width: surface.config.physical_width_meters,
                            height: surface.config.physical_width_meters * aspect,
                        }),
                );
            }
        }
        let layers: Vec<&xr::CompositionLayerBase<xr::Vulkan>> = quads
            .iter()
            .map(|quad| quad as &xr::CompositionLayerBase<xr::Vulkan>)
            .collect();
        self.frame_stream
            .end(display_time, self.blend_mode, &layers)
            .map_err(|error| format!("xrEndFrame failed: {error}"))?;
        Ok(())
    }

    fn handle_command(&mut self, command: SessionCommand) {
        match command {
            SessionCommand::RegisterSurface { config, reply } => {
                let _ = reply.send(self.register_surface(config));
            }
            SessionCommand::UnregisterSurface { surface_id, reply } => {
                self.surfaces.remove(&surface_id);
                let _ = reply.send(Ok(()));
            }
            SessionCommand::UpdateFrame { surface_id, frame } => {
                match self.surfaces.get_mut(&surface_id) {
                    Some(surface) => surface.pending_frame = Some(frame),
                    None => tracing::debug!(
                        surface_id = surface_id.as_str(),
                        "dropping frame for unregistered overlay surface"
                    ),
                }
            }
            SessionCommand::Show { surface_id } => {
                if let Some(surface) = self.surfaces.get_mut(&surface_id) {
                    surface.requested_visible = true;
                    surface.policy.open(Instant::now());
                }
            }
            SessionCommand::Hide { surface_id } => {
                if let Some(surface) = self.surfaces.get_mut(&surface_id) {
                    surface.requested_visible = false;
                    surface.policy.close();
                    surface.visible = false;
                }
            }
            SessionCommand::SnapshotDevices { reply } => {
                let _ = reply.send(Ok(self.snapshot_devices()));
            }
            SessionCommand::Stop => unreachable!("Stop is handled by the run loop"),
        }
    }

    fn register_surface(&mut self, config: OverlaySurfaceConfig) -> Result<(), String> {
        let attachment = parse_attachment(&config.placement)?;
        if let Some(existing) = self.surfaces.get_mut(&config.surface_id) {
            if existing.width == config.size.width && existing.height == config.size.height {
                existing.attachment = attachment;
                existing.pose = placement_pose(&config.placement);
                existing.config = config;
                return Ok(());
            }
            self.surfaces.remove(&config.surface_id);
        }

        let formats = self
            .session
            .enumerate_swapchain_formats()
            .map_err(|error| format!("failed to enumerate swapchain formats: {error}"))?;
        let srgb = vk::Format::R8G8B8A8_SRGB.as_raw() as u32;
        let unorm = vk::Format::R8G8B8A8_UNORM.as_raw() as u32;
        let format = if formats.contains(&srgb) {
            srgb
        } else if formats.contains(&unorm) {
            unorm
        } else {
            *formats
                .first()
                .ok_or_else(|| "runtime offered no swapchain formats".to_string())?
        };

        let width = config.size.width;
        let height = config.size.height;
        let swapchain = self
            .session
            .create_swapchain(&xr::SwapchainCreateInfo {
                create_flags: xr::SwapchainCreateFlags::EMPTY,
                usage_flags: xr::SwapchainUsageFlags::COLOR_ATTACHMENT
                    | xr::SwapchainUsageFlags::TRANSFER_DST,
                format,
                sample_count: 1,
                width,
                height,
                face_count: 1,
                array_size: 1,
                mip_count: 1,
            })
            .map_err(|error| format!("failed to create overlay swapchain: {error}"))?;
        let images = swapchain
            .enumerate_images()
            .map_err(|error| format!("failed to enumerate swapchain images: {error}"))?
            .into_iter()
            .map(vk::Image::from_raw)
            .collect();

        self.surfaces.insert(
            config.surface_id.clone(),
            SurfaceState {
                attachment,
                pose: placement_pose(&config.placement),
                swapchain,
                images,
                width,
                height,
                policy: WristVisibilityPolicy::default(),
                pending_frame: None,
                uploaded: false,
                visible: false,
                requested_visible: false,
                config,
            },
        );
        Ok(())
    }

    fn snapshot_devices(&self) -> Vec<VrDeviceSnapshot> {
        let time = self.last_predicted_display_time;
        let located = |tracked: bool| {
            if tracked {
                VrDeviceStatus::Normal
            } else {
                VrDeviceStatus::TrackingWarning
            }
        };

        let mut rows = Vec::new();
        let hmd_tracked = time.as_nanos() > 0
            && self
                .view_space
                .locate(&self.local_space, time)
                .map(|location| {
                    location
                        .location_flags
                        .contains(xr::SpaceLocationFlags::POSITION_VALID)
                })
                .unwrap_or(false);
        rows.push(VrDeviceSnapshot {
            label: "HMD".to_string(),
            serial: None,
            status: located(hmd_tracked),
            battery_percent: None,
        });
        for hand in Hand::ALL {
            if !self.input.hand_connected(&self.session, hand) {
                continue;
            }
            let tracked =
                time.as_nanos() > 0 && self.input.hand_located(hand, &self.local_space, time);
            rows.push(VrDeviceSnapshot {
                label: hand.label().to_string(),
                serial: None,
                status: located(tracked),
                battery_percent: None,
            });
        }
        rows
    }

    fn shutdown(mut self) {
        self.surfaces.clear();
        if !self.session_running {
            return;
        }
        if self.session.request_exit().is_err() {
            return;
        }
        let deadline = Instant::now() + Duration::from_millis(500);
        let mut event_buffer = xr::EventDataBuffer::new();
        while Instant::now() < deadline {
            match self.instance.poll_event(&mut event_buffer) {
                Ok(Some(xr::Event::SessionStateChanged(changed))) => {
                    if changed.state() == xr::SessionState::STOPPING {
                        let _ = self.session.end();
                        return;
                    }
                }
                Ok(Some(_)) => {}
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => return,
            }
        }
    }
}

fn upload_surface_frame(vk: &mut VulkanContext, surface: &mut SurfaceState) -> Result<(), String> {
    let Some(frame) = surface.pending_frame.take() else {
        return Ok(());
    };
    if frame.size.width != surface.width || frame.size.height != surface.height {
        return Err(format!(
            "frame size {}x{} does not match surface {}x{}",
            frame.size.width, frame.size.height, surface.width, surface.height
        ));
    }
    let index = surface
        .swapchain
        .acquire_image()
        .map_err(|error| format!("xrAcquireSwapchainImage failed: {error}"))?
        as usize;
    surface
        .swapchain
        .wait_image(xr::Duration::INFINITE)
        .map_err(|error| format!("xrWaitSwapchainImage failed: {error}"))?;
    let upload = match surface.images.get(index).copied() {
        Some(image) => vk.upload_rgba(image, surface.width, surface.height, &frame.data),
        None => Err(format!("swapchain image index {index} out of range")),
    };
    surface
        .swapchain
        .release_image()
        .map_err(|error| format!("xrReleaseSwapchainImage failed: {error}"))?;
    upload?;
    surface.uploaded = true;
    Ok(())
}

fn create_overlay_session(
    instance: &xr::Instance,
    system: xr::SystemId,
    vk: &VulkanContext,
) -> Result<
    (
        xr::Session<xr::Vulkan>,
        xr::FrameWaiter,
        xr::FrameStream<xr::Vulkan>,
    ),
    BackendStartError,
> {
    let overlay_info = xr::sys::SessionCreateInfoOverlayEXTX {
        ty: xr::sys::SessionCreateInfoOverlayEXTX::TYPE,
        next: std::ptr::null(),
        create_flags: xr::sys::OverlaySessionCreateFlagsEXTX::EMPTY,
        session_layers_placement: OVERLAY_LAYERS_PLACEMENT,
    };
    let binding = xr::sys::GraphicsBindingVulkanKHR {
        ty: xr::sys::GraphicsBindingVulkanKHR::TYPE,
        next: (&overlay_info as *const xr::sys::SessionCreateInfoOverlayEXTX).cast(),
        instance: vk.raw_instance(),
        physical_device: vk.raw_physical_device(),
        device: vk.raw_device(),
        queue_family_index: vk.queue_family_index(),
        queue_index: 0,
    };
    let create_info = xr::sys::SessionCreateInfo {
        ty: xr::sys::SessionCreateInfo::TYPE,
        next: (&binding as *const xr::sys::GraphicsBindingVulkanKHR).cast(),
        create_flags: xr::sys::SessionCreateFlags::EMPTY,
        system_id: system,
    };
    let mut handle = xr::sys::Session::NULL;
    let result =
        unsafe { (instance.fp().create_session)(instance.as_raw(), &create_info, &mut handle) };
    if result.into_raw() < 0 {
        return Err(BackendStartError::transient(format!(
            "xrCreateSession (overlay) failed: {result:?}"
        )));
    }
    let (session, frame_waiter, frame_stream) =
        unsafe { xr::Session::<xr::Vulkan>::from_raw(instance.clone(), handle, Box::new(())) };
    Ok((session, frame_waiter, frame_stream))
}

fn parse_attachment(placement: &OverlayPlacement) -> Result<Attachment, String> {
    match placement {
        OverlayPlacement::TrackedDeviceRelative { device_hint } => match device_hint.as_str() {
            "left-hand" => Ok(Attachment::Hand(Hand::Left)),
            "right-hand" => Ok(Attachment::Hand(Hand::Right)),
            "hmd" | "head" => Ok(Attachment::Head),
            value if value.starts_with("hmd:") => Ok(Attachment::Head),
            _ => Err(format!("unknown tracked device hint '{device_hint}'")),
        },
        OverlayPlacement::Absolute { .. } => {
            Err("OpenXR overlay backend does not support Absolute placement".to_string())
        }
    }
}

fn placement_pose(placement: &OverlayPlacement) -> xr::Posef {
    match placement {
        OverlayPlacement::TrackedDeviceRelative { device_hint } if device_hint == "left-hand" => {
            matrix3x4_to_posef([
                [0.0, 0.0, -1.0, -0.07],
                [0.0, -1.0, 0.0, -0.05],
                [-1.0, 0.0, 0.0, 0.06],
            ])
        }
        OverlayPlacement::TrackedDeviceRelative { device_hint } if device_hint == "right-hand" => {
            matrix3x4_to_posef([
                [0.0, 0.0, 1.0, 0.07],
                [0.0, -1.0, 0.0, -0.05],
                [1.0, 0.0, 0.0, 0.06],
            ])
        }
        OverlayPlacement::TrackedDeviceRelative { device_hint }
            if device_hint.starts_with("hmd") =>
        {
            let (x, y) = match device_hint.as_str() {
                "hmd:top" => (0.0, 0.38),
                "hmd:left" => (-0.52, -0.12),
                "hmd:right" => (0.52, -0.12),
                _ => (0.0, -0.38),
            };
            matrix3x4_to_posef([
                [1.0, 0.0, 0.0, x],
                [0.0, 1.0, 0.0, y],
                [0.0, 0.0, 1.0, -1.15],
            ])
        }
        OverlayPlacement::TrackedDeviceRelative { .. } => matrix3x4_to_posef([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.035],
            [0.0, 0.0, 1.0, 0.055],
        ]),
        OverlayPlacement::Absolute { transform } => matrix3x4_to_posef([
            [
                transform.rotation[0][0],
                transform.rotation[0][1],
                transform.rotation[0][2],
                transform.translation[0],
            ],
            [
                transform.rotation[1][0],
                transform.rotation[1][1],
                transform.rotation[1][2],
                transform.translation[1],
            ],
            [
                transform.rotation[2][0],
                transform.rotation[2][1],
                transform.rotation[2][2],
                transform.translation[2],
            ],
        ]),
    }
}

fn matrix3x4_to_posef(m: [[f32; 4]; 3]) -> xr::Posef {
    let trace = m[0][0] + m[1][1] + m[2][2];
    let (w, x, y, z) = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        (
            0.25 * s,
            (m[2][1] - m[1][2]) / s,
            (m[0][2] - m[2][0]) / s,
            (m[1][0] - m[0][1]) / s,
        )
    } else if m[0][0] > m[1][1] && m[0][0] > m[2][2] {
        let s = (1.0 + m[0][0] - m[1][1] - m[2][2]).sqrt() * 2.0;
        (
            (m[2][1] - m[1][2]) / s,
            0.25 * s,
            (m[0][1] + m[1][0]) / s,
            (m[0][2] + m[2][0]) / s,
        )
    } else if m[1][1] > m[2][2] {
        let s = (1.0 + m[1][1] - m[0][0] - m[2][2]).sqrt() * 2.0;
        (
            (m[0][2] - m[2][0]) / s,
            (m[0][1] + m[1][0]) / s,
            0.25 * s,
            (m[1][2] + m[2][1]) / s,
        )
    } else {
        let s = (1.0 + m[2][2] - m[0][0] - m[1][1]).sqrt() * 2.0;
        (
            (m[1][0] - m[0][1]) / s,
            (m[0][2] + m[2][0]) / s,
            (m[1][2] + m[2][1]) / s,
            0.25 * s,
        )
    };
    let norm = (w * w + x * x + y * y + z * z).sqrt();
    xr::Posef {
        orientation: xr::Quaternionf {
            x: x / norm,
            y: y / norm,
            z: z / norm,
            w: w / norm,
        },
        position: xr::Vector3f {
            x: m[0][3],
            y: m[1][3],
            z: m[2][3],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rotate(q: xr::Quaternionf, v: [f32; 3]) -> [f32; 3] {
        let u = [q.x, q.y, q.z];
        let cross = |a: [f32; 3], b: [f32; 3]| {
            [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ]
        };
        let uv = cross(u, v);
        let uuv = cross(u, uv);
        [
            v[0] + 2.0 * (q.w * uv[0] + uuv[0]),
            v[1] + 2.0 * (q.w * uv[1] + uuv[1]),
            v[2] + 2.0 * (q.w * uv[2] + uuv[2]),
        ]
    }

    fn assert_rotation_matches(m: [[f32; 4]; 3]) {
        let pose = matrix3x4_to_posef(m);
        for (axis_index, axis) in [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
            .into_iter()
            .enumerate()
        {
            let rotated = rotate(pose.orientation, axis);
            for row in 0..3 {
                let expected = m[row][axis_index];
                assert!(
                    (rotated[row] - expected).abs() < 1e-5,
                    "axis {axis_index} row {row}: expected {expected}, got {}",
                    rotated[row]
                );
            }
        }
    }

    #[test]
    fn identity_matrix_converts_to_identity_pose() {
        let pose = matrix3x4_to_posef([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ]);
        assert!((pose.orientation.w - 1.0).abs() < 1e-6);
        assert!(pose.orientation.x.abs() < 1e-6);
        assert!(pose.orientation.y.abs() < 1e-6);
        assert!(pose.orientation.z.abs() < 1e-6);
    }

    #[test]
    fn wrist_transforms_convert_to_unit_quaternions_matching_the_matrix() {
        assert_rotation_matches([
            [0.0, 0.0, -1.0, -0.07],
            [0.0, -1.0, 0.0, -0.05],
            [-1.0, 0.0, 0.0, 0.06],
        ]);
        assert_rotation_matches([
            [0.0, 0.0, 1.0, 0.07],
            [0.0, -1.0, 0.0, -0.05],
            [1.0, 0.0, 0.0, 0.06],
        ]);
    }

    #[test]
    fn translation_is_taken_from_the_fourth_column() {
        let pose = matrix3x4_to_posef([
            [0.0, 0.0, -1.0, -0.07],
            [0.0, -1.0, 0.0, -0.05],
            [-1.0, 0.0, 0.0, 0.06],
        ]);
        assert_eq!(pose.position.x, -0.07);
        assert_eq!(pose.position.y, -0.05);
        assert_eq!(pose.position.z, 0.06);
    }
}
