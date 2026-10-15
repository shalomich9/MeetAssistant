/**
 * MeetAssistant - Options Script
 * Handles settings storage, API key validation, model selection, and configuration reset.
 */

const DEFAULT_SETTINGS = {
  groqApiKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  responseLanguage: 'auto',
  detectionMode: 'all',
  autoAnswerEnabled: true,
  minIntervalSeconds: 12,
  maxContextLength: 5000
};

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const groqApiKeyInput = document.getElementById('groqApiKey');
  const toggleKeyVisibilityBtn = document.getElementById('toggleKeyVisibility');
  const testApiKeyBtn = document.getElementById('testApiKeyBtn');
  const keyTestResult = document.getElementById('keyTestResult');

  const groqModelSelect = document.getElementById('groqModel');
  const customModelGroup = document.getElementById('customModelGroup');
  const customModelInput = document.getElementById('customModelInput');
  const responseLanguageSelect = document.getElementById('responseLanguage');

  const detectionModeRadios = document.getElementsByName('detectionMode');
  const autoAnswerCheckbox = document.getElementById('autoAnswerEnabled');
  const minIntervalInput = document.getElementById('minIntervalSeconds');
  const maxContextInput = document.getElementById('maxContextLength');

  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const saveStatus = document.getElementById('saveStatus');
  const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const statusAlert = document.getElementById('statusAlert');

  // Load existing settings
  chrome.storage.local.get(null, (stored) => {
    const config = Object.assign({}, DEFAULT_SETTINGS, stored);

    groqApiKeyInput.value = config.groqApiKey || '';

    // Handle Model select
    if (config.groqModel === 'llama-3.3-70b-versatile' || config.groqModel === 'llama-3.1-8b-instant') {
      groqModelSelect.value = config.groqModel;
      customModelGroup.classList.add('hidden');
    } else if (config.groqModel) {
      groqModelSelect.value = 'custom';
      customModelGroup.classList.remove('hidden');
      customModelInput.value = config.groqModel;
    } else {
      groqModelSelect.value = DEFAULT_SETTINGS.groqModel;
      customModelGroup.classList.add('hidden');
    }

    responseLanguageSelect.value = config.responseLanguage || 'auto';

    // Detection mode
    for (const radio of detectionModeRadios) {
      if (radio.value === config.detectionMode) {
        radio.checked = true;
        break;
      }
    }

    autoAnswerCheckbox.checked = config.autoAnswerEnabled !== false;
    minIntervalInput.value = config.minIntervalSeconds || 12;
    maxContextInput.value = config.maxContextLength || 1500;
  });

  // Toggle API key visibility
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    if (groqApiKeyInput.type === 'password') {
      groqApiKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = '🔒';
    } else {
      groqApiKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = '👁';
    }
  });

  // Toggle Custom Model input
  groqModelSelect.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      customModelGroup.classList.remove('hidden');
      customModelInput.focus();
    } else {
      customModelGroup.classList.add('hidden');
    }
  });

  // Test API Key
  testApiKeyBtn.addEventListener('click', async () => {
    const apiKey = groqApiKeyInput.value.trim();
    if (!apiKey) {
      setKeyTestResult('Please enter an API key to test.', 'error');
      return;
    }

    let model = groqModelSelect.value;
    if (model === 'custom') {
      model = customModelInput.value.trim() || 'llama-3.3-70b-versatile';
    }

    setKeyTestResult('Testing connection to Groq API...', 'text-dim');
    testApiKeyBtn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'TEST_API_KEY',
      apiKey,
      model
    }, (response) => {
      testApiKeyBtn.disabled = false;

      if (chrome.runtime.lastError) {
        setKeyTestResult(`Connection failed: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }

      if (response && response.success) {
        setKeyTestResult('✓ Key is valid! Connected to Groq API successfully.', 'success');
      } else {
        setKeyTestResult(`✗ Verification failed: ${response?.error || 'Unknown error'}`, 'error');
      }
    });
  });

  function setKeyTestResult(msg, type) {
    keyTestResult.textContent = msg;
    keyTestResult.className = `form-hint ${type}`;
  }

  // Get selected detection mode
  function getSelectedDetectionMode() {
    for (const radio of detectionModeRadios) {
      if (radio.checked) return radio.value;
    }
    return 'all';
  }

  // Save Settings
  saveSettingsBtn.addEventListener('click', () => {
    const apiKey = groqApiKeyInput.value.trim();
    let model = groqModelSelect.value;
    if (model === 'custom') {
      model = customModelInput.value.trim();
      if (!model) {
        showGlobalAlert('Please specify a custom model identifier or choose a preset model.', 'error');
        return;
      }
    }

    const minInterval = Math.max(5, Math.min(60, parseInt(minIntervalInput.value, 10) || 12));
    const maxContext = Math.max(500, Math.min(10000, parseInt(maxContextInput.value, 10) || 5000));

    const newSettings = {
      groqApiKey: apiKey,
      groqModel: model,
      responseLanguage: responseLanguageSelect.value,
      detectionMode: getSelectedDetectionMode(),
      autoAnswerEnabled: autoAnswerCheckbox.checked,
      minIntervalSeconds: minInterval,
      maxContextLength: maxContext
    };

    chrome.storage.local.set(newSettings, () => {
      if (chrome.runtime.lastError) {
        showGlobalAlert('Failed to save settings: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      saveStatus.textContent = '✓ Settings saved successfully!';
      saveStatus.className = 'save-status success';
      setTimeout(() => {
        saveStatus.textContent = '';
      }, 3000);

      showGlobalAlert('Settings successfully updated!', 'success');

      // Notify any active Meet tabs to reload settings
      chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
        if (tabs && tabs.length > 0) {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
          });
        }
      });
    });
  });

  // Restore Defaults (retains current API key)
  resetDefaultsBtn.addEventListener('click', () => {
    const currentKey = groqApiKeyInput.value;
    groqModelSelect.value = DEFAULT_SETTINGS.groqModel;
    customModelGroup.classList.add('hidden');
    customModelInput.value = '';
    responseLanguageSelect.value = DEFAULT_SETTINGS.responseLanguage;

    for (const radio of detectionModeRadios) {
      radio.checked = (radio.value === DEFAULT_SETTINGS.detectionMode);
    }

    autoAnswerCheckbox.checked = DEFAULT_SETTINGS.autoAnswerEnabled;
    minIntervalInput.value = DEFAULT_SETTINGS.minIntervalSeconds;
    maxContextInput.value = DEFAULT_SETTINGS.maxContextLength;

    showGlobalAlert('Fields reset to defaults. Click "Save Settings" to apply.', 'success');
  });

  // Clear All Local Data
  clearAllBtn.addEventListener('click', () => {
    const confirmed = confirm('Are you sure you want to remove all saved settings and clear your API key from Chrome storage?');
    if (!confirmed) return;

    chrome.storage.local.clear(() => {
      groqApiKeyInput.value = '';
      groqModelSelect.value = DEFAULT_SETTINGS.groqModel;
      customModelGroup.classList.add('hidden');
      customModelInput.value = '';
      responseLanguageSelect.value = DEFAULT_SETTINGS.responseLanguage;

      for (const radio of detectionModeRadios) {
        radio.checked = (radio.value === DEFAULT_SETTINGS.detectionMode);
      }

      autoAnswerCheckbox.checked = DEFAULT_SETTINGS.autoAnswerEnabled;
      minIntervalInput.value = DEFAULT_SETTINGS.minIntervalSeconds;
      maxContextInput.value = DEFAULT_SETTINGS.maxContextLength;

      keyTestResult.textContent = '';
      showGlobalAlert('All local settings and stored keys have been deleted.', 'success');
    });
  });

  function showGlobalAlert(message, type) {
    statusAlert.textContent = message;
    statusAlert.className = `alert ${type}`;
    statusAlert.classList.remove('hidden');
    setTimeout(() => {
      statusAlert.classList.add('hidden');
    }, 4000);
  }
});
