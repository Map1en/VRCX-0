use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct OverlaySize {
    pub width: u32,
    pub height: u32,
}

impl OverlaySize {
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn contains_point(self, x: f32, y: f32) -> bool {
        x >= self.x && y >= self.y && x <= self.x + self.width && y <= self.y + self.height
    }

    pub fn center_uv(self, size: OverlaySize) -> UvPoint {
        let width = size.width.max(1) as f32;
        let height = size.height.max(1) as f32;
        UvPoint::new(
            (self.x + self.width * 0.5) / width,
            (self.y + self.height * 0.5) / height,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct UvPoint {
    pub x: f32,
    pub y: f32,
}

impl UvPoint {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OverlayQuadSize {
    pub width_meters: f32,
    pub height_meters: f32,
}

impl OverlayQuadSize {
    pub const fn new(width_meters: f32, height_meters: f32) -> Self {
        Self {
            width_meters,
            height_meters,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OverlayTransform {
    pub translation: [f32; 3],
    pub rotation: [[f32; 3]; 3],
}

impl OverlayTransform {
    pub const fn identity() -> Self {
        Self {
            translation: [0.0, 0.0, 0.0],
            rotation: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        }
    }

    pub const fn from_translation(translation: [f32; 3]) -> Self {
        Self {
            translation,
            rotation: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        }
    }

    pub const fn from_translation_rotation(translation: [f32; 3], rotation: [[f32; 3]; 3]) -> Self {
        Self {
            translation,
            rotation,
        }
    }

    pub fn right(self) -> [f32; 3] {
        [
            self.rotation[0][0],
            self.rotation[1][0],
            self.rotation[2][0],
        ]
    }

    pub fn up(self) -> [f32; 3] {
        [
            self.rotation[0][1],
            self.rotation[1][1],
            self.rotation[2][1],
        ]
    }

    pub fn normal(self) -> [f32; 3] {
        [
            self.rotation[0][2],
            self.rotation[1][2],
            self.rotation[2][2],
        ]
    }

    pub fn forward(self) -> [f32; 3] {
        scale(self.normal(), -1.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct Ray3 {
    pub origin: [f32; 3],
    pub direction: [f32; 3],
}

impl Ray3 {
    pub fn new(origin: [f32; 3], direction: [f32; 3]) -> Self {
        Self {
            origin,
            direction: normalize_or(direction, [0.0, 0.0, -1.0]),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct RayQuadHit {
    pub uv: UvPoint,
    pub distance: f32,
}

pub fn ray_quad_intersection(
    ray: Ray3,
    transform: OverlayTransform,
    quad: OverlayQuadSize,
) -> Option<RayQuadHit> {
    let normal = transform.normal();
    let denominator = dot(ray.direction, normal);
    if denominator >= -0.0001 {
        return None;
    }

    let distance = dot(sub(transform.translation, ray.origin), normal) / denominator;
    if distance < 0.0 {
        return None;
    }

    let hit = add(ray.origin, scale(ray.direction, distance));
    let local = sub(hit, transform.translation);
    let local_x = dot(local, transform.right());
    let local_y = dot(local, transform.up());
    let half_width = quad.width_meters * 0.5;
    let half_height = quad.height_meters * 0.5;
    let epsilon = 0.0001;
    if local_x < -half_width - epsilon
        || local_x > half_width + epsilon
        || local_y < -half_height - epsilon
        || local_y > half_height + epsilon
    {
        return None;
    }

    Some(RayQuadHit {
        uv: UvPoint::new(
            ((local_x + half_width) / quad.width_meters).clamp(0.0, 1.0),
            ((half_height - local_y) / quad.height_meters).clamp(0.0, 1.0),
        ),
        distance,
    })
}

pub fn recenter_transform(
    hmd_transform: OverlayTransform,
    distance_meters: f32,
    vertical_offset_meters: f32,
) -> OverlayTransform {
    let translation = add(
        add(
            hmd_transform.translation,
            scale(hmd_transform.forward(), distance_meters),
        ),
        scale(hmd_transform.up(), vertical_offset_meters),
    );
    OverlayTransform {
        translation,
        rotation: hmd_transform.rotation,
    }
}

pub fn grab_follow_transform(
    panel_start: OverlayTransform,
    controller_start: OverlayTransform,
    controller_current: OverlayTransform,
) -> OverlayTransform {
    let delta = sub(controller_current.translation, controller_start.translation);
    OverlayTransform {
        translation: add(panel_start.translation, delta),
        rotation: panel_start.rotation,
    }
}

fn add(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

fn sub(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn scale(value: [f32; 3], scalar: f32) -> [f32; 3] {
    [value[0] * scalar, value[1] * scalar, value[2] * scalar]
}

fn dot(left: [f32; 3], right: [f32; 3]) -> f32 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn normalize_or(value: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    let len = dot(value, value).sqrt();
    if len <= 0.0001 {
        return fallback;
    }
    scale(value, 1.0 / len)
}
