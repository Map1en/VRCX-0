const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TelemetryDatabaseScale {
    pub db_bytes: u64,
    pub feed_rows: Option<i64>,
    pub gamelog_rows: Option<i64>,
    pub friend_log_rows: Option<i64>,
}

pub(super) fn db_size_bucket(db_bytes: u64) -> String {
    let bucket = if db_bytes < 512 * MIB {
        "lt512m"
    } else if db_bytes < GIB {
        "512m_1g"
    } else if db_bytes < 2 * GIB {
        "1g_2g"
    } else if db_bytes < 4 * GIB {
        "2g_4g"
    } else if db_bytes < 8 * GIB {
        "4g_8g"
    } else {
        "gte8g"
    };
    bucket.to_string()
}

pub(super) fn row_bucket(rows: Option<i64>) -> String {
    let Some(rows) = rows.filter(|rows| *rows >= 0) else {
        return "unknown".to_string();
    };
    let bucket = if rows < 10_000 {
        "lt10k"
    } else if rows < 100_000 {
        "10k_100k"
    } else if rows < 1_000_000 {
        "100k_1m"
    } else if rows < 5_000_000 {
        "1m_5m"
    } else if rows < 20_000_000 {
        "5m_20m"
    } else {
        "gte20m"
    };
    bucket.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_size_buckets_cover_the_documented_user_tiers() {
        assert_eq!(db_size_bucket(0), "lt512m");
        assert_eq!(db_size_bucket(287 * MIB), "lt512m");
        assert_eq!(db_size_bucket(512 * MIB), "512m_1g");
        assert_eq!(db_size_bucket(GIB), "1g_2g");
        assert_eq!(db_size_bucket(3 * GIB), "2g_4g");
        assert_eq!(db_size_bucket(4 * GIB), "4g_8g");
        assert_eq!(db_size_bucket(8 * GIB), "gte8g");
    }

    #[test]
    fn every_bucket_is_a_worker_safe_enum_slug() {
        let buckets = [
            db_size_bucket(0),
            db_size_bucket(u64::MAX),
            row_bucket(None),
            row_bucket(Some(0)),
            row_bucket(Some(i64::MAX)),
            db_size_bucket(700 * MIB),
            row_bucket(Some(50_000)),
            row_bucket(Some(500_000)),
            row_bucket(Some(2_000_000)),
            row_bucket(Some(10_000_000)),
        ];
        for bucket in buckets {
            assert!(
                !bucket.is_empty()
                    && bucket.len() <= 32
                    && bucket.chars().all(|ch| ch.is_ascii_lowercase()
                        || ch.is_ascii_digit()
                        || ch == '_'
                        || ch == '-'),
                "bucket {bucket} is rejected by the worker enum slug shape"
            );
        }
    }

    #[test]
    fn row_buckets_separate_missing_statistics_from_empty_tables() {
        assert_eq!(row_bucket(None), "unknown");
        assert_eq!(row_bucket(Some(-1)), "unknown");
        assert_eq!(row_bucket(Some(0)), "lt10k");
        assert_eq!(row_bucket(Some(138_466)), "100k_1m");
        assert_eq!(row_bucket(Some(600_000)), "100k_1m");
        assert_eq!(row_bucket(Some(4_999_999)), "1m_5m");
        assert_eq!(row_bucket(Some(20_344_206)), "gte20m");
    }
}
