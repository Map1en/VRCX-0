use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::Error;

use super::DbParams;

pub trait DbWriteTarget {
    fn execute_non_query(&self, sql: &str, args: &DbParams) -> Result<i64, Error>;
}

impl DbWriteTarget for DatabaseService {
    fn execute_non_query(&self, sql: &str, args: &DbParams) -> Result<i64, Error> {
        DatabaseService::execute_non_query(self, sql, args)
    }
}

impl DbWriteTarget for DatabaseWriteTransaction<'_> {
    fn execute_non_query(&self, sql: &str, args: &DbParams) -> Result<i64, Error> {
        DatabaseWriteTransaction::execute_non_query(self, sql, args)
    }
}
