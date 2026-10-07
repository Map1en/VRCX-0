use std::collections::BTreeSet;

use super::{activity_iso_from_ms, ActivityPageStore};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::social_aggregates::{
    CopresenceAudience, CopresenceGroupBy, CopresenceOrderBy, CopresenceSummaryInput,
    FadingFriendsInput, TimeWindow,
};
use vrcx_0_core::OwnerId;

use vrcx_0_contracts::activity_page::{
    ActivityCompanionOrder, ActivityPageCompanionRow, ActivityPageFadingRow, ActivityPagePeople,
};

const COMPANION_LIMIT: i64 = 10;
const FADING_LIMIT: i64 = 10;

pub(super) fn people(
    store: &impl ActivityPageStore,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
    utc_offset_minutes: i64,
    order: ActivityCompanionOrder,
) -> Result<ActivityPagePeople> {
    let window = TimeWindow {
        from: from_ms.map(activity_iso_from_ms),
        to: Some(activity_iso_from_ms(to_ms)),
    };

    let encountered = store.encountered_user_ids(owner_user_id, from_ms, Some(to_ms))?;
    let previously_encountered = match from_ms {
        Some(from_ms) => store.encountered_user_ids(owner_user_id, None, Some(from_ms))?,
        None => BTreeSet::new(),
    };
    let new_face_count = encountered
        .iter()
        .filter(|user_id| !previously_encountered.contains(*user_id))
        .count();

    Ok(ActivityPagePeople {
        order,
        companions: companions(
            store,
            owner_user_id,
            &window,
            utc_offset_minutes,
            match order {
                ActivityCompanionOrder::Minutes => CopresenceOrderBy::TotalMinutes,
                ActivityCompanionOrder::Days => CopresenceOrderBy::CoDays,
            },
            CopresenceAudience::Friends,
        )?,
        strangers: companions(
            store,
            owner_user_id,
            &window,
            utc_offset_minutes,
            CopresenceOrderBy::CoDays,
            CopresenceAudience::Strangers,
        )?,
        fading: fading(store, owner_user_id, from_ms, to_ms)?,
        encountered_count: i64::try_from(encountered.len()).unwrap_or(i64::MAX),
        new_face_count: i64::try_from(new_face_count).unwrap_or(i64::MAX),
    })
}

fn companions(
    store: &impl ActivityPageStore,
    owner_user_id: &OwnerId,
    window: &TimeWindow,
    utc_offset_minutes: i64,
    order_by: CopresenceOrderBy,
    audience: CopresenceAudience,
) -> Result<Vec<ActivityPageCompanionRow>> {
    let summary = store.copresence_summary(CopresenceSummaryInput {
        time_window: window.clone(),
        group_by: CopresenceGroupBy::Friend,
        order_by,
        min_minutes: None,
        limit: Some(COMPANION_LIMIT),
        owner_user_id: Some(owner_user_id.clone()),
        audience,
        utc_offset_minutes: Some(utc_offset_minutes),
    })?;

    Ok(summary
        .rows
        .into_iter()
        .map(|row| ActivityPageCompanionRow {
            user_id: row.user_id,
            display_name: row.display_name,
            is_friend: row.is_friend,
            minutes: row.total_minutes,
            co_days: i64::try_from(row.co_days).unwrap_or(i64::MAX),
            instances: i64::try_from(row.instances).unwrap_or(i64::MAX),
            last_seen_together: row.last_seen_together,
        })
        .collect())
}

fn fading(
    store: &impl ActivityPageStore,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<Vec<ActivityPageFadingRow>> {
    let Some(from_ms) = from_ms else {
        return Ok(Vec::new());
    };
    let prior_from_ms = from_ms - (to_ms - from_ms);
    let output = store.fading_friends(FadingFriendsInput {
        owner_user_id: owner_user_id.clone(),
        prior_from: activity_iso_from_ms(prior_from_ms),
        pivot: activity_iso_from_ms(from_ms),
        now: activity_iso_from_ms(to_ms),
        min_prior_minutes: None,
        limit: Some(FADING_LIMIT),
    })?;
    Ok(output
        .rows
        .into_iter()
        .map(|row| ActivityPageFadingRow {
            user_id: row.user_id,
            display_name: row.display_name,
            prior_minutes: row.prior_minutes,
            recent_minutes: row.recent_minutes,
            drop_percent: row.drop_percent,
            last_seen_together: row.last_seen_together,
        })
        .collect())
}
