import type { ChangeEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarRefreshButton } from '@/components/layout/ToolbarControls';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/constants/imageUpload';
import { Badge } from '@/ui/shadcn/badge';
import { Input } from '@/ui/shadcn/input';

import type { GalleryGridDensity } from '../galleryDensity';
import { GalleryGridDensityMenu } from './GalleryGridDensityMenu';

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
                        <GalleryGridDensityMenu
                            gridDensity={gridDensity}
                            onGridDensityChange={onGridDensityChange}
                        />
                        <ToolbarRefreshButton onRefresh={onRefreshAll} />
                    </>
                }
            />
        </>
    );
}
