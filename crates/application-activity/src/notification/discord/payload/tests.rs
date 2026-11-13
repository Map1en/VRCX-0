use crate::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
};

use super::*;
use vrcx_0_contracts::activity::ActivityKind;

#[test]
fn builds_rich_invite_embed_with_explicit_enrichment() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::Invite;
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

    assert!(embed["title"]
        .as_str()
        .is_some_and(|title| title.contains("Example")));
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
    let footer = embed["footer"]["text"].as_str().unwrap();
    assert!(footer.contains("#810"));
    assert!(footer.contains("JP"));
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
    delivery.entry.kind = ActivityKind::Gps;
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

    let footer = embed["footer"]["text"].as_str().unwrap();
    assert!(footer.contains("#48291"));
    assert!(footer.contains("USW"));
}

#[test]
fn gps_uses_location_title_without_message() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::Gps;
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

    assert!(embed["title"]
        .as_str()
        .is_some_and(|title| !title.is_empty()));
    assert!(embed["description"]
        .as_str()
        .is_some_and(|description| description.contains("Named World")));
    let footer = embed["footer"]["text"].as_str().unwrap();
    assert!(footer.contains("#810"));
    assert!(footer.contains("JP"));
}

#[test]
fn status_uses_status_title_and_target() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::Status;
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

    assert!(embed["title"]
        .as_str()
        .is_some_and(|title| !title.is_empty()));
    assert!(embed["description"]
        .as_str()
        .is_some_and(|description| !description.is_empty()));
    assert!(embed.get("footer").is_none());
}

#[test]
fn avatar_change_uses_enriched_avatar_name_without_mutating_delivery() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::AvatarChange;
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

    assert!(embed["title"]
        .as_str()
        .is_some_and(|title| title.contains("Traveler")));
    assert_eq!(embed["description"].as_str(), Some("Maple"));
    assert!(delivery.entry.content.avatar_name.is_empty());
}

#[test]
fn avatar_change_prefers_existing_avatar_name() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::AvatarChange;
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
    delivery.entry.kind = ActivityKind::Offline;
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
    assert!(embed["title"]
        .as_str()
        .is_some_and(|title| title.contains("Traveler")));
    assert!(embed.get("description").is_none());
    assert!(embed.get("footer").is_none());
}

#[test]
fn online_uses_rich_title() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::Online;
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
    assert!(embed["title"]
        .as_str()
        .is_some_and(|title| title.contains("Traveler")));
    assert!(embed.get("footer").is_none());
}

#[test]
fn falls_back_to_legacy_for_unsupported_type() {
    let mut delivery = delivery();
    delivery.entry.kind = ActivityKind::Bio;
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

fn delivery() -> ActivityDelivery {
    ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: "game-log:join".into(),
            kind: ActivityKind::OnPlayerJoined,
            category: ActivityCategory::CurrentInstance,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_traveler".into(),
            actor_display_name: "Traveler".into(),
            content: ActivityContent {
                location: "wrld_named:123".into(),
                world_id: "wrld_named".into(),
                display_location: "Named World Public".into(),
                world_name: "Named World".into(),
                ..ActivityContent::default()
            },
            actor_relation: ActivityActorRelation::None,
        },
        desktop: false,
        vr: false,
        hmd: false,
        webhook: true,
        tts: false,
        widget: false,
    }
}

#[test]
fn every_activity_type_renders_text_and_both_webhook_payloads_in_every_locale() {
    use crate::notification::{generic_webhook_payload, parse_webhook_fields, render_delivery};
    use crate::{activity_type_definitions, ActivityFilters, ActivityRouter, ActivityScope};
    use vrcx_0_contracts::activity::{
        ActivityActor, ActivityEvent, ActivityFacts, ActivitySubject,
    };

    let definitions = activity_type_definitions();
    let desktop_types = definitions
        .iter()
        .map(|definition| {
            let scope = if definition.allowed_scopes.contains(&ActivityScope::On) {
                "on"
            } else if definition.allowed_scopes.contains(&ActivityScope::Friends) {
                "friends"
            } else {
                "allFavorites"
            };
            (
                definition.key.key().to_string(),
                serde_json::json!({ "scope": scope }),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    let router = ActivityRouter::with_filters(ActivityFilters::from_json(
        serde_json::json!({ "desktop": { "types": desktop_types } }),
    ));
    router.set_friend_user_ids(["usr_actor"]);
    router.set_group_favorite_groups(crate::ActivityFavoriteGroups::from_pairs([(
        "group:all",
        ["grp_all"].as_slice(),
    )]));
    let fields = parse_webhook_fields("");

    for definition in definitions {
        let kind = definition.key;
        let mut event = ActivityEvent::new(
            kind,
            format!("{}:all", kind.key()),
            "2026-10-02T00:00:00.000Z",
        );
        event.actor = ActivityActor::new("usr_actor", "Actor");
        event.subject = if kind == ActivityKind::GroupInstanceOpened {
            ActivitySubject::Group("grp_all".into())
        } else {
            ActivitySubject::User("usr_actor".into())
        };
        event.facts = ActivityFacts {
            location: "wrld_all:123".into(),
            world_id: "wrld_all".into(),
            world_name: "All World".into(),
            group_id: "grp_all".into(),
            group_name: "All Group".into(),
            title: "Title".into(),
            message: "Message".into(),
            status: "active".into(),
            avatar_name: "Avatar".into(),
            previous_display_name: "Old Actor".into(),
            trust_level: "Trusted".into(),
            video: "Video".into(),
            ..ActivityFacts::default()
        };
        let entry = router
            .ingest(event)
            .unwrap_or_else(|| panic!("{} should ingest", kind.key()));
        let delivery = ActivityDelivery {
            entry,
            desktop: true,
            vr: true,
            hmd: true,
            webhook: true,
            tts: true,
            widget: false,
        };

        for locale in [
            OverlayLocale::En,
            OverlayLocale::ZhCn,
            OverlayLocale::ZhTw,
            OverlayLocale::Ja,
            OverlayLocale::Ko,
        ] {
            let label = format!("{} in {locale:?}", kind.key());
            let render = render_delivery(&delivery, locale, false);
            assert!(!render.text.trim().is_empty(), "{label}: text");
            assert!(!render.title.trim().is_empty(), "{label}: title");

            let generic = generic_webhook_payload(&delivery, &render, &fields);
            assert!(
                generic.as_object().is_some_and(|object| !object.is_empty()),
                "{label}: generic webhook"
            );

            let discord = build_discord_payload_with_enrichment(
                &delivery,
                &render,
                locale,
                &DiscordEnrichment::default(),
            );
            let embed = &discord["embeds"][0];
            if matches!(
                kind,
                ActivityKind::OnPlayerJoining
                    | ActivityKind::OnPlayerJoined
                    | ActivityKind::OnPlayerLeft
                    | ActivityKind::LobbyAvatarChange
                    | ActivityKind::Bio
                    | ActivityKind::Friend
                    | ActivityKind::Unfriend
                    | ActivityKind::DisplayName
                    | ActivityKind::TrustLevel
                    | ActivityKind::FriendRequest
                    | ActivityKind::Boop
                    | ActivityKind::GroupChange
                    | ActivityKind::BlockedOnPlayerJoined
                    | ActivityKind::BlockedOnPlayerLeft
                    | ActivityKind::MutedOnPlayerJoined
                    | ActivityKind::MutedOnPlayerLeft
            ) {
                let name = if kind == ActivityKind::DisplayName {
                    "Old Actor"
                } else {
                    "Actor"
                };
                assert!(
                    embed["title"]
                        .as_str()
                        .is_some_and(|title| title.contains(name)),
                    "{label}: discord title includes the user name"
                );
            }
            assert!(
                ["title", "description"].iter().any(|field| embed[*field]
                    .as_str()
                    .is_some_and(|text| !text.trim().is_empty())),
                "{label}: discord embed"
            );
        }
    }
}
