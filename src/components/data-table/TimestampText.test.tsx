// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/state/shellStore';

import { TimestampText } from './TimestampText';

describe('TimestampText', () => {
    beforeEach(() => {
        useShellStore.setState({
            locale: 'en',
            dateCulture: 'en-gb',
            dateIsoFormat: false,
            dateHour12: false
        });
    });

    afterEach(cleanup);

    it('re-renders when the clock preference changes', () => {
        render(
            <TimestampText
                value="2026-06-04T19:20:02"
                format="time"
                tooltip={false}
            />
        );
        expect(screen.getByText('19:20')).toBeTruthy();

        act(() => {
            useShellStore.setState({ dateHour12: true });
        });

        expect(screen.queryByText('19:20')).toBeNull();
        expect(screen.getByText(/7:20/)).toBeTruthy();
    });

    it('renders the empty placeholder for missing values', () => {
        render(<TimestampText value="" emptyText="—" />);

        expect(screen.getByText('—')).toBeTruthy();
    });
});
