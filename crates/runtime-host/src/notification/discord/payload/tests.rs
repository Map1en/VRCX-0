use serde_json::json;
use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityDelivery, OverlayActivityEntry,
};

use super::*;

#[test]
fn builds_rich_invite_embed_with_explicit_enrichment() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "invite".into();
    delivery.entry.actor_display_name = "Example".into();
    delivery.entry.actor_user_id = "usr_abcdefg".into();
    delivery.entry.created_at = "2026-06-29T08:11:00.000Z".into();
    delivery.entry.content.location = "wrld_114514:810~private(usr_abcdefg)~region(jp)".into();
    delivery.entry.content.world_id = "wrld_114514".into();
    delivery.entry.content.world_name = "for Two".into();
    delivery.entry.content.detail = "プラベいこ♡".into();
    delivery.entry.content.image_url =
        "https://api.vrchat.cloud/api/1/image/file_fallback/1/256".into();
    let enrichment = DiscordEnrichment {
        actor_icon_url: "https://api.vrchat.cloud/api/1/image/file_icon/2/256".into(),
        world_image_url: "https://api.vrchat.cloud/api/1/file/file_world/8/file".into(),
        avatar_name: String::new(),
    };

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::En,
        &enrichment,
    );
    let embed = &payload["embeds"][0];

    assert_eq!(embed["title"].as_str(), Some("Example's invite"));
    assert_eq!(embed["description"].as_str(), Some("「プラベいこ♡」"));
    assert_eq!(
        embed["url"].as_str(),
        Some(
            "https://vrchat.com/home/launch?worldId=wrld_114514&instanceId=810~private(usr_abcdefg)~region(jp)"
        )
    );
    assert_eq!(embed["author"]["name"].as_str(), Some("Example"));
    assert_eq!(
        embed["author"]["url"].as_str(),
        Some("https://vrchat.com/home/user/usr_abcdefg")
    );
    assert_eq!(
        embed["author"]["icon_url"].as_str(),
        Some("https://api.vrchat.cloud/api/1/image/file_icon/2/256")
    );
    assert_eq!(embed["footer"]["text"].as_str(), Some("#810 - Invite · JP"));
    assert_eq!(
        embed["timestamp"].as_str(),
        Some("2026-06-29T08:11:00.000Z")
    );
    assert_eq!(
        embed["thumbnail"]["url"].as_str(),
        Some("https://api.vrchat.cloud/api/1/file/file_world/8/file")
    );
}

#[test]
fn preserves_specific_region_code() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "GPS".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = "wrld_named:48291~hidden(usr_x)~region(usw)".into();
    delivery.entry.content.world_id = "wrld_named".into();
    delivery.entry.content.world_name = "Named World".into();

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::En,
        &DiscordEnrichment::default(),
    );
    let embed = &payload["embeds"][0];

    assert_eq!(
        embed["footer"]["text"].as_str(),
        Some("#48291 - Friends+ · USW")
    );
}

#[test]
fn gps_uses_location_title_without_message() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "GPS".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location =
        "wrld_named:810~private(usr_x)~canRequestInvite~region(jp)".into();
    delivery.entry.content.world_id = "wrld_named".into();
    delivery.entry.content.world_name = "Named World".into();
    delivery.entry.content.detail = "Named World invite+".into();

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &DiscordEnrichment::default(),
    );
    let embed = &payload["embeds"][0];

    assert_eq!(embed["title"].as_str(), Some("Traveler が移動しました"));
    assert_eq!(embed["description"].as_str(), Some("→ Named World"));
    assert_eq!(
        embed["footer"]["text"].as_str(),
        Some("#810 - インバイト+ · JP")
    );
}

#[test]
fn status_uses_status_title_and_target() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "Status".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = String::new();
    delivery.entry.content.world_id = String::new();
    delivery.entry.content.world_name = String::new();
    delivery.entry.content.status = "join me".into();

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &DiscordEnrichment::default(),
    );
    let embed = &payload["embeds"][0];

    assert_eq!(
        embed["title"].as_str(),
        Some("Traveler がステータスを変更しました")
    );
    assert_eq!(embed["description"].as_str(), Some("だれでもおいで"));
    assert!(embed.get("footer").is_none());
}

#[test]
fn avatar_change_uses_enriched_avatar_name_without_mutating_delivery() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "AvatarChange".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = String::new();
    delivery.entry.content.world_id = String::new();
    delivery.entry.content.world_name = String::new();
    let enrichment = DiscordEnrichment {
        avatar_name: "Maple".into(),
        ..DiscordEnrichment::default()
    };

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &enrichment,
    );
    let embed = &payload["embeds"][0];

    assert_eq!(
        embed["title"].as_str(),
        Some("Traveler がアバターを変更しました")
    );
    assert_eq!(embed["description"].as_str(), Some("Maple"));
    assert!(delivery.entry.content.avatar_name.is_empty());
}

#[test]
fn avatar_change_prefers_existing_avatar_name() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "AvatarChange".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = String::new();
    delivery.entry.content.world_id = String::new();
    delivery.entry.content.world_name = String::new();
    delivery.entry.content.avatar_name = "Maple".into();
    let enrichment = DiscordEnrichment {
        avatar_name: "Ignored".into(),
        ..DiscordEnrichment::default()
    };

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &enrichment,
    );
    let embed = &payload["embeds"][0];

    assert_eq!(embed["description"].as_str(), Some("Maple"));
}

#[test]
fn offline_uses_rich_title_without_world_name() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "Offline".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = String::new();
    delivery.entry.content.world_id = String::new();
    delivery.entry.content.world_name = String::new();

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &DiscordEnrichment::default(),
    );
    let embed = &payload["embeds"][0];

    assert_eq!(embed["author"]["name"].as_str(), Some("Traveler"));
    assert_eq!(
        embed["title"].as_str(),
        Some("Traveler がログアウトしました")
    );
    assert!(embed.get("description").is_none());
    assert!(embed.get("footer").is_none());
}

#[test]
fn online_uses_rich_title() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "Online".into();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = String::new();
    delivery.entry.content.world_id = String::new();
    delivery.entry.content.world_name = String::new();

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &DiscordEnrichment::default(),
    );
    let embed = &payload["embeds"][0];

    assert_eq!(embed["author"]["name"].as_str(), Some("Traveler"));
    assert_eq!(embed["title"].as_str(), Some("Traveler がログインしました"));
    assert!(embed.get("footer").is_none());
}

#[test]
fn falls_back_to_legacy_for_unsupported_type() {
    let mut delivery = delivery();
    delivery.entry.activity_type = "Bio".into();
    delivery.entry.actor_display_name = "Traveler".into();
    let enrichment = DiscordEnrichment {
        actor_icon_url: "https://api.vrchat.cloud/api/1/image/file_icon/2/256".into(),
        world_image_url: "https://api.vrchat.cloud/api/1/file/file_world/8/file".into(),
        avatar_name: String::new(),
    };

    let payload = build_discord_payload_with_enrichment(
        &delivery,
        &rendered(),
        OverlayLocale::Ja,
        &enrichment,
    );
    let embed = &payload["embeds"][0];

    assert_eq!(embed["author"]["name"].as_str(), Some("Traveler"));
    assert_eq!(
        embed["author"]["icon_url"].as_str(),
        Some("https://api.vrchat.cloud/api/1/image/file_icon/2/256")
    );
    assert!(embed.get("footer").is_none());
    assert_eq!(embed["thumbnail"]["url"].as_str(), None);
}

fn rendered() -> RenderedNotification {
    RenderedNotification {
        title: "Traveler".into(),
        body: "joined Named World".into(),
        text: "Traveler joined Named World".into(),
        display_location: "Named World Public".into(),
        image_url: String::new(),
    }
}

fn delivery() -> OverlayActivityDelivery {
    OverlayActivityDelivery {
        entry: OverlayActivityEntry {
            sequence: 1,
            source_id: "game-log:join".into(),
            activity_type: "OnPlayerJoined".into(),
            category: OverlayActivityCategory::CurrentInstance,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_traveler".into(),
            actor_display_name: "Traveler".into(),
            content: OverlayActivityContent {
                location: "wrld_named:123".into(),
                world_id: "wrld_named".into(),
                display_location: "Named World Public".into(),
                world_name: "Named World".into(),
                ..OverlayActivityContent::default()
            },
            actor_relation: OverlayActivityActorRelation::None,
            payload: json!({}),
        },
        desktop: false,
        vr: false,
        hmd: false,
        webhook: true,
        tts: false,
    }
}
