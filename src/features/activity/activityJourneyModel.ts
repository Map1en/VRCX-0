import { toLocalDayKey } from '@/lib/instanceActivityDate';
import type {
    ActivityJourneyCompanion,
    ActivityJourneyVisit
} from '@/platform/tauri/bindings';
import { ACTIVITY_PAGE_CONFIG_KEYS } from '@/repositories/configKeys';

export const ACTIVITY_PAGE_MODE_KEY = ACTIVITY_PAGE_CONFIG_KEYS.mode;

export type ActivityPageMode = 'overview' | 'journey';

export function normalizeActivityPageMode(
    value: string | null
): ActivityPageMode {
    return value === 'journey' ? 'journey' : 'overview';
}

export const ACTIVITY_JOURNEY_DENSITY_KEY =
    ACTIVITY_PAGE_CONFIG_KEYS.journeyDensity;

export const JOURNEY_DENSITIES = ['standard', 'compact', 'dense'] as const;

export type JourneyDensity = (typeof JOURNEY_DENSITIES)[number];

export function normalizeJourneyDensity(value: string | null): JourneyDensity {
    return value === 'compact' || value === 'dense' ? value : 'standard';
}

export type JourneyDensityLimits = {
    strangers: number;
    photos: number;
};

export const JOURNEY_DENSITY_LIMITS: Record<
    JourneyDensity,
    JourneyDensityLimits
> = {
    standard: { strangers: 4, photos: 6 },
    compact: { strangers: 3, photos: 4 },
    dense: { strangers: 2, photos: 3 }
};

export const JOURNEY_PHOTO_PREVIEW_LIMIT = 6;
const BRIEF_VISIT_MS = 5 * 60_000;
const SMALL_INSTANCE_PEOPLE = 10;

export type JourneyPerson = ActivityJourneyCompanion & {
    key: string;
    isFavorite: boolean;
};

export type JourneyVisitView = {
    key: string;
    visit: ActivityJourneyVisit;
    durationMs: number;
    peopleCount: number;
    friendCount: number;
    shownPeople: JourneyPerson[];
    otherPeople: JourneyPerson[];
    brief: boolean;
};

export function journeyDayBounds(dayKey: string): {
    fromMs: number;
    toMs: number;
} {
    const [year, month, day] = dayKey
        .split('-')
        .map((value) => Number.parseInt(value, 10) || 0);
    return {
        fromMs: new Date(year, Math.max(0, month - 1), day || 1).getTime(),
        toMs: new Date(year, Math.max(0, month - 1), (day || 1) + 1).getTime()
    };
}

export function journeyVisitKey(visit: ActivityJourneyVisit): string {
    return `${visit.location}@${visit.startMs}`;
}

export const JOURNEY_PAGE_DAYS = 7;

export function journeyDaysInRange(
    days: readonly string[],
    fromMs: number | null,
    toMs: number | null
): string[] {
    return days
        .filter((dayKey) => {
            const bounds = journeyDayBounds(dayKey);
            return (
                (fromMs === null || bounds.toMs > fromMs) &&
                (toMs === null || bounds.fromMs <= toMs)
            );
        })
        .sort((left, right) => right.localeCompare(left));
}

export function journeyPageWindow(
    dayList: readonly string[],
    startIndex: number,
    fromMs: number | null,
    toMs: number | null
): { fromMs: number; toMs: number } | null {
    const page = dayList.slice(startIndex, startIndex + JOURNEY_PAGE_DAYS);
    if (page.length === 0) {
        return null;
    }
    const windowFrom = journeyDayBounds(page[page.length - 1]).fromMs;
    const windowTo = journeyDayBounds(page[0]).toMs;
    return {
        fromMs: fromMs === null ? windowFrom : Math.max(windowFrom, fromMs),
        toMs: toMs === null ? windowTo : Math.min(windowTo, toMs + 1)
    };
}

export function mergeJourneyVisits(
    current: readonly ActivityJourneyVisit[],
    page: readonly ActivityJourneyVisit[]
): ActivityJourneyVisit[] {
    const byKey = new Map(
        current.map((visit) => [journeyVisitKey(visit), visit])
    );
    for (const visit of page) {
        byKey.set(journeyVisitKey(visit), visit);
    }
    return [...byKey.values()].sort(
        (left, right) => right.startMs - left.startMs
    );
}

export function groupJourneyVisitsByDay(
    visits: readonly ActivityJourneyVisit[]
): { dayKey: string; visits: ActivityJourneyVisit[] }[] {
    const groups: { dayKey: string; visits: ActivityJourneyVisit[] }[] = [];
    for (const visit of visits) {
        const dayKey = toLocalDayKey(visit.startMs);
        const last = groups[groups.length - 1];
        if (last?.dayKey === dayKey) {
            last.visits.push(visit);
        } else {
            groups.push({ dayKey, visits: [visit] });
        }
    }
    return groups;
}

export function buildJourneyVisitView(
    visit: ActivityJourneyVisit,
    favoriteIdSet: ReadonlySet<string>,
    photoCount: number,
    homeWorldId: string,
    limits: JourneyDensityLimits
): JourneyVisitView {
    const people = visit.companions.map((companion) => ({
        ...companion,
        key: companion.userId || `name:${companion.displayName}`,
        isFavorite:
            Boolean(companion.userId) && favoriteIdSet.has(companion.userId)
    }));
    const close = people.filter(
        (person) => person.isFriend || person.isFavorite
    );
    const strangers =
        people.length <= SMALL_INSTANCE_PEOPLE
            ? people
                  .filter((person) => !close.includes(person))
                  .slice(0, limits.strangers)
            : [];
    const durationMs = Math.max(0, visit.endMs - visit.startMs);
    const shownPeople = [...close, ...strangers];

    return {
        key: journeyVisitKey(visit),
        visit,
        durationMs,
        peopleCount: people.length,
        friendCount: close.length,
        shownPeople,
        otherPeople: people.filter((person) => !shownPeople.includes(person)),
        brief:
            close.length === 0 &&
            photoCount === 0 &&
            (durationMs < BRIEF_VISIT_MS ||
                (Boolean(homeWorldId) && visit.worldId === homeWorldId))
    };
}

export function summarizeJourneyDay(
    visits: readonly ActivityJourneyVisit[],
    favoriteIdSet: ReadonlySet<string>
): { worldCount: number; friendCount: number } {
    const worlds = new Set<string>();
    const friends = new Set<string>();
    for (const visit of visits) {
        worlds.add(visit.worldId || visit.location);
        for (const companion of visit.companions) {
            if (
                companion.userId &&
                (companion.isFriend || favoriteIdSet.has(companion.userId))
            ) {
                friends.add(companion.userId);
            }
        }
    }
    return {
        worldCount: worlds.size,
        friendCount: friends.size
    };
}
