use serde_json::{json, Value};
use vrcx_0_application::{OverlayActivityDelivery, OverlayActivityEntry};
use vrcx_0_core::location::{launch_url, parse_location, region_label};
use vrcx_0_core::vrchat_endpoints::VRCHAT_SITE_ORIGIN;

use crate::notification::rendered::RenderedNotification;
use crate::vr_overlay::{
    discord_embed_kind, discord_title_key, DiscordEmbedKind, OverlayLocale, OverlayLocalizer,
};

use super::resolve::{
    resolve_actor_icon_url, resolve_avatar_name, resolve_world_thumbnail_url, DiscordDeps,
};

#[derive(Clone, Debug, Default)]
struct DiscordEnrichment {
    actor_icon_url: String,
    world_image_url: String,
    avatar_name: String,
}

pub(crate) async fn build_discord_payload(
    deps: &DiscordDeps<'_>,
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    locale: OverlayLocale,
) -> Value {
    let entry = &delivery.entry;
    let kind = discord_embed_kind(&entry.activity_type);
    let has_rich = discord_title_key(&entry.activity_type).is_some();
    let actor_icon = resolve_actor_icon_url(deps, delivery);
    let world_image = async {
        if has_rich {
            resolve_world_thumbnail_url(deps, delivery).await
        } else {
            String::new()
        }
    };
    let avatar_name = async {
        if kind == DiscordEmbedKind::AvatarChange && entry.content.avatar_name.trim().is_empty() {
            resolve_avatar_name(deps, delivery).await
        } else {
            String::new()
        }
    };
    let (actor_icon_url, world_image_url, avatar_name) =
        tokio::join!(actor_icon, world_image, avatar_name);
    let enrichment = DiscordEnrichment {
        actor_icon_url,
        world_image_url,
        avatar_name,
    };
    build_discord_payload_with_enrichment(delivery, render, locale, &enrichment)
}

fn build_discord_payload_with_enrichment(
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    locale: OverlayLocale,
    enrichment: &DiscordEnrichment,
) -> Value {
    let entry = &delivery.entry;
    if discord_title_key(&entry.activity_type).is_none() {
        return discord_legacy_embed(delivery, render, enrichment);
    }
    let localizer = OverlayLocalizer::new(locale);
    let parsed = parse_location(&entry.content.location);

    let mut title = localizer.discord_title(&entry.activity_type, &entry.actor_display_name);
    if title.trim().is_empty() {
        title = render.text.clone();
    }

    let mut description = String::new();
    match discord_embed_kind(&entry.activity_type) {
        DiscordEmbedKind::Invite => {
            let message = entry.content.detail.trim();
            if !message.is_empty() && message != render.display_location.trim() {
                description.push_str(&format!("\u{300c}{message}\u{300d}"));
            }
        }
        DiscordEmbedKind::Gps => {
            let content = &entry.content;
            let target = if !content.world_name.trim().is_empty() {
                content.world_name.trim()
            } else if !render.display_location.trim().is_empty() {
                render.display_location.trim()
            } else if !render.body.trim().is_empty() {
                render.body.trim()
            } else {
                render.text.trim()
            };
            if !target.is_empty() {
                description.push_str(&format!("\u{2192} {target}"));
            }
        }
        DiscordEmbedKind::Status => {
            let status = localizer.status_text(&entry.content.status);
            if !status.is_empty() {
                description.push_str(&status);
            }
        }
        DiscordEmbedKind::AvatarChange => {
            let avatar = entry.content.avatar_name.trim();
            let avatar = if avatar.is_empty() {
                enrichment.avatar_name.trim()
            } else {
                avatar
            };
            if !avatar.is_empty() {
                description.push_str(avatar);
            }
        }
        DiscordEmbedKind::Other => {}
    }

    let author = build_discord_author(entry, &enrichment.actor_icon_url);

    let mut footer = String::new();
    if !parsed.instance_name.is_empty() {
        footer.push_str(&format!("#{}", parsed.instance_name));
        let access = localizer.access_label(&parsed);
        if !access.is_empty() {
            footer.push_str(&format!(" - {access}"));
        }
        let region = region_label(&parsed.region);
        if !region.is_empty() {
            footer.push_str(&format!(" \u{00b7} {region}"));
        }
    }

    let thumbnail_url = if enrichment.world_image_url.trim().is_empty() {
        render.image_url.trim()
    } else {
        enrichment.world_image_url.trim()
    };
    let thumbnail = if thumbnail_url.is_empty() {
        json!({})
    } else {
        json!({ "url": thumbnail_url })
    };

    let mut embed = serde_json::Map::new();
    embed.insert("title".into(), Value::String(title));
    if !description.is_empty() {
        embed.insert("description".into(), Value::String(description));
    }
    let url = launch_url(&parsed);
    if !url.is_empty() {
        embed.insert("url".into(), Value::String(url));
    }
    if !author.is_empty() {
        embed.insert("author".into(), Value::Object(author));
    }
    if !footer.is_empty() {
        embed.insert("footer".into(), json!({ "text": footer }));
    }
    embed.insert("timestamp".into(), Value::String(entry.created_at.clone()));
    embed.insert("thumbnail".into(), thumbnail);

    json!({
        "content": null,
        "embeds": [Value::Object(embed)],
    })
}

fn build_discord_author(
    entry: &OverlayActivityEntry,
    actor_icon_url: &str,
) -> serde_json::Map<String, Value> {
    let mut author = serde_json::Map::new();
    if !entry.actor_display_name.trim().is_empty() {
        author.insert(
            "name".into(),
            Value::String(entry.actor_display_name.clone()),
        );
    }
    if !entry.actor_user_id.trim().is_empty() {
        author.insert(
            "url".into(),
            Value::String(format!(
                "{VRCHAT_SITE_ORIGIN}/home/user/{}",
                entry.actor_user_id
            )),
        );
    }
    if !actor_icon_url.trim().is_empty() {
        author.insert("icon_url".into(), Value::String(actor_icon_url.to_string()));
    }
    author
}

fn discord_legacy_embed(
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    enrichment: &DiscordEnrichment,
) -> Value {
    let entry = &delivery.entry;
    let description = if !render.body.trim().is_empty() {
        String::new()
    } else if !render.display_location.trim().is_empty() {
        format!("\u{2192} {}", render.display_location)
    } else if !entry.content.world_name.trim().is_empty() {
        format!("\u{2192} {}", entry.content.world_name)
    } else {
        String::new()
    };
    let thumbnail = if render.image_url.trim().is_empty() {
        json!({})
    } else {
        json!({ "url": render.image_url })
    };
    let author = build_discord_author(entry, &enrichment.actor_icon_url);
    let title = if author.is_empty() || render.body.trim().is_empty() {
        render.text.clone()
    } else {
        render.body.clone()
    };
    let mut embed = serde_json::Map::new();
    if !author.is_empty() {
        embed.insert("author".into(), Value::Object(author));
    }
    embed.insert("title".into(), Value::String(title));
    if !description.is_empty() {
        embed.insert("description".into(), Value::String(description));
    }
    embed.insert("thumbnail".into(), thumbnail);
    embed.insert("timestamp".into(), Value::String(entry.created_at.clone()));
    json!({
        "content": null,
        "embeds": [embed],
    })
}

#[cfg(test)]
mod tests {
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
            webhook: true,
        }
    }
}
