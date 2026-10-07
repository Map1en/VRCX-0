use super::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::activity_page::{ActivityLocationSpan, CachedActivityPage};
use vrcx_0_contracts::social_aggregates::{
    CopresenceSummaryInput, CopresenceSummaryOutput, FadingFriendsInput, FadingFriendsOutput,
};
use vrcx_0_core::OwnerId;

#[derive(Default)]
struct Store {
    locked: Cell<bool>,
    calls: RefCell<Vec<&'static str>>,
    cached: RefCell<Option<CachedActivityPage>>,
    fail_source: Cell<bool>,
    fail_write: Cell<bool>,
}
impl Store {
    fn called(&self, name: &'static str) {
        assert!(self.locked.get(), "query outside build lock");
        self.calls.borrow_mut().push(name);
    }
}
impl ActivityPageStore for Store {
    fn with_build_lock<T>(
        &self,
        owner: &OwnerId,
        operation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        assert_eq!(owner.as_str(), "usr_page");
        assert!(!self.locked.replace(true));
        let result = operation();
        self.locked.set(false);
        result
    }
    fn source_cursor(&self, _: &OwnerId) -> Result<String> {
        self.called("cursor");
        Ok("current".into())
    }
    fn read_cached_page(&self, _: &OwnerId, _: i64) -> Result<Option<CachedActivityPage>> {
        self.called("cache_read");
        Ok(self.cached.borrow().clone())
    }
    fn write_cached_page(
        &self,
        _: &OwnerId,
        _: i64,
        version: i64,
        view: &ActivityPageView,
    ) -> Result<()> {
        self.called("cache_write");
        if self.fail_write.get() {
            return Err(Error::Custom("cache write failed".into()));
        }
        *self.cached.borrow_mut() = Some(CachedActivityPage {
            view: view.clone(),
            built_from_cursor: view.built_from_cursor.clone(),
            payload_version: version,
        });
        Ok(())
    }
    fn read_instance_spans(
        &self,
        _: &OwnerId,
        from: Option<i64>,
        to: i64,
    ) -> Result<Vec<ActivityLocationSpan>> {
        self.called("spans");
        if self.fail_source.get() {
            return Err(Error::Custom("source failed".into()));
        }
        Ok(vec![ActivityLocationSpan {
            start_ms: from.unwrap_or(to - 3_600_000),
            end_ms: from.unwrap_or(to - 3_600_000) + 3_600_000,
            world_id: "wrld_a".into(),
            world_name: "A".into(),
            access_bucket: "public".into(),
        }])
    }
    fn first_source_created_at(&self, _: &OwnerId) -> Result<String> {
        self.called("coverage");
        Ok("2025-01-01T00:00:00.000Z".into())
    }
    fn world_ids_before(&self, _: &OwnerId, _: i64) -> Result<BTreeSet<String>> {
        self.called("worlds");
        Ok(Default::default())
    }
    fn encountered_user_ids(
        &self,
        _: &OwnerId,
        _: Option<i64>,
        _: Option<i64>,
    ) -> Result<BTreeSet<String>> {
        self.called("encountered");
        Ok(Default::default())
    }
    fn copresence_summary(&self, _: CopresenceSummaryInput) -> Result<CopresenceSummaryOutput> {
        self.called("companions");
        Ok(CopresenceSummaryOutput {
            rows: Vec::new(),
            total_rows: 0,
            returned_rows: 0,
            truncated: false,
            summary: String::new(),
            caveats: Vec::new(),
        })
    }
    fn fading_friends(&self, _: FadingFriendsInput) -> Result<FadingFriendsOutput> {
        self.called("fading");
        Ok(FadingFriendsOutput {
            rows: Vec::new(),
            caveats: Vec::new(),
        })
    }
}
fn input() -> ActivityPageBuildInput {
    ActivityPageBuildInput {
        owner_user_id: OwnerId::new("usr_page"),
        range_days: 7,
        utc_offset_minutes: 0,
        now_ms: 1_736_035_200_000,
        companion_order: Default::default(),
        force_refresh: false,
    }
}

#[test]
fn invalid_inputs_do_not_read_or_lock_storage() {
    let store = Store::default();
    let mut query = input();
    query.range_days = -1;
    assert_eq!(
        activity_page_view_build(&store, query).unwrap().range_days,
        0
    );
    let mut query = input();
    query.owner_user_id = OwnerId::new("");
    assert_eq!(
        activity_page_view_build(&store, query)
            .unwrap()
            .summary
            .total_minutes,
        0
    );
    assert!(store.calls.borrow().is_empty());
}

#[test]
fn cache_hit_skips_rebuild_and_all_operations_stay_inside_owner_lock() {
    let store = Store::default();
    let first = activity_page_view_build(&store, input()).unwrap();
    assert_eq!(first.summary.total_minutes, 60);
    assert_eq!(store.cached.borrow().as_ref().unwrap().payload_version, 3);
    store.calls.borrow_mut().clear();
    assert_eq!(activity_page_view_build(&store, input()).unwrap(), first);
    assert_eq!(*store.calls.borrow(), vec!["cursor", "cache_read"]);
    assert!(!store.locked.get());
}

#[test]
fn forced_rebuild_failure_returns_original_cache_marked_stale() {
    let store = Store::default();
    let mut expected = activity_page_view_build(&store, input()).unwrap();
    store.fail_source.set(true);
    store.calls.borrow_mut().clear();
    let mut query = input();
    query.force_refresh = true;
    expected.stale = true;
    assert_eq!(activity_page_view_build(&store, query).unwrap(), expected);
    assert!(!store.calls.borrow().contains(&"cache_write"));
}

#[test]
fn source_failure_without_cache_and_cache_write_failure_propagate() {
    let store = Store::default();
    store.fail_source.set(true);
    assert_eq!(
        activity_page_view_build(&store, input())
            .unwrap_err()
            .to_string(),
        "source failed"
    );
    store.fail_source.set(false);
    activity_page_view_build(&store, input()).unwrap();
    store.fail_write.set(true);
    let mut query = input();
    query.force_refresh = true;
    assert_eq!(
        activity_page_view_build(&store, query)
            .unwrap_err()
            .to_string(),
        "cache write failed"
    );
}

#[test]
fn timezone_order_and_payload_version_changes_invalidate_cache() {
    let store = Store::default();
    activity_page_view_build(&store, input()).unwrap();
    let mut query = input();
    query.utc_offset_minutes = 540;
    let view = activity_page_view_build(&store, query.clone()).unwrap();
    assert_eq!(view.utc_offset_minutes, 540);
    query.companion_order = ActivityCompanionOrder::Days;
    assert_eq!(
        activity_page_view_build(&store, query.clone())
            .unwrap()
            .people
            .order,
        ActivityCompanionOrder::Days
    );
    store.cached.borrow_mut().as_mut().unwrap().payload_version = 0;
    store.calls.borrow_mut().clear();
    activity_page_view_build(&store, query).unwrap();
    assert!(store.calls.borrow().contains(&"cache_write"));
}
