# MeetAssistant - AI Meeting Copilot for Google Meet

MeetAssistant is a lightweight, privacy-focused Chrome Extension (Manifest V3) for Windows 10 that reads visible closed captions in **Ukrainian** or **Russian** during Google Meet calls, identifies questions in real time using local heuristics, sends relevant meeting context to the **Groq API**, and renders concise AI answers in a draggable floating panel.

---

## Key Features

- **DOM Caption Observation & Turn Accumulator**: Seamlessly captures live spoken captions directly from Google Meet. Maintains a rolling memory buffer of the last 20–40 dialogue turns without recording microphones or capturing system audio.
- **Progressive Speech Stabilization & De-fragmentation**: Correctly consolidates speech-to-text live revisions and progressive speech extensions into unified speaker turns instead of fragmenting words into duplicate entries.
- **Semantic Question Detection**: Heuristic engine recognizes explicit questions (`?`), conversational interrogatives (`хто`, `що`, `коли`, `де`, `чому`, `як`, `кто`, `что`, `когда`, `где`, `почему`, `как`...), and semantic inquiry phrases without question marks (e.g. *«Что думаете об этом?»*, *«Какой вариант лучше?»*, *«Можете объяснить?»*).
- **Dual-Section Prompt Architecture**: Transmits conversation history and target question as separate prompt sections to Groq, instructing the LLM to resolve pronouns and implicit references against meeting history rather than refusing.
- **Movable In-Meeting Floating Panel**: Compact dark glassmorphism overlay inside Google Meet (isolated via Shadow DOM). Draggable, collapsible to a mini-badge, with real-time turn count indicator `(N turns)`, Copy, Retry, Clear, and Manual Ask controls.
- **Live Debug Logging**: Provides safe, non-sensitive telemetry in Chrome DevTools (`F12` Console) showing dialogue turns gathered, detected questions, and character counts without ever printing the Groq API key.
- **Free-Tier Friendly**: Powered directly by Groq's official Chat Completions API with your own free API key. Features models like `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`.
- **Zero Overhead**: Written in vanilla JavaScript, HTML, and CSS. No Node.js runtime, build steps, bundlers, external servers, or tracking required.

---

## Installation Guide (Load Unpacked in Chrome)

Follow these steps to load MeetAssistant into Google Chrome on Windows 10:

1. **Open the Extensions Page**:
   - In Google Chrome, type `chrome://extensions/` into the URL bar and press **Enter** (or click the puzzle piece icon in the top right and select **Manage Extensions**).
2. **Enable Developer Mode**:
   - In the top-right corner of `chrome://extensions/`, toggle the **Developer mode** switch to **ON**.
3. **Select "Load Unpacked"**:
   - Click the **Load unpacked** button in the top-left toolbar.
4. **Choose the Folder**:
   - In the file dialog, navigate to and select this project directory:
     ```
     c:\Codes\MeetAssistant
     ```
   - Click **Select Folder**.
5. **Verify Installation**:
   - You will see **MeetAssistant - AI Meeting Copilot** appear in your extension list with version `1.0.0` and active status.
   - For quick access, click the puzzle icon in Chrome's toolbar and **pin** MeetAssistant.

---

## Configuration & Groq API Key Setup

MeetAssistant uses the official Groq API free tier:

1. **Obtain your Free Groq API Key**:
   - Go to [console.groq.com/keys](https://console.groq.com/keys).
   - Sign up or log in (free account, no credit card required).
   - Click **Create API Key**, give it a name (e.g. `MeetAssistant`), and copy the generated key (`gsk_...`).
2. **Open MeetAssistant Options**:
   - Right-click the MeetAssistant icon in Chrome and select **Options** (or click the extension icon and select **Options & API Key**).
3. **Configure Settings**:
   - **Groq API Key**: Paste your key and click **⚡ Test Key** to verify the connection.
   - **Model**: Select `llama-3.3-70b-versatile` (best Ukrainian & Russian reasoning) or `llama-3.1-8b-instant` (ultra-low latency).
   - **Response Language**: Choose *Auto-detect* (answers in the question's language), *Always Ukrainian*, or *Always Russian*.
   - **Question Detection Mode**:
     - *All Questions*: Detects both explicit `?` and conversational question words.
     - *Direct Questions Only*: Requires an explicit `?`.
     - *Manual Only*: Triggers only when you click **⚡ Ask AI**.
   - Click **💾 Save Settings**.

> [!NOTE]
> Your API key is stored locally in Chrome's internal storage (`chrome.storage.local`). It is never transmitted anywhere except directly to Groq's official API endpoint (`https://api.groq.com/openai/v1/chat/completions`).

---

## How to Enable Captions in Google Meet

MeetAssistant listens to captions displayed by Google Meet. To turn them on:

1. Join or start a meeting on [meet.google.com](https://meet.google.com).
2. Click the **Turn on captions (CC)** button on the bottom control bar, or press keyboard shortcut <kbd>c</kbd>.
3. **Set the Caption Language to Ukrainian or Russian**:
   - Click the **More options** (three dots) icon on the bottom bar &gt; **Settings**.
   - Go to **Captions**.
   - Select **Language of the call**: choose **Ukrainian (Українська)** or **Russian (Русский)**.
   - Ensure the captions toggle is active.
4. The floating MeetAssistant panel will automatically change status from **Idle** to **Listening**.

---

## Testing with the Built-in Test Sandbox

You do not need an active Google Meet meeting or live speech to test the extension or verify that heuristics and UI controls work properly!

1. Open the sandbox in Chrome:
   - Click the MeetAssistant icon &gt; click **🧪 Test Sandbox** (or navigate to `chrome-extension://<your-extension-id>/test_sandbox.html`).
2. **Features of the Test Sandbox**:
   - **Zero-Quota Mock Mode**: Select **Mock AI** to simulate real-time answers without consuming any Groq API quota.
   - **Live Scenarios**: Click **🇺🇦 Ukrainian Meeting** or **🇷🇺 Russian Meeting** to inject multi-speaker dialogues.
   - **Progressive Speech Simulator**: Click **⚡ Progressive Typing** to see how the engine stabilizes incremental words into complete sentences without duplicate calls.
   - **Automated Test Suite**: Click **▶ Run Unit Tests** in the right column to run all 58 automated checks directly in your browser.
   - **Interactive Floating Panel**: Drag the panel around, test **Minimize**, **Pause**, **Clear**, **Copy**, and **Ask AI**.

---

## Automated CLI Verification (Developer Checks)

To run the automated test suite from the terminal (validating Manifest V3 schema, JavaScript syntax via `node --check`, question heuristics, deduplication buffers, and HTTP error formatting):

```powershell
node test/run_tests.js
```

---

## Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **"⚠️ Captions not detected" banner** | Closed Captions are turned off in Google Meet. | Press <kbd>c</kbd> or click the **CC** button at the bottom of the Meet window. |
| **Panel does not appear on Meet** | Script loaded before Meet finished initializing, or page was open before loading unpacked extension. | Refresh the Google Meet tab (<kbd>Ctrl + F5</kbd>). |
| **HTTP 401 Error ("Invalid Groq API Key")** | API key was mistyped, expired, or not saved. | Open Options, re-enter your key from [console.groq.com/keys](https://console.groq.com/keys), click **Test Key**, then **Save Settings**. |
| **HTTP 429 Error ("Rate limit reached")** | Groq free tier limit hit due to rapid questions. | Wait 10-15 seconds. Increase the **Minimum Interval Between Requests** in Options (e.g. 15-20s). |
| **Heuristic didn't trigger on a question** | Sentence had ambiguous syntax or was filtered as a statement. | Click the **⚡ Ask AI** button in the floating panel to answer immediately from recent context. |
| **Panel is blocking meeting screen** | Large video feed or presentation. | Drag the panel by its header to any screen corner, or click the **−** button to collapse it into a minimal pill. |

---

## Known Limitations

1. **Google Meet DOM Volatility**: Google Meet regularly pushes internal updates that modify obfuscated CSS class names and internal attributes. MeetAssistant combines semantic landmarks (`[role="region"][aria-label*="caption"]`), fallback selector cascades, and container tree traversal to remain resilient, but interface changes by Google may require updating selectors.
2. **Question Recipient Ambiguity**: Meeting captions do not indicate who a speaker was looking at or referring to. A question like *"What do you think?"* could be directed at anyone in the room. Use **Direct Questions Only** or **Manual Only** mode if this occurs frequently in large meetings.
3. **Groq Free Tier Rate Limits**: The free tier of Groq provides high token throughput but enforces Requests-Per-Minute (RPM) limits. MeetAssistant includes a client-side throttle timer and deduplication buffer to avoid rate limiting.
4. **Local Extension Storage**: Settings and API keys are stored in Chrome's `chrome.storage.local`. While safe from websites, this is not a hardware enclave; avoid using on shared or public workstations.
