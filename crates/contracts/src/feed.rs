use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use vrcx_0_core::text::normalize_text;

use crate::feed_live::FeedLiveEntry;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FeedQueryMode {
    Search,
    Lookup,
    Instance,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum FeedFilter {
    #[serde(rename = "GPS")]
    Gps,
    Status,
    Bio,
    Avatar,
    Online,
    Offline,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedCursorInput {
    pub created_at: String,
    pub source_rank: i64,
    pub row_id: i64,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowsQueryInput {
    pub user_id: String,
    pub mode: FeedQueryMode,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<FeedFilter>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    #[serde(default)]
    pub scoped_user_ids: Vec<String>,
    #[serde(default)]
    pub excluded_user_ids: Vec<String>,
    #[serde(default)]
    pub location_hidden_user_ids: Vec<String>,
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub cursor: Option<FeedCursorInput>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedLatestQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub filters: Vec<FeedFilter>,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub scoped_user_ids: Vec<String>,
    #[serde(default)]
    pub excluded_user_ids: Vec<String>,
    #[serde(default)]
    pub location_hidden_user_ids: Vec<String>,
    #[serde(default)]
    pub favorites_only: bool,
    pub max_rows: i64,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedSearchQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<FeedFilter>,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub scoped_user_ids: Vec<String>,
    #[serde(default)]
    pub excluded_user_ids: Vec<String>,
    #[serde(default)]
    pub location_hidden_user_ids: Vec<String>,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    pub max_rows: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveEntryInput {
    pub sequence: i64,
    pub entry: FeedLiveEntry,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelOutput {
    pub rows: Vec<FeedRowOutput>,
    pub max_sequence: i64,
    pub persisted_cursor: Option<FeedCursorInput>,
    pub persisted_has_more: bool,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rank: Option<i64>,
    #[serde(rename = "created_at")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_avatar_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_avatar_thumbnail_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_avatar_tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_avatar_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_current_avatar_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_current_avatar_thumbnail_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_current_avatar_tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
}

pub struct FeedLiveQueryMatcher {
    current_user_id: String,
    filters: Vec<FeedFilter>,
    search: String,
    date_from: String,
    date_to: String,
    favorites_only: bool,
    favorite_user_ids: HashSet<String>,
    scoped_user_ids: HashSet<String>,
    excluded_user_ids: HashSet<String>,
    location_hidden_user_ids: HashSet<String>,
    max_rows: Option<usize>,
}

#[derive(Clone, Copy)]
pub struct FeedLiveQueryParts<'a> {
    pub current_user_id: &'a str,
    pub filters: &'a [FeedFilter],
    pub search: &'a str,
    pub date_from: &'a str,
    pub date_to: &'a str,
    pub favorites_only: bool,
    pub favorite_user_ids: &'a [String],
    pub scoped_user_ids: &'a [String],
    pub excluded_user_ids: &'a [String],
    pub location_hidden_user_ids: &'a [String],
    pub max_rows: i64,
}

impl FeedLiveQueryMatcher {
    pub fn for_latest(query: &FeedLatestQueryInput) -> Self {
        Self::from_parts(FeedLiveQueryParts {
            current_user_id: &query.user_id,
            filters: &query.filters,
            search: "",
            date_from: "",
            date_to: "",
            favorites_only: query.favorites_only,
            favorite_user_ids: &query.favorite_user_ids,
            scoped_user_ids: &query.scoped_user_ids,
            excluded_user_ids: &query.excluded_user_ids,
            location_hidden_user_ids: &query.location_hidden_user_ids,
            max_rows: query.max_rows,
        })
    }

    pub fn for_search(query: &FeedSearchQueryInput) -> Self {
        Self::from_parts(FeedLiveQueryParts {
            current_user_id: &query.user_id,
            filters: &query.filters,
            search: &query.search,
            date_from: &query.date_from,
            date_to: &query.date_to,
            favorites_only: query.favorites_only,
            favorite_user_ids: &query.favorite_user_ids,
            scoped_user_ids: &query.scoped_user_ids,
            excluded_user_ids: &query.excluded_user_ids,
            location_hidden_user_ids: &query.location_hidden_user_ids,
            max_rows: query.max_rows,
        })
    }

    pub fn from_parts(parts: FeedLiveQueryParts<'_>) -> Self {
        Self {
            current_user_id: parts.current_user_id.to_string(),
            filters: parts.filters.to_vec(),
            search: parts.search.to_string(),
            date_from: parts.date_from.to_string(),
            date_to: parts.date_to.to_string(),
            favorites_only: parts.favorites_only,
            favorite_user_ids: normalize_user_ids(parts.favorite_user_ids),
            scoped_user_ids: normalize_user_ids(parts.scoped_user_ids),
            excluded_user_ids: normalize_user_ids(parts.excluded_user_ids),
            location_hidden_user_ids: normalize_user_ids(parts.location_hidden_user_ids),
            max_rows: (parts.max_rows > 0).then_some(parts.max_rows as usize),
        }
    }

    pub fn matches(&self, entry: &FeedLiveEntry) -> bool {
        let Some(entry_filter) = entry.filter() else {
            return false;
        };

        let owner_user_id = entry.owner_user_id();
        if !owner_user_id.is_empty() && owner_user_id != self.current_user_id {
            return false;
        }
        if !self.filters.is_empty() && !self.filters.contains(&entry_filter) {
            return false;
        }

        let user_id = entry.user_id();
        if self.favorites_only && (user_id.is_empty() || !self.favorite_user_ids.contains(user_id))
        {
            return false;
        }
        if !self.scoped_user_ids.is_empty() && !self.scoped_user_ids.contains(user_id) {
            return false;
        }
        if !user_id.is_empty() && self.excluded_user_ids.contains(user_id) {
            return false;
        }
        if entry_filter == FeedFilter::Gps
            && !user_id.is_empty()
            && self.location_hidden_user_ids.contains(user_id)
        {
            return false;
        }

        let created_at = entry.created_at();
        if !self.date_from.trim().is_empty()
            && !created_at.is_empty()
            && created_at < self.date_from.as_str()
        {
            return false;
        }
        if !self.date_to.trim().is_empty()
            && !created_at.is_empty()
            && created_at > self.date_to.as_str()
        {
            return false;
        }

        feed_search_matches(entry, &self.search)
    }

    pub fn max_rows(&self) -> Option<usize> {
        self.max_rows
    }

    pub fn matches_user_scope(&self, user_id: &str) -> bool {
        (self.scoped_user_ids.is_empty() || self.scoped_user_ids.contains(user_id))
            && (user_id.is_empty() || !self.excluded_user_ids.contains(user_id))
    }
}

fn normalize_user_ids(user_ids: &[String]) -> HashSet<String> {
    user_ids
        .iter()
        .map(normalize_text)
        .filter(|user_id| !user_id.is_empty())
        .collect()
}

fn feed_search_matches(entry: &FeedLiveEntry, search: &str) -> bool {
    let query = search.trim().to_uppercase();
    if query.is_empty() {
        return true;
    }

    if let Some(owner_id) = entry.avatar_owner_id() {
        let user_id = entry.user_id();
        if !user_id.is_empty()
            && !owner_id.is_empty()
            && ((query == "PRIVATE" && user_id == owner_id)
                || (query == "PUBLIC" && user_id != owner_id))
        {
            return true;
        }
    }

    if (query.starts_with("WRLD_") || query.starts_with("GRP_"))
        && entry.location().to_uppercase().contains(&query)
    {
        return true;
    }

    entry
        .search_fields()
        .iter()
        .any(|value| value.to_uppercase().contains(&query))
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldFriendVisitsOutput {
    pub friend_count: i64,
    pub last_visited_at: String,
    pub friends: Vec<WorldFriendVisitRow>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldFriendVisitRow {
    pub user_id: String,
    pub display_name: String,
    pub visit_count: i64,
    pub last_visited_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldRecentFriendCountRow {
    pub world_id: String,
    pub friend_count: i64,
}
