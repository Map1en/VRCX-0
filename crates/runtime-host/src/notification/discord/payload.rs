use serde_json::{json, Value};
use vrcx_0_application_activity::{OverlayActivityDelivery, OverlayActivityEntry};
use vrcx_0_core::location::{launch_url, parse_location, region_label};
use vrcx_0_core::vrchat_endpoints::VRCHAT_SITE_ORIGIN;

use crate::notification::{
    discord_embed_kind, discord_title_key, DiscordEmbedKind, OverlayLocale, OverlayLocalizer,
    RenderedNotification,
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
mod tests;
