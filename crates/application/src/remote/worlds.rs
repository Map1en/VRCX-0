use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use serde::{de::Error as _, Deserialize, Deserializer};
use vrcx_0_application_core::vrchat_api::require_text;
use vrcx_0_application_core::{
    AuthenticatedMutationContext, RemoteMutationGate, Result, RuntimeAuthScope,
};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_contracts::vrchat_requests::{
    QueryOrder, ReleaseStatusFilter, WorldRatingValue, WorldSearchSort, WorldUpdateRequest,
};

const WORLD_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub fn deserialize_nonnegative_i32<'de, D>(deserializer: D) -> std::result::Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    let value = i32::deserialize(deserializer)?;
    if value < 0 {
        return Err(D::Error::custom("value must be non-negative"));
    }
    Ok(value)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldRemoteOperation {
    ListByUser {
        user_id: String,
        n: i32,
        offset: i32,
        sort: WorldSearchSort,
        order: QueryOrder,
        release_status: ReleaseStatusFilter,
    },
    PersistentDataExists {
        user_id: String,
        world_id: String,
    },
    Save {
        world_id: String,
        params: WorldUpdateRequest,
    },
    Delete {
        world_id: String,
    },
    Publish {
        world_id: String,
    },
    Unpublish {
        world_id: String,
    },
    PersistentDataDelete {
        user_id: String,
        world_id: String,
    },
    RatingGet {
        world_id: String,
    },
    RatingSet {
        world_id: String,
        value: Option<WorldRatingValue>,
    },
}

impl WorldRemoteOperation {
    fn hydrates_response(&self) -> bool {
        matches!(
            self,
            Self::Save { .. } | Self::Publish { .. } | Self::Unpublish { .. }
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldRemoteScope {
    Public,
    Authenticated {
        current_user_id: String,
        endpoint: String,
    },
}

pub type WorldRemoteFuture<'a> = BoxFuture<'a, Result<VrchatResponse>>;

pub trait WorldRemotePort: Send + Sync {
    fn execute(
        &self,
        scope: WorldRemoteScope,
        operation: WorldRemoteOperation,
    ) -> WorldRemoteFuture<'_>;
}

pub trait WorldResponseProjectionPort: Send + Sync {
    fn hydrate(&self, response: &VrchatResponse);
}

#[derive(Clone)]
pub struct WorldRemoteRuntime {
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    remote: Arc<dyn WorldRemotePort>,
    projection: Arc<dyn WorldResponseProjectionPort>,
}

impl WorldRemoteRuntime {
    pub fn new(
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        remote: Arc<dyn WorldRemotePort>,
        projection: Arc<dyn WorldResponseProjectionPort>,
    ) -> Self {
        Self {
            auth_scope,
            remote_mutations,
            remote,
            projection,
        }
    }

    pub async fn list_by_user(
        &self,
        user_id: String,
        n: i32,
        offset: i32,
        sort: WorldSearchSort,
        order: QueryOrder,
        release_status: ReleaseStatusFilter,
    ) -> Result<VrchatResponse> {
        let user_id = require_text(user_id, "VrchatWorldListByUserGet requires userId.")?;
        require_nonnegative(n)?;
        require_nonnegative(offset)?;
        self.execute_read(WorldRemoteOperation::ListByUser {
            user_id,
            n,
            offset,
            sort,
            order,
            release_status,
        })
        .await
    }

    pub async fn persistent_data_exists(
        &self,
        user_id: String,
        world_id: String,
    ) -> Result<VrchatResponse> {
        let user_id = require_text(user_id, "VrchatWorldPersistentDataExists requires userId.")?;
        let world_id = require_text(
            world_id,
            "VrchatWorldPersistentDataExists requires worldId.",
        )?;
        self.execute_read(WorldRemoteOperation::PersistentDataExists { user_id, world_id })
            .await
    }

    pub async fn save(
        &self,
        world_id: String,
        params: WorldUpdateRequest,
    ) -> Result<VrchatResponse> {
        let world_id = require_text(world_id, "VrchatWorldSave requires worldId.")?;
        if params.id != world_id {
            return Err(vrcx_0_application_core::Error::Custom(
                "VrchatWorldSave params.id must match worldId.".into(),
            ));
        }
        self.execute_mutation(WorldRemoteOperation::Save { world_id, params })
            .await
    }

    pub async fn delete(&self, world_id: String) -> Result<VrchatResponse> {
        let world_id = require_text(world_id, "VrchatWorldDelete requires worldId.")?;
        self.execute_mutation(WorldRemoteOperation::Delete { world_id })
            .await
    }

    pub async fn publish(&self, world_id: String) -> Result<VrchatResponse> {
        let world_id = require_text(world_id, "VrchatWorldPublish requires worldId.")?;
        self.execute_mutation(WorldRemoteOperation::Publish { world_id })
            .await
    }

    pub async fn unpublish(&self, world_id: String) -> Result<VrchatResponse> {
        let world_id = require_text(world_id, "VrchatWorldUnpublish requires worldId.")?;
        self.execute_mutation(WorldRemoteOperation::Unpublish { world_id })
            .await
    }

    pub async fn persistent_data_delete(
        &self,
        user_id: String,
        world_id: String,
    ) -> Result<VrchatResponse> {
        let user_id = require_text(user_id, "VrchatWorldPersistentDataDelete requires userId.")?;
        let world_id = require_text(
            world_id,
            "VrchatWorldPersistentDataDelete requires worldId.",
        )?;
        self.execute_mutation(WorldRemoteOperation::PersistentDataDelete { user_id, world_id })
            .await
    }

    pub async fn rating_get(&self, world_id: String) -> Result<VrchatResponse> {
        let world_id = require_text(world_id, "VrchatWorldRatingGet requires worldId.")?;
        self.execute_read(WorldRemoteOperation::RatingGet { world_id })
            .await
    }

    pub async fn rating_set(
        &self,
        world_id: String,
        value: Option<WorldRatingValue>,
    ) -> Result<VrchatResponse> {
        let world_id = require_text(world_id, "VrchatWorldRatingSet requires worldId.")?;
        self.execute_mutation(WorldRemoteOperation::RatingSet { world_id, value })
            .await
    }

    async fn execute_read(&self, operation: WorldRemoteOperation) -> Result<VrchatResponse> {
        self.remote
            .execute(WorldRemoteScope::Public, operation)
            .await
    }

    async fn execute_mutation(&self, operation: WorldRemoteOperation) -> Result<VrchatResponse> {
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            self.remote_mutations.as_ref(),
            "VRChat mutation",
        )?;
        let scope = WorldRemoteScope::Authenticated {
            current_user_id: mutation.scope().current_user_id.clone(),
            endpoint: mutation.scope().endpoint.clone(),
        };
        let hydrates_response = operation.hydrates_response();
        let response = mutation
            .run_after_wait(WORLD_REMOTE_MUTATION_INTERVAL, || {
                self.remote.execute(scope, operation)
            })
            .await?;
        if hydrates_response {
            self.projection.hydrate(&response);
        }
        Ok(response)
    }
}

fn require_nonnegative(value: i32) -> Result<()> {
    if value < 0 {
        return Err(vrcx_0_application_core::Error::Custom(
            "value must be non-negative".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
