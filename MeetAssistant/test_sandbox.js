/**
 * MeetAssistant - Test Sandbox Script
 * Comprehensive simulation and automated verification suite for Google Meet caption observation,
 * question heuristics, buffer management, and AI answering.
 */

// --- Heuristics & Core Logic Under Test ---
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

const INTERROGATIVE_STARTERS = new RegExp(
  '^(?:хто|що|коли|де|куди|звідки|чому|навіщо|як|який|яка|яке|які|чи|скільки|котрий|хтось|кто|что|как|когда|где|куда|откуда|почему|зачем|какой|какая|какое|какие|ли|сколько|который|кто-то)' + CYR_BOUNDARY,
  'i'
);

const CONJUNCTION_FILTER = /^(?:я\s+(?:думаю|вважаю|знаю|бачу|чув|хотів|хочу)|ми\s+(?:думаємо|знаємо|хочемо)|на\s+мою\s+думку|мне\s+кажется|я\s+считаю|я\s+знаю|мы\s+(?:считаем|знаем|решили)|по-моему|как\s+по\s+мне)\s*,\s*(?:що|что)/i;

function isQuestionTest(text, mode = 'all') {
  if (!text || text.length < 5) return { isQ: false };
  const trimmed = text.trim();

  // 1. Explicit question mark
  if (trimmed.includes('?')) {
    return { isQ: true, type: 'explicit' };
  }

  if (mode === 'direct') {
    return { isQ: false };
  }

  // 2. Conjunction filter
  if (CONJUNCTION_FILTER.test(trimmed)) {
    return { isQ: false };
  }

  // 3. Strip speech prefix
  let core = trimmed;
  while (SPEECH_PREFIX.test(core)) {
    core = core.replace(SPEECH_PREFIX, '').trim();
  }

  // 4. Semantic question patterns
  for (const pattern of SEMANTIC_QUESTION_PATTERNS) {
    if (pattern.test(core) || pattern.test(trimmed)) {
      return { isQ: true, type: 'semantic' };
    }
  }

  // 5. Interrogative starters
  if (INTERROGATIVE_STARTERS.test(core)) {
    return { isQ: true, type: 'heuristic' };
  }

  return { isQ: false };
}

function normalizeQuestion(text) {
  return text.toLowerCase().replace(/[.,!?;:"'«»(){}\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

// --- Sandbox Controller ---
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('simulatedCaptionsContainer');
  const toggleCCBtn = document.getElementById('toggleCCBtn');
  const simUaBtn = document.getElementById('simUaBtn');
  const simRuBtn = document.getElementById('simRuBtn');
  const simStreamBtn = document.getElementById('simStreamBtn');
  const customSpeakerInput = document.getElementById('customSpeakerInput');
  const customTextInput = document.getElementById('customTextInput');
  const injectCaptionBtn = document.getElementById('injectCaptionBtn');
  const runUnitTestsBtn = document.getElementById('runUnitTestsBtn');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const testLogDisplay = document.getElementById('testLogDisplay');
  const testSummary = document.getElementById('testSummary');
  const mockApiRadio = document.getElementById('mockApiRadio');

  let isCCOn = true;
  let simulationTimer = null;

  // --- Live Floating Panel In Sandbox ---
  let sandboxPanelRoot = null;
  let sandboxShadow = null;
  let panelEl, statusPillEl, statusTextEl, questionBoxEl, answerBoxEl, errorBoxEl, thinkingEl, bannerEl, pauseBtnEl;
  let isPaused = false;
  let currentQuestion = '';
  let currentAnswer = '';
  let sandboxTracker = [];

  function initSandboxFloatingPanel() {
    const host = document.createElement('div');
    host.id = 'sandbox-panel-root';
    document.body.appendChild(host);

    sandboxShadow = host.attachShadow({ mode: 'open' });

    // Load panel CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'floating-panel.css';
    sandboxShadow.appendChild(link);

    const containerDiv = document.createElement('div');
    containerDiv.innerHTML = `
      <div class="ma-panel" id="maPanel" style="position: fixed; top: 90px; right: 30px;">
        <div class="ma-header" id="maHeader">
          <div class="ma-header-title-group">
            <div class="ma-logo-icon">M</div>
            <span class="ma-title">MeetAssistant (Sandbox)</span>
            <div class="ma-status-pill status-idle" id="maStatusPill">
              <span class="ma-status-dot"></span>
              <span id="maStatusText">Listening</span>
            </div>
          </div>
          <div class="ma-header-actions">
            <button class="ma-icon-btn" id="maMinBtn" title="Minimize">−</button>
            <button class="ma-icon-btn" id="maCloseBtn" title="Hide">×</button>
          </div>
        </div>

        <div class="ma-banner hidden" id="maBanner">
          ⚠️ Captions not detected. Turn on CC to listen.
        </div>

        <div class="ma-body">
          <div class="ma-section">
            <div class="ma-section-header">
              <span>Latest Question</span>
              <div class="ma-section-actions">
                <button class="ma-mini-btn" id="maRetryBtn">↺ Retry</button>
              </div>
            </div>
            <div class="ma-question-box empty" id="maQuestionBox">Waiting for questions in meeting captions...</div>
          </div>

          <div class="ma-section">
            <div class="ma-section-header">
              <span>AI Answer</span>
              <div class="ma-section-actions">
                <button class="ma-mini-btn" id="maCopyBtn">📋 Copy</button>
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

          <div class="ma-error-box" id="maErrorBox"></div>
        </div>

        <div class="ma-footer">
          <div style="display: flex; gap: 6px;">
            <button class="ma-btn ma-btn-primary" id="maManualAskBtn">⚡ Ask AI</button>
            <button class="ma-btn ma-btn-secondary" id="maPauseBtn">⏸ Pause</button>
            <button class="ma-btn ma-btn-subtle" id="maClearBtn">Clear</button>
          </div>
          <a href="options.html" class="ma-btn ma-btn-subtle" target="_blank" title="Open Settings">⚙️</a>
        </div>
      </div>

      <div class="ma-collapsed-pill" id="maCollapsedPill" style="position: fixed; top: 90px; right: 30px;">
        <span class="ma-logo-icon">M</span>
        <span>MeetAssistant</span>
        <div class="ma-status-pill status-ready">
          <span class="ma-status-dot"></span>
        </div>
      </div>
    `;

    sandboxShadow.appendChild(containerDiv);

    panelEl = sandboxShadow.getElementById('maPanel');
    statusPillEl = sandboxShadow.getElementById('maStatusPill');
    statusTextEl = sandboxShadow.getElementById('maStatusText');
    questionBoxEl = sandboxShadow.getElementById('maQuestionBox');
    answerBoxEl = sandboxShadow.getElementById('maAnswerBox');
    errorBoxEl = sandboxShadow.getElementById('maErrorBox');
    thinkingEl = sandboxShadow.getElementById('maThinking');
    bannerEl = sandboxShadow.getElementById('maBanner');
    pauseBtnEl = sandboxShadow.getElementById('maPauseBtn');
    const collapsedPillEl = sandboxShadow.getElementById('maCollapsedPill');

    // Dragging
    const header = sandboxShadow.getElementById('maHeader');
    let isDragging = false, startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      panelEl.classList.add('is-dragging');
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
      panelEl.style.left = `${initialLeft}px`;
      panelEl.style.top = `${initialTop}px`;
      panelEl.style.right = 'auto';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panelEl.style.left = `${initialLeft + (e.clientX - startX)}px`;
      panelEl.style.top = `${initialTop + (e.clientY - startY)}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panelEl.classList.remove('is-dragging');
      }
    });

    // Minimize & Restore
    sandboxShadow.getElementById('maMinBtn').addEventListener('click', () => {
      panelEl.classList.add('collapsed');
      collapsedPillEl.classList.add('active');
    });
    collapsedPillEl.addEventListener('click', () => {
      panelEl.classList.remove('collapsed');
      collapsedPillEl.classList.remove('active');
    });

    // Close
    sandboxShadow.getElementById('maCloseBtn').addEventListener('click', () => {
      panelEl.classList.add('hidden');
    });

    // Pause
    pauseBtnEl.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        statusPillEl.className = 'ma-status-pill status-idle';
        statusTextEl.textContent = 'Paused';
        pauseBtnEl.textContent = '▶ Resume';
      } else {
        statusPillEl.className = 'ma-status-pill status-listening';
        statusTextEl.textContent = 'Listening';
        pauseBtnEl.textContent = '⏸ Pause';
      }
    });

    // Clear
    sandboxShadow.getElementById('maClearBtn').addEventListener('click', () => {
      currentQuestion = '';
      currentAnswer = '';
      questionBoxEl.textContent = 'Waiting for questions in meeting captions...';
      questionBoxEl.classList.add('empty');
      answerBoxEl.innerHTML = 'Answers from Groq AI will appear here automatically.';
      answerBoxEl.classList.add('empty');
      errorBoxEl.classList.remove('active');
      statusPillEl.className = 'ma-status-pill status-listening';
      statusTextEl.textContent = 'Listening';
    });

    // Copy
    const copyBtn = sandboxShadow.getElementById('maCopyBtn');
    copyBtn.addEventListener('click', () => {
      if (!currentAnswer) return;
      navigator.clipboard.writeText(currentAnswer).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      });
    });

    // Manual Ask
    sandboxShadow.getElementById('maManualAskBtn').addEventListener('click', () => {
      const q = currentQuestion || 'Що обговорюється на цьому мітингу?';
      triggerSandboxAnswer(q);
    });

    // Retry
    sandboxShadow.getElementById('maRetryBtn').addEventListener('click', () => {
      if (currentQuestion) triggerSandboxAnswer(currentQuestion);
    });
  }

  initSandboxFloatingPanel();

  function triggerSandboxAnswer(question) {
    if (isPaused) return;

    currentQuestion = question;
    questionBoxEl.textContent = question;
    questionBoxEl.classList.remove('empty');
    errorBoxEl.classList.remove('active');

    statusPillEl.className = 'ma-status-pill status-processing';
    statusTextEl.textContent = 'Processing';
    thinkingEl.classList.add('active');

    const isMock = mockApiRadio.checked;

    if (isMock) {
      setTimeout(() => {
        thinkingEl.classList.remove('active');
        statusPillEl.className = 'ma-status-pill status-ready';
        statusTextEl.textContent = 'Answer ready';

        let mockAnswer = '';
        const qLower = question.toLowerCase();

        if (qLower.includes('індекс') || qLower.includes('postgresql')) {
          mockAnswer = 'У PostgreSQL додано **B-tree індекси** на поля `user_id` та `created_at`.\n* Прискорило фільтрацію сесій у ~12 разів\n* Не створило помітного навантаження на операції запису.';
        } else if (qLower.includes('реліз') || qLower.includes('стейджинг')) {
          mockAnswer = 'Реліз на стейджинг заплановано на сьогодні о 17:00 після проходження автоматичних E2E тестів.';
        } else if (qLower.includes('токен') || qLower.includes('кэш') || qLower.includes('инвалидац')) {
          mockAnswer = 'Сессионные токены живут 24 часа. Для инвалидации при логауте удаляйте ключ `session:{token}` из Redis и публикуйте событие инвалидации через Redis Pub/Sub.';
        } else if (qLower.includes('redis')) {
          mockAnswer = 'Redis забезпечує in-memory зберігання даних за ключами. Рекомендовано застосовувати TTL (Time-To-Live) для тимчасових сесій та політику витіснення `volatile-lru`.';
        } else if (qLower.includes('github actions') || qLower.includes('деплой')) {
          mockAnswer = 'Для автоматичного деплою налаштуйте `.github/workflows/deploy.yml` з тригером на `push: branches: [main]` та кроками збірки Docker образу.';
        } else {
          mockAnswer = 'Ось відповідь на основі контексту мітингу: операція успішно запланована командою розробки.';
        }

        currentAnswer = mockAnswer;
        answerBoxEl.innerHTML = mockAnswer
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;">$1</code>')
          .replace(/\n\* (.*)/g, '<li style="margin-left:14px;">$1</li>')
          .replace(/\n/g, '<br>');
        answerBoxEl.classList.remove('empty');
      }, 700);
    } else {
      // Real API route via background worker
      chrome.runtime.sendMessage({
        type: 'GENERATE_ANSWER',
        question: question,
        context: sandboxTracker.join('\n')
      }, (res) => {
        thinkingEl.classList.remove('active');
        if (res && res.success) {
          statusPillEl.className = 'ma-status-pill status-ready';
          statusTextEl.textContent = 'Answer ready';
          currentAnswer = res.answer;
          answerBoxEl.textContent = res.answer;
          answerBoxEl.classList.remove('empty');
        } else {
          statusPillEl.className = 'ma-status-pill status-error';
          statusTextEl.textContent = 'Error';
          errorBoxEl.textContent = res?.error || 'Failed to call Groq API';
          errorBoxEl.classList.add('active');
        }
      });
    }
  }

  // Hook into caption ingestion
  function onCaptionIngested(speaker, text) {
    sandboxTracker.push(`${speaker}: ${text}`);
    if (sandboxTracker.length > 20) sandboxTracker.shift();

    if (isPaused) return;

    const check = isQuestionTest(text);
    if (check.isQ) {
      setTimeout(() => {
        triggerSandboxAnswer(text);
      }, 1200);
    }
  }

  // Toggle CC
  toggleCCBtn.addEventListener('click', () => {
    isCCOn = !isCCOn;
    if (isCCOn) {
      container.classList.remove('captions-disabled');
      container.setAttribute('aria-label', 'Captions');
      toggleCCBtn.textContent = 'Toggle CC (ON)';
      toggleCCBtn.className = 'btn btn-outline btn-sm';
      if (bannerEl) bannerEl.classList.add('hidden');
    } else {
      container.classList.add('captions-disabled');
      container.removeAttribute('aria-label');
      toggleCCBtn.textContent = 'Toggle CC (OFF)';
      toggleCCBtn.className = 'btn btn-danger btn-sm';
      if (bannerEl) bannerEl.classList.remove('hidden');
    }
  });

  function addCaptionLine(speaker, text) {
    if (!isCCOn) return;
    const line = document.createElement('div');
    line.className = 'caption-line';
    line.innerHTML = `
      <span class="speaker-name NWpY1d">${escapeHtml(speaker)}:</span>
      <span class="caption-text ygicle VbkSUe">${escapeHtml(text)}</span>
    `;
    container.appendChild(line);

    onCaptionIngested(speaker, text);

    // Keep only last 4 lines visible in container
    while (container.children.length > 5) {
      container.removeChild(container.firstChild);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Scenario 1: Ukrainian Meeting ---
  simUaBtn.addEventListener('click', () => {
    stopActiveSim();
    const script = [
      { speaker: 'Олексій', text: 'Колеги, привіт усім на нашому дейлі мітингу.', delay: 400 },
      { speaker: 'Марія', text: 'Привіт! Я закінчила оптимізацію запитів до бази.', delay: 1800 },
      { speaker: 'Олексій', text: 'Чудово. А які саме індекси були додані в PostgreSQL?', delay: 3500 },
      { speaker: 'Марія', text: 'Ми створили B-tree індекси на поля user_id та created_at.', delay: 5500 },
      { speaker: 'Олексій', text: 'Хто може підказати, коли буде готовий реліз на стейджинг?', delay: 7800 }
    ];
    runScript(script);
  });

  // --- Scenario 2: Russian Meeting ---
  simRuBtn.addEventListener('click', () => {
    stopActiveSim();
    const script = [
      { speaker: 'Дмитрий', text: 'Всем привет, давайте обсудим архитектуру кэширования.', delay: 400 },
      { speaker: 'Иван', text: 'Да, сейчас у нас узкое место в сервисе авторизации.', delay: 1800 },
      { speaker: 'Дмитрий', text: 'Подскажите, сколько времени живут сессионные токены?', delay: 3500 },
      { speaker: 'Иван', text: 'Сейчас время жизни установлено в 24 часа.', delay: 5500 },
      { speaker: 'Дмитрий', text: 'Как лучше организовать инвалидацию кэша при логауте?', delay: 7800 }
    ];
    runScript(script);
  });

  // --- Scenario 3: Progressive Typing (Speech Streaming) ---
  simStreamBtn.addEventListener('click', () => {
    stopActiveSim();
    const fragments = [
      'Як',
      'Як налаштувати',
      'Як налаштувати автоматичний',
      'Як налаштувати автоматичний деплой через GitHub Actions?'
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i >= fragments.length) {
        clearInterval(interval);
        return;
      }
      addCaptionLine('Степан', fragments[i]);
      i++;
    }, 700);
  });

  function stopActiveSim() {
    if (simulationTimer) {
      clearTimeout(simulationTimer);
      simulationTimer = null;
    }
  }

  function runScript(script) {
    script.forEach(item => {
      setTimeout(() => {
        addCaptionLine(item.speaker, item.text);
      }, item.delay);
    });
  }

  // --- Custom Injection ---
  injectCaptionBtn.addEventListener('click', () => {
    const speaker = customSpeakerInput.value.trim() || 'Speaker';
    const text = customTextInput.value.trim();
    if (text) {
      addCaptionLine(speaker, text);
    }
  });

  // --- Automated Unit Test Suite ---
  runUnitTestsBtn.addEventListener('click', runAllTests);
  clearLogBtn.addEventListener('click', () => {
    testLogDisplay.textContent = '';
    testSummary.textContent = '';
  });

  function logTest(name, passed, details = '') {
    const status = passed ? '[PASS]' : '[FAIL]';
    const cssClass = passed ? 'test-pass' : 'test-fail';
    const line = `${status} ${name}${details ? ' -> ' + details : ''}\n`;
    testLogDisplay.textContent += line;
    testLogDisplay.scrollTop = testLogDisplay.scrollHeight;
  }

  function runAllTests() {
    testLogDisplay.textContent = '--- Starting MeetAssistant Unit Test Suite ---\n\n';
    let total = 0;
    let passed = 0;

    function assert(name, condition, details = '') {
      total++;
      if (condition) {
        passed++;
        logTest(name, true, details);
      } else {
        logTest(name, false, details);
      }
    }

    // 1. Ukrainian Question Starters
    assert(
      'UA Heuristic: "Хто може допомогти з тестами?"',
      isQuestionTest('Хто може допомогти з тестами?').isQ === true
    );
    assert(
      'UA Heuristic: "Що робити з цією помилкою"',
      isQuestionTest('Що робити з цією помилкою').isQ === true
    );
    assert(
      'UA Heuristic: "Коли планується наступний мітинг"',
      isQuestionTest('Коли планується наступний мітинг').isQ === true
    );
    assert(
      'UA Heuristic: "Де знайти документацію по API"',
      isQuestionTest('Де знайти документацію по API').isQ === true
    );
    assert(
      'UA Heuristic: "Чому сервіс повертає 500 помилку"',
      isQuestionTest('Чому сервіс повертає 500 помилку').isQ === true
    );
    assert(
      'UA Heuristic: "Підкажіть статус задачі"',
      isQuestionTest('Підкажіть статус задачі').isQ === true
    );
    assert(
      'UA Heuristic: "Чи є сенс додавати індекс"',
      isQuestionTest('Чи є сенс додавати індекс').isQ === true
    );

    // 2. Russian Question Starters
    assert(
      'RU Heuristic: "Кто отвечает за деплой на прод?"',
      isQuestionTest('Кто отвечает за деплой на прод?').isQ === true
    );
    assert(
      'RU Heuristic: "Что изменилось в последнем релизе"',
      isQuestionTest('Что изменилось в последнем релизе').isQ === true
    );
    assert(
      'RU Heuristic: "Когда мы сможем протестировать фичу"',
      isQuestionTest('Когда мы сможем протестировать фичу').isQ === true
    );
    assert(
      'RU Heuristic: "Почему сборка упала в GitLab"',
      isQuestionTest('Почему сборка упала в GitLab').isQ === true
    );
    assert(
      'RU Heuristic: "Подскажите пожалуйста номер тикета"',
      isQuestionTest('Подскажите пожалуйста номер тикета').isQ === true
    );
    assert(
      'RU Heuristic: "Как настроить локальное окружение"',
      isQuestionTest('Как настроить локальное окружение').isQ === true
    );

    // 3. Explicit Question Marks
    assert(
      'Explicit Question with mark: "Реліз сьогодні?"',
      isQuestionTest('Реліз сьогодні?').isQ === true && isQuestionTest('Реліз сьогодні?').type === 'explicit'
    );
    assert(
      'Explicit Question inside text: "Тут є помилка, бачиш? Треба виправити."',
      isQuestionTest('Тут є помилка, бачиш? Треба виправити.').isQ === true
    );

    // 4. Negative Statements (Must NOT trigger as questions)
    assert(
      'Negative Non-Q: "Я думаю, що це гарне рішення."',
      isQuestionTest('Я думаю, що це гарне рішення.').isQ === false,
      'Filtered by conjunction rule'
    );
    assert(
      'Negative Non-Q: "Мне кажется, что сервер перегружен."',
      isQuestionTest('Мне кажется, что сервер перегружен.').isQ === false,
      'Filtered by conjunction rule'
    );
    assert(
      'Negative Non-Q: "Ми закінчили роботу над спринтом."',
      isQuestionTest('Ми закінчили роботу над спринтом.').isQ === false
    );
    assert(
      'Negative Non-Q: "Всі тести пройшли успішно."',
      isQuestionTest('Всі тести пройшли успішно.').isQ === false
    );
    assert(
      'Short text rejection (<5 chars)',
      isQuestionTest('Так').isQ === false
    );

    // 5. Direct-Only Mode
    assert(
      'Direct Mode rejects heuristic question without "?"',
      isQuestionTest('Хто може допомогти', 'direct').isQ === false
    );
    assert(
      'Direct Mode accepts question with "?"',
      isQuestionTest('Хто може допомогти?', 'direct').isQ === true
    );

    // 6. Normalization & Deduplication
    assert(
      'Question Normalization: Strips punctuation and lowercase',
      normalizeQuestion('Хто це зробив?!') === 'хто це зробив'
    );
    assert(
      'Question Normalization: Collapses whitespace',
      normalizeQuestion('  Що   з   сервером?  ') === 'що з сервером'
    );

    // 7. Caption Accumulator & Deduplication Simulation
    class MiniTracker {
      constructor() {
        this.buffer = [];
        this.activeText = '';
      }
      ingest(text) {
        if (text.startsWith(this.activeText)) {
          this.activeText = text; // progressive update
        } else {
          if (this.activeText) this.buffer.push(this.activeText);
          this.activeText = text;
        }
      }
    }

    const trackerTest = new MiniTracker();
    trackerTest.ingest('Хто');
    trackerTest.ingest('Хто може');
    trackerTest.ingest('Хто може допомогти?');
    assert(
      'Deduplication: Progressive stream collapsed into single utterance',
      trackerTest.buffer.length === 0 && trackerTest.activeText === 'Хто може допомогти?'
    );

    trackerTest.ingest('Дякую за допомогу.');
    assert(
      'Deduplication: New sentence commits prior utterance',
      trackerTest.buffer.length === 1 && trackerTest.buffer[0] === 'Хто може допомогти?'
    );

    // Summary
    const allPassed = (passed === total);
    testSummary.textContent = `Result: ${passed}/${total} tests passed (${Math.round((passed/total)*100)}%)`;
    testSummary.style.color = allPassed ? '#34d399' : '#f87171';
    testLogDisplay.textContent += `\n--- Test Run Complete: ${passed}/${total} passed ---\n`;
  }
});
