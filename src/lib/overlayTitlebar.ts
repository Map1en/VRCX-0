const APP_TITLE_BAR_SELECTOR = '[data-app-titlebar="true"]';

type OverlayCloseEventDetails = {
    reason: string;
    event: Event;
    cancel: () => void;
};

function isAppTitleBarTarget(target: EventTarget | null) {
    return (
        target instanceof Element &&
        Boolean(target.closest(APP_TITLE_BAR_SELECTOR))
    );
}

function preserveAppTitleBarOnOpenChange(
    open: boolean,
    eventDetails: OverlayCloseEventDetails
) {
    if (
        !open &&
        eventDetails.reason === 'outside-press' &&
        isAppTitleBarTarget(eventDetails.event.target)
    ) {
        eventDetails.cancel();
        return true;
    }
    return false;
}

export { preserveAppTitleBarOnOpenChange };
