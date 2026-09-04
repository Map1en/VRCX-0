import { RefreshCwIcon, SettingsIcon } from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/utils/imageUpload';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    GALLERY_GRID_DENSITY_OPTIONS,
    sanitizeGalleryGridDensity,
    type GalleryGridDensity
} from '../galleryDensity';

function GalleryGridSettingsMenu({
    gridDensity,
    onGridDensityChange
}: {
    gridDensity: GalleryGridDensity;
    onGridDensityChange: (value: GalleryGridDensity) => void;
}) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.actions.view_options')}
                    >
                        <SettingsIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <DropdownMenuContent className="w-72 p-3" align="end">
                <FieldGroup>
                    <Field>
                        <FieldLabel>
                            {t('dialog.gallery_icons.grid_density')}
                        </FieldLabel>
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={gridDensity ? [gridDensity] : []}
                            onValueChange={(nextValue) => {
                                if (nextValue[0]) {
                                    onGridDensityChange(
                                        sanitizeGalleryGridDensity(nextValue[0])
                                    );
                                }
                            }}
                            className="grid w-full grid-cols-3"
                        >
                            {GALLERY_GRID_DENSITY_OPTIONS.map((option) => (
                                <ToggleGroupItem
                                    key={option.value}
                                    value={option.value}
                                    aria-label={t(option.labelKey)}
                                    className="w-full min-w-0 justify-center px-2"
                                >
                                    <span className="truncate">
                                        {t(option.labelKey)}
                                    </span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                </FieldGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function GalleryHeader({
    uploadInputRef,
    uploadingTab,
    onUploadChange,
    gridDensity,
    onGridDensityChange,
    onRefreshAll
}: {
    uploadInputRef: RefObject<HTMLInputElement | null>;
    uploadingTab: string;
    onUploadChange: (event: ChangeEvent<HTMLInputElement>) => void;
    gridDensity: GalleryGridDensity;
    onGridDensityChange: (value: GalleryGridDensity) => void;
    onRefreshAll: () => void;
}) {
    const { t } = useTranslation();

    return (
        <>
            <Input
                ref={uploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={onUploadChange}
            />
            <ToolPageHeader
                toolKey="gallery"
                status={
                    uploadingTab ? (
                        <Badge variant="outline">
                            {t('message.upload.loading')} {uploadingTab}
                        </Badge>
                    ) : null
                }
                actions={
                    <>
                        <GalleryGridSettingsMenu
                            gridDensity={gridDensity}
                            onGridDensityChange={onGridDensityChange}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onRefreshAll}
                        >
                            <RefreshCwIcon data-icon="inline-start" />
                            {t('dialog.gallery_icons.refresh')}
                        </Button>
                    </>
                }
            />
        </>
    );
}
