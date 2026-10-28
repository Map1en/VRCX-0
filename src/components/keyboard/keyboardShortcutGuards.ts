export const TEXT_ENTRY_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]'
].join(',');
export const KEYBOARD_CONTROL_SELECTOR = [
    TEXT_ENTRY_SELECTOR,
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="tablist"]',
    '[role="slider"]',
    '[role="separator"]',
    '[role="spinbutton"]',
    '[role="tree"]',
    '[role="grid"]'
].join(',');
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';
const POPUP_SELECTOR =
    '[role="menu"], [role="listbox"], [data-slot="popover-content"]';

export function isTextEntryTarget(target: EventTarget | null) {
    return (
        target instanceof Element &&
        Boolean(target.closest(TEXT_ENTRY_SELECTOR))
    );
}

export function isShortcutBlocked(
    event: Event,
    owner: Element,
    controlSelector: string
) {
    if (owner.getClientRects().length === 0) {
        return true;
    }
    const target = event.target instanceof Element ? event.target : null;
    const focused = document.activeElement;
    if (target?.closest(controlSelector) || focused?.closest(controlSelector)) {
        return true;
    }

    for (const dialog of document.querySelectorAll(DIALOG_SELECTOR)) {
        if (dialog.getClientRects().length && !dialog.contains(owner)) {
            return true;
        }
    }
    for (const popup of document.querySelectorAll(POPUP_SELECTOR)) {
        if (popup.getClientRects().length) {
            return true;
        }
    }

    const scope =
        owner.closest(
            `[role="tabpanel"], .vrcx-0-page-scaffold, ${DIALOG_SELECTOR}`
        ) ?? owner.parentElement;
    return Boolean(
        focused && focused !== document.body && !scope?.contains(focused)
    );
}
