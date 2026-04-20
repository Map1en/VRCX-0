const APP_TITLE_BAR_SELECTOR = '[data-app-titlebar="true"]';

type OutsideInteractionEvent = Event & {
    detail?: {
        originalEvent?: Event;
    };
};

function isAppTitleBarOutsideInteraction(event: OutsideInteractionEvent) {
    const target = event.detail?.originalEvent?.target ?? event.target;
    return (
        target instanceof Element &&
        Boolean(target.closest(APP_TITLE_BAR_SELECTOR))
    );
}

function preserveAppTitleBarOutsideInteraction(event: OutsideInteractionEvent) {
    if (!event.defaultPrevented && isAppTitleBarOutsideInteraction(event)) {
        event.preventDefault();
    }
}

export { preserveAppTitleBarOutsideInteraction };
