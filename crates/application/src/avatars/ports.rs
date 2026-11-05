use futures_util::future::BoxFuture;
use serde_json::Value;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_contracts::{AvatarTagOutput, AvatarTimeSpentOutput};

pub trait AvatarFeedCleanupStore: Send + Sync {
    fn purge_avatar_feed(&self, user_id: String, cutoff_date: Option<String>) -> Result<i64>;
    fn vacuum_if_fragmented(&self) -> Result<bool>;
}

pub trait MyAvatarsStore: Send + Sync {
    fn avatar_tags(&self) -> Result<Vec<AvatarTagOutput>>;
    fn avatar_time_spent(&self, owner_user_id: String) -> Result<Vec<AvatarTimeSpentOutput>>;
}

pub trait AvatarCacheStore: Send + Sync {
    fn remove_cached_avatar(&self, avatar_id: String) -> Result<()>;
}

#[derive(Clone, Debug)]
pub enum AvatarRemoteMutation {
    Select {
        avatar_id: String,
        fallback: bool,
    },
    Save {
        avatar_id: String,
        params: crate::remote::AvatarUpdateRequest,
    },
    Delete {
        avatar_id: String,
    },
    CreateImpostor {
        avatar_id: String,
    },
    DeleteImpostor {
        avatar_id: String,
    },
    SendModeration {
        avatar_id: String,
    },
    DeleteModeration {
        avatar_id: String,
    },
}

pub type AvatarRemoteFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait AvatarRemote: Send + Sync {
    fn moderations<'a>(
        &'a self,
        endpoint: &'a str,
        command: &'a str,
        detail: &'a str,
    ) -> AvatarRemoteFuture<'a, VrchatResponse>;
    fn my_avatar_page<'a>(
        &'a self,
        endpoint: &'a str,
        page_size: i32,
        offset: i32,
    ) -> AvatarRemoteFuture<'a, Vec<Value>>;
    fn mutate<'a>(
        &'a self,
        endpoint: &'a str,
        command: &'a str,
        detail: &'a str,
        mutation: AvatarRemoteMutation,
    ) -> AvatarRemoteFuture<'a, VrchatResponse>;
}
