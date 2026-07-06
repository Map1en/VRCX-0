import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import { queryClient } from '@/lib/queryClient';
import { bindSQLiteErrorDialogService } from '@/services/sqliteErrorDialogService';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

export function AppProviders({ children }: { children: ReactNode }) {
    useEffect(() => bindSQLiteErrorDialogService(), []);

    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delay={100}>{children}</TooltipProvider>
        </QueryClientProvider>
    );
}
