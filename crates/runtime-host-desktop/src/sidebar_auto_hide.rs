use std::time::{Duration, Instant};
pub use vrcx_0_host_desktop::sidebar_window::{Point, Rect, Screen};

#[derive(Clone, Copy, Default, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SidebarAutoHideContext {
    pub sidebar_mode: bool,
    pub blocked: bool,
    pub reduced_motion: bool,
    pub frame_inset: f64,
}

#[derive(Clone, Copy, Default, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SidebarAutoHideSnapshot {
    pub enabled: bool,
    pub failed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Edge {
    Left,
    Right,
    Top,
}

impl Edge {
    fn snap(self, rect: Rect, area: Rect, inset: f64) -> Rect {
        let inset = inset.round();
        let mut snapped = rect.at(rect.clamp_position(area));
        match self {
            Edge::Left => snapped.x = area.x - inset,
            Edge::Right => snapped.x = area.x + area.width - snapped.width + inset,
            Edge::Top => snapped.y = area.y - inset,
        }
        snapped
    }
}

#[derive(Clone, Debug)]
struct Dock {
    edge: Edge,
    screen: Screen,
    expanded: Rect,
}

impl Dock {
    fn tucked_position(&self) -> Point {
        let mut point = self.expanded.position();
        match self.edge {
            Edge::Left => point.x = self.screen.bounds.x - self.expanded.width,
            Edge::Right => point.x = self.screen.bounds.x + self.screen.bounds.width,
            Edge::Top => point.y = self.screen.bounds.y - self.expanded.height,
        }
        point
    }

    fn hot_zone(&self) -> Rect {
        let bounds = self.screen.bounds;
        let thickness = 3.0 * self.screen.scale;
        match self.edge {
            Edge::Left => Rect {
                width: thickness,
                ..bounds
            },
            Edge::Right => Rect {
                x: bounds.x + bounds.width - thickness,
                width: thickness,
                ..bounds
            },
            Edge::Top => Rect {
                y: bounds.y,
                height: thickness,
                ..self.expanded
            },
        }
    }
}

pub struct Sample {
    pub rect: Rect,
    pub screens: Vec<Screen>,
    pub pointer: Option<Point>,
    pub pointer_down: bool,
    pub visible: bool,
    pub minimized: bool,
    pub maximized: bool,
    pub blocked: bool,
    pub reveal_allowed: bool,
    pub reduced_motion: bool,
    pub frame_inset: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Move(Point),
    Reveal(Point),
    Hide(Point),
}

#[derive(Clone)]
struct Slide {
    from: Point,
    to: Point,
    started: Instant,
    hiding: bool,
}

#[derive(Clone, Default)]
pub struct SidebarAutoHide {
    dock: Option<Dock>,
    hidden: bool,
    slide: Option<Slide>,
    dwell: Option<Instant>,
    last_rect: Option<Rect>,
    settled_since: Option<Instant>,
    last_tick: Option<Instant>,
    failed_recovery: Option<Rect>,
}

impl SidebarAutoHide {
    pub fn is_hidden(&self) -> bool {
        self.hidden
    }

    pub fn is_animating(&self) -> bool {
        self.slide.is_some()
    }

    pub fn is_hidden_edge_hovered(&self, pointer: Option<Point>) -> bool {
        self.hidden
            && self
                .dock
                .as_ref()
                .is_some_and(|dock| pointer.is_some_and(|point| dock.hot_zone().contains(point)))
    }

    pub fn interval(&self) -> Duration {
        Duration::from_millis(if self.slide.is_some() { 16 } else { 60 })
    }

    pub fn reset(&mut self) -> Option<Point> {
        let recovery = self.recovery_bounds().map(Rect::position);
        *self = Self::default();
        recovery
    }

    pub fn recovery_bounds(&self) -> Option<Rect> {
        self.failed_recovery.or_else(|| {
            self.dock
                .as_ref()
                .filter(|_| self.hidden || self.slide.is_some())
                .map(|dock| dock.expanded)
        })
    }

    pub fn tick<E>(
        &mut self,
        now: Instant,
        sample: &Sample,
        apply: impl FnOnce(Action, bool) -> Result<(), E>,
    ) -> Result<(), E> {
        let mut next = self.clone();
        if let Some(action) = next.next_action(now, sample) {
            if let Err(error) = apply(action, next.is_animating()) {
                let point = match action {
                    Action::Move(point) | Action::Reveal(point) | Action::Hide(point) => point,
                };
                let bounds = next
                    .dock
                    .as_ref()
                    .map_or(sample.rect.at(point), |dock| dock.expanded);
                let point = visible_position(bounds, &sample.screens).unwrap_or(bounds.position());
                self.failed_recovery = Some(bounds.at(point));
                return Err(error);
            }
            next.failed_recovery = None;
        }
        *self = next;
        Ok(())
    }

    fn next_action(&mut self, now: Instant, sample: &Sample) -> Option<Action> {
        let resumed = self
            .last_tick
            .is_some_and(|last| now.duration_since(last) > Duration::from_secs(2));
        self.last_tick = Some(now);
        if let Some(dock) = self.dock.clone() {
            if let Some(screen) = sample
                .screens
                .iter()
                .find(|screen| screen.id == dock.screen.id)
            {
                if screen != &dock.screen {
                    let expanded = dock.edge.snap(
                        Rect {
                            width: sample.rect.width,
                            height: sample.rect.height,
                            ..dock.expanded
                        },
                        screen.work_area,
                        sample.frame_inset * screen.scale,
                    );
                    let dock = Dock {
                        edge: dock.edge,
                        screen: screen.clone(),
                        expanded,
                    };
                    let point = if self.hidden {
                        dock.tucked_position()
                    } else {
                        expanded.position()
                    };
                    self.dock = Some(dock);
                    self.slide = None;
                    self.dwell = None;
                    self.last_rect = Some(expanded.at(point));
                    return Some(if self.hidden {
                        Action::Hide(point)
                    } else {
                        Action::Move(point)
                    });
                }
            } else {
                if !sample.reveal_allowed || sample.pointer.is_none() {
                    self.dwell = None;
                    return None;
                }
                let point = visible_position(
                    Rect {
                        width: sample.rect.width,
                        height: sample.rect.height,
                        ..dock.expanded
                    },
                    &sample.screens,
                )?;
                self.reset();
                return Some(Action::Reveal(point));
            }
            if resumed && sample.reveal_allowed {
                return self.reset().map(Action::Reveal);
            }
        }
        if sample.minimized || sample.maximized || !sample.visible {
            return self.reset().map(Action::Move);
        }
        if let Some(slide) = &self.slide {
            if sample.blocked || sample.pointer_down {
                return self.reset().map(Action::Reveal);
            }
            let interrupted = slide.hiding
                && self
                    .dock
                    .as_ref()
                    .is_some_and(|dock| sample.pointer.is_some_and(|p| dock.expanded.contains(p)));
            if interrupted {
                let to = self.dock.as_ref()?.expanded.position();
                return self.slide_to(
                    now,
                    sample.rect.position(),
                    to,
                    false,
                    sample.reduced_motion,
                );
            }
            return self.advance_slide(now, sample.reduced_motion);
        }
        if self.hidden {
            let dock = self.dock.as_ref()?;
            let hovering = sample.reveal_allowed
                && !sample.pointer_down
                && self.is_hidden_edge_hovered(sample.pointer);
            if !hovering {
                self.dwell = None;
                return None;
            }
            let since = *self.dwell.get_or_insert(now);
            if now.duration_since(since) < Duration::from_millis(150) {
                return None;
            }
            self.hidden = false;
            self.dwell = None;
            if sample.reduced_motion {
                let expanded = dock.expanded;
                self.last_rect = Some(expanded);
                return Some(Action::Reveal(expanded.position()));
            }
            let from = dock.tucked_position();
            self.slide = Some(Slide {
                from,
                to: dock.expanded.position(),
                started: now,
                hiding: false,
            });
            return Some(Action::Reveal(from));
        }
        if self.last_rect != Some(sample.rect) {
            self.last_rect = Some(sample.rect);
            self.settled_since = Some(now);
            self.dock = None;
            self.dwell = None;
        }
        if sample.pointer_down || sample.blocked || sample.pointer.is_none() {
            self.dwell = None;
            self.settled_since = Some(now);
            return None;
        }
        if self.dock.is_none() {
            let since = *self.settled_since.get_or_insert(now);
            if now.duration_since(since) < Duration::from_millis(180) {
                return None;
            }
            self.dock = detect_dock(sample.rect, &sample.screens, sample.frame_inset);
        }
        let Some(dock) = self.dock.as_ref() else {
            if sample
                .screens
                .iter()
                .any(|screen| overlap(screen.work_area, sample.rect) > 0.0)
            {
                return None;
            }
            let point = visible_position(sample.rect, &sample.screens)?;
            self.last_rect = Some(sample.rect.at(point));
            self.settled_since = Some(now);
            return Some(Action::Move(point));
        };
        let anchored = dock.expanded.position();
        if (sample.rect.x - anchored.x).abs() >= 1.0 || (sample.rect.y - anchored.y).abs() >= 1.0 {
            self.dwell = None;
            return self.slide_to(
                now,
                sample.rect.position(),
                anchored,
                false,
                sample.reduced_motion,
            );
        }
        if sample.pointer.is_some_and(|p| sample.rect.contains(p)) {
            self.dwell = None;
            return None;
        }
        let since = *self.dwell.get_or_insert(now);
        if now.duration_since(since) < Duration::from_millis(500) {
            return None;
        }
        self.dwell = None;
        let to = dock.tucked_position();
        self.slide_to(now, sample.rect.position(), to, true, sample.reduced_motion)
    }

    fn slide_to(
        &mut self,
        now: Instant,
        from: Point,
        to: Point,
        hiding: bool,
        reduced_motion: bool,
    ) -> Option<Action> {
        self.slide = Some(Slide {
            from,
            to,
            started: now,
            hiding,
        });
        self.advance_slide(now, reduced_motion)
    }

    fn advance_slide(&mut self, now: Instant, reduced_motion: bool) -> Option<Action> {
        let slide = self.slide.as_ref()?;
        let progress = if reduced_motion {
            1.0
        } else {
            (now.duration_since(slide.started).as_secs_f64() / 0.16).min(1.0)
        };
        if progress >= 1.0 {
            let hiding = slide.hiding;
            self.slide = None;
            self.hidden = hiding;
            self.dwell = None;
            let dock = self.dock.as_ref()?;
            let expanded = dock.expanded;
            let point = if hiding {
                dock.tucked_position()
            } else {
                expanded.position()
            };
            self.last_rect = Some(expanded.at(point));
            return Some(if hiding {
                Action::Hide(point)
            } else {
                Action::Move(point)
            });
        }
        let eased = if slide.hiding {
            progress.powi(3)
        } else {
            1.0 - (1.0 - progress).powi(3)
        };
        Some(Action::Move(Point {
            x: slide.from.x + (slide.to.x - slide.from.x) * eased,
            y: slide.from.y + (slide.to.y - slide.from.y) * eased,
        }))
    }
}

pub fn visible_position(rect: Rect, screens: &[Screen]) -> Option<Point> {
    let center = Point {
        x: rect.x + rect.width / 2.0,
        y: rect.y + rect.height / 2.0,
    };
    let screen = screens
        .iter()
        .find(|screen| screen.bounds.contains(center))
        .or(screens.first())?;
    Some(rect.clamp_position(screen.work_area))
}

fn overlap(first: Rect, second: Rect) -> f64 {
    let width = (first.x + first.width).min(second.x + second.width) - first.x.max(second.x);
    let height = (first.y + first.height).min(second.y + second.height) - first.y.max(second.y);
    width.max(0.0) * height.max(0.0)
}

fn detect_dock(rect: Rect, screens: &[Screen], frame_inset: f64) -> Option<Dock> {
    let screen = screens
        .iter()
        .filter(|screen| overlap(screen.work_area, rect) > 0.0)
        .max_by(|a, b| overlap(a.work_area, rect).total_cmp(&overlap(b.work_area, rect)))?
        .clone();
    let area = screen.work_area;
    let tolerance = 8.0 * screen.scale;
    let inside = |distance: f64| Some(distance).filter(|distance| *distance <= tolerance);
    let side = [
        (Edge::Left, rect.x - area.x),
        (Edge::Right, area.x + area.width - rect.x - rect.width),
    ]
    .into_iter()
    .filter_map(|(edge, distance)| inside(distance).map(|distance| (edge, distance.max(0.0))))
    .min_by(|a, b| a.1.total_cmp(&b.1));
    let top = inside(rect.y - area.y).map(|distance| (Edge::Top, distance.max(0.0)));
    let (edge, _) = match (side, top) {
        (Some(side), Some(top)) if rect.width >= rect.height && top.1 < side.1 => top,
        (Some(side), _) => side,
        (None, top) => top?,
    };
    let expanded = edge.snap(rect, area, frame_inset * screen.scale);
    let outside = match edge {
        Edge::Left => Rect {
            x: screen.bounds.x - 1.0,
            width: 1.0,
            ..expanded
        },
        Edge::Right => Rect {
            x: screen.bounds.x + screen.bounds.width,
            width: 1.0,
            ..expanded
        },
        Edge::Top => Rect {
            y: screen.bounds.y - 1.0,
            height: 1.0,
            ..expanded
        },
    };
    if screens
        .iter()
        .any(|other| other.id != screen.id && other.bounds.intersects(outside))
    {
        return None;
    }
    Some(Dock {
        edge,
        screen,
        expanded,
    })
}

#[cfg(test)]
mod tests;
