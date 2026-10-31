use std::collections::VecDeque;

use vrcx_0_application_activity::ActivityEntry;
use vrcx_0_core::location::world_id_from_location;
use vrcx_0_vr_overlay::{AvatarBitmap, DesktopWidgetRow, FeedRelation, FeedSeverity};

use crate::localization::OverlayLocalizer;
use crate::surfaces::wrist::feed_text_from_activity;

const ROW_CAPACITY: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopWidgetRowPart {
    Actor,
    Detail,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DesktopWidgetTarget {
    User { user_id: String },
    Location { location: String },
}

struct FeedRow {
    id: u64,
    entry: ActivityEntry,
    avatar: Option<AvatarBitmap>,
}

#[derive(Default)]
pub(crate) struct DesktopWidgetFeed {
    rows: VecDeque<FeedRow>,
    next_id: u64,
}

impl DesktopWidgetFeed {
    pub(crate) fn push(&mut self, entry: ActivityEntry) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        self.rows.push_back(FeedRow {
            id,
            entry,
            avatar: None,
        });
        while self.rows.len() > ROW_CAPACITY {
            self.rows.pop_front();
        }
        id
    }

    pub(crate) fn resolve_world_name(&mut self, source_id: &str, world_name: &str) -> bool {
        let Some(row) = self.row_by_source_mut(source_id) else {
            return false;
        };
        if row.entry.content.world_name == world_name {
            return false;
        }
        row.entry.content.world_name = world_name.to_string();
        true
    }

    pub(crate) fn resolve_group_name(&mut self, source_id: &str, group_name: &str) -> bool {
        let Some(row) = self.row_by_source_mut(source_id) else {
            return false;
        };
        if row.entry.content.group_name == group_name {
            return false;
        }
        row.entry.content.group_name = group_name.to_string();
        true
    }

    pub(crate) fn set_avatar(&mut self, source_id: &str, avatar: AvatarBitmap) -> bool {
        let Some(row) = self.row_by_source_mut(source_id) else {
            return false;
        };
        if row.avatar.as_ref() == Some(&avatar) {
            return false;
        }
        row.avatar = Some(avatar);
        true
    }

    pub(crate) fn rows(&self, localizer: &OverlayLocalizer) -> Vec<DesktopWidgetRow> {
        self.rows.iter().map(|row| row.view(localizer)).collect()
    }

    pub(crate) fn target(
        &self,
        id: u64,
        part: DesktopWidgetRowPart,
    ) -> Option<DesktopWidgetTarget> {
        let entry = &self.rows.iter().find(|row| row.id == id)?.entry;
        let user = || {
            let user_id = entry.actor_user_id.trim();
            user_id
                .starts_with("usr_")
                .then(|| DesktopWidgetTarget::User {
                    user_id: user_id.to_string(),
                })
        };
        match part {
            DesktopWidgetRowPart::Actor => user(),
            DesktopWidgetRowPart::Detail => {
                let location = entry.content.location.trim();
                if world_id_from_location(location).is_empty() {
                    user()
                } else {
                    Some(DesktopWidgetTarget::Location {
                        location: location.to_string(),
                    })
                }
            }
        }
    }

    pub(crate) fn clear(&mut self) {
        self.rows.clear();
    }

    fn row_by_source_mut(&mut self, source_id: &str) -> Option<&mut FeedRow> {
        self.rows
            .iter_mut()
            .find(|row| row.entry.source_id == source_id)
    }
}

impl FeedRow {
    fn view(&self, localizer: &OverlayLocalizer) -> DesktopWidgetRow {
        let text = feed_text_from_activity(&self.entry, localizer);
        DesktopWidgetRow {
            id: self.id,
            time_text: text.time_text,
            actor: text.subject,
            detail: text.action,
            favorite: text.relation == FeedRelation::Favorite,
            warning: text.severity == FeedSeverity::Warning,
            show_avatar_slot: self.entry.actor_user_id.trim().starts_with("usr_"),
            avatar: self.avatar.clone(),
        }
    }
}

#[cfg(test)]
mod tests;
