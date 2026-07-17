import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-easy-crop/react-easy-crop.css', () => ({}));

vi.mock('react-easy-crop', async () => {
    const R = await import('react');
    return {
        default: (props: { image?: string }) =>
            R.createElement('div', {
                'data-testid': 'easy-crop',
                'data-image': props.image
            })
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({ children, ...props }: React.ComponentProps<'button'>) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: React.PropsWithChildren) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: React.PropsWithChildren) =>
            React.createElement('p', null, children),
        DialogFooter: ({ children }: React.PropsWithChildren) =>
            React.createElement('footer', null, children),
        DialogHeader: ({ children }: React.PropsWithChildren) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: React.PropsWithChildren) =>
            React.createElement('h1', null, children)
    };
});

vi.mock('@/ui/shadcn/field', async () => {
    const React = await import('react');

    return {
        Field: ({ children, ...props }: React.ComponentProps<'div'>) =>
            React.createElement('div', props, children),
        FieldGroup: ({ children, ...props }: React.ComponentProps<'div'>) =>
            React.createElement('div', props, children),
        FieldLabel: ({ children, ...props }: React.ComponentProps<'label'>) =>
            React.createElement('label', props, children)
    };
});

vi.mock('@/ui/shadcn/input', async () => {
    const React = await import('react');

    return {
        Input: (props: React.ComponentProps<'input'>) =>
            React.createElement('input', props)
    };
});

vi.mock('@/ui/shadcn/slider', async () => {
    const React = await import('react');

    return {
        Slider: ({
            value,
            onValueChange: _onValueChange,
            ...props
        }: Omit<React.ComponentProps<'input'>, 'value'> & {
            value?: number | readonly number[];
            onValueChange?: (value: number | readonly number[]) => void;
        }) =>
            React.createElement('input', {
                ...props,
                value: Array.isArray(value) ? value[0] : value
            })
    };
});

vi.mock('@/ui/shadcn/checkbox', async () => {
    const React = await import('react');

    return {
        Checkbox: (props: React.ComponentProps<'input'>) =>
            React.createElement('input', {
                ...props,
                type: 'checkbox',
                checked: props.checked
            })
    };
});

vi.mock('lucide-react', async () => {
    const React = await import('react');
    const Icon = (props: React.ComponentProps<'span'>) =>
        React.createElement('span', props);

    return {
        FlipHorizontal2: Icon,
        FlipVertical2: Icon,
        Maximize2: Icon,
        Minimize2: Icon,
        RefreshCcw: Icon,
        RotateCcw: Icon,
        RotateCw: Icon,
        Upload: Icon,
        ZoomIn: Icon,
        ZoomOut: Icon
    };
});

vi.mock('@/ui/shadcn/spinner', async () => {
    const React = await import('react');

    return {
        Spinner: (props: React.ComponentProps<'span'>) =>
            React.createElement('span', props)
    };
});

import { ImageCropDialog } from './ImageCropDialog';

describe('ImageCropDialog', () => {
    it('renders the upload note field only when requested', () => {
        const withoutNote = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1
            })
        );
        const withNote = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1,
                noteField: {
                    label: 'Print note',
                    placeholder: 'Print note'
                }
            })
        );

        expect(withoutNote).not.toContain('Print note');
        expect(withNote).toContain('Print note');
        expect(withNote).toContain('maxLength="32"');
    });

    it('renders the crop white border field only when requested', () => {
        const withoutCropWhiteBorder = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1
            })
        );
        const withCropWhiteBorder = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1,
                cropWhiteBorderField: {
                    label: 'Crop white border',
                    defaultChecked: true
                }
            })
        );

        expect(withoutCropWhiteBorder).not.toContain('Crop white border');
        expect(withCropWhiteBorder).toContain('Crop white border');
        expect(withCropWhiteBorder).toContain('checked');
    });
});
