use std::sync::Arc;

use vrcx_0_application::social::{WorldNameFuture, WorldNameResolver};
use vrcx_0_application_core::WorldCache;

pub struct CachedWorldNameResolver {
    cache: Arc<WorldCache>,
}

impl CachedWorldNameResolver {
    pub fn new(cache: Arc<WorldCache>) -> Self {
        Self { cache }
    }
}

impl WorldNameResolver for CachedWorldNameResolver {
    fn resolve<'a>(&'a self, endpoint: &'a str, world_id: &'a str) -> WorldNameFuture<'a> {
        Box::pin(async move { self.cache.resolve_name(endpoint, world_id).await })
    }
}
