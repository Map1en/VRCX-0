import { ArrowLeftIcon, RefreshCwIcon } from 'lucide-react';

import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import { IMAGE_UPLOAD_ACCEPT } from '@/shared/utils/imageUpload.js';

export function GalleryHeader({
    t,
    uploadInputRef,
    uploadingTab,
    onUploadChange,
    onBack,
    onRefreshAll
}) {
    return (
        <>
            <Input
                ref={uploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={onUploadChange}
            />
            <div className="ml-2 flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="mr-3"
                    onClick={onBack}
                >
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t('nav_tooltip.tools')}
                </Button>
                <span className="header">
                    {t('dialog.gallery_icons.header')}
                </span>
                {uploadingTab ? (
                    <Badge variant="outline">
                        {t('message.upload.loading')} {uploadingTab}
                    </Badge>
                ) : null}
                <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={onRefreshAll}
                >
                    <RefreshCwIcon data-icon="inline-start" />
                    {t('dialog.gallery_icons.refresh')}
                </Button>
            </div>
        </>
    );
}
