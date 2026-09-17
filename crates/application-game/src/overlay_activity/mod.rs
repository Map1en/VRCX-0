mod game_ingest;
#[cfg(test)]
mod tests;

pub use game_ingest::OverlayActivityGameIngestExt;

pub(crate) use game_ingest::video_activity_candidate;
