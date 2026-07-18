use openxr as xr;

use super::super::types::OverlayActivationButton;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Hand {
    Left,
    Right,
}

impl Hand {
    pub const ALL: [Hand; 2] = [Hand::Left, Hand::Right];

    pub fn label(self) -> &'static str {
        match self {
            Hand::Left => "L",
            Hand::Right => "R",
        }
    }
}

struct ProfileBinding {
    action: BindingAction,
    path: &'static str,
}

#[derive(Clone, Copy)]
enum BindingAction {
    Grip,
    Menu,
    Pose,
}

struct InteractionProfile {
    path: &'static str,
    bindings: &'static [ProfileBinding],
}

const fn binding(action: BindingAction, path: &'static str) -> ProfileBinding {
    ProfileBinding { action, path }
}

const INTERACTION_PROFILES: &[InteractionProfile] = &[
    InteractionProfile {
        path: "/interaction_profiles/khr/simple_controller",
        bindings: &[
            binding(BindingAction::Grip, "/user/hand/left/input/select/click"),
            binding(BindingAction::Grip, "/user/hand/right/input/select/click"),
            binding(BindingAction::Menu, "/user/hand/left/input/menu/click"),
            binding(BindingAction::Menu, "/user/hand/right/input/menu/click"),
            binding(BindingAction::Pose, "/user/hand/left/input/grip/pose"),
            binding(BindingAction::Pose, "/user/hand/right/input/grip/pose"),
        ],
    },
    InteractionProfile {
        path: "/interaction_profiles/oculus/touch_controller",
        bindings: &[
            binding(BindingAction::Grip, "/user/hand/left/input/squeeze/value"),
            binding(BindingAction::Grip, "/user/hand/right/input/squeeze/value"),
            binding(BindingAction::Grip, "/user/hand/left/input/x/click"),
            binding(BindingAction::Grip, "/user/hand/right/input/a/click"),
            binding(BindingAction::Menu, "/user/hand/left/input/menu/click"),
            binding(BindingAction::Pose, "/user/hand/left/input/grip/pose"),
            binding(BindingAction::Pose, "/user/hand/right/input/grip/pose"),
        ],
    },
    InteractionProfile {
        path: "/interaction_profiles/valve/index_controller",
        bindings: &[
            binding(BindingAction::Grip, "/user/hand/left/input/squeeze/value"),
            binding(BindingAction::Grip, "/user/hand/right/input/squeeze/value"),
            binding(BindingAction::Grip, "/user/hand/left/input/a/click"),
            binding(BindingAction::Grip, "/user/hand/right/input/a/click"),
            binding(BindingAction::Menu, "/user/hand/left/input/b/click"),
            binding(BindingAction::Menu, "/user/hand/right/input/b/click"),
            binding(BindingAction::Pose, "/user/hand/left/input/grip/pose"),
            binding(BindingAction::Pose, "/user/hand/right/input/grip/pose"),
        ],
    },
    InteractionProfile {
        path: "/interaction_profiles/htc/vive_controller",
        bindings: &[
            binding(BindingAction::Grip, "/user/hand/left/input/squeeze/click"),
            binding(BindingAction::Grip, "/user/hand/right/input/squeeze/click"),
            binding(BindingAction::Menu, "/user/hand/left/input/menu/click"),
            binding(BindingAction::Menu, "/user/hand/right/input/menu/click"),
            binding(BindingAction::Pose, "/user/hand/left/input/grip/pose"),
            binding(BindingAction::Pose, "/user/hand/right/input/grip/pose"),
        ],
    },
];

pub(super) struct OverlayInput {
    action_set: xr::ActionSet,
    grip_activate: xr::Action<bool>,
    menu_activate: xr::Action<bool>,
    left_path: xr::Path,
    right_path: xr::Path,
    left_grip_space: xr::Space,
    right_grip_space: xr::Space,
}

impl OverlayInput {
    pub fn new(instance: &xr::Instance, session: &xr::Session<xr::Vulkan>) -> Result<Self, String> {
        let action_set = instance
            .create_action_set("vrcx_wrist_overlay", "VRCX Wrist Overlay", 0)
            .map_err(|error| format!("failed to create OpenXR action set: {error}"))?;
        let left_path = instance
            .string_to_path("/user/hand/left")
            .map_err(|error| format!("failed to resolve hand path: {error}"))?;
        let right_path = instance
            .string_to_path("/user/hand/right")
            .map_err(|error| format!("failed to resolve hand path: {error}"))?;
        let hands = [left_path, right_path];

        let grip_activate = action_set
            .create_action::<bool>("wrist_activate_grip", "Show wrist overlay (grip)", &hands)
            .map_err(|error| format!("failed to create grip action: {error}"))?;
        let menu_activate = action_set
            .create_action::<bool>("wrist_activate_menu", "Show wrist overlay (menu)", &hands)
            .map_err(|error| format!("failed to create menu action: {error}"))?;
        let hand_pose = action_set
            .create_action::<xr::Posef>("wrist_hand_pose", "Wrist hand pose", &hands)
            .map_err(|error| format!("failed to create hand pose action: {error}"))?;

        suggest_bindings(instance, &grip_activate, &menu_activate, &hand_pose);

        session
            .attach_action_sets(&[&action_set])
            .map_err(|error| format!("failed to attach OpenXR action set: {error}"))?;

        let left_grip_space = hand_pose
            .create_space(session, left_path, xr::Posef::IDENTITY)
            .map_err(|error| format!("failed to create left grip space: {error}"))?;
        let right_grip_space = hand_pose
            .create_space(session, right_path, xr::Posef::IDENTITY)
            .map_err(|error| format!("failed to create right grip space: {error}"))?;

        Ok(Self {
            action_set,
            grip_activate,
            menu_activate,
            left_path,
            right_path,
            left_grip_space,
            right_grip_space,
        })
    }

    pub fn sync(&self, session: &xr::Session<xr::Vulkan>) -> xr::Result<()> {
        session.sync_actions(&[xr::ActiveActionSet::new(&self.action_set)])
    }

    pub fn activation_pressed(
        &self,
        session: &xr::Session<xr::Vulkan>,
        hand: Hand,
        button: OverlayActivationButton,
    ) -> bool {
        let action = match button {
            OverlayActivationButton::Grip => &self.grip_activate,
            OverlayActivationButton::Menu => &self.menu_activate,
        };
        action
            .state(session, self.subaction_path(hand))
            .map(|state| state.is_active && state.current_state)
            .unwrap_or(false)
    }

    pub fn grip_space(&self, hand: Hand) -> &xr::Space {
        match hand {
            Hand::Left => &self.left_grip_space,
            Hand::Right => &self.right_grip_space,
        }
    }

    pub fn hand_located(&self, hand: Hand, base: &xr::Space, time: xr::Time) -> bool {
        self.grip_space(hand)
            .locate(base, time)
            .map(|location| {
                location
                    .location_flags
                    .contains(xr::SpaceLocationFlags::POSITION_VALID)
            })
            .unwrap_or(false)
    }

    pub fn hand_connected(&self, session: &xr::Session<xr::Vulkan>, hand: Hand) -> bool {
        session
            .current_interaction_profile(self.subaction_path(hand))
            .map(|profile| profile != xr::Path::NULL)
            .unwrap_or(false)
    }

    fn subaction_path(&self, hand: Hand) -> xr::Path {
        match hand {
            Hand::Left => self.left_path,
            Hand::Right => self.right_path,
        }
    }
}

fn suggest_bindings(
    instance: &xr::Instance,
    grip_activate: &xr::Action<bool>,
    menu_activate: &xr::Action<bool>,
    hand_pose: &xr::Action<xr::Posef>,
) {
    for profile in INTERACTION_PROFILES {
        let Ok(profile_path) = instance.string_to_path(profile.path) else {
            continue;
        };
        let mut bindings = Vec::with_capacity(profile.bindings.len());
        for entry in profile.bindings {
            let Ok(path) = instance.string_to_path(entry.path) else {
                continue;
            };
            match entry.action {
                BindingAction::Grip => bindings.push(xr::Binding::new(grip_activate, path)),
                BindingAction::Menu => bindings.push(xr::Binding::new(menu_activate, path)),
                BindingAction::Pose => bindings.push(xr::Binding::new(hand_pose, path)),
            }
        }
        if bindings.is_empty() {
            continue;
        }
        if let Err(error) = instance.suggest_interaction_profile_bindings(profile_path, &bindings) {
            tracing::debug!(
                profile = profile.path,
                error = %error,
                "skipping unsupported OpenXR interaction profile"
            );
        }
    }
}
