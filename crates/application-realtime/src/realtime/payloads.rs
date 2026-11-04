use serde::Serialize;
use vrcx_0_contracts::RuntimeEventPayload;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEconomyBalancePayload {
    pub user_id: String,
    pub wallet_balance: i64,
}

impl RuntimeEventPayload for RealtimeEconomyBalancePayload {
    const EVENT_NAME: &'static str = "realtimeEconomyBalance";
}
