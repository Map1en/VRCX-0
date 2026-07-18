use std::collections::HashMap;
use std::ffi::c_void;

use openvr::overlay::OverlayHandle;
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, RgbaFrame};
use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
    D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_RESOURCE_MISC_SHARED,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_SAMPLE_DESC};

pub struct GpuPresenter {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    overlay: &'static openvr_sys::VR_IVROverlay_FnTable,
    surfaces: HashMap<OverlaySurfaceId, SurfaceTextures>,
}

impl GpuPresenter {
    pub fn new() -> Result<Self, String> {
        let overlay = load_overlay_fn_table()?;
        let (device, context) = create_d3d11_device()?;
        Ok(Self {
            device,
            context,
            overlay,
            surfaces: HashMap::new(),
        })
    }

    pub fn present(
        &mut self,
        surface_id: &OverlaySurfaceId,
        handle: OverlayHandle,
        frame: &RgbaFrame,
    ) -> Result<(), String> {
        validate_frame(frame)?;
        let size = frame.size;
        let context = &self.context;
        let device = &self.device;
        let overlay = self.overlay;
        if self
            .surfaces
            .get(surface_id)
            .is_none_or(|surface| surface.slots.needs_rebuild(size))
        {
            let textures = self.create_texture_pair(size)?;
            self.surfaces
                .insert(surface_id.clone(), SurfaceTextures::new(size, textures));
        }
        let surface = self
            .surfaces
            .get_mut(surface_id)
            .ok_or_else(|| "D3D11 overlay surface textures are not allocated".to_string())?;
        let texture = surface.texture();
        let row_pitch = size
            .width
            .checked_mul(4)
            .ok_or_else(|| "overlay frame row pitch overflow".to_string())?;

        unsafe {
            let resource: ID3D11Resource = texture
                .cast()
                .map_err(|error| format!("cast overlay texture resource failed: {error}"))?;
            context.UpdateSubresource(
                &resource,
                0,
                None,
                frame.data.as_ptr().cast::<c_void>(),
                row_pitch,
                0,
            );
            context.Flush();
            device
                .GetDeviceRemovedReason()
                .map_err(|error| format!("D3D11 device removed: {error}"))?;
        }
        set_overlay_texture(overlay, handle, texture)?;
        surface.slots.advance();
        Ok(())
    }

    pub fn unregister_surface(&mut self, surface_id: &OverlaySurfaceId) {
        self.surfaces.remove(surface_id);
    }

    fn create_texture_pair(
        &self,
        size: OverlaySize,
    ) -> Result<[ID3D11Texture2D; TEXTURE_BUFFER_COUNT], String> {
        Ok([self.create_texture(size)?, self.create_texture(size)?])
    }

    fn create_texture(&self, size: OverlaySize) -> Result<ID3D11Texture2D, String> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: size.width,
            Height: size.height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_R8G8B8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
        };
        let mut texture = None;
        unsafe {
            self.device
                .CreateTexture2D(&desc, None, Some(&mut texture))
                .map_err(|error| format!("create D3D11 overlay texture failed: {error}"))?;
        }
        texture.ok_or_else(|| "D3D11CreateTexture2D returned no texture".to_string())
    }
}

struct SurfaceTextures {
    slots: SurfaceTextureSlots,
    textures: [ID3D11Texture2D; TEXTURE_BUFFER_COUNT],
}

impl SurfaceTextures {
    fn new(size: OverlaySize, textures: [ID3D11Texture2D; TEXTURE_BUFFER_COUNT]) -> Self {
        Self {
            slots: SurfaceTextureSlots::new(size),
            textures,
        }
    }

    fn texture(&self) -> &ID3D11Texture2D {
        &self.textures[self.slots.write_index()]
    }
}

const TEXTURE_BUFFER_COUNT: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SurfaceTextureSlots {
    size: OverlaySize,
    write_index: usize,
}

impl SurfaceTextureSlots {
    fn new(size: OverlaySize) -> Self {
        Self {
            size,
            write_index: 0,
        }
    }

    fn needs_rebuild(&self, size: OverlaySize) -> bool {
        self.size != size
    }

    fn write_index(&self) -> usize {
        self.write_index
    }

    fn advance(&mut self) {
        self.write_index = (self.write_index + 1) % TEXTURE_BUFFER_COUNT;
    }
}

fn validate_frame(frame: &RgbaFrame) -> Result<(), String> {
    let expected_len = expected_frame_len(frame.size)
        .ok_or_else(|| "overlay frame byte length overflow".to_string())?;
    if frame.data.len() == expected_len {
        Ok(())
    } else {
        Err(format!(
            "overlay frame byte length mismatch: got {}, expected {expected_len}",
            frame.data.len()
        ))
    }
}

fn expected_frame_len(size: OverlaySize) -> Option<usize> {
    let width = usize::try_from(size.width).ok()?;
    let height = usize::try_from(size.height).ok()?;
    width.checked_mul(height)?.checked_mul(4)
}

fn create_d3d11_device() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(|error| format!("create D3D11 device failed: {error}"))?;
    }
    let device = device.ok_or_else(|| "D3D11CreateDevice returned no device".to_string())?;
    let context = context.ok_or_else(|| "D3D11CreateDevice returned no context".to_string())?;
    Ok((device, context))
}

fn set_overlay_texture(
    overlay: &openvr_sys::VR_IVROverlay_FnTable,
    handle: OverlayHandle,
    texture: &ID3D11Texture2D,
) -> Result<(), String> {
    let set_texture = overlay
        .SetOverlayTexture
        .ok_or_else(|| "OpenVR SetOverlayTexture is unavailable".to_string())?;
    let mut texture = openvr_sys::Texture_t {
        handle: texture.as_raw().cast::<c_void>(),
        eType: openvr_sys::ETextureType_TextureType_DirectX,
        eColorSpace: openvr_sys::EColorSpace_ColorSpace_Gamma,
    };
    let error = unsafe { set_texture(handle.0, &mut texture) };
    if error == openvr_sys::EVROverlayError_VROverlayError_None {
        Ok(())
    } else {
        Err(format!("set overlay texture failed: {error}"))
    }
}

fn load_overlay_fn_table() -> Result<&'static openvr_sys::VR_IVROverlay_FnTable, String> {
    let mut magic = Vec::from(b"FnTable:".as_slice());
    magic.extend(openvr_sys::IVROverlay_Version);
    let mut error = openvr_sys::EVRInitError_VRInitError_None;
    let table = unsafe {
        openvr_sys::VR_GetGenericInterface(magic.as_ptr().cast(), &mut error)
            as *const openvr_sys::VR_IVROverlay_FnTable
    };
    if error != openvr_sys::EVRInitError_VRInitError_None {
        return Err(format!("OpenVR overlay fn table unavailable: {error:?}"));
    }
    if table.is_null() {
        return Err("OpenVR overlay fn table pointer is null".to_string());
    }
    let table = unsafe { &*table };
    if table.SetOverlayTexture.is_none() {
        return Err("OpenVR overlay fn table has no SetOverlayTexture".to_string());
    }
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surface_texture_slots_alternate_between_two_buffers() {
        let mut slots = SurfaceTextureSlots::new(OverlaySize::new(640, 480));

        assert_eq!(slots.write_index(), 0);
        slots.advance();
        assert_eq!(slots.write_index(), 1);
        slots.advance();
        assert_eq!(slots.write_index(), 0);
    }

    #[test]
    fn surface_texture_slots_start_at_first_buffer_for_new_size() {
        let first = OverlaySize::new(640, 480);
        let next = OverlaySize::new(800, 600);
        let mut slots = SurfaceTextureSlots::new(first);

        slots.advance();
        assert!(!slots.needs_rebuild(first));
        assert!(slots.needs_rebuild(next));

        let slots = SurfaceTextureSlots::new(next);
        assert_eq!(slots.write_index(), 0);
        assert!(!slots.needs_rebuild(next));
    }

    #[test]
    fn validate_frame_rejects_mismatched_rgba_length() {
        let frame = RgbaFrame::new(OverlaySize::new(2, 2), vec![0; 15]);

        assert!(validate_frame(&frame).is_err());
    }
}
