use std::collections::HashMap;

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use serde_json::Value;
pub use vrcx_0_contracts::vrchat_requests::{
    AvatarListSort, QueryOrder, ReleaseStatusFilter, UserSearchCustomField, UserSearchSort,
    WorldSearchSort,
};

pub fn deserialize_nonnegative_i32<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    let value = i32::deserialize(deserializer)?;
    if value >= 0 {
        Ok(value)
    } else {
        Err(D::Error::custom("value must be non-negative"))
    }
}

pub fn deserialize_optional_nonnegative_i32<'de, D>(
    deserializer: D,
) -> Result<Option<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<i32>::deserialize(deserializer)?;
    match value {
        Some(value) if value < 0 => Err(D::Error::custom("value must be non-negative")),
        value => Ok(value),
    }
}

pub(crate) fn serialize_query<T: Serialize>(query: &T) -> HashMap<String, Value> {
    let Value::Object(query) =
        serde_json::to_value(query).expect("query DTO serialization must succeed")
    else {
        panic!("query DTO must serialize as an object");
    };
    query.into_iter().collect()
}

#[cfg(test)]
mod nonnegative_i32_tests {
    use super::*;

    #[derive(Deserialize)]
    struct RequiredValue {
        #[serde(deserialize_with = "deserialize_nonnegative_i32")]
        value: i32,
    }

    #[derive(Deserialize)]
    struct OptionalValue {
        #[serde(default, deserialize_with = "deserialize_optional_nonnegative_i32")]
        value: Option<i32>,
    }

    #[test]
    fn serde_rejects_negative_required_and_optional_values() {
        assert!(serde_json::from_str::<RequiredValue>(r#"{"value":-1}"#).is_err());
        assert!(serde_json::from_str::<OptionalValue>(r#"{"value":-1}"#).is_err());
        assert_eq!(
            serde_json::from_str::<RequiredValue>(r#"{"value":0}"#)
                .unwrap()
                .value,
            0
        );
        assert_eq!(
            serde_json::from_str::<OptionalValue>(r#"{}"#)
                .unwrap()
                .value,
            None
        );
    }
}
