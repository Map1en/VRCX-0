use std::collections::BTreeSet;

use super::{activity_iso_from_ms, ActivityPageStore, PAYLOAD_VERSION};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::activity_page::{
    ActivityLocationSpan as LocationSpan, CachedActivityPage as CachedPage,
};
use vrcx_0_core::OwnerId;

use super::aggregate::{
    access_split, series, series_bucket_for_range, summarize, summarize_previous, worlds,
};
use super::people::people;
use vrcx_0_contracts::activity_page::{
    ActivityPageBuildInput, ActivityPageCoverage, ActivityPageView,
};

const DAY_MS: i64 = 86_400_000;
const MINUTE_MS: i64 = 60_000;
const TOP_WORLD_LIMIT: usize = 10;

pub fn activity_page_view_build(
    store: &impl ActivityPageStore,
    input: ActivityPageBuildInput,
) -> Result<ActivityPageView> {
    if input.owner_user_id.as_str().trim().is_empty() || input.range_days < 0 {
        return Ok(empty_activity_page_view(&input));
    }
    let range_days = input.range_days;
    let cacheable = input.window_to_ms.is_none();
    store.with_build_lock(&input.owner_user_id, || {
        let cursor = store.source_cursor(&input.owner_user_id)?;
        let cached = if cacheable {
            store.read_cached_page(&input.owner_user_id, range_days)?
        } else {
            None
        };
        let window = window_bounds(&input, range_days);

        if !input.force_refresh {
            if let Some(cached) = &cached {
                if is_reusable(cached, &cursor, &input, &window) {
                    return Ok(cached.view.clone());
                }
            }
        }

        match build_fresh(store, &input, range_days, &cursor, &window) {
            Ok(view) => {
                if cacheable {
                    store.write_cached_page(
                        &input.owner_user_id,
                        range_days,
                        PAYLOAD_VERSION,
                        &view,
                    )?;
                }
                Ok(view)
            }
            Err(error) => match cached {
                Some(cached) => {
                    tracing::warn!(
                        target: "vrcx_0_persistence::activity_page::build",
                        range_days,
                        error = %error,
                        "activity page rebuild failed; serving stale cache"
                    );
                    Ok(ActivityPageView {
                        stale: true,
                        ..cached.view
                    })
                }
                None => Err(error),
            },
        }
    })
}

fn is_reusable(
    cached: &CachedPage,
    cursor: &str,
    input: &ActivityPageBuildInput,
    window: &WindowBounds,
) -> bool {
    cached.payload_version == PAYLOAD_VERSION
        && cached.built_from_cursor == cursor
        && cached.view.utc_offset_minutes == input.utc_offset_minutes
        && cached.view.people.order == input.companion_order
        && cached.view.window_from_ms == window.from_ms.unwrap_or(0)
        && cached.view.window_to_ms == window.to_ms
}

fn empty_activity_page_view(input: &ActivityPageBuildInput) -> ActivityPageView {
    ActivityPageView {
        range_days: input.range_days.max(0),
        utc_offset_minutes: input.utc_offset_minutes,
        built_at: activity_iso_from_ms(input.now_ms),
        ..Default::default()
    }
}

pub(super) struct WindowBounds {
    pub(super) from_ms: Option<i64>,
    pub(super) to_ms: i64,
}

fn window_bounds(input: &ActivityPageBuildInput, range_days: i64) -> WindowBounds {
    let offset_ms = input.utc_offset_minutes * MINUTE_MS;
    let local_day_end_ms =
        |ms: i64| (ms + offset_ms).div_euclid(DAY_MS) * DAY_MS + DAY_MS - offset_ms;
    let current_to_ms = local_day_end_ms(input.now_ms);
    let to_ms = match input.window_to_ms {
        Some(window_to_ms) => local_day_end_ms(window_to_ms.saturating_sub(1)).min(current_to_ms),
        None => current_to_ms,
    };
    WindowBounds {
        from_ms: (range_days > 0).then(|| to_ms - range_days * DAY_MS),
        to_ms,
    }
}

fn build_fresh(
    store: &impl ActivityPageStore,
    input: &ActivityPageBuildInput,
    range_days: i64,
    cursor: &str,
    window: &WindowBounds,
) -> Result<ActivityPageView> {
    let to_ms = window.to_ms;
    let from_ms = window.from_ms;
    let previous_from_ms = from_ms.map(|from_ms| from_ms - range_days * DAY_MS);
    let spans = store.read_instance_spans(&input.owner_user_id, from_ms, to_ms)?;

    let previous = match (previous_from_ms, from_ms) {
        (Some(previous_from_ms), Some(from_ms)) => {
            let previous_spans =
                store.read_instance_spans(&input.owner_user_id, Some(previous_from_ms), from_ms)?;
            summarize_previous(&previous_spans, input.utc_offset_minutes)
        }
        _ => Default::default(),
    };

    let earlier_world_ids = match from_ms {
        Some(from_ms) => store.world_ids_before(&input.owner_user_id, from_ms)?,
        None => BTreeSet::new(),
    };

    let window_days = match range_days {
        0 => window_days_from_spans(&spans),
        days => days,
    };

    Ok(ActivityPageView {
        range_days,
        utc_offset_minutes: input.utc_offset_minutes,
        window_from_ms: from_ms.unwrap_or(0),
        window_to_ms: to_ms,
        summary: summarize(&spans, window_days, input.utc_offset_minutes),
        previous,
        series: series(
            &spans,
            series_bucket_for_range(range_days),
            input.utc_offset_minutes,
            from_ms,
            to_ms,
        ),
        access_split: access_split(&spans),
        worlds: worlds(&spans, &earlier_world_ids, TOP_WORLD_LIMIT),
        people: people(
            store,
            &input.owner_user_id,
            from_ms,
            to_ms,
            input.utc_offset_minutes,
            input.companion_order,
        )?,
        coverage: coverage(store, &input.owner_user_id, from_ms, to_ms)?,
        built_from_cursor: cursor.to_string(),
        built_at: activity_iso_from_ms(input.now_ms),
        stale: false,
    })
}

fn window_days_from_spans(spans: &[LocationSpan]) -> i64 {
    match (spans.first(), spans.last()) {
        (Some(first), Some(last)) => ((last.end_ms - first.start_ms) / DAY_MS) + 1,
        _ => 0,
    }
}

fn coverage(
    store: &impl ActivityPageStore,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<ActivityPageCoverage> {
    let first_source_at = store.first_source_created_at(owner_user_id)?;
    let from = match from_ms {
        Some(from_ms) => activity_iso_from_ms(from_ms),
        None => first_source_at.clone(),
    };
    Ok(ActivityPageCoverage {
        from,
        to: activity_iso_from_ms(to_ms),
        first_source_at,
    })
}
