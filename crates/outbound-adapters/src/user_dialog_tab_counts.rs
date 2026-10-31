use std::collections::HashSet;
use std::sync::Arc;

use serde::de::{IgnoredAny, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use url::Url;
use uuid::Uuid;
use vrcx_0_application::social::{
    AvatarProviderConfig, AvatarReleaseStatus, UserDialogCountPage, UserDialogFavoriteGroupPage,
    UserDialogTabCountsFuture, UserDialogTabCountsSource, DEFAULT_AVATAR_PROVIDER,
};
use vrcx_0_application_core::{
    vrchat_api::{VrchatApiRequest, VrchatScope},
    Error, Result, WebClient,
};
use vrcx_0_contracts::VrchatJsonResponse;
use vrcx_0_integrations::external_api::{self, ExternalApiScope};
use vrcx_0_persistence::{config, DatabaseService};
use vrcx_0_vrchat_client::{
    avatars::{avatar_list_by_user_get_input, AvatarListByUserGetInput},
    favorites::{favorite_groups_get_input, favorite_worlds_get_input},
    groups::user_groups_get_input,
    query::{AvatarListSort, QueryOrder, ReleaseStatusFilter, WorldSearchSort},
    users::user_mutual_counts_get_input,
    worlds::world_list_by_user_get_input,
};

const AVATAR_PROVIDER_ENABLED_KEY: &str = "avatarRemoteDatabase";
const AVATAR_PROVIDER_LIST_KEY: &str = "VRCX_avatarRemoteDatabaseProviderList";
const AVATAR_PROVIDER_SELECTED_KEY: &str = "VRCX_avatarRemoteDatabaseProvider";
const VRCX_ID_KEY: &str = "id";

pub struct LocalUserDialogTabCountsSource {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
}

impl LocalUserDialogTabCountsSource {
    pub fn new(db: Arc<DatabaseService>, web: Arc<WebClient>) -> Self {
        Self { db, web }
    }

    async fn execute_vrchat_payload(
        &self,
        request: VrchatApiRequest,
        source: &str,
    ) -> Result<String> {
        let response = self.web.execute_api(request, VrchatScope::Vrchat).await?;
        validate_vrchat_payload(response.status, &response.data, source)?;
        Ok(response.data)
    }
}

impl UserDialogTabCountsSource for LocalUserDialogTabCountsSource {
    fn avatar_provider_config(&self) -> Result<AvatarProviderConfig> {
        Ok(AvatarProviderConfig {
            enabled: config::get_bool(&self.db, AVATAR_PROVIDER_ENABLED_KEY, true)?,
            providers: config::get_json(
                &self.db,
                AVATAR_PROVIDER_LIST_KEY,
                serde_json::json!([DEFAULT_AVATAR_PROVIDER]),
            )?
            .into(),
            selected: config::get_string(&self.db, AVATAR_PROVIDER_SELECTED_KEY, "")?,
        })
    }

    fn mutual_friend_count<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
    ) -> UserDialogTabCountsFuture<'a, usize> {
        Box::pin(async move {
            let request =
                user_mutual_counts_get_input(endpoint.to_string(), user_id.to_string())?.1;
            let payload = self
                .execute_vrchat_payload(request, "mutual friends")
                .await?;
            parse_mutual_friend_count(&payload)
        })
    }

    fn group_count<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
    ) -> UserDialogTabCountsFuture<'a, usize> {
        Box::pin(async move {
            let request = user_groups_get_input(endpoint.to_string(), user_id.to_string())?.1;
            let payload = self.execute_vrchat_payload(request, "groups").await?;
            Ok(parse_count_page(&payload)?.selected_count)
        })
    }

    fn worlds_page<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        n: i32,
        offset: i32,
        release_status: AvatarReleaseStatus,
    ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage> {
        Box::pin(async move {
            let request = world_list_by_user_get_input(
                endpoint.to_string(),
                user_id.to_string(),
                n,
                offset,
                WorldSearchSort::Updated,
                QueryOrder::Descending,
                release_status_filter(release_status),
            )?
            .1;
            let payload = self.execute_vrchat_payload(request, "worlds").await?;
            parse_count_page(&payload)
        })
    }

    fn favorite_worlds_page<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        group_name: &'a str,
        n: i32,
        offset: i32,
    ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage> {
        Box::pin(async move {
            let request = favorite_worlds_get_input(
                endpoint.to_string(),
                n,
                offset,
                user_id.to_string(),
                user_id.to_string(),
                group_name.to_string(),
            );
            let payload = self
                .execute_vrchat_payload(request, "favorite worlds")
                .await?;
            parse_count_page(&payload)
        })
    }

    fn favorite_groups_page<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        n: i32,
        offset: i32,
    ) -> UserDialogTabCountsFuture<'a, UserDialogFavoriteGroupPage> {
        Box::pin(async move {
            let request =
                favorite_groups_get_input(endpoint.to_string(), n, offset, user_id.to_string());
            let payload = self
                .execute_vrchat_payload(request, "favorite groups")
                .await?;
            parse_favorite_group_page(&payload)
        })
    }

    fn my_avatars_page<'a>(
        &'a self,
        endpoint: &'a str,
        n: i32,
        offset: i32,
        release_status: AvatarReleaseStatus,
    ) -> UserDialogTabCountsFuture<'a, UserDialogCountPage> {
        Box::pin(async move {
            let request = avatar_list_by_user_get_input(AvatarListByUserGetInput {
                endpoint: endpoint.to_string(),
                user_id: String::new(),
                user: "me".into(),
                n,
                offset,
                sort: AvatarListSort::Updated,
                order: QueryOrder::Descending,
                release_status: ReleaseStatusFilter::All,
            })?
            .1;
            let payload = self.execute_vrchat_payload(request, "my avatars").await?;
            parse_my_avatar_page(&payload, release_status)
        })
    }

    fn external_avatar_count<'a>(
        &'a self,
        provider: &'a str,
        target_user_id: &'a str,
    ) -> UserDialogTabCountsFuture<'a, usize> {
        Box::pin(async move {
            let mut url = Url::parse(provider)
                .map_err(|error| Error::Custom(format!("Invalid avatar provider URL: {error}")))?;
            let retained_query = url
                .query_pairs()
                .filter(|(key, _)| key != "search" && key != "n")
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect::<Vec<_>>();
            url.set_query(None);
            {
                let mut query = url.query_pairs_mut();
                query.extend_pairs(retained_query);
                query.append_pair("search", target_user_id);
                query.append_pair("n", "5000");
            }

            let mut vrcx_id = config::get_string(&self.db, VRCX_ID_KEY, "")?
                .trim()
                .to_string();
            if vrcx_id.is_empty() {
                vrcx_id = Uuid::new_v4().to_string();
                config::set_string(&self.db, VRCX_ID_KEY, &vrcx_id)?;
            }
            let input = external_api::avatar_search_get_input(url.as_str(), &vrcx_id);
            let request =
                external_api::build_web_execute_request(input, ExternalApiScope::AvatarSearch)
                    .map_err(|error| Error::Custom(error.to_string()))?;
            let (status, payload) = self.web.execute_external(request).await?;
            parse_external_avatar_count(status, &payload, target_user_id)
        })
    }
}

fn validate_vrchat_payload(status: i32, payload: &str, source: &str) -> Result<()> {
    if status >= 400 || payload.trim_start().starts_with('{') {
        let parsed = VrchatJsonResponse::parse(status, payload);
        if parsed.is_failure() {
            return Err(Error::Custom(format!(
                "User dialog {source} count request failed: {}",
                parsed.error_message_or("VRChat API request failed")
            )));
        }
    }
    Ok(())
}

fn parse_mutual_friend_count(payload: &str) -> Result<usize> {
    let value = serde_json::from_str::<Value>(payload)?;
    value
        .get("friends")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| Error::Custom("Mutual friend count response is invalid.".into()))
}

fn parse_count_page(payload: &str) -> Result<UserDialogCountPage> {
    let row_count = json_array_len(payload)?;
    Ok(UserDialogCountPage {
        row_count,
        selected_count: row_count,
    })
}

fn json_array_len(payload: &str) -> Result<usize> {
    struct ArrayLenVisitor;

    impl<'de> Visitor<'de> for ArrayLenVisitor {
        type Value = usize;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a JSON array")
        }

        fn visit_seq<A>(self, mut sequence: A) -> std::result::Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut count = 0;
            while sequence.next_element::<IgnoredAny>()?.is_some() {
                count += 1;
            }
            Ok(count)
        }
    }

    let mut deserializer = serde_json::Deserializer::from_str(payload);
    Ok(deserializer.deserialize_seq(ArrayLenVisitor)?)
}

#[derive(Deserialize)]
struct FavoriteGroupCountRow {
    #[serde(default)]
    name: Value,
    #[serde(default, rename = "type")]
    kind: Value,
}

fn parse_favorite_group_page(payload: &str) -> Result<UserDialogFavoriteGroupPage> {
    let rows = serde_json::from_str::<Vec<FavoriteGroupCountRow>>(payload)?;
    let row_count = rows.len();
    let world_group_names = rows
        .into_iter()
        .filter(|row| row.kind.as_str() == Some("world"))
        .filter_map(|row| {
            row.name
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .collect();
    Ok(UserDialogFavoriteGroupPage {
        row_count,
        world_group_names,
    })
}

#[derive(Deserialize)]
struct AvatarSearchCountRow {
    #[serde(
        default,
        alias = "Id",
        alias = "_id",
        alias = "avatarId",
        alias = "AvatarId"
    )]
    id: Value,
    #[serde(default, rename = "authorId", alias = "AuthorId", alias = "author_id")]
    author_id: Value,
}

fn parse_external_avatar_count(status: i32, payload: &str, user_id: &str) -> Result<usize> {
    if status != 200 {
        return Err(Error::Custom(format!(
            "Avatar search count request failed with status {status}."
        )));
    }

    struct TargetAvatarCountVisitor<'a> {
        user_id: &'a str,
    }

    impl<'de> Visitor<'de> for TargetAvatarCountVisitor<'_> {
        type Value = usize;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a JSON avatar array")
        }

        fn visit_seq<A>(self, mut sequence: A) -> std::result::Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut avatar_ids = HashSet::new();
            while let Some(row) = sequence.next_element::<AvatarSearchCountRow>()? {
                let author_id = row.author_id.as_str().map(str::trim).unwrap_or_default();
                if author_id != self.user_id {
                    continue;
                }
                let avatar_id = row.id.as_str().map(str::trim).unwrap_or_default();
                if !avatar_id.is_empty() {
                    avatar_ids.insert(avatar_id.to_string());
                }
            }
            Ok(avatar_ids.len())
        }
    }

    let mut deserializer = serde_json::Deserializer::from_str(payload);
    Ok(deserializer.deserialize_seq(TargetAvatarCountVisitor { user_id })?)
}

#[derive(Deserialize)]
struct MyAvatarCountRow {
    #[serde(default, rename = "releaseStatus")]
    release_status: Value,
}

fn parse_my_avatar_page(
    payload: &str,
    release_status: AvatarReleaseStatus,
) -> Result<UserDialogCountPage> {
    let rows = serde_json::from_str::<Vec<MyAvatarCountRow>>(payload)?;
    let row_count = rows.len();
    let selected_count = if release_status == AvatarReleaseStatus::All {
        row_count
    } else {
        rows.iter()
            .filter(|row| row.release_status.as_str() == Some(release_status.as_str()))
            .count()
    };
    Ok(UserDialogCountPage {
        row_count,
        selected_count,
    })
}

fn release_status_filter(status: AvatarReleaseStatus) -> ReleaseStatusFilter {
    match status {
        AvatarReleaseStatus::All => ReleaseStatusFilter::All,
        AvatarReleaseStatus::Hidden => ReleaseStatusFilter::Hidden,
        AvatarReleaseStatus::Private => ReleaseStatusFilter::Private,
        AvatarReleaseStatus::Public => ReleaseStatusFilter::Public,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vrchat_payload_validation_preserves_source_specific_api_errors() {
        assert_eq!(
            validate_vrchat_payload(
                403,
                r#"{"error":{"message":"permission denied"}}"#,
                "groups",
            )
            .unwrap_err()
            .to_string(),
            "User dialog groups count request failed: permission denied"
        );
    }

    #[test]
    fn mutual_friend_parser_requires_a_numeric_friends_count() {
        assert_eq!(parse_mutual_friend_count(r#"{"friends":7}"#).unwrap(), 7);
        assert_eq!(
            parse_mutual_friend_count(r#"{"friends":"seven"}"#)
                .unwrap_err()
                .to_string(),
            "Mutual friend count response is invalid."
        );
    }

    #[test]
    fn favorite_group_parser_only_keeps_named_world_groups() {
        let payload = serde_json::json!([
            { "name": "worlds1", "type": "world" },
            { "name": "avatars1", "type": "avatar" },
            { "name": "  worlds2  ", "type": "world" },
            { "name": "", "type": "world" }
        ])
        .to_string();

        assert_eq!(
            parse_favorite_group_page(&payload).unwrap(),
            UserDialogFavoriteGroupPage {
                row_count: 4,
                world_group_names: vec!["worlds1".into(), "worlds2".into()],
            }
        );
    }

    #[test]
    fn external_avatar_parser_deduplicates_target_ids_and_rejects_http_errors() {
        let payload = serde_json::json!([
            { "id": "avtr_1", "authorId": "usr_target" },
            { "Id": "avtr_1", "AuthorId": "usr_target" },
            { "avatarId": "avtr_2", "author_id": "usr_target" },
            { "id": "avtr_3", "authorId": "usr_other" }
        ])
        .to_string();

        assert_eq!(
            parse_external_avatar_count(200, &payload, "usr_target").unwrap(),
            2
        );
        assert_eq!(
            parse_external_avatar_count(503, &payload, "usr_target")
                .unwrap_err()
                .to_string(),
            "Avatar search count request failed with status 503."
        );
    }

    #[test]
    fn my_avatar_page_filters_by_release_status_but_keeps_raw_page_length() {
        let payload = serde_json::json!([
            { "id": "avtr_public", "releaseStatus": "public" },
            { "id": "avtr_private", "releaseStatus": "private" },
            { "id": "avtr_public_2", "releaseStatus": "public" }
        ])
        .to_string();

        assert_eq!(
            parse_my_avatar_page(&payload, AvatarReleaseStatus::Public).unwrap(),
            UserDialogCountPage {
                row_count: 3,
                selected_count: 2,
            }
        );
    }
}
