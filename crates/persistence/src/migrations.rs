//! Versioned one-time migrations, keyed by `PRAGMA user_version`.
//!
//! Only operations that are too expensive to repeat on every startup belong here — a full
//! table scan to seed derived data, or a table rebuild. Anything idempotent and cheap
//! (adding a column, creating or dropping an index) goes into the relevant `ensure_*_tables`
//! path instead, so it reaches existing databases without an upgrade cycle.
//!
//! ⛔ Published versions are append-only — never edit, reorder or remove an entry.

use crate::migration::Migration;

pub fn migrations() -> Vec<Migration> {
    vec![crate::favorites::migration_v1::migration()]
}
