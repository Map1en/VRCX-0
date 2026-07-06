use std::sync::Arc;

use vrcx_0_vr_overlay::{
    build_main_scene, AvatarBitmap, Color, DrawCommand, FeedRelation, FeedSeverity,
    MainSurfaceModel, OverlayRenderer, OverlaySize, TextMeasurer, TinySkiaRenderer, ToastCard,
};

#[test]
fn main_surface_builds_hmd_scene_with_favorite_marker_and_avatar() {
    let model = sample_main_model();
    let mut measurer = TextMeasurer::new();

    let scene = build_main_scene(&model, &mut measurer);

    assert_eq!(scene.surface_id.as_str(), "main");
    assert_eq!(scene.size, OverlaySize::new(960, 528));
    assert!(scene.commands.iter().any(|command| {
        matches!(
            command,
            DrawCommand::Image {
                width: 96,
                height: 96,
                ..
            }
        )
    }));
    assert!(scene.commands.iter().any(|command| {
        matches!(command, DrawCommand::Text { text, .. } if text == "Fav User ★")
    }));
    assert_eq!(
        text_color(&scene.commands, "Fav User ★"),
        Some(Color::rgba(245, 205, 84, 255))
    );
}

#[test]
fn tiny_skia_renderer_blits_image_commands() {
    let model = sample_main_model();
    let mut measurer = TextMeasurer::new();
    let scene = build_main_scene(&model, &mut measurer);
    let mut renderer = TinySkiaRenderer::new();

    let frame = renderer.render(&scene).expect("render main scene");

    assert_eq!(frame.size, model.size);
    assert!(frame.is_valid_len());
    assert!(
        frame
            .data
            .chunks_exact(4)
            .any(|pixel| pixel[0] == 255 && pixel[1] == 0 && pixel[2] == 0 && pixel[3] == 255),
        "avatar bitmap should be copied into the rendered frame"
    );
}

fn sample_main_model() -> MainSurfaceModel {
    MainSurfaceModel {
        size: OverlaySize::new(960, 528),
        dark_background: true,
        accent: Color::rgba(94, 234, 212, 255),
        toasts: vec![ToastCard {
            actor_name: "Fav User".to_string(),
            relation: FeedRelation::Favorite,
            action: "joined your instance".to_string(),
            context: Some("A very long world name that should not break the card".to_string()),
            severity: FeedSeverity::Important,
            avatar: Some(AvatarBitmap {
                width: 96,
                height: 96,
                rgba: Arc::from([255u8, 0, 0, 255].repeat(96 * 96)),
            }),
        }],
    }
}

fn text_color(commands: &[DrawCommand], expected_text: &str) -> Option<Color> {
    commands.iter().find_map(|command| match command {
        DrawCommand::Text { text, style, .. } if text == expected_text => Some(style.color),
        _ => None,
    })
}
