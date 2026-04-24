function sortStatus(a, b) {
    switch (b) {
        case 'join me':
            switch (a) {
                case 'active':
                case 'ask me':
                case 'busy':
                case 'offline':
                    return 1;
            }
            break;
        case 'active':
            switch (a) {
                case 'join me':
                    return -1;
                case 'ask me':
                case 'busy':
                case 'offline':
                    return 1;
            }
            break;
        case 'ask me':
            switch (a) {
                case 'join me':
                case 'active':
                    return -1;
                case 'busy':
                case 'offline':
                    return 1;
            }
            break;
        case 'busy':
            switch (a) {
                case 'join me':
                case 'active':
                case 'ask me':
                    return -1;
                case 'offline':
                    return 1;
            }
            break;
        case 'offline':
            switch (a) {
                case 'join me':
                case 'active':
                case 'ask me':
                case 'busy':
                    return -1;
            }
            break;
    }
    return 0;
}

export { sortStatus };
