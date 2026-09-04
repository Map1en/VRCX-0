// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sheet, SheetContent, SheetTitle } from './sheet';

describe('Sheet variants', () => {
    it('renders the inset variant as a floating surface', () => {
        render(
            <Sheet open>
                <SheetContent side="right" variant="inset">
                    <SheetTitle>Title</SheetTitle>
                </SheetContent>
            </Sheet>
        );

        const viewport = document.querySelector('[data-slot="sheet-viewport"]');
        const backdrop = document.querySelector('[data-slot="sheet-backdrop"]');
        const popup = document.querySelector('[data-slot="sheet-popup"]');

        expect(viewport).toBeTruthy();
        expect(backdrop).toBeTruthy();
        expect(popup).toBeTruthy();
        expect(backdrop?.classList.contains('vrcx-0-app-overlay')).toBe(true);
        expect(viewport?.classList.contains('vrcx-0-app-drawer-viewport')).toBe(
            true
        );
        expect(viewport?.classList.contains('sm:p-4')).toBe(true);
        expect(viewport?.contains(popup)).toBe(true);
        expect(popup?.classList.contains('sm:rounded-2xl')).toBe(true);
        expect(popup?.classList.contains('sm:border')).toBe(true);
    });
});
