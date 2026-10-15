/**
 * MeetAssistant - Content Script
 * Injected into meet.google.com to observe closed captions, detect questions,
 * trigger Groq AI completions via background script, and display answers in a floating panel.
 */

(function () {
  // Prevent duplicate injection
  if (window.__meetAssistantLoaded) return;
  window.__meetAssistantLoaded = true;

  // --- Configuration & Constants ---
  const DEBOUNCE_QUESTION_MS = 2000; // Wait 2.0s for speaker to finish asking
  const DEFAULT_MIN_INTERVAL_MS = 12000; // 12s minimum between automatic requests
  const DEFAULT_MAX_CONTEXT_CHARS = 5000;
  const CAPTION_POLL_INTERVAL_MS = 1500;

  // Cyrillic-safe word boundary (in JS, \b only recognizes ASCII \w [a-zA-Z0-9_])
  const CYR_BOUNDARY = '(?![а-яА-ЯёЁіІїЇєЄґҐa-zA-Z0-9])';

  // Speech prefixes commonly said before questions (Ukrainian & Russian)
  const SPEECH_PREFIX = new RegExp(
    '^(?:колеги|коллеги|ребята|друзі|скажіть|скажите|слушайте|послухайте|кстати|до\\s+речі|ну|а|і|и|так|отже|тогда|тоді|скажи|слухай)' + CYR_BOUNDARY + '\\s*[,–-]?\\s*',
    'i'
  );

  // Semantic question patterns (detects questions even WITHOUT a question mark)
  const SEMANTIC_QUESTION_PATTERNS = [
    // Opinion & thoughts (e.g. "Что думаете об этом?", "Що думаєте про це?")
    /(?:что|що|как|як)\s+(?:думаете|думаєте|считаете|вважаєте)(?:\s+(?:об\s+этом|про\s+це|по\s+этому\s+поводу|щодо\s+цього))?/i,
    // Choices & comparison (e.g. "Какой вариант лучше?", "Який варіант кращий?")
    /(?:какой|який)\s+(?:вариант|варіант|способ|спосіб|выбор|вибір)\s+(?:лучше|кращий|предпочтительнее|оптимальнее|оптимальніший)/i,
    /(?:какой|який|что|що)\s+(?:из\s+них|з\s+них)?\s*(?:лучше|краще)/i,
    // Requests to explain / show / clarify (e.g. "Можете объяснить?", "Можете пояснити?")
    /можете\s+(?:ли\s+)?(?:объяснить|пояснить|пояснити|рассказать|розказати|подсказать|підказати|уточнить|уточнити|показать|показати)/i,
    // Can anyone / who can / who knows
    /(?:кто|хто)\s+(?:может|може|знает|знає|готов|готовий)/i,
    /(?:может|може)\s+ли\s+кто(?:-то| нибудь)?/i,
    /(?:чи\s+може)\s+(?:хтось|хто-небудь)/i,
    // Direct requests for info
    new RegExp('(?:подскажите|підкажіть|поясните|поясніть|расскажите|розкажіть|посоветуйте|порадьте)' + CYR_BOUNDARY, 'i'),
    // Existence / worthiness
    /(?:есть\s+ли|чи\s+є|стоит\s+ли|чи\s+варто|имеет\s+ли\s+смысл|чи\s+має\s+сенс)/i,
    // Inquiring difference / cause / problem
    /(?:в\s+чем|у\s+чому)\s+(?:разница|різниця|проблема|причина|дело|справа|суть)/i,
    // Practical how-to
    /(?:как|як)\s+(?:нам\s+|мне\s+|нам\s+)?(?:лучше|краще|правильно|работает|працює|сделать|зробити|настроить|налаштувати|исправить|виправити)/i
  ];

  // Cyrillic-safe interrogative starters
  const INTERROGATIVE_STARTERS = new RegExp(
    '^(?:хто|що|коли|де|куди|звідки|чому|навіщо|як|який|яка|яке|які|чи|скільки|котрий|хтось|кто|что|как|когда|где|куда|откуда|почему|зачем|какой|какая|какое|какие|ли|сколько|который|кто-то)' + CYR_BOUNDARY,
    'i'
  );

  // Conjunction filter: personal opinion statements that contain "что/що", not questions
  const CONJUNCTION_FILTER = /^(?:я\s+(?:думаю|вважаю|знаю|бачу|чув|хотів|хочу)|ми\s+(?:думаємо|знаємо|хочемо)|на\s+мою\s+думку|мне\s+кажется|я\s+считаю|я\s+знаю|мы\s+(?:считаем|знаем|решили)|по-моему|как\s+по\s+мне)\s*,\s*(?:що|что)/i;

  // --- State ---
  const state = {
    isPaused: false,
    detectionMode: 'all', // 'all', 'direct', 'manual'
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
    autoAnswerEnabled: true,
    lastRequestTimestamp: 0,
    currentStatus: 'idle', // 'idle', 'listening', 'processing', 'ready', 'error'
    currentQuestion: '',
    currentAnswer: '',
    lastError: '',
    isCollapsed: false,
    isHidden: false,
    captionsAvailable: false
  };

  // Set of recently processed questions to prevent spamming duplicates
  const processedQuestions = new Set();
  let questionDebounceTimer = null;

  // Load user settings from chrome.storage.local
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([
        'isPaused',
        'detectionMode',
        'minIntervalSeconds',
        'maxContextLength',
        'autoAnswerEnabled'
      ], (items) => {
        if (items) {
          if (items.isPaused !== undefined) state.isPaused = items.isPaused;
          if (items.detectionMode) state.detectionMode = items.detectionMode;
          if (items.minIntervalSeconds) state.minIntervalMs = items.minIntervalSeconds * 1000;
          if (items.maxContextLength) state.maxContextChars = items.maxContextLength;
          if (items.autoAnswerEnabled !== undefined) state.autoAnswerEnabled = items.autoAnswerEnabled;
          updateUIStatus();
        }
      });
    }
  }

  // --- Caption Tracker & Accumulator (Stores 20-40 dialogue turns) ---
  class CaptionTracker {
    constructor(maxTurns = 40) {
      this.maxTurns = maxTurns;
      this.turns = []; // Array of { speaker, text, timestamp }
      this.activeTurn = null; // Currently in-progress turn { speaker, text, timestamp }
      this.inactivityTimeoutMs = 3500;
      this.inactivityTimer = null;
    }

    /**
     * Ingests a caption turn from Google Meet DOM
     */
    ingestTurn(speaker, text) {
      if (!text || text.length < 2) return;
      speaker = (speaker || 'Speaker').trim();
      text = text.trim();

      // Skip if identical to the last finalized turn
      const lastFinal = this.turns[this.turns.length - 1];
      if (lastFinal && lastFinal.speaker === speaker && lastFinal.text === text) {
        return;
      }

      // Skip if identical to the active turn
      if (this.activeTurn && this.activeTurn.speaker === speaker && this.activeTurn.text === text) {
        return;
      }

      const now = Date.now();

      if (this.activeTurn) {
        if (this.activeTurn.speaker === speaker) {
          // Same speaker
          if (text.startsWith(this.activeTurn.text)) {
            // Progressive extension of speech (e.g. "Хто" -> "Хто може")
            this.activeTurn.text = text;
            this.activeTurn.timestamp = now;
            this.resetInactivityTimer();
            this.notifyUpdate(speaker, text);
            return;
          } else if (this.activeTurn.text.startsWith(text)) {
            // Stale / shorter partial text, ignore
            return;
          } else {
            // Check if Speech-to-Text revised the wording or started a new sentence
            if (this.isLikelyRevision(this.activeTurn.text, text)) {
              this.activeTurn.text = text;
              this.activeTurn.timestamp = now;
              this.resetInactivityTimer();
              this.notifyUpdate(speaker, text);
              return;
            } else {
              // Finalize previous turn and start new turn
              this.finalizeActiveTurn();
              this.startNewTurn(speaker, text, now);
              this.notifyUpdate(speaker, text);
              return;
            }
          }
        } else {
          // Different speaker: commit previous speaker's turn and start new turn
          this.finalizeActiveTurn();
          this.startNewTurn(speaker, text, now);
          this.notifyUpdate(speaker, text);
          return;
        }
      } else {
        // No active turn
        this.startNewTurn(speaker, text, now);
        this.notifyUpdate(speaker, text);
      }
    }

    isLikelyRevision(oldText, newText) {
      const oldWords = oldText.toLowerCase().split(/\s+/);
      const newWords = newText.toLowerCase().split(/\s+/);
      if (oldWords.length === 0 || newWords.length === 0) return false;

      let common = 0;
      for (const w of newWords) {
        if (oldWords.includes(w)) common++;
      }
      return (common / Math.max(oldWords.length, newWords.length)) >= 0.45;
    }

    startNewTurn(speaker, text, timestamp) {
      this.activeTurn = { speaker, text, timestamp };
      this.resetInactivityTimer();
      console.log(`[MeetAssistant Debug] Turn #${this.getTurnCount()} started [${speaker}]:`, text);
    }

    resetInactivityTimer() {
      if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        this.finalizeActiveTurn();
      }, this.inactivityTimeoutMs);
    }

    finalizeActiveTurn() {
      if (this.inactivityTimer) {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = null;
      }
      if (this.activeTurn && this.activeTurn.text.length > 1) {
        const last = this.turns[this.turns.length - 1];
        if (!last || last.speaker !== this.activeTurn.speaker || last.text !== this.activeTurn.text) {
          this.turns.push({
            speaker: this.activeTurn.speaker,
            text: this.activeTurn.text,
            timestamp: this.activeTurn.timestamp
          });
          if (this.turns.length > this.maxTurns) {
            this.turns.shift();
          }
          console.log(`[MeetAssistant Debug] Turn finalized. Total stored: ${this.turns.length} turns [${this.activeTurn.speaker}]:`, this.activeTurn.text);
        }
        this.activeTurn = null;
      }
    }

    clear() {
      if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
      this.turns = [];
      this.activeTurn = null;
      console.log('[MeetAssistant Debug] Context buffer cleared.');
    }

    getTurnCount() {
      return this.turns.length + (this.activeTurn ? 1 : 0);
    }

    getFormattedContext(maxChars = 5000) {
      const all = [...this.turns];
      if (this.activeTurn) {
        all.push(this.activeTurn);
      }
      if (all.length === 0) return '';

      const lines = all.map(t => `${t.speaker}: ${t.text}`);
      let result = lines.join('\n');

      if (result.length > maxChars) {
        while (lines.length > 1 && lines.join('\n').length > maxChars) {
          lines.shift();
        }
        result = lines.join('\n');
      }
      return result;
    }

    notifyUpdate(speaker, text) {
      handleCaptionUpdate(speaker, text);
    }
  }

  const tracker = new CaptionTracker(40);

  // --- Question Detection Logic (Explicit & Semantic) ---
  function isQuestion(text, mode = 'all') {
    if (!text || text.length < 5) return { isQ: false };
    const trimmed = text.trim();

    // 1. Explicit question mark anywhere in text
    if (trimmed.includes('?')) {
      return { isQ: true, type: 'explicit', question: trimmed };
    }

    if (mode === 'direct') {
      return { isQ: false };
    }

    // 2. Filter out personal opinion conjunction statements ("Я думаю, что...")
    if (CONJUNCTION_FILTER.test(trimmed)) {
      return { isQ: false };
    }

    // 3. Strip leading conversational speech prefixes (e.g. "Коллеги, какой вариант лучше")
    let core = trimmed;
    while (SPEECH_PREFIX.test(core)) {
      core = core.replace(SPEECH_PREFIX, '').trim();
    }

    // 4. Check semantic question patterns without question marks
    for (const pattern of SEMANTIC_QUESTION_PATTERNS) {
      if (pattern.test(core) || pattern.test(trimmed)) {
        return { isQ: true, type: 'semantic', question: trimmed };
      }
    }

    // 5. Check interrogative starters
    if (INTERROGATIVE_STARTERS.test(core)) {
      return { isQ: true, type: 'heuristic', question: trimmed };
    }

    return { isQ: false };
  }

  function normalizeQuestion(text) {
    return text.toLowerCase().replace(/[.,!?;:"'«»(){}\[\]]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Called whenever caption text updates
   */
  function handleCaptionUpdate(speaker, text) {
    if (state.isPaused) return;

    state.captionsAvailable = true;
    updateBanner();
    updateTurnCountBadge();

    if (state.currentStatus === 'idle') {
      setStatus('listening');
    }

    // If mode is manual, do not auto-detect
    if (state.detectionMode === 'manual' || !state.autoAnswerEnabled) {
      return;
    }

    const check = isQuestion(text, state.detectionMode);
    if (!check.isQ) return;

    console.log(`[MeetAssistant Debug] Question detected (${check.type}) [${speaker}]:`, text);

    // Reset debounce timer to allow speaker to finish
    if (questionDebounceTimer) {
      clearTimeout(questionDebounceTimer);
    }

    questionDebounceTimer = setTimeout(() => {
      onQuestionFinished(speaker, text);
    }, DEBOUNCE_QUESTION_MS);
  }

  /**
   * Called once a question sentence has settled
   */
  function onQuestionFinished(speaker, questionText) {
    if (state.isPaused || state.detectionMode === 'manual' || !state.autoAnswerEnabled) {
      return;
    }

    const norm = normalizeQuestion(questionText);
    if (processedQuestions.has(norm)) {
      return; // Already answered
    }

    // Check rate limit throttle
    const now = Date.now();
    if (now - state.lastRequestTimestamp < state.minIntervalMs) {
      console.log('[MeetAssistant Debug] Throttled by minimum interval. Question skipped:', questionText);
      return;
    }

    processedQuestions.add(norm);
    if (processedQuestions.size > 50) {
      const first = processedQuestions.values().next().value;
      processedQuestions.delete(first);
    }

    state.currentQuestion = questionText;
    updateUIQuestion(questionText);
    requestAIAnswer(questionText);
  }

  /**
   * Sends request to background service worker to query Groq
   */
  function requestAIAnswer(questionText) {
    const context = tracker.getFormattedContext(state.maxContextChars);
    const turnsCount = tracker.getTurnCount();

    // Debug logging (Requirement 8)
    console.log('[MeetAssistant Debug] Requesting AI answer:', {
      turnsInContext: turnsCount,
      contextLengthChars: context.length,
      question: questionText
    });
    console.log('[MeetAssistant Debug] Meeting context sent to Groq:\n' + context);

    setStatus('processing');
    state.lastRequestTimestamp = Date.now();

    chrome.runtime.sendMessage({
      type: 'GENERATE_ANSWER',
      question: questionText,
      context: context,
      turnsCount: turnsCount
    }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message || 'Could not communicate with extension background script.');
        return;
      }

      if (!response) {
        showError('No response received from background service.');
        return;
      }

      if (response.success && response.answer) {
        state.currentAnswer = response.answer;
        updateUIAnswer(response.answer);
        setStatus('ready');
      } else {
        showError(response.error || 'Failed to generate answer.');
      }
    });
  }

  // --- Google Meet Caption DOM Observer & Row Scanner ---
  let captionObserver = null;
  let activeCaptionContainer = null;
  let captionScanTimeout = null;

  // Known selectors used by Google Meet for captions and speaker names
  const SELECTORS = {
    containers: [
      '[role="region"][aria-label*="caption" i]',
      '[role="region"][aria-label*="субтитр" i]',
      '.iOzk7',
      'div[jscontroller][aria-live]',
      'div[aria-live="polite"]',
      'div[aria-live="assertive"]'
    ],
    speaker: [
      '.NWpY1d',
      '[data-self-name]',
      '.zs75Ib',
      '.adE7zb'
    ],
    text: [
      '.ygicle.VbkSUe',
      '.ygicle',
      '.VbkSUe',
      '.CNWvd',
      'div[jsname="YSxPC"]',
      'span[jsname="YSxPC"]'
    ]
  };

  function findCaptionContainer() {
    for (const selector of SELECTORS.containers) {
      const el = document.querySelector(selector);
      if (el && el.isConnected) return el;
    }
    return null;
  }

  function scheduleCaptionScan() {
    if (captionScanTimeout) clearTimeout(captionScanTimeout);
    captionScanTimeout = setTimeout(() => {
      scanCaptionContainer();
    }, 120);
  }

  function scanCaptionContainer() {
    const container = findCaptionContainer();
    if (!container || !container.isConnected) return;

    state.captionsAvailable = true;
    updateBanner();

    // In Google Meet, each speaker utterance is represented as a row or block
    let rows = Array.from(container.querySelectorAll('.nMxhM, div[jscontroller], [data-speaker-id], .iOzk7 > div'));
    if (rows.length === 0) {
      rows = Array.from(container.children).filter(c => c.textContent && c.textContent.trim().length > 0);
    }
    if (rows.length === 0 && container.textContent && container.textContent.trim().length > 1) {
      rows = [container];
    }

    for (const row of rows) {
      const res = extractSpeakerAndTextFromRow(row);
      if (res && res.text) {
        tracker.ingestTurn(res.speaker, res.text);
      }
    }
  }

  function extractSpeakerAndTextFromRow(row) {
    if (!row || row.nodeType !== Node.ELEMENT_NODE) return null;

    let speaker = '';
    for (const sSel of SELECTORS.speaker) {
      const sEl = row.querySelector(sSel);
      if (sEl && sEl.textContent) {
        speaker = sEl.textContent.trim();
        break;
      }
    }

    let text = '';
    for (const tSel of SELECTORS.text) {
      const tEl = row.querySelector(tSel);
      if (tEl && tEl.textContent) {
        text = tEl.textContent.trim();
        break;
      }
    }

    if (!text && row.textContent) {
      const clone = row.cloneNode(true);
      for (const sSel of SELECTORS.speaker) {
        clone.querySelectorAll(sSel).forEach(el => el.remove());
      }
      const raw = clone.textContent.trim();
      if (raw.length > 1) {
        text = raw;
      }
    }

    return text ? { speaker: speaker || 'Speaker', text } : null;
  }

  function startCaptionObserver() {
    const container = findCaptionContainer();

    if (container && container !== activeCaptionContainer) {
      if (captionObserver) captionObserver.disconnect();
      activeCaptionContainer = container;
      state.captionsAvailable = true;
      updateBanner();

      captionObserver = new MutationObserver(() => {
        scheduleCaptionScan();
      });

      captionObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
      });

      console.log('[MeetAssistant Debug] Caption observer attached to container:', container);
      scanCaptionContainer();
      return;
    }

    if (!captionObserver) {
      captionObserver = new MutationObserver(() => {
        const found = findCaptionContainer();
        if (found) {
          startCaptionObserver();
        }
      });

      captionObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  // Periodic health check for caption availability
  setInterval(() => {
    const container = findCaptionContainer();
    const hasCC = !!container;
    if (state.captionsAvailable !== hasCC) {
      state.captionsAvailable = hasCC;
      updateBanner();
      if (hasCC && state.currentStatus === 'idle') {
        setStatus('listening');
      }
    }
  }, CAPTION_POLL_INTERVAL_MS);

  // --- Shadow DOM & Floating UI Panel ---
  let shadowRoot = null;
  let panelEl = null;
  let collapsedPillEl = null;
  let statusPillEl = null;
  let statusTextEl = null;
  let questionBoxEl = null;
  let answerBoxEl = null;
  let errorBoxEl = null;
  let thinkingEl = null;
  let bannerEl = null;
  let pauseBtnEl = null;

  function renderFloatingPanel() {
    const host = document.createElement('div');
    host.id = 'meet-assistant-root';
    document.documentElement.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    // Load CSS
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('floating-panel.css');
    shadowRoot.appendChild(styleLink);

    // HTML Markup
    const template = document.createElement('div');
    template.innerHTML = `
      <div class="ma-panel" id="maPanel">
        <!-- Header -->
        <div class="ma-header" id="maHeader">
          <div class="ma-header-title-group">
            <div class="ma-logo-icon">M</div>
            <span class="ma-title">MeetAssistant</span>
            <div class="ma-status-pill status-idle" id="maStatusPill">
              <span class="ma-status-dot"></span>
              <span id="maStatusText">Idle</span>
            </div>
          </div>
          <div class="ma-header-actions">
            <button class="ma-icon-btn" id="maMinBtn" title="Minimize to corner">−</button>
            <button class="ma-icon-btn" id="maCloseBtn" title="Hide panel">×</button>
          </div>
        </div>

        <!-- Captions Warning Banner -->
        <div class="ma-banner hidden" id="maBanner">
          ⚠️ Captions not detected. Turn on CC in Meet (press 'c') to listen.
        </div>

        <!-- Body Content -->
        <div class="ma-body">
          <!-- Question Section -->
          <div class="ma-section">
            <div class="ma-section-header">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span>Latest Question</span>
                <span id="maTurnsBadge" style="font-size: 10px; color: #64748b; font-weight: normal; text-transform: none;">(0 turns)</span>
              </div>
              <div class="ma-section-actions">
                <button class="ma-mini-btn" id="maRetryBtn" title="Re-ask this question">↺ Retry</button>
              </div>
            </div>
            <div class="ma-question-box empty" id="maQuestionBox">Waiting for questions in meeting captions...</div>
          </div>

          <!-- Answer Section -->
          <div class="ma-section">
            <div class="ma-section-header">
              <span>AI Answer</span>
              <div class="ma-section-actions">
                <button class="ma-mini-btn" id="maCopyBtn" title="Copy answer to clipboard">📋 Copy</button>
              </div>
            </div>
            <div class="ma-answer-box-wrapper">
              <div class="ma-answer-box empty" id="maAnswerBox">Answers from Groq AI will appear here automatically.</div>
              <div class="ma-thinking-indicator" id="maThinking">
                <div class="ma-spinner"></div>
                <span>Generating answer from Groq...</span>
              </div>
            </div>
          </div>

          <!-- Error Alert Box -->
          <div class="ma-error-box" id="maErrorBox"></div>
        </div>

        <!-- Toolbar Footer -->
        <div class="ma-footer">
          <div style="display: flex; gap: 6px;">
            <button class="ma-btn ma-btn-primary" id="maManualAskBtn" title="Generate answer from recent meeting context">
              ⚡ Ask AI
            </button>
            <button class="ma-btn ma-btn-secondary" id="maPauseBtn">
              ⏸ Pause
            </button>
            <button class="ma-btn ma-btn-subtle" id="maClearBtn" title="Clear current question, answer and context">
              Clear
            </button>
          </div>
          <button class="ma-btn ma-btn-subtle" id="maSettingsBtn" title="Open Settings">
            ⚙️
          </button>
        </div>
      </div>

      <!-- Collapsed Mini Pill -->
      <div class="ma-collapsed-pill" id="maCollapsedPill">
        <span class="ma-logo-icon">M</span>
        <span>MeetAssistant</span>
        <div class="ma-status-pill status-idle" id="maPillStatus">
          <span class="ma-status-dot"></span>
        </div>
      </div>
    `;

    shadowRoot.appendChild(template);

    // Cache elements
    panelEl = shadowRoot.getElementById('maPanel');
    collapsedPillEl = shadowRoot.getElementById('maCollapsedPill');
    statusPillEl = shadowRoot.getElementById('maStatusPill');
    statusTextEl = shadowRoot.getElementById('maStatusText');
    questionBoxEl = shadowRoot.getElementById('maQuestionBox');
    answerBoxEl = shadowRoot.getElementById('maAnswerBox');
    errorBoxEl = shadowRoot.getElementById('maErrorBox');
    thinkingEl = shadowRoot.getElementById('maThinking');
    bannerEl = shadowRoot.getElementById('maBanner');
    pauseBtnEl = shadowRoot.getElementById('maPauseBtn');

    initDragAndDrop();
    bindUIEvents();
    updateBanner();
  }

  // --- Drag and Drop Mechanics ---
  function initDragAndDrop() {
    const header = shadowRoot.getElementById('maHeader');
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    header.addEventListener('mousedown', (e) => {
      // Don't drag if clicking buttons
      if (e.target.closest('button')) return;

      isDragging = true;
      panelEl.classList.add('is-dragging');

      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;

      // Fix panel with absolute pixels rather than right/top
      panelEl.style.left = `${initialLeft}px`;
      panelEl.style.top = `${initialTop}px`;
      panelEl.style.right = 'auto';

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // Restrict within window boundaries
      const maxLeft = window.innerWidth - panelEl.offsetWidth - 10;
      const maxTop = window.innerHeight - panelEl.offsetHeight - 10;

      newLeft = Math.max(10, Math.min(newLeft, maxLeft));
      newTop = Math.max(10, Math.min(newTop, maxTop));

      panelEl.style.left = `${newLeft}px`;
      panelEl.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panelEl.classList.remove('is-dragging');
      }
    });
  }

  // --- UI Event Binding ---
  function bindUIEvents() {
    // Minimize toggle
    shadowRoot.getElementById('maMinBtn').addEventListener('click', () => {
      toggleCollapse(true);
    });

    collapsedPillEl.addEventListener('click', () => {
      toggleCollapse(false);
    });

    // Close / Hide
    shadowRoot.getElementById('maCloseBtn').addEventListener('click', () => {
      panelEl.classList.add('hidden');
      state.isHidden = true;
    });

    // Pause / Resume
    pauseBtnEl.addEventListener('click', () => {
      togglePause();
    });

    // Clear
    shadowRoot.getElementById('maClearBtn').addEventListener('click', () => {
      clearAll();
    });

    // Manual Ask button
    shadowRoot.getElementById('maManualAskBtn').addEventListener('click', () => {
      handleManualAsk();
    });

    // Retry button
    shadowRoot.getElementById('maRetryBtn').addEventListener('click', () => {
      if (state.currentQuestion) {
        requestAIAnswer(state.currentQuestion);
      } else {
        handleManualAsk();
      }
    });

    // Copy Answer button
    const copyBtn = shadowRoot.getElementById('maCopyBtn');
    copyBtn.addEventListener('click', () => {
      if (!state.currentAnswer) return;
      navigator.clipboard.writeText(state.currentAnswer).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      }).catch(() => {
        copyBtn.textContent = 'Failed';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      });
    });

    // Settings shortcut button
    shadowRoot.getElementById('maSettingsBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });
  }

  function toggleCollapse(collapsed) {
    state.isCollapsed = collapsed;
    if (collapsed) {
      panelEl.classList.add('collapsed');
      collapsedPillEl.classList.add('active');
    } else {
      panelEl.classList.remove('collapsed');
      collapsedPillEl.classList.remove('active');
    }
  }

  function togglePause(paused) {
    state.isPaused = (paused !== undefined) ? paused : !state.isPaused;
    chrome.storage.local.set({ isPaused: state.isPaused });
    updateUIStatus();
  }

  function clearAll() {
    tracker.clear();
    state.currentQuestion = '';
    state.currentAnswer = '';
    state.lastError = '';

    questionBoxEl.textContent = 'Waiting for questions in meeting captions...';
    questionBoxEl.classList.add('empty');

    answerBoxEl.innerHTML = 'Answers from Groq AI will appear here automatically.';
    answerBoxEl.classList.add('empty');

    errorBoxEl.classList.remove('active');
    errorBoxEl.textContent = '';

    setStatus(state.captionsAvailable ? 'listening' : 'idle');
  }

  function handleManualAsk() {
    let question = state.currentQuestion;
    if (!question) {
      if (tracker.activeTurn && tracker.activeTurn.text) {
        question = tracker.activeTurn.text;
      } else if (tracker.turns.length > 0) {
        const last = tracker.turns[tracker.turns.length - 1];
        question = `${last.speaker}: ${last.text}`;
      } else {
        question = 'Определить текущую тему обсуждения или последний вопрос и дать ответ.';
      }
    }
    console.log('[MeetAssistant Debug] Manual Ask triggered for:', question);
    updateUIQuestion(question);
    requestAIAnswer(question);
  }

  function updateTurnCountBadge() {
    if (!shadowRoot) return;
    const badge = shadowRoot.getElementById('maTurnsBadge');
    if (badge) {
      const count = tracker.getTurnCount();
      badge.textContent = `(${count} turns)`;
    }
  }

  // --- UI Update Helpers ---
  function setStatus(status) {
    state.currentStatus = status;
    updateUIStatus();
    updateTurnCountBadge();
  }

  function updateUIStatus() {
    if (!statusPillEl) return;

    if (state.isPaused) {
      statusPillEl.className = 'ma-status-pill status-idle';
      statusTextEl.textContent = 'Paused';
      if (pauseBtnEl) pauseBtnEl.textContent = '▶ Resume';
      return;
    }

    if (pauseBtnEl) pauseBtnEl.textContent = '⏸ Pause';

    const statusMap = {
      idle: { text: 'Idle', class: 'status-idle' },
      listening: { text: 'Listening', class: 'status-listening' },
      processing: { text: 'Processing', class: 'status-processing' },
      ready: { text: 'Answer ready', class: 'status-ready' },
      error: { text: 'Error', class: 'status-error' }
    };

    const cur = statusMap[state.currentStatus] || statusMap.idle;
    statusPillEl.className = `ma-status-pill ${cur.class}`;
    statusTextEl.textContent = cur.text;

    // Toggle thinking indicator
    if (thinkingEl) {
      if (state.currentStatus === 'processing') {
        thinkingEl.classList.add('active');
      } else {
        thinkingEl.classList.remove('active');
      }
    }
  }

  function updateBanner() {
    if (!bannerEl) return;
    if (!state.captionsAvailable) {
      bannerEl.classList.remove('hidden');
    } else {
      bannerEl.classList.add('hidden');
    }
  }

  function updateUIQuestion(question) {
    if (!questionBoxEl) return;
    state.currentQuestion = question;
    questionBoxEl.textContent = question;
    questionBoxEl.classList.remove('empty');
    if (errorBoxEl) errorBoxEl.classList.remove('active');
  }

  function formatAnswerHtml(markdownText) {
    if (!markdownText) return '';
    // Basic safe Markdown renderer for bold, bullets, newlines
    let html = markdownText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Bullet points (* or -)
    const lines = html.split('\n');
    let inList = false;
    const formatted = [];

    for (let line of lines) {
      const match = line.match(/^(\s*)[*\-]\s+(.*)$/);
      if (match) {
        if (!inList) {
          formatted.push('<ul>');
          inList = true;
        }
        formatted.push(`<li>${match[2]}</li>`);
      } else {
        if (inList) {
          formatted.push('</ul>');
          inList = false;
        }
        if (line.trim()) {
          formatted.push(`<p style="margin: 4px 0;">${line}</p>`);
        }
      }
    }
    if (inList) formatted.push('</ul>');

    return formatted.join('');
  }

  function updateUIAnswer(answerText) {
    if (!answerBoxEl) return;
    state.currentAnswer = answerText;
    answerBoxEl.innerHTML = formatAnswerHtml(answerText);
    answerBoxEl.classList.remove('empty');
    if (errorBoxEl) errorBoxEl.classList.remove('active');
  }

  function showError(msg) {
    state.lastError = msg;
    setStatus('error');
    if (errorBoxEl) {
      errorBoxEl.textContent = `Error: ${msg}`;
      errorBoxEl.classList.add('active');
    }
  }

  // --- Message Communication with Popup & Background ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    switch (msg.type) {
      case 'GET_MEET_STATE':
        sendResponse({
          success: true,
          state: {
            isPaused: state.isPaused,
            detectionMode: state.detectionMode,
            currentStatus: state.currentStatus,
            captionsAvailable: state.captionsAvailable,
            hasQuestion: !!state.currentQuestion,
            hasAnswer: !!state.currentAnswer
          }
        });
        return true;

      case 'TOGGLE_PAUSE':
        togglePause(msg.isPaused);
        sendResponse({ success: true, isPaused: state.isPaused });
        return true;

      case 'SET_MODE':
        if (msg.mode) {
          state.detectionMode = msg.mode;
          chrome.storage.local.set({ detectionMode: msg.mode });
          sendResponse({ success: true, mode: state.detectionMode });
        }
        return true;

      case 'TRIGGER_MANUAL':
        handleManualAsk();
        sendResponse({ success: true });
        return true;

      case 'SHOW_PANEL':
        if (panelEl) {
          panelEl.classList.remove('hidden');
          panelEl.classList.remove('collapsed');
          collapsedPillEl.classList.remove('active');
          state.isHidden = false;
          state.isCollapsed = false;
        }
        sendResponse({ success: true });
        return true;

      case 'SETTINGS_UPDATED':
        loadSettings();
        sendResponse({ success: true });
        return true;
    }
    return false;
  });

  // Listen to storage changes dynamically
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.isPaused) state.isPaused = changes.isPaused.newValue;
      if (changes.detectionMode) state.detectionMode = changes.detectionMode.newValue;
      if (changes.minIntervalSeconds) state.minIntervalMs = changes.minIntervalSeconds.newValue * 1000;
      if (changes.maxContextLength) state.maxContextChars = changes.maxContextLength.newValue;
      if (changes.autoAnswerEnabled) state.autoAnswerEnabled = changes.autoAnswerEnabled.newValue;
      updateUIStatus();
    });
  }

  // --- Initialization ---
  function init() {
    loadSettings();
    renderFloatingPanel();
    startCaptionObserver();
    console.log('[MeetAssistant] Content script initialized on Google Meet.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
