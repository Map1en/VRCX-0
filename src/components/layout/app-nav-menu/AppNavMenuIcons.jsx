import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    getNavIconComponent
} from '@/shared/constants/navIcons.js';

function NavIcon({ entry, className = undefined }) {
    const fallback = String(entry?.index || '').startsWith(
        DASHBOARD_NAV_KEY_PREFIX
    )
        ? DEFAULT_DASHBOARD_ICON
        : entry?.children
          ? DEFAULT_FOLDER_ICON
          : DEFAULT_NAV_ICON_KEY;
    const Icon = getNavIconComponent(entry?.icon, fallback);
    return <Icon className={className} />;
}

function NotifiedNavIcon({ entry, isNotified, className = undefined }) {
    return (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <NavIcon entry={entry} className={className} />
            {isNotified ? (
                <span
                    className="bg-destructive absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
                    aria-hidden="true"
                />
            ) : null}
        </span>
    );
}

export { NavIcon, NotifiedNavIcon };
