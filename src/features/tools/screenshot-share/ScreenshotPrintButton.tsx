import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';

import { ScreenshotPrintDialog } from './ScreenshotPrintDialog';

export function ScreenshotPrintButton({
    paths,
    disabled
}: {
    paths: string[];
    disabled: boolean;
}) {
    const { t } = useTranslation();
    const [dialogPaths, setDialogPaths] = useState<string[] | null>(null);

    return (
        <>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setDialogPaths(paths)}
            >
                <ImageIcon data-icon="inline-start" />
                {t('view.tools.screenshot_print.menu')}
            </Button>
            {dialogPaths ? (
                <ScreenshotPrintDialog
                    open
                    paths={dialogPaths}
                    onOpenChange={(open) => {
                        if (!open) {
                            setDialogPaths(null);
                        }
                    }}
                />
            ) : null}
        </>
    );
}
