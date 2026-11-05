use vrcx_0_application::favorites::{FavoriteRemoteFuture, LocalWorldDetailsRemote};
use vrcx_0_application_core::WorldCache;

pub struct CachedLocalWorldDetailsRemote<'a> {
    world_cache: &'a WorldCache,
}

impl<'a> CachedLocalWorldDetailsRemote<'a> {
    pub fn new(world_cache: &'a WorldCache) -> Self {
        Self { world_cache }
    }
}

impl LocalWorldDetailsRemote for CachedLocalWorldDetailsRemote<'_> {
    fn refresh<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
    ) -> FavoriteRemoteFuture<'a, i32> {
        Box::pin(async move {
            self.world_cache
                .get(endpoint, world_id, true, false)
                .await
                .map(|response| response.status)
        })
    }
}
