import { useTranslation } from 'react-i18next';

import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { FILE_TABS, TAB_ORDER, type GalleryTab } from '../galleryConstants';
import { GalleryFileTab } from './GalleryFileTab';
import { GalleryPrintsTab } from './GalleryPrintsTab';

export function GalleryTabs({
    activeTab,
    onActiveTabChange,
    tabCounts,
    fileTab,
    printsTab
}: any) {
    const { t } = useTranslation();

    return (
        <Tabs
            value={activeTab}
            onValueChange={onActiveTabChange}
            className="min-h-0 flex-1"
        >
            <TabsList
                variant="line"
                className="flex h-auto w-full flex-wrap justify-start"
            >
                {TAB_ORDER.map((tab: GalleryTab) => {
                    const definition = tab === 'prints' ? null : FILE_TABS[tab];
                    return (
                        <TabsTrigger
                            key={tab}
                            value={tab}
                            className="flex-none"
                        >
                            {definition?.titleKey
                                ? t(definition.titleKey)
                                : t(`dialog.gallery_icons.${tab}`)}
                            <span className="text-muted-foreground text-xs">
                                {tabCounts[tab]}
                            </span>
                        </TabsTrigger>
                    );
                })}
            </TabsList>

            {Object.entries(FILE_TABS).map(([tab, definition]) => (
                <GalleryFileTab
                    key={tab}
                    tab={tab}
                    definition={definition}
                    fileTab={fileTab}
                />
            ))}
            <GalleryPrintsTab printsTab={printsTab} />
        </Tabs>
    );
}
