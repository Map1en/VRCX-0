use super::*;
use vrcx_0_core::screenshots::ScreenshotShareEmbedField;

#[test]
fn accepts_only_discord_webhook_urls() {
    assert!(is_discord_webhook_url(
        "https://discord.com/api/webhooks/123/token"
    ));
    assert!(is_discord_webhook_url(
        "https://canary.discord.com/api/webhooks/123/token"
    ));
    assert!(!is_discord_webhook_url(
        "http://discord.com/api/webhooks/123/token"
    ));
    assert!(!is_discord_webhook_url(
        "https://discord.com.evil.example/api/webhooks/123/token"
    ));
    assert!(!is_discord_webhook_url(
        "https://discord.com/api/webhooks/123"
    ));
    assert!(!is_discord_webhook_url("https://discord.com/channels/1/2"));
}

#[test]
fn builds_wait_and_message_urls() {
    assert_eq!(
        with_wait("https://discord.com/api/webhooks/1/t?thread_id=9&wait=false").unwrap(),
        "https://discord.com/api/webhooks/1/t?thread_id=9&wait=true"
    );
    assert_eq!(
        webhook_message_url("https://discord.com/api/webhooks/1/t?thread_id=9", "42").unwrap(),
        "https://discord.com/api/webhooks/1/t/messages/42?thread_id=9"
    );
}

#[test]
fn url_hint_keeps_only_the_tail() {
    assert_eq!(
        url_hint("https://discord.com/api/webhooks/1/abcdWXYZ/"),
        "…WXYZ"
    );
}

#[test]
fn attachment_names_are_ascii_with_spoiler_prefix_and_suffix() {
    assert_eq!(
        attachment_name("C:/p/VRChat_2026-01-02 日本.png", false, false, None, "png"),
        "VRChat_2026-01-02___.png"
    );
    assert_eq!(
        attachment_name("/p/a.png", true, false, Some(2), "jpg"),
        "SPOILER_a_2.jpg"
    );
    assert_eq!(
        attachment_name("/p/a.png", false, true, None, "png"),
        "VRCX-0_print_a.png"
    );
    assert_eq!(
        print_file_stem("/p/VRChat_2026-04-12_23-41-00.123_3840x2160.png"),
        "VRCX-0_print_2026-04-12_23-41-00.123_3840x2160"
    );
}

fn embed() -> ScreenshotShareEmbed {
    ScreenshotShareEmbed {
        title: Some("World".into()),
        url: Some("javascript:alert(1)".into()),
        fields: vec![
            ScreenshotShareEmbedField {
                name: "People".into(),
                value: "A, B".into(),
                inline: false,
            },
            ScreenshotShareEmbedField {
                name: "Empty".into(),
                value: String::new(),
                inline: true,
            },
        ],
        ..Default::default()
    }
}

fn file(name: &str, size: usize) -> EncodedFile {
    EncodedFile {
        name: name.into(),
        mime: "image/png",
        data: vec![0; size],
    }
}

#[test]
fn payload_disables_mentions_and_embeds_a_single_visible_image() {
    let embed = embed();
    let payload = discord_payload("  hi @everyone  ", Some(&embed), false, &[file("a.png", 0)]);
    assert_eq!(payload["allowed_mentions"], json!({ "parse": [] }));
    assert_eq!(payload["content"], "hi @everyone");
    assert_eq!(
        payload["attachments"],
        json!([{ "id": 0, "filename": "a.png" }])
    );
    let embed = &payload["embeds"][0];
    assert_eq!(embed["image"]["url"], "attachment://a.png");
    assert!(embed.get("url").is_none());
    assert_eq!(embed["fields"].as_array().unwrap().len(), 1);
}

#[test]
fn payload_keeps_spoiler_images_out_of_the_embed() {
    let embed = embed();
    let payload = discord_payload("", Some(&embed), true, &[file("SPOILER_a.png", 0)]);
    assert!(payload["embeds"][0].get("image").is_none());
    assert!(payload.get("content").is_none());
}

#[test]
fn batches_respect_the_request_budget_and_attachment_count() {
    let sizes =
        |batches: Vec<Vec<EncodedFile>>| -> Vec<usize> { batches.iter().map(Vec::len).collect() };
    let files = || {
        (0..4)
            .map(|index| file(&format!("{index}.png"), 6))
            .collect::<Vec<_>>()
    };
    assert_eq!(sizes(pack_batches(files(), Some(10))), vec![1, 1, 1, 1]);
    assert_eq!(sizes(pack_batches(files(), Some(12))), vec![2, 2]);
    let many = (0..12)
        .map(|index| file(&format!("{index}.png"), 1))
        .collect();
    assert_eq!(sizes(pack_batches(many, None)), vec![10, 2]);
}

#[test]
fn statuses_map_to_share_error_codes() {
    assert_eq!(SendFailure::from_status(-1).code(), "network");
    assert_eq!(SendFailure::from_status(404).code(), "invalid");
    assert_eq!(SendFailure::from_status(413).code(), "tooLarge");
    assert_eq!(SendFailure::from_status(429).code(), "rateLimited");
    assert_eq!(SendFailure::from_status(500).code(), "http500");
}

#[test]
fn webhook_id_is_the_path_id_segment() {
    assert_eq!(
        webhook_id("https://discord.com/api/webhooks/123/token?thread_id=9").as_deref(),
        Some("123")
    );
}
