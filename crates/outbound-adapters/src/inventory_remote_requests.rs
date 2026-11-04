use std::sync::Arc;

use vrcx_0_application::media::{
    InventoryPageFuture, InventoryPageRequest, InventoryRemoteRequests,
};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::WebClient;

#[derive(Clone)]
pub struct VrchatInventoryRemoteRequests {
    web: Arc<WebClient>,
}

impl VrchatInventoryRemoteRequests {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl InventoryRemoteRequests for VrchatInventoryRemoteRequests {
    fn inventory_page(
        &self,
        endpoint: String,
        input: InventoryPageRequest,
    ) -> InventoryPageFuture<'_> {
        let request = vrcx_0_vrchat_protocol::media::inventory_items_get_input(
            endpoint,
            vrcx_0_vrchat_protocol::media::InventoryListParams {
                n: Some(input.page_size),
                offset: Some(input.offset),
                order: Some(vrcx_0_vrchat_protocol::media::InventoryOrder::Newest),
                types: input.types,
                not_flags: input.not_flags,
                archived: input.archived,
                ..Default::default()
            },
        );
        Box::pin(async move {
            self.web
                .execute_api(request, VrchatScope::VrchatMedia)
                .await
        })
    }
}
