/**
 * MeetAssistant - Popup Script
 * Manages UI interactions in the extension popup and communicates with content script.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('popupStatusBadge');
  const statusText = document.getElementById('popupStatusText');
  const statusDesc = document.getElementById('statusDesc');
  const meetNotice = document.getElementById('meetNotice');
  const meetControls = document.getElementById('meetControls');
  const togglePauseBtn = document.getElementById('togglePauseBtn');
  const pauseBtnIcon = document.getElementById('pauseBtnIcon');
  const pauseBtnLabel = document.getElementById('pauseBtnLabel');
  const detectionModeSelect = document.getElementById('detectionModeSelect');
  const showPanelBtn = document.getElementById('showPanelBtn');
  const manualAskBtn = document.getElementById('manualAskBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const openSandboxBtn = document.getElementById('openSandboxBtn');
  const footerSandboxBtn = document.getElementById('footerSandboxBtn');

  let activeTab = null;
  let isMeetTab = false;

  // 1. Check current active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      activeTab = tabs[0];
      isMeetTab = !!(activeTab.url && activeTab.url.includes('meet.google.com/'));
    }
  } catch (err) {
    console.warn('Could not query active tab:', err);
  }

  // 2. Load stored settings
  chrome.storage.local.get(['isPaused', 'detectionMode'], (data) => {
    const isPaused = data.isPaused || false;
    const mode = data.detectionMode || 'all';

    updatePauseButtonUI(isPaused);
    detectionModeSelect.value = mode;

    if (!isMeetTab) {
      meetNotice.classList.remove('hidden');
      meetControls.style.opacity = '0.5';
      meetControls.style.pointerEvents = 'none';

      statusBadge.className = 'header-status-pill status-notmeet';
      statusText.textContent = 'Not on Meet';
      statusDesc.textContent = 'Assistant activates on meet.google.com';
    } else {
      meetNotice.classList.add('hidden');
      meetControls.style.opacity = '1';
      meetControls.style.pointerEvents = 'auto';

      // Query content script for live state
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_MEET_STATE' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          statusBadge.className = 'header-status-pill status-paused';
          statusText.textContent = 'Connecting...';
          statusDesc.textContent = 'Refresh Meet tab if panel is not visible';
          return;
        }

        const meetState = response.state;
        updatePauseButtonUI(meetState.isPaused);
        detectionModeSelect.value = meetState.detectionMode;

        if (meetState.isPaused) {
          statusBadge.className = 'header-status-pill status-paused';
          statusText.textContent = 'Paused';
          statusDesc.textContent = 'Monitoring is paused';
        } else if (!meetState.captionsAvailable) {
          statusBadge.className = 'header-status-pill status-paused';
          statusText.textContent = 'CC Off';
          statusDesc.textContent = 'Turn on captions in Google Meet';
        } else {
          statusBadge.className = 'header-status-pill status-listening';
          statusText.textContent = 'Active';
          statusDesc.textContent = 'Listening to Google Meet captions';
        }
      });
    }
  });

  // Helper to update pause button display
  function updatePauseButtonUI(isPaused) {
    if (isPaused) {
      pauseBtnIcon.textContent = '▶';
      pauseBtnLabel.textContent = 'Resume';
      statusBadge.className = 'header-status-pill status-paused';
      statusText.textContent = 'Paused';
      statusDesc.textContent = 'Monitoring is paused';
    } else {
      pauseBtnIcon.textContent = '⏸';
      pauseBtnLabel.textContent = 'Pause';
      if (isMeetTab) {
        statusBadge.className = 'header-status-pill status-listening';
        statusText.textContent = 'Active';
        statusDesc.textContent = 'Listening to Google Meet captions';
      }
    }
  }

  // --- Button Listeners ---

  // Pause / Resume Toggle
  togglePauseBtn.addEventListener('click', () => {
    chrome.storage.local.get(['isPaused'], (data) => {
      const nextPaused = !data.isPaused;
      chrome.storage.local.set({ isPaused: nextPaused }, () => {
        updatePauseButtonUI(nextPaused);
        if (isMeetTab && activeTab) {
          chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_PAUSE', isPaused: nextPaused });
        }
      });
    });
  });

  // Mode Selection
  detectionModeSelect.addEventListener('change', (e) => {
    const newMode = e.target.value;
    chrome.storage.local.set({ detectionMode: newMode }, () => {
      if (isMeetTab && activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'SET_MODE', mode: newMode });
      }
    });
  });

  // Focus Floating Panel
  showPanelBtn.addEventListener('click', () => {
    if (isMeetTab && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_PANEL' });
      window.close();
    }
  });

  // Manual Ask
  manualAskBtn.addEventListener('click', () => {
    if (isMeetTab && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'TRIGGER_MANUAL' });
      window.close();
    }
  });

  // Options page links
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Test Sandbox page links
  function openSandbox() {
    const sandboxUrl = chrome.runtime.getURL('test_sandbox.html');
    chrome.tabs.create({ url: sandboxUrl });
  }

  if (openSandboxBtn) openSandboxBtn.addEventListener('click', openSandbox);
  if (footerSandboxBtn) footerSandboxBtn.addEventListener('click', openSandbox);
});
