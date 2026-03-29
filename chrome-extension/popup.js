const API_CANDIDATES = [
    'http://127.0.0.1:3000/api/save-external',
    'http://localhost:3000/api/save-external'
];

const annotationInput = document.querySelector('#annotation');
const saveButton = document.querySelector('#save-button');
const statusElement = document.querySelector('#status');
const pageMetaElement = document.querySelector('#page-meta');

let activeTab = null;

function isSupportedPageUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
}

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.style.color = isError ? '#fca5a5' : '#c7c7c7';
}

function truncateText(value, maxLength) {
    const text = String(value || '').trim();

    if (!text || text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength).trimEnd()}...`;
}

async function getActiveTab() {
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return tabs[0] || null;
}

async function postCapture(payload) {
    let lastError = new Error('Knowledge Hub API is unavailable.');

    for (const endpoint of API_CANDIDATES) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save page.');
            }

            return data;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Failed to save page.');
        }
    }

    throw lastError;
}

async function handleSave() {
    if (!activeTab?.url) {
        setStatus('No active page available.', true);
        return;
    }

    saveButton.disabled = true;
    setStatus('Saving…');

    try {
        await postCapture({
            title: activeTab.title || '',
            url: activeTab.url,
            annotation: annotationInput.value
        });

        annotationInput.value = '';
        setStatus('Capture sent to Knowledge Hub.');
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to save page.', true);
    } finally {
        saveButton.disabled = false;
    }
}

async function init() {
    try {
        activeTab = await getActiveTab();

        if (!activeTab?.url) {
            pageMetaElement.textContent = 'Open a page before saving.';
            saveButton.disabled = true;
            return;
        }

        if (!isSupportedPageUrl(activeTab.url)) {
            pageMetaElement.textContent = 'Only http and https pages can be saved.';
            saveButton.disabled = true;
            return;
        }

        pageMetaElement.textContent = truncateText(
            `${activeTab.title || 'Untitled page'}\n${activeTab.url}`,
            140
        );
    } catch (error) {
        pageMetaElement.textContent = 'Failed to read the active tab.';
        saveButton.disabled = true;
        setStatus('Chrome tab access failed.', true);
    }
}

saveButton.addEventListener('click', handleSave);

init();
