// based on https://github.com/GoogleChrome/chrome-extensions-samples/blob/main/functional-samples/ai.gemini-on-device-summarization/sidepanel/index.js
// and https://github.com/GoogleChrome/chrome-extensions-samples/blob/main/functional-samples/ai.gemini-on-device/sidepanel/index.js

import marked  from 'marked';
import DOMPurify from 'dompurify';

// for summarizer
const addSectionButton = document.querySelector('#add-section-button');
const sectionsContainer = document.querySelector('#sections');
const sectionTemplate = document.querySelector('#section-template');

// for chatbot
const inputPrompt = document.body.querySelector('#input-prompt');
const buttonPrompt = document.body.querySelector('#button-prompt');
const buttonReset = document.body.querySelector('#button-reset');
const elementResponse = document.body.querySelector('#response');
const elementLoading = document.body.querySelector('#loading');
const elementError = document.body.querySelector('#error');

const MAX_MODEL_CHARS = 6000;
let sectionNumbers = {main : 0, subsections: {}};
let chatTemperature;
let chatTopK;

// chatbot code
let session;

async function runPrompt(prompt, params) {
  try {
    if (!session) {
      session = await self.ai.languageModel.create(params);
    }
    return session.prompt(prompt);
  } catch (e) {
    console.log('Prompt failed');
    console.error(e);
    console.log('Prompt:', prompt);
    // Reset session
    reset();
    throw e;
  }
}

async function reset() {
  if (session) {
    session.destroy();
  }
  session = null;
}

async function initChatDefaults() {
  if (!(self.ai.languageModel)) {
    showResponse('Error: AI not supported in this browser');
    return;
  }
  const defaults = await self.ai.languageModel.capabilities();
  console.log('Model default:', defaults);
  if (defaults.available !== 'readily') {
    showResponse(
      `Model not yet available (current state: "${defaults.available}")`
    );
    return;
  }
  chatTemperature = defaults.defaultTemperature;
  // Pending https://issues.chromium.org/issues/367771112.
  if (defaults.defaultTopK > 3) {
    // limit default topK to 3
    chatTopK = 3;
  } else {
    chatTopK = defaults.defaultTopK;
  }
}

initChatDefaults();

buttonReset.addEventListener('click', () => {
  hide(elementLoading);
  hide(elementError);
  hide(elementResponse);
  reset();
  buttonReset.setAttribute('disabled', '');
});

inputPrompt.addEventListener('input', () => {
  if (inputPrompt.value.trim()) {
    buttonPrompt.removeAttribute('disabled');
  } else {
    buttonPrompt.setAttribute('disabled', '');
  }
});

buttonPrompt.addEventListener('click', async () => {
  const prompt = inputPrompt.value.trim();
  showLoading();
  try {
    const params = {
      systemPrompt: 'You are a helpful and friendly assistant who specializes in research.',
      temperature: chatTemperature,
      topK: chatTopK
    };
    const response = await runPrompt(prompt, params);
    showResponse(response);
  } catch (e) {
    showError(e);
  }
});

function showLoading() {
  buttonReset.removeAttribute('disabled');
  hide(elementResponse);
  hide(elementError);
  show(elementLoading);
}

function showResponse(response) {
  hide(elementLoading);
  show(elementResponse);
  elementResponse.innerHTML = DOMPurify.sanitize(marked.parse(response));
}

function showError(error) {
  show(elementError);
  hide(elementResponse);
  hide(elementLoading);
  elementError.textContent = error;
}

function show(element) {
  element.removeAttribute('hidden');
}

function hide(element) {
  element.setAttribute('hidden', '');
}

// summarizer code
function createNewSection(isSubsection, parentSectionId) {
  const newSection = document.importNode(sectionTemplate.content, true);
  const section = newSection.querySelector('.section');
  const sectionHeader = section.querySelector('.section-header');
  const sectionTitle = sectionHeader.querySelector('.section-title');
  
  let sectionId;
  if (isSubsection) {
    sectionId = parentSectionId + "." + sectionNumbers.subsections[parentSectionId];
    sectionNumbers.subsections[parentSectionId]++;
  } else {
    sectionNumbers.main++;
    parentSectionId = sectionNumbers.main;
    sectionId = parentSectionId + ".0";
    sectionNumbers.subsections[parentSectionId] = 1; 
  }
  
  sectionTitle.textContent = "Section " + sectionId;
  
  sectionsContainer.appendChild(section);
  sectionHeader.addEventListener('click', () => toggleSection(section));

  const inputPrompt = section.querySelector('#input-prompt');
  const buttonSummarize = section.querySelector('#button-summarize');
  const removeButton = section.querySelector('.remove-section-btn');
  const addSubsectionButton = section.querySelector('.add-subsection');

  const lengthOption = section.querySelector("#length");
  const elementSummary = section.querySelector('#text-summary');
  const warningElement = section.querySelector('#warning');

  lengthOption.id = 'length-' + sectionId;
  elementSummary.id = 'text-summary-' + sectionId;
  warningElement.id = 'warning-' + sectionId;

  inputPrompt.addEventListener('input', () => {
    if (inputPrompt.value.trim()) {
      buttonSummarize.removeAttribute('disabled');
    } else {
      buttonSummarize.setAttribute('disabled', '');
    }
  });
  
  buttonSummarize.addEventListener('click', async () => {
    let summary = "";
    const content = inputPrompt.value.trim();
    
    if (content.length > MAX_MODEL_CHARS) {
      updateWarning(
        "Text is too long for summarization with ${content.length} characters (maximum supported content length is ~6000 characters).",
        sectionId
      );
    } else {
      updateWarning('', sectionId);
      showSummary("Loading... (may take a couple of seconds)", sectionId);
      summary = await generateSummary(content, sectionId);
      await showSummary(summary, sectionId);
    }
  });

  removeButton.addEventListener('click', () => {
    section.remove();
    if (!isSubsection) {
      sectionNumbers.main--;
    } else {
      sectionNumbers.subsections[parentSectionId]--;
    }
  });
  
  addSubsectionButton.addEventListener('click', () => {
    createNewSection(true, parentSectionId); 
  });
  
  toggleSection(section);
}

function toggleSection(section) {
  section.classList.toggle('open');
}

async function generateSummary(text, sectionId) {
    try {
      const summaryLengthSelect = document.getElementById("length-" + sectionId);
      const session = await createSummarizer(
        {
          type: "key-points",
          format: "markdown",
          length: summaryLengthSelect.value
        },
        (message, progress) => {
          console.log(`${message} (${progress.loaded}/${progress.total})`);
        }
      );
      const summary = await session.summarize(text);
      session.destroy();
      return summary;
    }
    catch (e) {
      console.log("Summary Creation failed");
      console.error(e);
      return e.message;
    }
  }
async function createSummarizer(config, downloadProgressCallback) {
    if (!self.ai) {
      throw new Error('AI Summarization is not supported in this browser');
    }
    const canSummarize = await window.ai.summarizer.capabilities();
    if (canSummarize.available === 'no') {
      throw new Error('AI Summarization is not supported');
    }
    const summarizationSession = await self.ai.summarizer.create(
      config,
      downloadProgressCallback
    );
    if (canSummarize.available === 'after-download') {
      summarizationSession.addEventListener(
        'downloadprogress',
        downloadProgressCallback
      );
      await summarizationSession.ready;
    }
    return summarizationSession;
}


async function showSummary(text, sectionId) {
  const elementSummary = document.getElementById("text-summary-" + sectionId);
  elementSummary.innerHTML = DOMPurify.sanitize(marked.parse(text));
}

async function updateWarning(warning, sectionId) {
  const warningElement = document.getElementById("warning-" + sectionId);
  warningElement.textContent = warning;
  if (warning) {
    warningElement.removeAttribute('hidden');
  } else {
    warningElement.setAttribute('hidden', '');
  }
}

addSectionButton.addEventListener('click', () => {
  createNewSection(false);
});