// Basic Tracking Logic
// Stores data in chrome.storage.local

// Set idle detection interval to 15 seconds (minimum allowed is 15s)
chrome.idle.setDetectionInterval(15);


async function updateHistory() {
    const now = Date.now();
    const data = await chrome.storage.local.get(['currentEntry', 'history']);
    let { currentEntry, history } = data;

    if (!history) history = [];

    // If there was an active page, resolve its duration
    if (currentEntry && currentEntry.url) {
        const duration = (now - currentEntry.startTime) / 1000; // in seconds

        // Only log if meaningful duration (> 1s)
        if (duration > 1) {
            history.push({
                url: currentEntry.url,
                title: currentEntry.title,
                duration: duration
            });
        }
    }
    return history;
}

async function startTracking(tab) {
    const now = Date.now();
    // Ignored URLs
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
        await chrome.storage.local.set({
            currentEntry: {
                url: tab.url,
                title: tab.title,
                startTime: now
            }
        });
    } else {
        await chrome.storage.local.set({ currentEntry: null });
    }
}

// 1. Tab Switch
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const history = await updateHistory();
    await chrome.storage.local.set({ history });

    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await startTracking(tab);
    } catch (e) {
        await chrome.storage.local.set({ currentEntry: null });
    }
});

// 2. Navigation / Reload within same tab
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        const history = await updateHistory();
        await chrome.storage.local.set({ history });
        await startTracking(tab);
    }
});

// 3. Window Focus Change (Stop tracking if user leaves Chrome)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // Lost focus
        const history = await updateHistory();
        await chrome.storage.local.set({ history, currentEntry: null });
    } else {
        // Gained focus
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            // Commit previous session if exists (edge case) then start new
            // Actually updateHistory checks storage, so it handles pending state properly
            const history = await updateHistory();
            await chrome.storage.local.set({ history });
            await startTracking(tabs[0]);
        }
    }
});
// 4. Idle State Change (Laptops sleep/lock/idle)
chrome.idle.onStateChanged.addListener(async (state) => {
    console.log("Idle state changed to:", state);
    if (state === 'idle' || state === 'locked') {
        // Stop tracking
        const history = await updateHistory();
        await chrome.storage.local.set({ history, currentEntry: null });
    } else if (state === 'active') {
        // Resume tracking
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            const history = await updateHistory();
            await chrome.storage.local.set({ history });
            await startTracking(tabs[0]);
        }
    }
});
// 5. Initialization
async function init() {
    console.log("Initializing extension...");
    // Clear any stale state
    await chrome.storage.local.set({ currentEntry: null });

    // Check if there is an active tab and we are not idle
    // chrome.idle.queryState is a callback-based API in some versions, but can be used with a promise
    chrome.idle.queryState(15, async (state) => {
        if (state === 'active') {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
                await startTracking(tabs[0]);
            }
        }
    });
}

// Handle extension load/update
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);

// Also run init now in case the service worker just woke up
init();
