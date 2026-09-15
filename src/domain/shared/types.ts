const LOAD_STATUSES = ['idle', 'running', 'ready', 'error'] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

export type RemoteTabStatus = '' | 'running' | 'ready' | 'error';
