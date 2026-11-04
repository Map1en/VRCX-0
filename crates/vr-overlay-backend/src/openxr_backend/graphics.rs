use std::ffi::c_void;
use std::mem;

use ash::vk::{self, Handle};
use openxr as xr;

use super::super::types::BackendStartError;

pub(super) struct VulkanContext {
    queue_family_index: u32,
    queue: vk::Queue,
    command_pool: vk::CommandPool,
    command_buffer: vk::CommandBuffer,
    fence: vk::Fence,
    staging: Option<StagingBuffer>,
    device: ash::Device,
    physical_device: vk::PhysicalDevice,
    memory_properties: vk::PhysicalDeviceMemoryProperties,
    instance: ash::Instance,
    _entry: ash::Entry,
}

struct StagingBuffer {
    buffer: vk::Buffer,
    memory: vk::DeviceMemory,
    capacity: vk::DeviceSize,
    mapped: *mut c_void,
}

impl VulkanContext {
    pub fn new(
        xr_instance: &xr::Instance,
        system: xr::SystemId,
    ) -> Result<Self, BackendStartError> {
        let entry = unsafe { ash::Entry::load() }.map_err(|error| {
            BackendStartError::permanent(format!("Vulkan loader unavailable: {error}"))
        })?;
        let get_instance_proc_addr = unsafe {
            mem::transmute::<
                ash::vk::PFN_vkGetInstanceProcAddr,
                xr::sys::platform::VkGetInstanceProcAddr,
            >(entry.static_fn().get_instance_proc_addr)
        };

        let app_name = c"VRCX-0";
        let app_info = vk::ApplicationInfo::default()
            .application_name(app_name)
            .api_version(vk::API_VERSION_1_1);
        let instance_create_info = vk::InstanceCreateInfo::default().application_info(&app_info);
        let raw_instance = unsafe {
            xr_instance.create_vulkan_instance(
                system,
                get_instance_proc_addr,
                &instance_create_info as *const _ as *const _,
            )
        }
        .map_err(|error| {
            BackendStartError::transient(format!("xrCreateVulkanInstanceKHR failed: {error}"))
        })?
        .map_err(|error| {
            BackendStartError::transient(format!(
                "vkCreateInstance failed: {:?}",
                vk::Result::from_raw(error)
            ))
        })?;
        let vk_instance = vk::Instance::from_raw(raw_instance as usize as u64);
        let instance = unsafe { ash::Instance::load(entry.static_fn(), vk_instance) };

        let raw_physical_device =
            unsafe { xr_instance.vulkan_graphics_device(system, raw_instance) }.map_err(
                |error| {
                    BackendStartError::transient(format!(
                        "xrGetVulkanGraphicsDevice2KHR failed: {error}"
                    ))
                },
            )?;
        let physical_device = vk::PhysicalDevice::from_raw(raw_physical_device as usize as u64);

        let queue_family_index =
            unsafe { instance.get_physical_device_queue_family_properties(physical_device) }
                .iter()
                .position(|properties| properties.queue_flags.contains(vk::QueueFlags::GRAPHICS))
                .ok_or_else(|| {
                    BackendStartError::transient("no graphics queue family available".to_string())
                })? as u32;

        let queue_priorities = [1.0f32];
        let queue_create_infos = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family_index)
            .queue_priorities(&queue_priorities)];
        let device_create_info =
            vk::DeviceCreateInfo::default().queue_create_infos(&queue_create_infos);
        let raw_device = unsafe {
            xr_instance.create_vulkan_device(
                system,
                get_instance_proc_addr,
                raw_physical_device,
                &device_create_info as *const _ as *const _,
            )
        }
        .map_err(|error| {
            BackendStartError::transient(format!("xrCreateVulkanDeviceKHR failed: {error}"))
        })?
        .map_err(|error| {
            BackendStartError::transient(format!(
                "vkCreateDevice failed: {:?}",
                vk::Result::from_raw(error)
            ))
        })?;
        let device = unsafe {
            ash::Device::load(
                instance.fp_v1_0(),
                vk::Device::from_raw(raw_device as usize as u64),
            )
        };

        let queue = unsafe { device.get_device_queue(queue_family_index, 0) };
        let command_pool = unsafe {
            device.create_command_pool(
                &vk::CommandPoolCreateInfo::default()
                    .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER)
                    .queue_family_index(queue_family_index),
                None,
            )
        }
        .map_err(|error| {
            BackendStartError::transient(format!("vkCreateCommandPool failed: {error}"))
        })?;
        let command_buffer = unsafe {
            device.allocate_command_buffers(
                &vk::CommandBufferAllocateInfo::default()
                    .command_pool(command_pool)
                    .level(vk::CommandBufferLevel::PRIMARY)
                    .command_buffer_count(1),
            )
        }
        .map_err(|error| {
            BackendStartError::transient(format!("vkAllocateCommandBuffers failed: {error}"))
        })?[0];
        let fence = unsafe { device.create_fence(&vk::FenceCreateInfo::default(), None) }.map_err(
            |error| BackendStartError::transient(format!("vkCreateFence failed: {error}")),
        )?;
        let memory_properties =
            unsafe { instance.get_physical_device_memory_properties(physical_device) };

        Ok(Self {
            queue_family_index,
            queue,
            command_pool,
            command_buffer,
            fence,
            staging: None,
            device,
            physical_device,
            memory_properties,
            instance,
            _entry: entry,
        })
    }

    pub fn queue_family_index(&self) -> u32 {
        self.queue_family_index
    }

    pub fn raw_instance(&self) -> *const c_void {
        self.instance.handle().as_raw() as usize as *const c_void
    }

    pub fn raw_physical_device(&self) -> *const c_void {
        self.physical_device.as_raw() as usize as *const c_void
    }

    pub fn raw_device(&self) -> *const c_void {
        self.device.handle().as_raw() as usize as *const c_void
    }

    pub fn upload_rgba(
        &mut self,
        image: vk::Image,
        width: u32,
        height: u32,
        data: &[u8],
    ) -> Result<(), String> {
        let byte_len = data.len() as vk::DeviceSize;
        self.ensure_staging_capacity(byte_len)?;
        let staging = self
            .staging
            .as_ref()
            .ok_or_else(|| "staging buffer unavailable".to_string())?;
        unsafe {
            std::ptr::copy_nonoverlapping(data.as_ptr(), staging.mapped.cast::<u8>(), data.len());
        }

        let device = &self.device;
        unsafe {
            device
                .begin_command_buffer(
                    self.command_buffer,
                    &vk::CommandBufferBeginInfo::default()
                        .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT),
                )
                .map_err(|error| format!("vkBeginCommandBuffer failed: {error}"))?;

            let subresource_range = vk::ImageSubresourceRange::default()
                .aspect_mask(vk::ImageAspectFlags::COLOR)
                .base_mip_level(0)
                .level_count(1)
                .base_array_layer(0)
                .layer_count(1);
            let to_transfer = vk::ImageMemoryBarrier::default()
                .src_access_mask(vk::AccessFlags::empty())
                .dst_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                .old_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
                .new_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .image(image)
                .subresource_range(subresource_range);
            device.cmd_pipeline_barrier(
                self.command_buffer,
                vk::PipelineStageFlags::TOP_OF_PIPE,
                vk::PipelineStageFlags::TRANSFER,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &[to_transfer],
            );

            let copy_region = vk::BufferImageCopy::default()
                .image_subresource(
                    vk::ImageSubresourceLayers::default()
                        .aspect_mask(vk::ImageAspectFlags::COLOR)
                        .mip_level(0)
                        .base_array_layer(0)
                        .layer_count(1),
                )
                .image_extent(vk::Extent3D {
                    width,
                    height,
                    depth: 1,
                });
            device.cmd_copy_buffer_to_image(
                self.command_buffer,
                staging.buffer,
                image,
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                &[copy_region],
            );

            let to_attachment = vk::ImageMemoryBarrier::default()
                .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                .dst_access_mask(vk::AccessFlags::MEMORY_READ)
                .old_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                .new_layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)
                .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .image(image)
                .subresource_range(subresource_range);
            device.cmd_pipeline_barrier(
                self.command_buffer,
                vk::PipelineStageFlags::TRANSFER,
                vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &[to_attachment],
            );

            device
                .end_command_buffer(self.command_buffer)
                .map_err(|error| format!("vkEndCommandBuffer failed: {error}"))?;

            let command_buffers = [self.command_buffer];
            let submit = vk::SubmitInfo::default().command_buffers(&command_buffers);
            device
                .queue_submit(self.queue, &[submit], self.fence)
                .map_err(|error| format!("vkQueueSubmit failed: {error}"))?;
            let wait_result = device.wait_for_fences(&[self.fence], true, 1_000_000_000);
            let reset_result = device.reset_fences(&[self.fence]);
            wait_result.map_err(|error| format!("vkWaitForFences failed: {error}"))?;
            reset_result.map_err(|error| format!("vkResetFences failed: {error}"))?;
        }
        Ok(())
    }

    fn ensure_staging_capacity(&mut self, byte_len: vk::DeviceSize) -> Result<(), String> {
        if let Some(staging) = &self.staging {
            if staging.capacity >= byte_len {
                return Ok(());
            }
        }
        if let Some(staging) = self.staging.take() {
            self.destroy_staging(staging);
        }

        let capacity = byte_len.next_power_of_two().max(4096);
        let device = &self.device;
        let buffer = unsafe {
            device.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(capacity)
                    .usage(vk::BufferUsageFlags::TRANSFER_SRC)
                    .sharing_mode(vk::SharingMode::EXCLUSIVE),
                None,
            )
        }
        .map_err(|error| format!("vkCreateBuffer failed: {error}"))?;
        let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };
        let memory_type_index = self
            .find_memory_type(
                requirements.memory_type_bits,
                vk::MemoryPropertyFlags::HOST_VISIBLE | vk::MemoryPropertyFlags::HOST_COHERENT,
            )
            .ok_or_else(|| "no host visible memory type for staging buffer".to_string());
        let memory_type_index = match memory_type_index {
            Ok(index) => index,
            Err(error) => {
                unsafe { device.destroy_buffer(buffer, None) };
                return Err(error);
            }
        };
        let allocation = unsafe {
            device.allocate_memory(
                &vk::MemoryAllocateInfo::default()
                    .allocation_size(requirements.size)
                    .memory_type_index(memory_type_index),
                None,
            )
        };
        let memory = match allocation {
            Ok(memory) => memory,
            Err(error) => {
                unsafe { device.destroy_buffer(buffer, None) };
                return Err(format!("vkAllocateMemory failed: {error}"));
            }
        };
        let bind_and_map = unsafe {
            device
                .bind_buffer_memory(buffer, memory, 0)
                .map_err(|error| format!("vkBindBufferMemory failed: {error}"))
                .and_then(|()| {
                    device
                        .map_memory(memory, 0, vk::WHOLE_SIZE, vk::MemoryMapFlags::empty())
                        .map_err(|error| format!("vkMapMemory failed: {error}"))
                })
        };
        let mapped = match bind_and_map {
            Ok(mapped) => mapped,
            Err(error) => {
                unsafe {
                    device.destroy_buffer(buffer, None);
                    device.free_memory(memory, None);
                }
                return Err(error);
            }
        };
        self.staging = Some(StagingBuffer {
            buffer,
            memory,
            capacity,
            mapped,
        });
        Ok(())
    }

    fn find_memory_type(&self, type_bits: u32, properties: vk::MemoryPropertyFlags) -> Option<u32> {
        (0..self.memory_properties.memory_type_count).find(|&index| {
            type_bits & (1 << index) != 0
                && self.memory_properties.memory_types[index as usize]
                    .property_flags
                    .contains(properties)
        })
    }

    fn destroy_staging(&self, staging: StagingBuffer) {
        unsafe {
            self.device.unmap_memory(staging.memory);
            self.device.destroy_buffer(staging.buffer, None);
            self.device.free_memory(staging.memory, None);
        }
    }
}

impl Drop for VulkanContext {
    fn drop(&mut self) {
        unsafe {
            let _ = self.device.device_wait_idle();
        }
        if let Some(staging) = self.staging.take() {
            self.destroy_staging(staging);
        }
        unsafe {
            self.device.destroy_fence(self.fence, None);
            self.device.destroy_command_pool(self.command_pool, None);
            self.device.destroy_device(None);
            self.instance.destroy_instance(None);
        }
    }
}
