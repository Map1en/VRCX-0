use vrcx_0_vr_overlay::{
    grab_follow_transform, grab_follow_transform_facing, ray_quad_intersection, recenter_transform,
    OverlayQuadSize, OverlayTransform, Ray3,
};

#[test]
fn grab_follow_transform_facing_yaws_panel_toward_hmd_keeping_upright() {
    let panel_start = OverlayTransform::from_translation([0.0, 1.0, -1.0]);
    let controller_start = OverlayTransform::from_translation([0.0, 1.0, -0.5]);
    let controller_current = OverlayTransform::from_translation([1.0, 1.2, -0.5]);
    let hmd = OverlayTransform::from_translation([0.0, 1.6, 0.0]);

    let moved =
        grab_follow_transform_facing(panel_start, controller_start, controller_current, Some(hmd));

    assert_eq!(moved.translation, [1.0, 1.2, -1.0]);
    let normal = moved.normal();
    let inv_sqrt2 = 1.0 / 2.0_f32.sqrt();
    assert!((normal[0] + inv_sqrt2).abs() < 1e-3);
    assert!(normal[1].abs() < 1e-3);
    assert!((normal[2] - inv_sqrt2).abs() < 1e-3);
    let up = moved.up();
    assert!((up[1] - 1.0).abs() < 1e-3);
}

#[test]
fn grab_follow_transform_facing_without_hmd_keeps_start_rotation() {
    let panel_start = OverlayTransform::from_translation([0.0, 1.0, -1.0]);
    let controller_start = OverlayTransform::from_translation([0.0, 1.0, -0.5]);
    let controller_current = OverlayTransform::from_translation([0.4, 1.0, -0.5]);

    let moved =
        grab_follow_transform_facing(panel_start, controller_start, controller_current, None);

    assert_eq!(moved.rotation, panel_start.rotation);
    assert_eq!(
        moved.translation,
        grab_follow_transform(panel_start, controller_start, controller_current).translation
    );
}

#[test]
fn raycast_hits_quad_center_and_boundaries() {
    let transform = OverlayTransform::identity();
    let ray = Ray3::new([0.0, 0.0, 1.0], [0.0, 0.0, -1.0]);
    let quad = OverlayQuadSize::new(0.8, 0.6);

    let hit = ray_quad_intersection(ray, transform, quad).expect("center hit");

    assert!((hit.distance - 1.0).abs() < 0.001);
    assert!((hit.uv.x - 0.5).abs() < 0.001);
    assert!((hit.uv.y - 0.5).abs() < 0.001);

    let edge_ray = Ray3::new([0.4, 0.3, 1.0], [0.0, 0.0, -1.0]);
    let edge = ray_quad_intersection(edge_ray, transform, quad).expect("edge hit");
    assert!((edge.uv.x - 1.0).abs() < 0.001);
    assert!(edge.uv.y.abs() < 0.001);
}

#[test]
fn raycast_rejects_backface_and_misses() {
    let transform = OverlayTransform::identity();
    let quad = OverlayQuadSize::new(0.8, 0.6);

    assert!(ray_quad_intersection(
        Ray3::new([0.0, 0.0, -1.0], [0.0, 0.0, 1.0]),
        transform,
        quad,
    )
    .is_none());
    assert!(ray_quad_intersection(
        Ray3::new([0.9, 0.0, 1.0], [0.0, 0.0, -1.0]),
        transform,
        quad,
    )
    .is_none());
}

#[test]
fn recenter_transform_places_panel_in_front_of_hmd() {
    let hmd = OverlayTransform::from_translation_rotation(
        [2.0, 1.5, -3.0],
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    );

    let panel = recenter_transform(hmd, 1.25, -0.15);

    assert!((panel.translation[0] - 2.0).abs() < 0.001);
    assert!((panel.translation[1] - 1.35).abs() < 0.001);
    assert!((panel.translation[2] - -4.25).abs() < 0.001);
    assert_eq!(panel.rotation, hmd.rotation);
}

#[test]
fn grab_follow_transform_preserves_controller_to_panel_offset() {
    let panel = OverlayTransform::from_translation([0.0, 1.0, -1.0]);
    let grab_start = OverlayTransform::from_translation([0.2, 0.9, -0.8]);
    let grab_move = OverlayTransform::from_translation([0.4, 1.1, -1.2]);

    let next_panel = grab_follow_transform(panel, grab_start, grab_move);

    assert!((next_panel.translation[0] - 0.2).abs() < 0.001);
    assert!((next_panel.translation[1] - 1.2).abs() < 0.001);
    assert!((next_panel.translation[2] - -1.4).abs() < 0.001);
}
