#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InstanceRosterMember {
    pub user_id: String,
    pub display_name: String,
    pub joined_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InstanceRosterSnapshot {
    pub location: String,
    pub world_name: String,
    pub destination: String,
    pub entered_at: String,
    pub members: Vec<InstanceRosterMember>,
    pub departed_user_ids: Vec<String>,
}

pub trait InstanceRosterObserver: Send + Sync {
    fn on_instance_roster(&self, snapshot: InstanceRosterSnapshot);
    fn on_game_running(&self, running: bool);
}
