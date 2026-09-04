use super::*;

fn sample() -> Sample {
    Sample {
        rect: Rect {
            x: 0.0,
            y: 100.0,
            width: 400.0,
            height: 700.0,
        },
        screens: vec![Screen {
            id: "primary".into(),
            bounds: Rect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            },
            work_area: Rect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1040.0,
            },
            scale: 1.0,
        }],
        pointer: Some(Point { x: 900.0, y: 900.0 }),
        pointer_down: false,
        visible: true,
        minimized: false,
        maximized: false,
        blocked: false,
        reveal_allowed: true,
        reduced_motion: true,
        frame_inset: 0.0,
    }
}

fn recovery(machine: &SidebarAutoHide) -> Option<Point> {
    machine.recovery_bounds().map(Rect::position)
}

fn step(
    machine: &mut SidebarAutoHide,
    sample: &mut Sample,
    start: Instant,
    ms: u64,
) -> Option<Action> {
    let mut action = None;
    machine
        .tick(
            start + Duration::from_millis(ms),
            sample,
            |next_action, _| {
                action = Some(next_action);
                Ok::<(), std::convert::Infallible>(())
            },
        )
        .unwrap();
    if let Some(action) = action {
        let position = match action {
            Action::Move(position) | Action::Reveal(position) | Action::Hide(position) => position,
        };
        sample.rect.x = position.x;
        sample.rect.y = position.y;
    }
    action
}

fn hide(machine: &mut SidebarAutoHide, sample: &mut Sample, start: Instant) {
    assert_eq!(step(machine, sample, start, 0), None);
    assert_eq!(step(machine, sample, start, 200), None);
    assert!(matches!(
        step(machine, sample, start, 700),
        Some(Action::Hide(_))
    ));
}

#[test]
fn top_and_sides_hide_then_reveal_without_resizing() {
    for (rect, hot, tucked) in [
        (
            Rect {
                x: 0.0,
                y: 100.0,
                width: 400.0,
                height: 700.0,
            },
            Point { x: 1.0, y: 200.0 },
            Point {
                x: -400.0,
                y: 100.0,
            },
        ),
        (
            Rect {
                x: 1520.0,
                y: 100.0,
                width: 400.0,
                height: 700.0,
            },
            Point {
                x: 1919.0,
                y: 200.0,
            },
            Point {
                x: 1920.0,
                y: 100.0,
            },
        ),
        (
            Rect {
                x: 400.0,
                y: 0.0,
                width: 400.0,
                height: 700.0,
            },
            Point { x: 500.0, y: 1.0 },
            Point {
                x: 400.0,
                y: -700.0,
            },
        ),
    ] {
        let start = Instant::now();
        let mut machine = SidebarAutoHide::default();
        let mut sample = sample();
        sample.rect = rect;
        hide(&mut machine, &mut sample, start);
        assert_eq!(sample.rect.position(), tucked);
        assert_eq!(
            (sample.rect.width, sample.rect.height),
            (rect.width, rect.height)
        );
        assert!(machine.is_hidden());
        sample.pointer = Some(hot);
        assert_eq!(step(&mut machine, &mut sample, start, 750), None);
        assert_eq!(step(&mut machine, &mut sample, start, 850), None);
        assert_eq!(
            step(&mut machine, &mut sample, start, 910),
            Some(Action::Reveal(rect.position()))
        );
        assert_eq!(sample.rect, rect);
        assert!(!machine.is_hidden());
    }
}

#[test]
fn shared_monitor_seams_and_bottom_are_not_docking_edges() {
    let mut sample = sample();
    sample.screens.push(Screen {
        id: "secondary".into(),
        bounds: Rect {
            x: -1920.0,
            ..sample.screens[0].bounds
        },
        work_area: Rect {
            x: -1920.0,
            ..sample.screens[0].work_area
        },
        scale: 1.0,
    });
    assert!(detect_dock(sample.rect, &sample.screens, 0.0).is_none());
    sample.rect.x = 700.0;
    sample.rect.y = 340.0;
    assert!(detect_dock(sample.rect, &sample.screens, 0.0).is_none());
}

#[test]
fn a_side_edge_reveals_anywhere_along_its_full_height() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.pointer = Some(Point { x: 1.0, y: 990.0 });
    assert_eq!(step(&mut machine, &mut sample, start, 800), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 1000),
        Some(Action::Reveal(_))
    ));
    assert!(!machine.is_hidden());
}

#[test]
fn the_top_edge_hot_zone_is_limited_to_the_window_span() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.rect = Rect {
        x: 400.0,
        y: 0.0,
        width: 400.0,
        height: 700.0,
    };
    hide(&mut machine, &mut sample, start);
    sample.pointer = Some(Point { x: 1200.0, y: 1.0 });
    step(&mut machine, &mut sample, start, 800);
    assert_eq!(step(&mut machine, &mut sample, start, 1200), None);
    assert!(machine.is_hidden());
}

#[test]
fn dragging_and_interactions_reset_hide_delay() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.pointer_down = true;
    for ms in [0, 200, 1000] {
        assert_eq!(step(&mut machine, &mut sample, start, ms), None);
    }
    sample.pointer_down = false;
    sample.blocked = true;
    assert_eq!(step(&mut machine, &mut sample, start, 1500), None);
    sample.blocked = false;
    step(&mut machine, &mut sample, start, 1700);
    assert_eq!(step(&mut machine, &mut sample, start, 2000), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 2200),
        Some(Action::Hide(_))
    ));
}

#[test]
fn movement_away_from_edge_detaches() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    step(&mut machine, &mut sample, start, 0);
    step(&mut machine, &mut sample, start, 200);
    sample.rect.x = 200.0;
    for ms in [300, 600, 1200] {
        assert_eq!(step(&mut machine, &mut sample, start, ms), None);
    }
}

#[test]
fn returning_pointer_interrupts_slide_and_restores_expanded_position() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.reduced_motion = false;
    let expanded = sample.rect;
    for ms in [0, 200, 700, 760] {
        step(&mut machine, &mut sample, start, ms);
    }
    assert!(sample.rect.x < expanded.x);
    sample.pointer = Some(Point { x: 100.0, y: 200.0 });
    step(&mut machine, &mut sample, start, 780);
    assert_eq!(
        step(&mut machine, &mut sample, start, 950),
        Some(Action::Move(expanded.position()))
    );
    assert!(sample.visible);
    assert_eq!(sample.rect, expanded);
}

#[test]
fn full_screen_suppresses_hover_and_requires_a_new_dwell() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.pointer = Some(Point { x: 1.0, y: 200.0 });
    sample.reveal_allowed = false;
    for ms in [800, 1200] {
        assert_eq!(step(&mut machine, &mut sample, start, ms), None);
    }
    sample.reveal_allowed = true;
    assert_eq!(step(&mut machine, &mut sample, start, 1300), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 1450),
        Some(Action::Reveal(_))
    ));
}

#[test]
fn monitor_removal_and_resume_recover_hidden_window() {
    for remove_monitor in [false, true] {
        let start = Instant::now();
        let mut machine = SidebarAutoHide::default();
        let mut sample = sample();
        hide(&mut machine, &mut sample, start);
        if remove_monitor {
            sample.screens[0].id = "replacement".into();
            sample.screens[0].bounds.x = 1920.0;
            sample.screens[0].work_area.x = 1920.0;
        }
        let action = step(&mut machine, &mut sample, start, 3000);
        assert!(matches!(action, Some(Action::Reveal(_))));
        assert_eq!(sample.rect.x, if remove_monitor { 1920.0 } else { 0.0 });
        assert!(!machine.is_hidden());
    }
}

#[test]
fn minimized_or_tray_hidden_window_is_never_revealed() {
    for minimize in [false, true] {
        let start = Instant::now();
        let mut machine = SidebarAutoHide::default();
        let mut sample = sample();
        sample.reduced_motion = false;
        for ms in [0, 200, 700, 750] {
            step(&mut machine, &mut sample, start, ms);
        }
        sample.minimized = minimize;
        sample.visible = false;
        assert!(matches!(
            step(&mut machine, &mut sample, start, 800),
            Some(Action::Move(_))
        ));
        sample.pointer = Some(Point { x: 1.0, y: 200.0 });
        assert_eq!(step(&mut machine, &mut sample, start, 1200), None);
        assert!(!sample.visible);
    }
}

#[test]
fn work_area_change_preserves_hidden_state_even_during_full_screen() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.screens[0].work_area.height = 1000.0;
    sample.reveal_allowed = false;
    assert!(matches!(
        step(&mut machine, &mut sample, start, 800),
        Some(Action::Hide(_))
    ));
    assert_eq!(sample.rect.x, -400.0);
    sample.reveal_allowed = true;
    assert_eq!(step(&mut machine, &mut sample, start, 900), None);
    assert!(machine.is_hidden());
}

#[test]
fn negative_coordinates_and_scaled_tolerance_use_physical_pixels() {
    let screen = Screen {
        id: "scaled".into(),
        bounds: Rect {
            x: -2560.0,
            y: -200.0,
            width: 2560.0,
            height: 1440.0,
        },
        work_area: Rect {
            x: -2560.0,
            y: -160.0,
            width: 2560.0,
            height: 1400.0,
        },
        scale: 2.0,
    };
    let rect = Rect {
        x: -2545.0,
        y: 100.0,
        width: 800.0,
        height: 900.0,
    };
    let dock = detect_dock(rect, &[screen], 0.0).unwrap();
    assert_eq!(dock.edge, Edge::Left);
    assert_eq!(dock.tucked_position().x, -3360.0);
    assert!(dock.hot_zone().contains(Point {
        x: -2555.0,
        y: 200.0
    }));
}

#[test]
fn removed_monitor_failure_retains_the_new_visible_recovery_position() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.screens[0].id = "replacement".into();
    sample.screens[0].bounds.x = 1920.0;
    sample.screens[0].work_area.x = 1920.0;
    let expected = Point {
        x: 1920.0,
        y: 100.0,
    };
    let result = machine.tick(start + Duration::from_millis(800), &sample, |action, _| {
        assert_eq!(action, Action::Reveal(expected));
        Err("show failed")
    });
    assert_eq!(result, Err("show failed"));
    assert_eq!(recovery(&machine), Some(expected));
}

#[test]
fn failed_first_reveal_frame_never_recovers_to_its_offscreen_animation_position() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.reduced_motion = false;
    sample.pointer = Some(Point { x: 1.0, y: 200.0 });
    step(&mut machine, &mut sample, start, 800);
    let result = machine.tick(start + Duration::from_millis(1000), &sample, |action, _| {
        assert_eq!(
            action,
            Action::Reveal(Point {
                x: -400.0,
                y: 100.0
            })
        );
        Err("show failed")
    });
    assert!(result.is_err());
    assert_eq!(recovery(&machine), Some(Point { x: 0.0, y: 100.0 }));
}

#[test]
fn resolution_and_scale_changes_on_same_monitor_do_not_reveal_hidden_window() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.screens[0].bounds.width = 2560.0;
    sample.screens[0].work_area.width = 2560.0;
    sample.screens[0].scale = 1.5;
    assert!(matches!(
        step(&mut machine, &mut sample, start, 800),
        Some(Action::Hide(_))
    ));
    assert!(machine.is_hidden());
    assert_eq!(sample.rect.x, -400.0);
}

#[test]
fn recovery_geometry_survives_failed_native_attempt_until_reset() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    let expected = Some(Point { x: 0.0, y: 100.0 });
    assert_eq!(recovery(&machine), expected);
    assert_eq!(recovery(&machine), expected);
    assert_eq!(machine.reset(), expected);
    assert_eq!(recovery(&machine), None);
}

#[test]
fn failed_animated_final_frame_preserves_recovery_geometry() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    let expanded = sample.rect.position();
    hide(&mut machine, &mut sample, start);
    sample.pointer = Some(Point { x: 1.0, y: 200.0 });
    sample.reduced_motion = false;
    for ms in [800, 1000, 1040] {
        step(&mut machine, &mut sample, start, ms);
    }

    let mut failed_action = None;
    let result = machine.tick(start + Duration::from_millis(1200), &sample, |action, _| {
        failed_action = Some(action);
        Err("move failed")
    });

    assert_eq!(failed_action, Some(Action::Move(expanded)));
    assert_eq!(result, Err("move failed"));
    assert!(sample.rect.x < expanded.x);
    assert_eq!(recovery(&machine), Some(expanded));
    assert_eq!(
        step(&mut machine, &mut sample, start, 1220),
        Some(Action::Move(expanded))
    );
    assert_eq!(sample.rect.position(), expanded);
    assert_eq!(recovery(&machine), None);
}

#[test]
fn failed_reduced_motion_reveal_preserves_recovery_geometry() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    let expanded = sample.rect.position();
    hide(&mut machine, &mut sample, start);
    sample.pointer = Some(Point { x: 1.0, y: 200.0 });
    step(&mut machine, &mut sample, start, 800);

    let mut failed_action = None;
    let result = machine.tick(start + Duration::from_millis(1000), &sample, |action, _| {
        failed_action = Some(action);
        Err("reveal failed")
    });

    assert_eq!(failed_action, Some(Action::Reveal(expanded)));
    assert_eq!(result, Err("reveal failed"));
    assert_eq!(sample.rect.x, -400.0);
    assert_eq!(recovery(&machine), Some(expanded));
    assert!(machine.is_hidden());
    assert_eq!(
        step(&mut machine, &mut sample, start, 1020),
        Some(Action::Reveal(expanded))
    );
    assert_eq!(sample.rect.position(), expanded);
    assert!(!machine.is_hidden());
}

#[test]
fn failed_reduced_motion_hide_preserves_recovery_geometry() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    let expanded = sample.rect.position();
    for ms in [0, 200] {
        step(&mut machine, &mut sample, start, ms);
    }

    let result = machine.tick(start + Duration::from_millis(700), &sample, |action, _| {
        assert_eq!(
            action,
            Action::Hide(Point {
                x: -400.0,
                y: 100.0
            })
        );
        Err("tuck failed")
    });

    assert!(result.is_err());
    assert!(!machine.is_hidden());
    assert_eq!(recovery(&machine), Some(expanded));
    assert_eq!(machine.reset(), Some(expanded));
    assert_eq!(recovery(&machine), None);
}

#[test]
fn a_tall_window_docks_sideways_even_when_its_top_edge_is_flush() {
    let screens = sample().screens;
    for (rect, edge) in [
        (
            Rect {
                x: 3.0,
                y: 0.0,
                width: 400.0,
                height: 1000.0,
            },
            Edge::Left,
        ),
        (
            Rect {
                x: 1517.0,
                y: 0.0,
                width: 400.0,
                height: 1000.0,
            },
            Edge::Right,
        ),
        (
            Rect {
                x: 5.0,
                y: 0.0,
                width: 400.0,
                height: 1040.0,
            },
            Edge::Left,
        ),
        (
            Rect {
                x: 400.0,
                y: 2.0,
                width: 400.0,
                height: 1000.0,
            },
            Edge::Top,
        ),
    ] {
        assert_eq!(
            detect_dock(rect, &screens, 0.0).map(|dock| dock.edge),
            Some(edge)
        );
    }
}

#[test]
fn a_wide_window_docks_to_the_closest_edge() {
    let screens = sample().screens;
    for (rect, edge) in [
        (
            Rect {
                x: 3.0,
                y: 0.0,
                width: 900.0,
                height: 300.0,
            },
            Edge::Top,
        ),
        (
            Rect {
                x: 0.0,
                y: 3.0,
                width: 900.0,
                height: 300.0,
            },
            Edge::Left,
        ),
    ] {
        assert_eq!(
            detect_dock(rect, &screens, 0.0).map(|dock| dock.edge),
            Some(edge)
        );
    }
}

#[test]
fn a_tucked_window_stays_visible_and_only_the_edge_reveals_it() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    assert!(sample.visible);
    assert!(machine.is_hidden());
    for ms in [800, 1200, 2000] {
        assert_eq!(step(&mut machine, &mut sample, start, ms), None);
    }
    assert!(machine.is_hidden());
}

#[test]
fn the_docked_edge_compensates_for_the_transparent_window_frame() {
    let screens = sample().screens;
    let rect = Rect {
        x: 5.0,
        y: 100.0,
        width: 400.0,
        height: 700.0,
    };
    assert_eq!(detect_dock(rect, &screens, 0.0).unwrap().expanded.x, 0.0);
    assert_eq!(detect_dock(rect, &screens, 6.0).unwrap().expanded.x, -6.0);
    let right = Rect { x: 1515.0, ..rect };
    assert_eq!(
        detect_dock(right, &screens, 6.0).unwrap().expanded.x,
        1526.0
    );
}

#[test]
fn hiding_accelerates_away_from_the_expanded_position() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.reduced_motion = false;
    for ms in [0, 200] {
        step(&mut machine, &mut sample, start, ms);
    }
    step(&mut machine, &mut sample, start, 700);
    let moved = step(&mut machine, &mut sample, start, 780);
    assert!(matches!(moved, Some(Action::Move(point)) if point.x > -200.0));
}

#[test]
fn revealing_decelerates_into_the_expanded_position() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.reduced_motion = false;
    sample.pointer = Some(Point { x: 1.0, y: 200.0 });
    for ms in [800, 1000] {
        step(&mut machine, &mut sample, start, ms);
    }
    let moved = step(&mut machine, &mut sample, start, 1080);
    assert!(matches!(moved, Some(Action::Move(point)) if point.x > -200.0));
}

#[test]
fn a_window_pushed_past_a_screen_edge_docks_to_it() {
    let screens = sample().screens;
    for (rect, edge, expanded) in [
        (
            Rect {
                x: -180.0,
                y: 100.0,
                width: 400.0,
                height: 700.0,
            },
            Edge::Left,
            0.0,
        ),
        (
            Rect {
                x: 1700.0,
                y: 100.0,
                width: 400.0,
                height: 700.0,
            },
            Edge::Right,
            1520.0,
        ),
        (
            Rect {
                x: 1800.0,
                y: 100.0,
                width: 400.0,
                height: 700.0,
            },
            Edge::Right,
            1520.0,
        ),
    ] {
        let dock = detect_dock(rect, &screens, 0.0).unwrap();
        assert_eq!(dock.edge, edge);
        assert_eq!(dock.expanded.x, expanded);
    }
}

#[test]
fn releasing_a_window_past_a_screen_edge_snaps_it_flush_before_hiding() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.rect.x = 1700.0;
    sample.pointer = Some(Point { x: 100.0, y: 900.0 });
    assert_eq!(step(&mut machine, &mut sample, start, 0), None);
    assert_eq!(
        step(&mut machine, &mut sample, start, 200),
        Some(Action::Move(Point {
            x: 1520.0,
            y: 100.0
        }))
    );
    assert_eq!(sample.rect.x, 1520.0);
    assert!(!machine.is_hidden());
    assert_eq!(step(&mut machine, &mut sample, start, 400), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 900),
        Some(Action::Hide(Point { x: 1920.0, .. }))
    ));
    assert!(machine.is_hidden());
}

#[test]
fn a_side_edge_reveals_from_the_physical_screen_edge_behind_an_appbar() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.screens[0].work_area = Rect {
        x: 60.0,
        y: 0.0,
        width: 1860.0,
        height: 1040.0,
    };
    sample.rect.x = 60.0;
    hide(&mut machine, &mut sample, start);
    assert_eq!(sample.rect.x, -400.0);
    sample.pointer = Some(Point { x: 1.0, y: 500.0 });
    assert_eq!(step(&mut machine, &mut sample, start, 800), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 1000),
        Some(Action::Reveal(_))
    ));
    assert!(!machine.is_hidden());
}

#[test]
fn a_window_left_entirely_off_screen_is_pulled_back_into_view() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    sample.rect.x = -400.0;
    assert_eq!(step(&mut machine, &mut sample, start, 0), None);
    assert_eq!(
        step(&mut machine, &mut sample, start, 200),
        Some(Action::Move(Point { x: 0.0, y: 100.0 }))
    );
    assert_eq!(sample.rect.x, 0.0);
    assert_eq!(step(&mut machine, &mut sample, start, 900), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 1500),
        Some(Action::Hide(_))
    ));
    assert!(machine.is_hidden());
}

#[test]
fn a_tucked_window_stays_tucked_while_a_native_menu_is_open() {
    let start = Instant::now();
    let mut machine = SidebarAutoHide::default();
    let mut sample = sample();
    hide(&mut machine, &mut sample, start);
    sample.blocked = true;
    sample.pointer = Some(Point {
        x: 1900.0,
        y: 1030.0,
    });
    for ms in [800, 1000, 1600] {
        assert_eq!(step(&mut machine, &mut sample, start, ms), None);
    }
    assert!(machine.is_hidden());
    sample.blocked = false;
    sample.pointer = Some(Point { x: 1.0, y: 200.0 });
    assert_eq!(step(&mut machine, &mut sample, start, 1700), None);
    assert!(matches!(
        step(&mut machine, &mut sample, start, 1900),
        Some(Action::Reveal(_))
    ));
}
