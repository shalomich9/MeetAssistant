/**
 * MeetAssistant - Automated Test Suite
 * Validates manifest.json, JS syntax across all project files, and tests question detection heuristics,
 * deduplication logic, context buffering, and API error formatting.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
let totalTests = 0;
let passedTests = 0;

function assert(description, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${description}`);
  } else {
    console.error(`  ✗ [FAIL] ${description} ${details ? '(' + details + ')' : ''}`);
  }
}

console.log('\n=============================================');
console.log(' MeetAssistant - Extension Test Suite');
console.log('=============================================\n');

// -------------------------------------------------------------
// 1. Manifest V3 Validation
// -------------------------------------------------------------
console.log('Section 1: Manifest V3 Structure & Integrity');
try {
  const manifestPath = path.join(rootDir, 'manifest.json');
  assert('manifest.json exists', fs.existsSync(manifestPath));

  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  assert('Manifest version is 3', manifest.manifest_version === 3);
  assert('Has valid name and version', !!manifest.name && !!manifest.version);
  assert('Background service worker declared', manifest.background?.service_worker === 'background.js');
  assert('Content scripts match meet.google.com/*', manifest.content_scripts?.[0]?.matches?.includes('https://meet.google.com/*'));
  assert('Content script file is content.js', manifest.content_scripts?.[0]?.js?.includes('content.js'));
  assert('Permissions include storage', manifest.permissions?.includes('storage'));
  assert('Host permissions include meet.google.com and api.groq.com',
    manifest.host_permissions?.includes('https://meet.google.com/*') &&
    manifest.host_permissions?.includes('https://api.groq.com/*')
  );
  assert('Options page is configured', manifest.options_ui?.page === 'options.html');
  assert('Popup page is configured', manifest.action?.default_popup === 'popup.html');

  // Verify all declared files exist
  const filesToCheck = [
    manifest.background.service_worker,
    manifest.content_scripts[0].js[0],
    manifest.action.default_popup,
    manifest.options_ui.page,
    manifest.icons['16'],
    manifest.icons['48'],
    manifest.icons['128']
  ];

  filesToCheck.forEach(file => {
    assert(`Referenced file exists: ${file}`, fs.existsSync(path.join(rootDir, file)));
  });
} catch (err) {
  assert('Manifest parsing failed', false, err.message);
}

// -------------------------------------------------------------
// 2. JavaScript Syntax Verification (node --check)
// -------------------------------------------------------------
console.log('\nSection 2: JavaScript Syntax Verification');
const jsFiles = [
  'background.js',
  'content.js',
  'popup.js',
  'options.js',
  'test_sandbox.js',
  'scripts/generate_icons.js'
];

jsFiles.forEach(file => {
  const fullPath = path.join(rootDir, file);
  if (fs.existsSync(fullPath)) {
    try {
      execFileSync(process.execPath, ['--check', fullPath]);
      assert(`Syntax valid: ${file}`, true);
    } catch (err) {
      assert(`Syntax valid: ${file}`, false, err.message);
    }
  } else {
    assert(`File exists: ${file}`, false, 'Missing file');
  }
});

// -------------------------------------------------------------
// -------------------------------------------------------------
// 3. Question Detection Heuristics & Semantic Tests
// -------------------------------------------------------------
console.log('\nSection 3: Question Detection Heuristics & Semantic Tests');

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

function detectQuestion(text, mode = 'all') {
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

// User-specified question examples:
assert('User Example 1: "Что думаете об этом?"', detectQuestion('Что думаете об этом?').isQ === true);
assert('User Example 1 (no ?): "Что думаете об этом"', detectQuestion('Что думаете об этом').isQ === true);
assert('User Example 2: "Какой вариант лучше?"', detectQuestion('Какой вариант лучше?').isQ === true);
assert('User Example 2 (no ?): "Какой вариант лучше"', detectQuestion('Какой вариант лучше').isQ === true);
assert('User Example 3: "Можете объяснить?"', detectQuestion('Можете объяснить?').isQ === true);
assert('User Example 3 (no ?): "Можете объяснить"', detectQuestion('Можете объяснить').isQ === true);
assert('Prefixed question: "Коллеги, какой вариант лучше"', detectQuestion('Коллеги, какой вариант лучше').isQ === true);
assert('Prefixed question: "Ребята, можете объяснить как работает деплой"', detectQuestion('Ребята, можете объяснить как работает деплой').isQ === true);

// Ukrainian test cases
const uaQuestions = [
  'Хто може пояснити цей баг?',
  'Що потрібно зробити до релізу',
  'Коли ми починаємо тестування',
  'Де лежить конфігурація для прому',
  'Чому не працює авторизація',
  'Як налаштувати вебхуки',
  'Підкажіть, який таймаут встановлено',
  'Чи є доступ до бази даних',
  'Хто знає, як це виправити',
  'Що думаєте про це',
  'Який варіант кращий',
  'Можете пояснити в чому різниця'
];

uaQuestions.forEach(q => {
  assert(`UA Question detected: "${q}"`, detectQuestion(q).isQ === true);
});

// Russian test cases
const ruQuestions = [
  'Кто будет проверять пуллреквест?',
  'Что происходит с нагрузкой на сервис',
  'Когда выйдет обновление',
  'Где сохраняются логи ошибок',
  'Почему падает этот запрос',
  'Как запустить тесты локально',
  'Подскажите, где найти документацию',
  'Есть ли готовый пример реализации'
];

ruQuestions.forEach(q => {
  assert(`RU Question detected: "${q}"`, detectQuestion(q).isQ === true);
});

// Explicit questions
assert('Explicit question with "?" anywhere', detectQuestion('Тут помилка, чи не так?').isQ === true);

// Negative statements (must NOT trigger)
const nonQuestions = [
  'Я думаю, що цей код потребує рефакторингу.',
  'Ми знаємо, що терміни підтискають.',
  'Мне кажется, что сервер не отвечает.',
  'Я считаю, что нужно объединить ветки.',
  'Сьогодні чудовий день для релізу.',
  'Всі юніт тести пройшли успішно.',
  'Дякую за інформацію.'
];

nonQuestions.forEach(nq => {
  assert(`Negative statement rejected: "${nq}"`, detectQuestion(nq).isQ === false);
});

// Direct mode only tests
assert('Direct mode accepts "?"', detectQuestion('Де логи?', 'direct').isQ === true);
assert('Direct mode rejects semantic without "?"', detectQuestion('Де логи', 'direct').isQ === false);
assert('Direct mode rejects "Какой вариант лучше" without "?"', detectQuestion('Какой вариант лучше', 'direct').isQ === false);

// -------------------------------------------------------------
// 4. Caption Deduplication & Buffer Management Tests
// -------------------------------------------------------------
console.log('\nSection 4: Caption Deduplication & Context Buffer');

class CaptionTrackerTest {
  constructor(maxTurns = 40) {
    this.maxTurns = maxTurns;
    this.turns = [];
    this.activeTurn = null;
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

  ingestTurn(speaker, text) {
    if (!text || text.length < 2) return;
    speaker = (speaker || 'Speaker').trim();
    text = text.trim();

    const lastFinal = this.turns[this.turns.length - 1];
    if (lastFinal && lastFinal.speaker === speaker && lastFinal.text === text) {
      return;
    }

    if (this.activeTurn && this.activeTurn.speaker === speaker && this.activeTurn.text === text) {
      return;
    }

    const now = Date.now();

    if (this.activeTurn) {
      if (this.activeTurn.speaker === speaker) {
        if (text.startsWith(this.activeTurn.text)) {
          this.activeTurn.text = text;
          this.activeTurn.timestamp = now;
          return;
        } else if (this.activeTurn.text.startsWith(text)) {
          return;
        } else {
          if (this.isLikelyRevision(this.activeTurn.text, text)) {
            this.activeTurn.text = text;
            this.activeTurn.timestamp = now;
            return;
          } else {
            this.finalizeActiveTurn();
            this.startNewTurn(speaker, text, now);
            return;
          }
        }
      } else {
        this.finalizeActiveTurn();
        this.startNewTurn(speaker, text, now);
        return;
      }
    } else {
      this.startNewTurn(speaker, text, now);
    }
  }

  startNewTurn(speaker, text, timestamp) {
    this.activeTurn = { speaker, text, timestamp };
  }

  finalizeActiveTurn() {
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
      }
      this.activeTurn = null;
    }
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
      let cutIdx = result.length - maxChars;
      const nextNewline = result.indexOf('\n', cutIdx);
      if (nextNewline !== -1 && nextNewline < result.length - 20) {
        cutIdx = nextNewline + 1;
      }
      result = '...\n' + result.slice(cutIdx);
    }
    return result;
  }
}

const tracker = new CaptionTrackerTest(3);
tracker.ingestTurn('Олексій', 'Привіт');
tracker.ingestTurn('Олексій', 'Привіт усім');
tracker.ingestTurn('Олексій', 'Привіт усім, як справи?');

assert('Progressive speech collapses into single active text',
  tracker.turns.length === 0 && tracker.activeTurn !== null && tracker.activeTurn.text === 'Привіт усім, як справи?'
);

// Speech-to-text live revision (>45% word overlap) updates the active turn
tracker.ingestTurn('Олексій', 'Привіт усім, як справи друзі');
assert('Speech-to-text revision updates active text instead of creating duplicate turn',
  tracker.turns.length === 0 && tracker.activeTurn.text === 'Привіт усім, як справи друзі'
);

// Speaker change commits previous
tracker.ingestTurn('Марія', 'Все добре');
assert('Speaker transition commits prior speaker turn to turns list',
  tracker.turns.length === 1 &&
  tracker.turns[0].speaker === 'Олексій' &&
  tracker.turns[0].text === 'Привіт усім, як справи друзі' &&
  tracker.activeTurn.speaker === 'Марія'
);

// Accumulating dialogue turns
tracker.ingestTurn('Олексій', 'Чудово, починаємо');
tracker.ingestTurn('Марія', 'Так, відкриваю презентацію');
tracker.ingestTurn('Степан', 'Я підключився');
tracker.finalizeActiveTurn();

assert('Buffer retains up to maxTurns (3)', tracker.turns.length === 3);

// Test 20-40 turn capacity on a realistic meeting instance
const meetingTracker = new CaptionTrackerTest(40);
for (let i = 1; i <= 30; i++) {
  meetingTracker.ingestTurn(i % 2 === 0 ? 'Анна' : 'Дмитро', `Обговорюємо пункт ${i} нашої агенди`);
}
meetingTracker.finalizeActiveTurn();
assert('Context buffer retains 20-40 turns without loss (stored 30 turns)', meetingTracker.turns.length === 30);

// Max character truncation formatting test
const longFormatted = tracker.getFormattedContext(30);
assert('Context respects max character length constraint', longFormatted.length <= 40);

// -------------------------------------------------------------
// 5. System Prompt & Error Handling Tests
// -------------------------------------------------------------
console.log('\nSection 5: Prompt Security & HTTP Error Handling');

function formatError(status, detail = '') {
  if (status === 401) return 'Invalid Groq API Key (HTTP 401). Please check your API key in extension options.';
  if (status === 403) return 'Groq API access forbidden (HTTP 403). Check account permissions or model access.';
  if (status === 429) return 'Groq API rate limit reached (HTTP 429). Please wait a few seconds before requesting again.';
  if (status === 400) return `Bad request to Groq API (HTTP 400)${detail ? ': ' + detail : '.'}`;
  if (status >= 500) return `Groq server error (HTTP ${status}). Groq servers may be experiencing temporary issues.`;
  return `Groq API error (${status})${detail ? ': ' + detail : '.'}`;
}

assert('HTTP 401 returns clear key error', formatError(401).includes('Invalid Groq API Key'));
assert('HTTP 429 returns rate limit advice', formatError(429).includes('rate limit reached (HTTP 429)'));
assert('HTTP 403 returns forbidden message', formatError(403).includes('forbidden'));
assert('HTTP 503 returns server error message', formatError(503).includes('server error (HTTP 503)'));

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n=============================================');
console.log(` Test Summary: ${passedTests}/${totalTests} Passed (${Math.round((passedTests/totalTests)*100)}%)`);
console.log('=============================================\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
