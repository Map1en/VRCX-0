use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::economy::{
    balance_get_input, licensed_avatars_get_input, purchases_get_input, store_get_input,
    transactions_get_input,
};

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn licensed_avatars(&self, n: i32, offset: i32) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_economy_licensed_avatars_get",
            "Getting licensed avatars.",
            licensed_avatars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), n, offset),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_purchases(
        &self,
        buyer_id: String,
        n: i32,
        offset: i32,
    ) -> Result<VrchatResponse> {
        let (buyer_id, request) =
            purchases_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), buyer_id, n, offset)?;
        self.execute(
            "app__vrchat_economy_purchases_get",
            format!("Getting purchases for {buyer_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_transactions(&self, user_id: String, n: i32) -> Result<VrchatResponse> {
        let (user_id, request) =
            transactions_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id, n)?;
        self.execute(
            "app__vrchat_economy_transactions_get",
            format!("Getting credit transactions for {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_balance(&self, user_id: String) -> Result<VrchatResponse> {
        let (user_id, request) = balance_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id)?;
        self.execute(
            "app__vrchat_economy_balance_get",
            format!("Getting credit balance for {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_store(&self, store_id: String) -> Result<VrchatResponse> {
        let (store_id, request) = store_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), store_id)?;
        self.execute(
            "app__vrchat_economy_store_get",
            format!("Getting store {store_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }
}
