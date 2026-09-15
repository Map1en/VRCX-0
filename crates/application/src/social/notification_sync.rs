use futures_util::future::BoxFuture;

use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_realtime::{normalize_v1_notification, normalize_v2_notification};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::NotificationKind;

use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_application_core::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot};

const NOTIFICATION_SYNC_PAGE_SIZE: i32 = 100;
const NOTIFICATION_SYNC_MAX_PAGES: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationSyncSource {
    V1,
    V2,
    HiddenFriendRequests,
}

pub struct NotificationSyncWrite {
    pub owner_user_id: String,
    pub visible_friend_requests: Vec<RawJson>,
    pub visible_complete: bool,
    pub hidden_friend_requests: Vec<RawJson>,
    pub hidden_complete: bool,
    pub notification_v1_upserts: Vec<RawJson>,
    pub notification_v2_upserts: Vec<RawJson>,
}

pub type NotificationSyncFuture<'a> = BoxFuture<'a, Result<VrchatApiResponse>>;

pub trait NotificationSyncPort: Send + Sync {
    fn fetch_page<'a>(
        &'a self,
        endpoint: &'a str,
        source: NotificationSyncSource,
        n: i32,
        offset: i32,
    ) -> NotificationSyncFuture<'a>;
    fn persist(&self, write: NotificationSyncWrite) -> Result<()>;
}

pub struct NotificationSyncDeps<'a> {
    pub(crate) port: &'a dyn NotificationSyncPort,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
}

impl<'a> NotificationSyncDeps<'a> {
    pub fn new(
        port: &'a dyn NotificationSyncPort,
        auth_scope: &'a RuntimeAuthScope,
        expected_scope: RuntimeAuthScopeSnapshot,
    ) -> Self {
        Self {
            port,
            auth_scope,
            expected_scope,
        }
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSyncOutcome {
    pub v1_count: u32,
    pub v2_count: u32,
    pub hidden_friend_request_count: u32,
    pub truncated: bool,
}

struct NotificationPages {
    rows: Vec<Value>,
    complete: bool,
}

pub async fn sync_notifications(
    deps: &NotificationSyncDeps<'_>,
) -> Result<NotificationSyncOutcome> {
    ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
    let v1_pages = fetch_notification_pages(deps, NotificationSyncSource::V1).await?;
    let v2_pages = fetch_notification_pages(deps, NotificationSyncSource::V2).await?;
    let hidden_pages =
        fetch_notification_pages(deps, NotificationSyncSource::HiddenFriendRequests).await?;
    ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;

    let now = Utc::now().to_rfc3339();
    let v1 = v1_pages
        .rows
        .iter()
        .map(|notification| normalize_v1_notification(notification, &now))
        .filter(valid_notification)
        .collect::<Vec<_>>();
    let mut hidden_rows = hidden_pages
        .rows
        .iter()
        .map(|notification| normalize_v1_notification(notification, &now))
        .filter(valid_notification)
        .collect::<Vec<_>>();
    for notification in &mut hidden_rows {
        if let Some(object) = notification.as_object_mut() {
            object.insert(
                "type".into(),
                Value::String(NotificationKind::IgnoredFriendRequest.as_str().into()),
            );
        }
    }
    let v1_count = v1.len();
    let (visible_friend_requests, regular_v1): (Vec<_>, Vec<_>) =
        v1.into_iter().partition(|notification| {
            NotificationKind::from(notification_type(notification))
                == NotificationKind::FriendRequest
        });
    let v2_rows = v2_pages
        .rows
        .iter()
        .map(|notification| {
            normalize_v2_notification(notification, &deps.expected_scope.endpoint, &now)
        })
        .filter(valid_notification)
        .collect::<Vec<_>>();

    let hidden_friend_request_count = hidden_rows.len();
    let v2_count = v2_rows.len();
    deps.port.persist(NotificationSyncWrite {
        owner_user_id: deps.expected_scope.current_user_id.clone(),
        visible_friend_requests: visible_friend_requests
            .into_iter()
            .map(RawJson::from)
            .collect(),
        visible_complete: v1_pages.complete,
        hidden_friend_requests: hidden_rows.into_iter().map(RawJson::from).collect(),
        hidden_complete: hidden_pages.complete,
        notification_v1_upserts: regular_v1.into_iter().map(RawJson::from).collect(),
        notification_v2_upserts: v2_rows.into_iter().map(RawJson::from).collect(),
    })?;

    Ok(NotificationSyncOutcome {
        v1_count: crate::wire_count(v1_count),
        v2_count: crate::wire_count(v2_count),
        hidden_friend_request_count: crate::wire_count(hidden_friend_request_count),
        truncated: !v1_pages.complete || !v2_pages.complete || !hidden_pages.complete,
    })
}

async fn fetch_notification_pages(
    deps: &NotificationSyncDeps<'_>,
    source: NotificationSyncSource,
) -> Result<NotificationPages> {
    let mut rows = Vec::new();
    for page in 0..NOTIFICATION_SYNC_MAX_PAGES {
        ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
        let response = deps
            .port
            .fetch_page(
                &deps.expected_scope.endpoint,
                source,
                NOTIFICATION_SYNC_PAGE_SIZE,
                page as i32 * NOTIFICATION_SYNC_PAGE_SIZE,
            )
            .await?;
        let response = vrcx_0_contracts::VrchatJsonResponse::from(&response);
        if response.is_failure() {
            return Err(Error::Custom(
                response.error_message_with_http_status("VRChat notification sync failed"),
            ));
        }
        let page_rows = response.json.as_array().cloned().ok_or_else(|| {
            Error::Custom("VRChat notification sync returned a non-array response.".into())
        })?;
        let complete = page_rows.len() < NOTIFICATION_SYNC_PAGE_SIZE as usize;
        rows.extend(page_rows);
        if complete {
            return Ok(NotificationPages {
                rows,
                complete: true,
            });
        }
    }
    Ok(NotificationPages {
        rows,
        complete: false,
    })
}

fn valid_notification(notification: &Value) -> bool {
    notification
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.trim().is_empty())
        && !notification_type(notification).is_empty()
}

fn notification_type(notification: &Value) -> &str {
    notification
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_snapshot_scope_matches(current, expected, "Notification sync")
}
