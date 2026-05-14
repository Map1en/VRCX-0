use crate::domain::database::{DatabaseService, DatabaseWriteTransaction};
use crate::error::AppError;

use super::DbParams;

pub trait DbWriteTarget {
    fn execute_non_query(&self, sql: &str, args: &DbParams) -> Result<i64, AppError>;
}

impl DbWriteTarget for DatabaseService {
    fn execute_non_query(&self, sql: &str, args: &DbParams) -> Result<i64, AppError> {
        DatabaseService::execute_non_query(self, sql, args)
    }
}

impl DbWriteTarget for DatabaseWriteTransaction<'_> {
    fn execute_non_query(&self, sql: &str, args: &DbParams) -> Result<i64, AppError> {
        DatabaseWriteTransaction::execute_non_query(self, sql, args)
    }
}
