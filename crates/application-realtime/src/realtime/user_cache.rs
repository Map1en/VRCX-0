use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};

use serde_json::{Map, Value};
use vrcx_0_core::user_facts::{
    merge_user_fact, normalize_user_id, user_fact_key, UserFact, UserFactMergeOptions,
};

const NON_FRIEND_CAPACITY: usize = 1000;

pub(crate) struct UserCacheRuntime {
    state: Mutex<UserCacheState>,
}

struct UserCacheState {
    users: HashMap<String, UserFact>,
    non_friend_lru: VecDeque<String>,
    capacity: usize,
}

pub(crate) struct UserCacheOutput {
    pub user: Map<String, Value>,
}

impl UserCacheRuntime {
    pub(crate) fn new() -> Self {
        Self::with_capacity(NON_FRIEND_CAPACITY)
    }

    pub(crate) fn with_capacity(capacity: usize) -> Self {
        Self {
            state: Mutex::new(UserCacheState {
                users: HashMap::new(),
                non_friend_lru: VecDeque::new(),
                capacity: capacity.max(1),
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, UserCacheState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn clear(&self) {
        let mut state = self.lock();
        state.users.clear();
        state.non_friend_lru.clear();
    }

    fn extract_user_id(value: &Value) -> String {
        normalize_user_id(
            value
                .get("id")
                .or_else(|| value.get("userId"))
                .or_else(|| value.get("user_id"))
                .unwrap_or(&Value::Null),
        )
    }

    pub(crate) fn record_user(
        &self,
        value: &Value,
        options: UserFactMergeOptions,
    ) -> Option<UserCacheOutput> {
        let user_id = Self::extract_user_id(value);
        if user_id.is_empty() {
            return None;
        }
        let key = user_fact_key(
            &Value::String(options.endpoint.clone()),
            &Value::String(user_id),
        );
        if key.is_empty() {
            return None;
        }

        let mut state = self.lock();
        let result = merge_user_fact(state.users.get(&key), value, &options);
        let pinned = options.is_friend
            || options.is_current_user
            || result.fact.fields.get("isFriend").and_then(Value::as_bool) == Some(true);
        let output = result.changed.then(|| UserCacheOutput {
            user: result.fact.to_object(),
        });
        state.users.insert(key.clone(), result.fact);
        touch_lru(&mut state, &key, pinned);
        output
    }

    pub(crate) fn get_user(&self, endpoint: &str, user_id: &str) -> Option<Map<String, Value>> {
        let key = user_fact_key(
            &Value::String(endpoint.to_string()),
            &Value::String(user_id.to_string()),
        );
        if key.is_empty() {
            return None;
        }
        let mut state = self.lock();
        let fact = state.users.get(&key)?.clone();
        let pinned = fact.fields.get("isFriend").and_then(Value::as_bool) == Some(true);
        let object = fact.to_object();
        touch_lru(&mut state, &key, pinned);
        Some(object)
    }
}

fn touch_lru(state: &mut UserCacheState, key: &str, pinned: bool) {
    state.non_friend_lru.retain(|existing| existing != key);
    if pinned {
        return;
    }
    state.non_friend_lru.push_back(key.to_string());
    while state.non_friend_lru.len() > state.capacity {
        if let Some(evicted) = state.non_friend_lru.pop_front() {
            state.users.remove(&evicted);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(is_friend: bool) -> UserFactMergeOptions {
        UserFactMergeOptions {
            endpoint: "https://api.example.test".into(),
            source: if is_friend {
                "realtime".into()
            } else {
                "profile".into()
            },
            received_at: "2026-06-16T00:00:00Z".into(),
            is_friend,
            ..Default::default()
        }
    }

    #[test]
    fn record_returns_output_on_change_and_caches_it() {
        let cache = UserCacheRuntime::new();
        let out = cache.record_user(
            &json!({ "id": "usr_1", "displayName": "Alice" }),
            opts(false),
        );
        assert!(out.is_some());
        assert_eq!(
            out.unwrap().user.get("displayName").and_then(Value::as_str),
            Some("Alice")
        );
        let cached = cache.get_user("https://api.example.test", "usr_1").unwrap();
        assert_eq!(
            cached.get("displayName").and_then(Value::as_str),
            Some("Alice")
        );
    }

    #[test]
    fn unchanged_record_returns_none() {
        let cache = UserCacheRuntime::new();
        cache.record_user(&json!({ "id": "usr_1", "state": "online" }), opts(false));
        let again = cache.record_user(&json!({ "id": "usr_1", "state": "online" }), opts(false));
        assert!(again.is_none());
    }

    #[test]
    fn non_friend_lru_evicts_oldest() {
        let cache = UserCacheRuntime::with_capacity(2);
        cache.record_user(&json!({ "id": "usr_a", "displayName": "A" }), opts(false));
        cache.record_user(&json!({ "id": "usr_b", "displayName": "B" }), opts(false));
        cache.record_user(&json!({ "id": "usr_c", "displayName": "C" }), opts(false));
        assert!(cache
            .get_user("https://api.example.test", "usr_a")
            .is_none());
        assert!(cache
            .get_user("https://api.example.test", "usr_b")
            .is_some());
        assert!(cache
            .get_user("https://api.example.test", "usr_c")
            .is_some());
    }

    #[test]
    fn friends_are_pinned_and_never_evicted() {
        let cache = UserCacheRuntime::with_capacity(1);
        cache.record_user(
            &json!({ "id": "usr_friend", "displayName": "F" }),
            opts(true),
        );
        cache.record_user(&json!({ "id": "usr_x", "displayName": "X" }), opts(false));
        cache.record_user(&json!({ "id": "usr_y", "displayName": "Y" }), opts(false));
        assert!(cache
            .get_user("https://api.example.test", "usr_friend")
            .is_some());
    }

    #[test]
    fn clear_drops_pinned_and_unpinned() {
        let cache = UserCacheRuntime::new();
        cache.record_user(
            &json!({ "id": "usr_friend", "displayName": "F" }),
            opts(true),
        );
        cache.record_user(&json!({ "id": "usr_x", "displayName": "X" }), opts(false));
        cache.clear();
        assert!(cache
            .get_user("https://api.example.test", "usr_friend")
            .is_none());
        assert!(cache
            .get_user("https://api.example.test", "usr_x")
            .is_none());
    }
}
