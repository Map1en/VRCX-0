import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarViewMenu } from '@/components/layout/ToolbarControls';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import {
    GALLERY_GRID_DENSITY_OPTIONS,
    sanitizeGalleryGridDensity,
    type GalleryGridDensity
} from '../galleryDensity';

export function GalleryGridDensityMenu({
    gridDensity,
    onGridDensityChange
}: {
    gridDensity: GalleryGridDensity;
    onGridDensityChange: (value: GalleryGridDensity) => void;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarViewMenu contentClassName="p-3">
            <FieldGroup onClick={(event) => event.stopPropagation()}>
                <Field>
                    <FieldLabel>
                        {t('dialog.gallery_icons.grid_density')}
                    </FieldLabel>
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={gridDensity ? [gridDensity] : []}
                        onValueChange={(nextValue) => {
                            if (nextValue[0]) {
                                onGridDensityChange(
                                    sanitizeGalleryGridDensity(nextValue[0])
                                );
                            }
                        }}
                        className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
                    >
                        {GALLERY_GRID_DENSITY_OPTIONS.map((option, index) => (
                            <Fragment key={option.value}>
                                {index > 0 ? <ToggleGroupSeparator /> : null}
                                <ToggleGroupItem
                                    value={option.value}
                                    aria-label={t(option.labelKey)}
                                    className="w-full min-w-0 justify-center px-2"
                                >
                                    <span className="truncate">
                                        {t(option.labelKey)}
                                    </span>
                                </ToggleGroupItem>
                            </Fragment>
                        ))}
                    </ToggleGroup>
                </Field>
            </FieldGroup>
        </ToolbarViewMenu>
    );
}
