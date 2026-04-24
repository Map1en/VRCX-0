import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient.js';
import { bindSQLiteErrorDialogService } from '@/services/sqliteErrorDialogService.js';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

export function AppProviders({ children }) {
    useEffect(() => bindSQLiteErrorDialogService(), []);

    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={100}>
                {children}
            </TooltipProvider>
        </QueryClientProvider>
    );
}
