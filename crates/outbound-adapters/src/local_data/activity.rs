use vrcx_0_contracts::activity_page::{
    ActivityJourneyDayInput, ActivityJourneyDaysInput, ActivityJourneyVisit,
};
use vrcx_0_contracts::activity_view::{
    ActivityOverlapViewBuildInput, ActivityOverlapViewOutput, ActivityViewBuildInput,
    ActivityViewOutput,
};
use vrcx_0_contracts::feed::{FeedRowOutput, FeedRowsQueryInput};

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn activity_overlap_view(
        &self,
        input: ActivityOverlapViewBuildInput,
    ) -> Result<ActivityOverlapViewOutput> {
        Ok(vrcx_0_persistence::activity::activity_overlap_view_build(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn activity_view(&self, input: ActivityViewBuildInput) -> Result<ActivityViewOutput> {
        Ok(vrcx_0_persistence::activity::activity_view_build(
            self.db.as_ref(),
            input,
        )?)
    }

    pub fn activity_journey_visits(
        &self,
        input: ActivityJourneyDayInput,
    ) -> Result<Vec<ActivityJourneyVisit>> {
        Ok(vrcx_0_persistence::activity_page::read_journey_visits(
            self.db.as_ref(),
            &input.owner_user_id,
            input.from_ms,
            input.to_ms,
        )?)
    }

    pub fn activity_journey_days(&self, input: ActivityJourneyDaysInput) -> Result<Vec<String>> {
        Ok(vrcx_0_persistence::activity_page::read_journey_days(
            self.db.as_ref(),
            &input.owner_user_id,
            input.utc_offset_minutes,
        )?)
    }

    pub fn feed_rows_query(&self, query: FeedRowsQueryInput) -> Result<Vec<FeedRowOutput>> {
        Ok(vrcx_0_persistence::feed::feed_rows_query(
            self.db.as_ref(),
            query,
        )?)
    }
}
