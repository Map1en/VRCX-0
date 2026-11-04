use chrono::{DateTime, SecondsFormat, Utc};

pub fn iso_millis(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn now_iso() -> String {
    iso_millis(Utc::now())
}

pub fn now_unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::iso_millis;
    use chrono::{TimeZone, Utc};

    #[test]
    fn renders_utc_with_millisecond_precision() {
        let value = Utc
            .with_ymd_and_hms(2026, 7, 21, 10, 30, 15)
            .unwrap()
            .checked_add_signed(chrono::Duration::milliseconds(250))
            .unwrap();

        assert_eq!(iso_millis(value), "2026-07-21T10:30:15.250Z");
    }
}
