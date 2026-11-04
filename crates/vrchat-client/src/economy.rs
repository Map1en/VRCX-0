use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{encode_path_segment, get_input, require_text, HttpApiError};
use vrcx_0_contracts::vrchat_api::VrchatRequest;

fn page_params(n: i32, offset: i32) -> HashMap<String, Value> {
    HashMap::from([
        ("n".to_string(), json!(n)),
        ("offset".to_string(), json!(offset)),
    ])
}

pub fn licensed_avatars_get_input(endpoint: String, n: i32, offset: i32) -> VrchatRequest {
    get_input(endpoint, "avatars/licensed", page_params(n, offset))
}

pub fn purchases_get_input(
    endpoint: String,
    buyer_id: String,
    n: i32,
    offset: i32,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let buyer_id = require_text(buyer_id, "VrchatEconomyPurchasesGet requires buyerId.")?;
    let mut params = page_params(n, offset);
    params.insert("buyerId".to_string(), json!(buyer_id));
    params.insert("order".to_string(), json!("desc"));
    params.insert("sort".to_string(), json!("purchaseDate"));
    Ok((buyer_id, get_input(endpoint, "economy/purchases", params)))
}

pub fn transactions_get_input(
    endpoint: String,
    user_id: String,
    n: i32,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatEconomyTransactionsGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!(
                "user/{}/economy/transactions",
                encode_path_segment(&user_id)
            ),
            HashMap::from([("n".to_string(), json!(n))]),
        ),
    ))
}

pub fn balance_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatEconomyBalanceGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("user/{}/economy/balance", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn store_get_input(
    endpoint: String,
    store_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let store_id = require_text(store_id, "VrchatEconomyStoreGet requires storeId.")?;
    Ok((
        store_id.clone(),
        get_input(
            endpoint,
            "economy/store",
            HashMap::from([
                ("storeId".to_string(), json!(store_id)),
                ("hydrateListings".to_string(), json!(true)),
                ("hydrateContext".to_string(), json!(false)),
            ]),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn economy_reads_use_the_expected_paths_and_params() {
        let licensed = licensed_avatars_get_input("endpoint".into(), 100, 200);
        assert_eq!(licensed.path.as_deref(), Some("avatars/licensed"));
        assert_eq!(
            licensed
                .query_params
                .as_ref()
                .and_then(|params| params.get("offset")),
            Some(&json!(200))
        );

        let (_, purchases) =
            purchases_get_input("endpoint".into(), "usr_me".into(), 50, 0).unwrap();
        assert_eq!(purchases.path.as_deref(), Some("economy/purchases"));
        let params = purchases.query_params.unwrap();
        assert_eq!(params.get("buyerId"), Some(&json!("usr_me")));
        assert_eq!(params.get("sort"), Some(&json!("purchaseDate")));

        let (_, transactions) =
            transactions_get_input("endpoint".into(), "usr me".into(), 100).unwrap();
        assert_eq!(
            transactions.path.as_deref(),
            Some("user/usr%20me/economy/transactions")
        );

        let (_, balance) = balance_get_input("endpoint".into(), "usr_me".into()).unwrap();
        assert_eq!(
            balance.path.as_deref(),
            Some("user/usr%5Fme/economy/balance")
        );

        let (_, store) = store_get_input("endpoint".into(), "store_1".into()).unwrap();
        let params = store.query_params.unwrap();
        assert_eq!(params.get("storeId"), Some(&json!("store_1")));
        assert_eq!(params.get("hydrateListings"), Some(&json!(true)));

        assert!(purchases_get_input("endpoint".into(), " ".into(), 50, 0).is_err());
        assert!(store_get_input("endpoint".into(), " ".into()).is_err());
    }
}
