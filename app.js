const STORAGE_KEY = 'chatbutte_state_v1';
const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
const MAX_TEXT_FILE_SIZE = 200 * 1024;
const INLINE_TEXT_PREVIEW_LIMIT = 50000;

if (window.marked) {
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight(code, language) {
      if (window.hljs) {
        const hasLang = language && hljs.getLanguage(language);
        return hasLang
          ? hljs.highlight(code, { language }).value
          : hljs.highlightAuto(code).value;
      }
      return code;
    },
  });
}

const defaultState = {
  profiles: [],
  activeProfileId: null,
  topics: [],
  activeTopicId: null,
  settings: {
    sendKey: 'enter',
    theme: 'system',
  },
  messagesByTopic: {},
  // 云同步配置
  gistToken: '',
  gistId: '',
  lastSyncTime: null,
  lastSyncHash: null, // 用于检测数据变化
};

const elements = {
  topicList: document.getElementById('topicList'),
  topicTitle: document.getElementById('topicTitle'),
  topicPromptPreview: document.getElementById('topicPromptPreview'),
  messages: document.getElementById('messages'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  sendHint: document.getElementById('sendHint'),
  attachBtn: document.getElementById('attachBtn'),
  attachmentInput: document.getElementById('attachmentInput'),
  attachmentList: document.getElementById('attachmentList'),
  profileSelect: document.getElementById('profileSelect'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  addTopicBtn: document.getElementById('addTopicBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  profileForm: document.getElementById('profileForm'),
  settingsProfileSelect: document.getElementById('settingsProfileSelect'),
  profileDeleteBtn: document.getElementById('profileDeleteBtn'),
  profileName: document.getElementById('profileName'),
  profileUrl: document.getElementById('profileUrl'),
  profileKey: document.getElementById('profileKey'),
  profileModel: document.getElementById('profileModel'),
  profileType: document.getElementById('profileType'),
  profileName: document.getElementById('profileName'),
  settingsSaveBtn: document.getElementById('settingsSaveBtn'),
  settingsCancelBtn: document.getElementById('settingsCancelBtn'),
  sendKeySelect: document.getElementById('sendKeySelect'),
  themeSelect: document.getElementById('themeSelect'),
  topicModal: document.getElementById('topicModal'),
  topicModalTitle: document.getElementById('topicModalTitle'),
  closeTopicBtn: document.getElementById('closeTopicBtn'),
  topicForm: document.getElementById('topicForm'),
  topicId: document.getElementById('topicId'),
  topicName: document.getElementById('topicName'),
  topicPrompt: document.getElementById('topicPrompt'),
  topicHistoryCount: document.getElementById('topicHistoryCount'),
  topicTemperature: document.getElementById('topicTemperature'),
  topicTemperatureValue: document.getElementById('topicTemperatureValue'),
  topicCancelBtn: document.getElementById('topicCancelBtn'),
  menuToggle: document.getElementById('menuToggle'),
  sidebarClose: document.getElementById('sidebarClose'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  sidebar: document.querySelector('.sidebar'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFileInput: document.getElementById('importFileInput'),
  resetBtn: document.getElementById('resetBtn'),
  // Gist 同步相关元素
  gistToken: document.getElementById('gistToken'),
  gistId: document.getElementById('gistId'),
  uploadBtn: document.getElementById('uploadBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  syncStatus: document.getElementById('syncStatus'),
  // 语言切换器
  langOptions: document.querySelectorAll('.lang-option'),
  windowTitle: document.getElementById('windowTitle'),
};

let state = structuredClone(defaultState);
let draftAttachments = [];
let settingsDraft = null;
let themeMediaQuery = null;
let saveStateTimer = null;
let storageErrorNotified = false;
let sendInFlight = false;

const STORAGE_BACKUP_KEY = `${STORAGE_KEY}_backup`;

const VALID_THEMES = new Set(['system', 'light', 'dark']);

function resolveThemePreference() {
  const theme = state.settings.theme || 'system';
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme === 'dark' ? 'dark' : 'light';
}

function updateThemeColor(resolved) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolved === 'dark' ? '#1c1c1e' : '#ececef';
  }
}

function applyTheme() {
  const resolved = resolveThemePreference();
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  updateThemeColor(resolved);
}

function onSystemThemeChange() {
  if ((state.settings.theme || 'system') === 'system') {
    applyTheme();
  }
}

function setupThemeListener() {
  if (!themeMediaQuery) {
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }
  themeMediaQuery.removeEventListener('change', onSystemThemeChange);
  if ((state.settings.theme || 'system') === 'system') {
    themeMediaQuery.addEventListener('change', onSystemThemeChange);
  }
}

function isStorageWritable() {
  try {
    const probeKey = `${STORAGE_KEY}_probe`;
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return true;
  } catch (error) {
    return false;
  }
}

function mergeParsedState(parsed) {
  const settings = { ...structuredClone(defaultState.settings), ...(parsed.settings || {}) };
  delete settings.composerMode;
  if (!VALID_THEMES.has(settings.theme)) {
    settings.theme = 'system';
  }
  return {
    ...structuredClone(defaultState),
    ...parsed,
    profiles: migrateProfiles(parsed.profiles || []),
    settings,
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    messagesByTopic: parsed.messagesByTopic && typeof parsed.messagesByTopic === 'object'
      ? parsed.messagesByTopic
      : {},
  };
}

function loadStateFromRaw(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return mergeParsedState(parsed);
  } catch (error) {
    console.error('Failed to parse saved state:', error);
    return null;
  }
}

function loadStateFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const loaded = loadStateFromRaw(raw);
  if (loaded) return loaded;

  const backup = localStorage.getItem(STORAGE_BACKUP_KEY);
  return loadStateFromRaw(backup);
}

function hydrateState() {
  state = loadStateFromLocalStorage() || structuredClone(defaultState);
}

function prepareStateForStorage(src) {
  const copy = JSON.parse(JSON.stringify(src));
  Object.values(copy.messagesByTopic || {}).forEach((messages) => {
    if (!Array.isArray(messages)) return;
    messages.forEach((message) => {
      if (!Array.isArray(message.attachments)) return;
      message.attachments = message.attachments.map((attachment) => {
        const slim = { ...attachment };
        if (slim.dataUrl) {
          slim.hadDataUrl = true;
          delete slim.dataUrl;
        }
        if (typeof slim.textContent === 'string' && slim.textContent.length > 4000) {
          slim.textContent = `${slim.textContent.slice(0, 4000)}\n...[truncated]`;
          slim.truncated = true;
        }
        if (typeof slim.previewText === 'string' && slim.previewText.length > 4000) {
          slim.previewText = `${slim.previewText.slice(0, 4000)}\n...[truncated]`;
          slim.truncated = true;
        }
        return slim;
      });
    });
  });
  return copy;
}

function notifyStorageError(error) {
  console.error('Failed to persist state:', error);
  if (storageErrorNotified) return;
  storageErrorNotified = true;
  const message = error?.name === 'QuotaExceededError'
    ? t('error.storageQuota')
    : t('error.storageUnavailable');
  window.setTimeout(() => alert(message), 0);
}

function flushSaveState() {
  if (!isStorageWritable()) {
    notifyStorageError(new Error('Storage unavailable'));
    return;
  }

  const serialized = JSON.stringify(prepareStateForStorage(state));
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
  } catch (error) {
    notifyStorageError(error);
  }
}

function saveState({ immediate = false } = {}) {
  if (immediate) {
    clearTimeout(saveStateTimer);
    saveStateTimer = null;
    flushSaveState();
    return;
  }

  clearTimeout(saveStateTimer);
  saveStateTimer = window.setTimeout(() => {
    saveStateTimer = null;
    flushSaveState();
  }, 300);
}

function ensureActiveSelections() {
  const hasActiveTopic = state.topics.some((topic) => topic.id === state.activeTopicId);
  if (!hasActiveTopic) {
    state.activeTopicId = state.topics[0]?.id || null;
  }
  const hasActiveProfile = state.profiles.some((profile) => profile.id === state.activeProfileId);
  if (!hasActiveProfile) {
    state.activeProfileId = state.profiles[0]?.id || null;
  }
}

function ensureTopicForSend(seedText, attachments) {
  ensureActiveSelections();
  const existing = getActiveTopic();
  if (existing) return existing;

  const topicId = createId('topic');
  const topic = {
    id: topicId,
    name: buildFallbackTopicName(seedText, attachments),
    prompt: '',
    historyCount: 12,
    temperature: 0.7,
    activeProfileId: state.activeProfileId,
  };
  state.topics.push(topic);
  state.activeTopicId = topicId;
  if (!state.messagesByTopic[topicId]) {
    state.messagesByTopic[topicId] = [];
  }
  saveState({ immediate: true });
  renderTopics();
  renderTopicHeader();
  return topic;
}

async function refineTopicName(topicId, seedText, profile) {
  if (!isChatProfile(profile) || !seedText.trim()) return;
  try {
    const generated = await generateTopicName(seedText, profile);
    const topic = state.topics.find((item) => item.id === topicId);
    if (!topic) return;
    const nextName = generated.trim().slice(0, 40);
    if (!nextName || nextName === topic.name) return;
    topic.name = nextName;
    saveState();
    renderTopics();
    renderTopicHeader();
  } catch (error) {
    console.warn('Topic name generation failed:', error);
  }
}

function openModal(modal) {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  // 打开 modal 时自动关闭 sidebar
  elements.sidebar.classList.remove('open');
  elements.sidebarOverlay.classList.remove('open');
}

function closeModal(modal) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function setSettingsTab(tabId) {
  const currentTab = document.querySelector('.settings-tab.active')?.dataset.tab;
  if (currentTab === 'models') captureProfileFormDraft();

  const tabs = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.settings-panel');
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === tabId;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabId);
  });
}

function readProfileFormFields() {
  return {
    type: elements.profileType.value === 'image' ? 'image' : 'chat',
    name: elements.profileName.value.trim(),
    apiUrl: elements.profileUrl.value.trim(),
    apiKey: elements.profileKey.value.trim(),
    model: elements.profileModel.value.trim(),
  };
}

function fillSettingsProfileForm(profile) {
  elements.profileType.value = profile.type === 'image' ? 'image' : 'chat';
  elements.profileName.value = profile.name || '';
  elements.profileUrl.value = profile.apiUrl || '';
  elements.profileKey.value = profile.apiKey || '';
  elements.profileModel.value = profile.model || '';
  updateProfileFormHints();
}

function resetSettingsProfileForm() {
  elements.profileType.value = 'chat';
  elements.profileName.value = '';
  elements.profileUrl.value = '';
  elements.profileKey.value = '';
  elements.profileModel.value = '';
  updateProfileFormHints();
}

function captureProfileFormDraft() {
  if (!settingsDraft || !elements.settingsProfileSelect) return;
  const value = elements.settingsProfileSelect.value;
  const fields = readProfileFormFields();
  if (value === '__new__') {
    settingsDraft.pendingNewProfile = fields;
    return;
  }
  const profile = settingsDraft.profiles.find((item) => item.id === value);
  if (profile) Object.assign(profile, fields);
}

function renderSettingsProfileSelect() {
  const select = elements.settingsProfileSelect;
  if (!select || !settingsDraft) return;
  const current = select.value;
  select.innerHTML = '';
  settingsDraft.profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    const typeLabel = isImageProfile(profile) ? t('profile.type.image') : t('profile.type.chat');
    option.textContent = `${getProfileLabel(profile)} · ${typeLabel}`;
    select.appendChild(option);
  });
  const newOption = document.createElement('option');
  newOption.value = '__new__';
  newOption.textContent = t('settings.profileNew');
  select.appendChild(newOption);
  if (current && [...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function onSettingsProfileSelectChange() {
  captureProfileFormDraft();
  const value = elements.settingsProfileSelect.value;
  if (value === '__new__') {
    if (settingsDraft?.pendingNewProfile) {
      fillSettingsProfileForm({
        type: 'chat',
        name: '',
        apiUrl: '',
        apiKey: '',
        model: '',
        ...settingsDraft.pendingNewProfile,
      });
    } else {
      resetSettingsProfileForm();
    }
    elements.profileDeleteBtn.disabled = true;
    return;
  }
  const profile = settingsDraft?.profiles.find((item) => item.id === value);
  if (profile) fillSettingsProfileForm(profile);
  elements.profileDeleteBtn.disabled = false;
}

function deleteSettingsProfileDraft() {
  const value = elements.settingsProfileSelect?.value;
  if (!value || value === '__new__' || !settingsDraft) return;
  if (!confirm(t('profile.deleteConfirm'))) return;
  settingsDraft.profiles = settingsDraft.profiles.filter((profile) => profile.id !== value);
  settingsDraft.pendingNewProfile = null;
  renderSettingsProfileSelect();
  if (settingsDraft.profiles.length) {
    elements.settingsProfileSelect.value = settingsDraft.profiles[0].id;
    fillSettingsProfileForm(settingsDraft.profiles[0]);
    elements.profileDeleteBtn.disabled = false;
  } else {
    elements.settingsProfileSelect.value = '__new__';
    resetSettingsProfileForm();
    elements.profileDeleteBtn.disabled = true;
  }
}

function openSettingsModal(preselectProfileId = null) {
  settingsDraft = {
    profiles: state.profiles.map((profile) => ({ ...profile })),
    pendingNewProfile: null,
  };

  elements.sendKeySelect.value = state.settings.sendKey;
  if (elements.themeSelect) {
    elements.themeSelect.value = state.settings.theme || 'system';
  }
  elements.gistToken.value = state.gistToken || '';
  elements.gistId.value = state.gistId || '';
  if (state.lastSyncTime) {
    updateSyncStatus(t('sync.lastOperation') + formatTime(state.lastSyncTime));
  } else {
    updateSyncStatus(t('settings.syncStatus'));
  }

  renderSettingsProfileSelect();

  if (preselectProfileId && settingsDraft.profiles.some((profile) => profile.id === preselectProfileId)) {
    elements.settingsProfileSelect.value = preselectProfileId;
    fillSettingsProfileForm(settingsDraft.profiles.find((profile) => profile.id === preselectProfileId));
    elements.profileDeleteBtn.disabled = false;
  } else if (settingsDraft.profiles.length) {
    elements.settingsProfileSelect.value = settingsDraft.profiles[0].id;
    fillSettingsProfileForm(settingsDraft.profiles[0]);
    elements.profileDeleteBtn.disabled = false;
  } else {
    elements.settingsProfileSelect.value = '__new__';
    resetSettingsProfileForm();
    elements.profileDeleteBtn.disabled = true;
  }

  setSettingsTab('models');
  openModal(elements.settingsModal);
}

function cancelSettingsModal() {
  settingsDraft = null;
  closeModal(elements.settingsModal);
}

function saveAllSettings() {
  if (!settingsDraft) return;

  captureProfileFormDraft();

  const selectValue = elements.settingsProfileSelect.value;
  if (selectValue === '__new__') {
    const fields = readProfileFormFields();
    const hasInput = fields.apiUrl || fields.model || fields.name || fields.apiKey;
    if (hasInput) {
      if (!fields.apiUrl || !fields.model) {
        alert(t('error.profileIncomplete'));
        setSettingsTab('models');
        return;
      }
      const newProfile = { id: createId('profile'), ...fields };
      settingsDraft.profiles.push(newProfile);
      state.activeProfileId = newProfile.id;
    }
  }

  for (const profile of settingsDraft.profiles) {
    if (!profile.apiUrl || !profile.model) {
      alert(t('error.profileIncomplete'));
      setSettingsTab('models');
      elements.settingsProfileSelect.value = profile.id;
      fillSettingsProfileForm(profile);
      elements.profileDeleteBtn.disabled = false;
      return;
    }
  }

  state.profiles = settingsDraft.profiles.map((profile) => ({ ...profile }));
  state.settings.sendKey = elements.sendKeySelect.value;
  const themeValue = elements.themeSelect?.value || 'system';
  state.settings.theme = VALID_THEMES.has(themeValue) ? themeValue : 'system';
  state.gistToken = elements.gistToken.value.trim();
  state.gistId = elements.gistId.value.trim();

  if (!state.profiles.find((profile) => profile.id === state.activeProfileId)) {
    state.activeProfileId = state.profiles[0]?.id || null;
  }

  updateSendHint();
  applyTheme();
  setupThemeListener();
  saveState({ immediate: true });
  render();
  settingsDraft = null;
  closeModal(elements.settingsModal);
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function deriveImageApiUrl(apiUrl) {
  if (!apiUrl) return '';
  if (apiUrl.includes('/chat/completions')) {
    return apiUrl.replace('/chat/completions', '/images/generations');
  }
  if (apiUrl.includes('/responses')) {
    return apiUrl.replace('/responses', '/images/generations');
  }
  if (apiUrl.includes('/multimodal-generation/generation')) {
    return apiUrl;
  }
  if (apiUrl.includes('/text2image/image-synthesis')) {
    return apiUrl;
  }
  return '';
}

function normalizeProfile(profile) {
  if (profile.type === 'chat' || profile.type === 'image') {
    return {
      id: profile.id,
      name: profile.name || '',
      type: profile.type,
      apiUrl: profile.apiUrl || '',
      apiKey: profile.apiKey || '',
      model: profile.model || '',
    };
  }

  const chatReady = Boolean(profile.apiUrl && profile.model);
  const imageApiUrl = (profile.imageApiUrl || deriveImageApiUrl(profile.apiUrl) || '').trim();
  const imageModel = (profile.imageModel || profile.model || '').trim();
  const imageReady = Boolean(imageApiUrl && imageModel);
  const hadExplicitImage = Boolean((profile.imageApiUrl || '').trim() || (profile.imageModel || '').trim());

  if (imageReady && !chatReady) {
    return {
      id: profile.id,
      name: profile.name || imageModel,
      type: 'image',
      apiUrl: imageApiUrl,
      apiKey: profile.apiKey || '',
      model: imageModel,
    };
  }

  return {
    id: profile.id,
    name: profile.name || profile.model || '',
    type: 'chat',
    apiUrl: profile.apiUrl || '',
    apiKey: profile.apiKey || '',
    model: profile.model || '',
    _legacyImage: hadExplicitImage || (imageReady && imageApiUrl !== profile.apiUrl)
      ? { apiUrl: imageApiUrl, model: imageModel, apiKey: profile.apiKey || '' }
      : null,
  };
}

function migrateProfiles(profiles) {
  const migrated = [];
  if (!Array.isArray(profiles)) return migrated;

  profiles.forEach((profile) => {
    if (!profile || typeof profile !== 'object') return;
    try {
      const normalized = normalizeProfile(profile);
      const legacyImage = normalized._legacyImage;
      delete normalized._legacyImage;
      migrated.push(normalized);
      if (legacyImage?.apiUrl && legacyImage?.model) {
        const exists = migrated.some(
          (item) => item.type === 'image' && item.apiUrl === legacyImage.apiUrl && item.model === legacyImage.model
        );
        if (!exists) {
          migrated.push({
            id: createId('profile'),
            name: `${legacyImage.model} · ${t('profile.type.image')}`,
            type: 'image',
            apiUrl: legacyImage.apiUrl,
            apiKey: legacyImage.apiKey || normalized.apiKey || '',
            model: legacyImage.model,
          });
        }
      }
    } catch (error) {
      console.warn('Skipped invalid profile while migrating:', error);
    }
  });
  return migrated;
}

function getProfileLabel(profile) {
  if (profile?.name?.trim()) return profile.name.trim();
  return profile?.model || (getCurrentLanguage() === 'zh' ? '未命名模型' : 'Unnamed Model');
}

function getProfileMode(profile) {
  return profile?.type === 'image' ? 'image' : 'chat';
}

function isChatProfile(profile) {
  return getProfileMode(profile) === 'chat';
}

function isImageProfile(profile) {
  return getProfileMode(profile) === 'image';
}

function profileIsReady(profile) {
  return Boolean(profile?.apiUrl && profile?.model);
}

function isImageFile(file) {
  return file.type.startsWith('image/');
}

function isTextLikeFile(file) {
  if (file.type.startsWith('text/')) return true;
  return /\.(txt|md|markdown|json|csv|js|ts|jsx|tsx|html|css|scss|sass|xml|yml|yaml|py|java|go|rs|php|sh|sql)$/i.test(file.name);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

async function createAttachmentFromFile(file) {
  if (!file || !file.size) {
    throw new Error(t('message.attachEmpty'));
  }

  const base = {
    id: createId('att'),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
  };

  if (isImageFile(file)) {
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(t('message.attachImageTooLarge'));
    }
    return {
      ...base,
      kind: 'image',
      dataUrl: await readFileAsDataURL(file),
    };
  }

  if (isTextLikeFile(file)) {
    if (file.size > MAX_TEXT_FILE_SIZE) {
      throw new Error(t('message.attachTextTooLarge'));
    }
    const textContent = await readFileAsText(file);
    return {
      ...base,
      kind: 'text',
      textContent,
      previewText: textContent.slice(0, INLINE_TEXT_PREVIEW_LIMIT),
      truncated: textContent.length > INLINE_TEXT_PREVIEW_LIMIT,
    };
  }

  return {
    ...base,
    kind: 'binary',
  };
}

function getAttachmentSummary(attachment) {
  const typeLabel = attachment.kind === 'image'
    ? t('message.imageLabel')
    : t('message.fileLabel');
  return `${typeLabel} · ${attachment.type || 'application/octet-stream'} · ${formatFileSize(attachment.size)}`;
}

function renderDraftAttachments() {
  elements.attachmentList.innerHTML = '';
  elements.attachmentList.classList.toggle('has-items', draftAttachments.length > 0);

  draftAttachments.forEach((attachment) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    if (attachment.kind === 'image' && attachment.dataUrl) {
      const preview = document.createElement('img');
      preview.className = 'attachment-chip-preview';
      preview.src = attachment.dataUrl;
      preview.alt = attachment.name;
      chip.appendChild(preview);
    }

    const meta = document.createElement('div');
    meta.className = 'attachment-chip-meta';
    const title = document.createElement('strong');
    title.textContent = attachment.name;
    const summary = document.createElement('span');
    summary.textContent = getAttachmentSummary(attachment);
    meta.append(title, summary);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-chip-remove';
    removeBtn.type = 'button';
    removeBtn.title = t('message.removeAttachment');
    removeBtn.setAttribute('aria-label', t('message.removeAttachment'));
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      draftAttachments = draftAttachments.filter((item) => item.id !== attachment.id);
      renderDraftAttachments();
    });

    chip.append(meta, removeBtn);
    elements.attachmentList.appendChild(chip);
  });

  if (draftAttachments.length > 0) {
    const note = document.createElement('div');
    note.className = 'composer-note';
    note.textContent = t('main.attachmentHint');
    elements.attachmentList.appendChild(note);
  }
}

function updateComposerForProfile() {
  const profile = getActiveProfile();
  const mode = profile ? getProfileMode(profile) : 'chat';
  if (elements.sendBtn) {
    const sendLabel = mode === 'image' ? t('main.generate') : t('main.send');
    elements.sendBtn.title = sendLabel;
    elements.sendBtn.setAttribute('aria-label', sendLabel);
  }
  if (elements.messageInput) {
    elements.messageInput.placeholder = mode === 'image'
      ? t('main.imagePlaceholder')
      : t('main.input.placeholder');
  }
}

function updateProfileFormHints() {
  if (!elements.profileType || !elements.profileUrl) return;
  const isImage = elements.profileType.value === 'image';
  elements.profileUrl.placeholder = isImage
    ? t('settings.imageApiUrl.placeholder')
    : t('settings.apiUrl.placeholder');
}

function buildFallbackTopicName(text, attachments) {
  const seed = (text || attachments.map((attachment) => attachment.name).join(' ')).trim();
  if (!seed) {
    return t('topic.generateName');
  }
  return seed.slice(0, 20);
}

function clearDraftAttachments() {
  draftAttachments = [];
  if (elements.attachmentInput) {
    elements.attachmentInput.value = '';
  }
  renderDraftAttachments();
}

async function handleAttachmentSelection(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  if (draftAttachments.length + files.length > MAX_ATTACHMENTS) {
    alert(t('message.attachTooMany'));
    if (elements.attachmentInput) {
      elements.attachmentInput.value = '';
    }
    return;
  }

  for (const file of files) {
    try {
      const attachment = await createAttachmentFromFile(file);
      draftAttachments.push(attachment);
    } catch (error) {
      alert(`${t('message.attachReadFailed')}${error.message}`);
    }
  }

  if (elements.attachmentInput) {
    elements.attachmentInput.value = '';
  }
  renderDraftAttachments();
}

function cloneAttachmentsForMessage(attachments) {
  return attachments.map((attachment) => ({ ...attachment }));
}

function renderTopics() {
  elements.topicList.innerHTML = '';
  state.topics.forEach((topic, index) => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.dataset.topicId = topic.id;
    card.dataset.index = index;
    card.draggable = true;
    if (topic.id === state.activeTopicId) {
      card.classList.add('active');
    }

    const title = document.createElement('h4');
    title.className = 'topic-title';
    title.textContent = topic.name;

    const actions = document.createElement('div');
    actions.className = 'topic-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'ghost-btn';
    editBtn.textContent = t('settings.edit');
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openTopicModal(topic);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ghost-btn';
    deleteBtn.textContent = t('settings.delete');
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      removeTopic(topic.id);
    });

    actions.append(editBtn, deleteBtn);
    card.append(title, actions);

    // 拖拽开始
    card.addEventListener('dragstart', (event) => {
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    });

    // 拖拽结束
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.topic-card').forEach(c => {
        c.classList.remove('drag-over');
      });
    });

    // 拖拽经过
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (card !== document.querySelector('.dragging')) {
        card.classList.add('drag-over');
      }
    });

    // 拖拽离开
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    // 放下
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const fromIndex = parseInt(event.dataTransfer.getData('text/plain'));
      const toIndex = index;

      if (fromIndex !== toIndex) {
        // 重新排序数组
        const [movedTopic] = state.topics.splice(fromIndex, 1);
        state.topics.splice(toIndex, 0, movedTopic);
        saveState();
        render();
      }
    });

    card.addEventListener('click', () => {
      state.activeTopicId = topic.id;
      // 切换话题时，同步该话题的模型到全局
      if (topic.activeProfileId) {
        state.activeProfileId = topic.activeProfileId;
      }
      saveState();
      render();
    });
    elements.topicList.appendChild(card);
  });
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getMessageAuthorName(role) {
  if (role === 'user') return t('message.you');
  if (role === 'assistant' || role === 'error') return t('message.assistant');
  return role;
}

function renderTopicHeader() {
  const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId);
  if (!activeTopic) {
    elements.topicTitle.textContent = t('main.noTopic');
    elements.topicPromptPreview.textContent = t('main.noTopicHint');
    if (elements.windowTitle) elements.windowTitle.textContent = 'Chatbutte';
    return;
  }
  const displayName = activeTopic.name.startsWith('@') ? activeTopic.name : `@${activeTopic.name}`;
  elements.topicTitle.textContent = displayName;
  elements.topicPromptPreview.textContent = activeTopic.prompt || (getCurrentLanguage() === 'zh' ? '未设置系统提示词' : 'No system prompt set');
  if (elements.windowTitle) elements.windowTitle.textContent = displayName;
}

function renderMessages() {
  elements.messages.innerHTML = '';
  const activeTopic = state.activeTopicId;
  if (!activeTopic) return;
  const messages = state.messagesByTopic[activeTopic] || [];
  messages.forEach((message) => {
    elements.messages.appendChild(createMessageBubble(message));
  });
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function openGeneratedImage(url) {
  if (!url) return;

  let previewUrl;
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    const key = `chatbutte_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      sessionStorage.setItem(key, url);
      previewUrl = `image-view.html?key=${encodeURIComponent(key)}`;
    } catch (err) {
      console.error('Failed to store image preview:', err);
      return;
    }
  } else if (url.startsWith('http://') || url.startsWith('https://')) {
    const proxySrc = `api/image-proxy?url=${encodeURIComponent(url)}`;
    previewUrl = `image-view.html?src=${encodeURIComponent(proxySrc)}`;
  } else {
    return;
  }

  const previewWindow = window.open(previewUrl, '_blank');
  if (!previewWindow) {
    alert(t('message.popupBlocked'));
    return;
  }
  previewWindow.opener = null;
}

function renderMessageAttachments(message, bubble) {
  if (message.attachments?.length) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-attachments';

    const imageAttachments = message.attachments.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl);
    const fileAttachments = message.attachments.filter((attachment) => attachment.kind !== 'image');

    if (imageAttachments.length) {
      const imageGrid = document.createElement('div');
      imageGrid.className = 'message-attachment-grid';
      imageAttachments.forEach((attachment) => {
        const item = document.createElement('a');
        item.className = 'message-attachment-image';
        item.href = attachment.dataUrl;
        item.target = '_blank';
        item.rel = 'noreferrer';

        const image = document.createElement('img');
        image.src = attachment.dataUrl;
        image.alt = attachment.name;

        const caption = document.createElement('div');
        caption.className = 'message-attachment-caption';
        caption.textContent = attachment.name;

        item.append(image, caption);
        imageGrid.appendChild(item);
      });
      wrapper.appendChild(imageGrid);
    }

    if (fileAttachments.length) {
      const fileList = document.createElement('div');
      fileList.className = 'message-file-list';
      fileAttachments.forEach((attachment) => {
        const chip = document.createElement('div');
        chip.className = 'message-file-chip';

        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = attachment.name;
        const meta = document.createElement('span');
        meta.textContent = getAttachmentSummary(attachment);
        info.append(title, meta);

        chip.appendChild(info);
        fileList.appendChild(chip);
      });
      wrapper.appendChild(fileList);
    }

    bubble.appendChild(wrapper);
  }

  if (message.generatedImages?.length) {
    const generatedWrapper = document.createElement('div');
    generatedWrapper.className = 'message-generated-images';
    const grid = document.createElement('div');
    grid.className = 'generated-image-grid';

    message.generatedImages.forEach((item, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'generated-image-card';
      card.title = t('message.openImage');
      card.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openGeneratedImage(item.url);
      });

      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.revisedPrompt || `${t('main.mode.image')} ${index + 1}`;
      image.loading = 'lazy';
      image.draggable = false;

      const caption = document.createElement('div');
      caption.className = 'generated-image-caption';
      caption.textContent = item.revisedPrompt || item.name || `${t('main.mode.image')} ${index + 1}`;

      card.append(image, caption);
      grid.appendChild(card);
    });

    generatedWrapper.appendChild(grid);
    bubble.appendChild(generatedWrapper);
  }
}

function createMessageBubble(message) {
  if (message.role === 'context_cutoff') {
    const cutoff = document.createElement('div');
    cutoff.className = 'context-cutoff';
    cutoff.innerHTML = `
      <div class="cutoff-line"></div>
      <div class="cutoff-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="9" x2="15" y2="9"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <span>${t('main.contextCleared')}</span>
      </div>
    `;
    return cutoff;
  }

  const row = document.createElement('div');
  row.className = `message-row ${message.role}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const author = document.createElement('span');
  author.textContent = getMessageAuthorName(message.role);
  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatMessageTime(message.time);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'message-copy-btn';
  copyBtn.title = t('message.copy.title');
  copyBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
    <span>${t('message.copy')}</span>
  `;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      copyBtn.classList.add('copied');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  });
  meta.append(author, time, copyBtn);

  const bubble = document.createElement('div');
  bubble.className = `message ${message.role}`;
  if (message.id) bubble.dataset.messageId = message.id;
  if (message.role === 'error') bubble.classList.add('error');

  if (message.reasoning && typeof updateReasoningBubble === 'function') {
    const reasoningBubble = document.createElement('div');
    reasoningBubble.className = 'message-reasoning';
    updateReasoningBubble(reasoningBubble, message.reasoning, false);
    bubble.appendChild(reasoningBubble);
  }

  const shouldRenderContent = (message.content || '').trim() || (!message.attachments?.length && !message.generatedImages?.length);
  if (shouldRenderContent) {
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content';
    contentWrapper.innerHTML = renderMarkdown(message.content || '').trim();
    bubble.appendChild(contentWrapper);
  }

  renderMessageAttachments(message, bubble);
  row.append(meta, bubble);
  return row;
}

function renderMarkdown(content) {
  if (window.marked) {
    return marked.parse(content);
  }
  return content.replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>');
}

function renderProfiles() {
  elements.profileSelect.innerHTML = '';
  if (!state.profiles.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('settings.noModel');
    elements.profileSelect.appendChild(option);
  }

  state.profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    const typeLabel = isImageProfile(profile) ? t('profile.type.image') : t('profile.type.chat');
    option.textContent = `${getProfileLabel(profile)} · ${typeLabel}`;
    if (profile.id === state.activeProfileId) option.selected = true;
    elements.profileSelect.appendChild(option);
  });

  updateComposerForProfile();
}

function renderSettings() {
  elements.sendKeySelect.value = state.settings.sendKey;
  updateComposerForProfile();
  updateProfileFormHints();
  updateSendHint();
  renderGistConfig();
}

// 更新界面文本（多语言支持）
function updateUIText() {
  const lang = getCurrentLanguage();

  // 侧栏
  const sidebarClose = document.querySelector('.sidebar-close');
  if (sidebarClose) {
    sidebarClose.title = t('sidebar.close');
    sidebarClose.setAttribute('aria-label', t('sidebar.close'));
  }

  const brandSub = document.querySelector('.brand-sub');
  if (brandSub) brandSub.textContent = t('sidebar.brand');

  const sectionHeaderH3 = document.querySelector('.section-header h3');
  if (sectionHeaderH3) sectionHeaderH3.textContent = t('sidebar.chats');

  if (elements.addTopicBtn) {
    elements.addTopicBtn.title = t('sidebar.topics.add');
    elements.addTopicBtn.setAttribute('aria-label', t('sidebar.topics.add'));
  }
  if (elements.settingsBtn) elements.settingsBtn.textContent = t('sidebar.settings');

  // 主界面
  updateComposerForProfile();
  if (elements.clearChatBtn) elements.clearChatBtn.textContent = t('main.clear');
  if (elements.newChatBtn) elements.newChatBtn.textContent = t('main.newChat');
  if (elements.attachBtn) {
    elements.attachBtn.title = t('main.attach');
    elements.attachBtn.setAttribute('aria-label', t('main.attach'));
  }

  const controlInlineLabel = document.querySelector('.control-inline label');
  if (controlInlineLabel) controlInlineLabel.textContent = t('main.model');

  // 设置模态框
  const settingsTitle = document.querySelector('#settingsModal .modal-header h3');
  if (settingsTitle) settingsTitle.textContent = t('settings.title');

  const settingsTabModels = document.getElementById('settingsTabModels');
  const settingsTabAppearance = document.getElementById('settingsTabAppearance');
  const settingsTabSend = document.getElementById('settingsTabSend');
  const settingsTabSync = document.getElementById('settingsTabSync');
  const settingsTabData = document.getElementById('settingsTabData');
  if (settingsTabModels) settingsTabModels.textContent = t('settings.tab.models');
  if (settingsTabAppearance) settingsTabAppearance.textContent = t('settings.tab.appearance');
  if (settingsTabSend) settingsTabSend.textContent = t('settings.tab.send');
  if (settingsTabSync) settingsTabSync.textContent = t('settings.tab.sync');
  if (settingsTabData) settingsTabData.textContent = t('settings.tab.data');

  const themeRowTitle = document.getElementById('themeRowTitle');
  if (themeRowTitle) themeRowTitle.textContent = t('settings.theme');
  const themeRowDesc = document.getElementById('themeRowDesc');
  if (themeRowDesc) themeRowDesc.textContent = t('settings.theme.desc');
  if (elements.themeSelect) {
    const themeOptions = elements.themeSelect.querySelectorAll('option');
    if (themeOptions[0]) themeOptions[0].textContent = t('settings.theme.system');
    if (themeOptions[1]) themeOptions[1].textContent = t('settings.theme.light');
    if (themeOptions[2]) themeOptions[2].textContent = t('settings.theme.dark');
  }

  // 模型配置表单
  const profileTypeLabel = document.getElementById('profileTypeLabel');
  if (profileTypeLabel) profileTypeLabel.textContent = t('settings.profileType');
  if (elements.profileType) {
    const typeOptions = elements.profileType.querySelectorAll('option');
    if (typeOptions[0]) typeOptions[0].textContent = t('profile.type.chat');
    if (typeOptions[1]) typeOptions[1].textContent = t('profile.type.image');
  }
  const profileNameLabel = document.getElementById('profileNameLabel');
  if (profileNameLabel) profileNameLabel.textContent = t('settings.profileName');
  const profileNameDesc = document.getElementById('profileNameDesc');
  if (profileNameDesc) profileNameDesc.textContent = t('settings.profileName.desc');
  if (elements.profileName) elements.profileName.placeholder = t('settings.profileName.optional');
  const profileKeyLabel = document.getElementById('profileKeyLabel');
  if (profileKeyLabel) profileKeyLabel.textContent = t('settings.apiKey');
  if (elements.profileKey) elements.profileKey.placeholder = t('settings.apiKey.placeholder');
  const profileUrlLabel = document.getElementById('profileUrlLabel');
  if (profileUrlLabel) profileUrlLabel.textContent = t('settings.apiUrl');
  const profileModelLabel = document.getElementById('profileModelLabel');
  if (profileModelLabel) profileModelLabel.textContent = t('settings.model');
  if (elements.profileModel) elements.profileModel.placeholder = t('settings.model.placeholder');
  const profileFormHint = document.getElementById('profileFormHint');
  if (profileFormHint) profileFormHint.textContent = t('settings.profileFormHint');
  updateProfileFormHints();

  const settingsProfileSelectLabel = document.getElementById('settingsProfileSelectLabel');
  if (settingsProfileSelectLabel) settingsProfileSelectLabel.textContent = t('settings.modelConfig');
  if (elements.profileDeleteBtn) elements.profileDeleteBtn.textContent = t('settings.delete');
  if (elements.settingsCancelBtn) elements.settingsCancelBtn.textContent = t('settings.cancel');
  if (elements.settingsSaveBtn) elements.settingsSaveBtn.textContent = t('settings.saveAll');

  // 发送设置
  const sendKeyRowTitle = document.getElementById('sendKeyRowTitle');
  if (sendKeyRowTitle) sendKeyRowTitle.textContent = t('settings.sendKey');
  const sendKeyRowDesc = document.getElementById('sendKeyRowDesc');
  if (sendKeyRowDesc) sendKeyRowDesc.textContent = t('settings.sendKey.desc');
  const sendKeyHint = document.getElementById('sendKeyHint');
  if (sendKeyHint) sendKeyHint.textContent = t('settings.sendKey.hint.mac');

  if (elements.sendKeySelect) {
    const sendKeyOptions = elements.sendKeySelect.querySelectorAll('option');
    if (sendKeyOptions[0]) sendKeyOptions[0].textContent = t('settings.sendKey.enter');
    if (sendKeyOptions[1]) sendKeyOptions[1].textContent = t('settings.sendKey.cmd');
    if (sendKeyOptions[2]) sendKeyOptions[2].textContent = t('settings.sendKey.ctrl');
    if (sendKeyOptions[3]) sendKeyOptions[3].textContent = t('settings.sendKey.alt');
  }

  // 云同步
  const gistTokenLabel = document.getElementById('gistTokenLabel');
  if (gistTokenLabel) gistTokenLabel.textContent = t('settings.gistToken');
  const gistTokenDesc = document.getElementById('gistTokenDesc');
  if (gistTokenDesc) gistTokenDesc.textContent = t('settings.gistToken.hintShort');
  if (elements.gistToken) elements.gistToken.placeholder = t('settings.gistToken.placeholder');

  const gistIdLabel = document.getElementById('gistIdLabel');
  if (gistIdLabel) gistIdLabel.textContent = t('settings.gistId');
  const gistIdDesc = document.getElementById('gistIdDesc');
  if (gistIdDesc) gistIdDesc.textContent = t('settings.gistId.hintShort');
  if (elements.gistId) elements.gistId.placeholder = t('settings.gistId.placeholderShort');

  const syncActionTitle = document.getElementById('syncActionTitle');
  if (syncActionTitle) syncActionTitle.textContent = t('settings.syncAction');
  if (elements.uploadBtn) elements.uploadBtn.textContent = t('settings.uploadShort');
  if (elements.downloadBtn) elements.downloadBtn.textContent = t('settings.downloadShort');

  // 数据管理
  const dataImportTitle = document.getElementById('dataImportTitle');
  if (dataImportTitle) dataImportTitle.textContent = t('settings.import');
  const dataImportDesc = document.getElementById('dataImportDesc');
  if (dataImportDesc) dataImportDesc.textContent = t('settings.import.desc');
  if (elements.importBtn) elements.importBtn.textContent = t('settings.importAction');

  const dataExportTitle = document.getElementById('dataExportTitle');
  if (dataExportTitle) dataExportTitle.textContent = t('settings.export');
  const dataExportDesc = document.getElementById('dataExportDesc');
  if (dataExportDesc) dataExportDesc.textContent = t('settings.export.desc');
  if (elements.exportBtn) elements.exportBtn.textContent = t('settings.exportAction');

  const dataResetTitle = document.getElementById('dataResetTitle');
  if (dataResetTitle) dataResetTitle.textContent = t('settings.reset');
  const dataResetHint = document.getElementById('dataResetHint');
  if (dataResetHint) dataResetHint.textContent = t('settings.reset.desc');
  if (elements.resetBtn) elements.resetBtn.textContent = t('settings.resetAction');

  // 话题模态框
  if (elements.topicModalTitle) elements.topicModalTitle.textContent = t('topic.add');

  if (elements.topicName) {
    const label = elements.topicName.previousElementSibling;
    if (label) label.textContent = t('topic.name');
    elements.topicName.placeholder = t('topic.name.placeholder');
  }

  if (elements.topicPrompt) {
    const label = elements.topicPrompt.previousElementSibling;
    if (label) label.textContent = t('topic.prompt');
    elements.topicPrompt.placeholder = t('topic.prompt.placeholder');
  }

  if (elements.topicHistoryCount) {
    const label = elements.topicHistoryCount.previousElementSibling;
    if (label) label.textContent = t('topic.historyCount');

    const parent = elements.topicHistoryCount.parentElement;
    if (parent) {
      const hint = parent.querySelector('.muted');
      if (hint) hint.textContent = t('topic.historyCount.hint');
    }
  }

  if (elements.topicTemperature) {
    const label = elements.topicTemperature.previousElementSibling;
    if (label) label.textContent = t('topic.temperature');

    // 同时更新 class 为 topic-temperature-label 的元素（在 HTML 中）
    const tempLabel = document.querySelector('.topic-temperature-label');
    if (tempLabel) tempLabel.textContent = t('topic.temperature');

    // .muted 元素在 .field 下面，是 .range-wrap 的兄弟元素
    const field = elements.topicTemperature.closest('.field');
    if (field) {
      const hint = field.querySelector('.muted');
      if (hint) hint.textContent = t('topic.temperature.hint');
    }
  }

  if (elements.topicCancelBtn) elements.topicCancelBtn.textContent = t('settings.cancel');

  const topicFormPrimaryBtn = document.querySelector('#topicForm .primary-btn');
  if (topicFormPrimaryBtn) topicFormPrimaryBtn.textContent = t('topic.save');

  updateComposerForProfile();
  renderDraftAttachments();

  // 更新语言切换器的激活状态
  elements.langOptions.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.lang === lang) {
      btn.classList.add('active');
    }
  });
}

function updateSendHint() {
  // 检测操作系统平台
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  const map = {
    enter: isMac
      ? t('sendHint.enter.mac')
      : t('sendHint.enter.windows'),
    cmd: t('sendHint.cmd'),
    ctrl: t('sendHint.ctrl'),
    alt: isMac
      ? t('sendHint.alt.mac')
      : t('sendHint.alt.windows'),
  };
  elements.sendHint.textContent = map[state.settings.sendKey] || '';
}

function render() {
  ensureActiveSelections();
  renderTopics();
  renderTopicHeader();
  renderMessages();
  renderProfiles();
  renderSettings();
  updateUIText();
}

function getActiveProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId);
}

function getActiveTopic() {
  return state.topics.find((topic) => topic.id === state.activeTopicId);
}

function pushMessage(topicId, role, content, meta = {}) {
  if (!state.messagesByTopic[topicId]) {
    state.messagesByTopic[topicId] = [];
  }
  const options = typeof meta === 'string' ? { id: meta } : meta;
  const message = {
    id: options.id || createId('msg'),
    role,
    content,
    time: Date.now(),
  };
  if (options.attachments?.length) {
    message.attachments = cloneAttachmentsForMessage(options.attachments);
  }
  if (options.generatedImages?.length) {
    message.generatedImages = options.generatedImages.map((item) => ({ ...item }));
  }
  if (options.mode) {
    message.mode = options.mode;
  }
  state.messagesByTopic[topicId].push(message);
  saveState();
  return message;
}

function patchMessage(topicId, messageId, patch) {
  const list = state.messagesByTopic[topicId] || [];
  const target = list.find((message) => message.id === messageId);
  if (!target) return null;
  Object.assign(target, patch);
  saveState();
  return target;
}

function updateMessageContent(topicId, messageId, content, reasoning = null) {
  const list = state.messagesByTopic[topicId] || [];
  const target = list.find((message) => message.id === messageId);
  if (!target) return;
  target.content = content;
  if (reasoning !== null) {
    target.reasoning = reasoning;
  }
  saveState();
  const bubble = elements.messages.querySelector(`[data-message-id=\"${messageId}\"]`);
  if (bubble) {
    // 更新思维链内容
    if (reasoning !== null && typeof updateReasoningBubble === 'function') {
      let reasoningBubble = bubble.querySelector('.message-reasoning');
      if (!reasoningBubble && reasoning) {
        // 如果没有思维链气泡但有内容，创建一个
        reasoningBubble = document.createElement('div');
        reasoningBubble.className = 'message-reasoning';
        const contentWrapper = bubble.querySelector('.message-content');
        bubble.insertBefore(reasoningBubble, contentWrapper);
      }
      if (reasoningBubble) {
        // 如果消息内容为空，显示加载动画
        const isLoading = !content || content.trim().length === 0;
        updateReasoningBubble(reasoningBubble, reasoning, isLoading);
      }
    }

    const contentWrapper = bubble.querySelector('.message-content');
    if (contentWrapper) {
      contentWrapper.innerHTML = renderMarkdown(content);
    } else {
      // 如果旧消息没有 message-content 包装器（向后兼容），重新创建整个气泡
      bubble.innerHTML = '';
      const newContentWrapper = document.createElement('div');
      newContentWrapper.className = 'message-content';
      newContentWrapper.innerHTML = renderMarkdown(content);
      bubble.appendChild(newContentWrapper);

      // 添加复制按钮
      const copyBtn = document.createElement('button');
      copyBtn.className = 'message-copy-btn';
      copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>${t('message.copy')}</span>
      `;
      copyBtn.title = t('message.copy.title');

      copyBtn.addEventListener('click', async () => {
        const text = content || '';
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>${t('message.copied')}</span>
          `;
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>${t('message.copy')}</span>
            `;
          }, 2000);
        } catch (err) {
          console.error('Copy failed:', err);
        }
      });

      bubble.appendChild(copyBtn);
    }
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
}

function buildAttachmentTextParts(attachments) {
  const parts = [];
  const textFiles = attachments.filter((attachment) => attachment.kind === 'text');
  const binaryFiles = attachments.filter((attachment) => attachment.kind === 'binary');

  textFiles.forEach((attachment) => {
    const suffix = attachment.truncated ? '\n...[truncated]' : '';
    parts.push({
      type: 'text',
      text: `[Attached file: ${attachment.name}]\n${attachment.previewText || attachment.textContent || ''}${suffix}`,
    });
  });

  if (binaryFiles.length) {
    const summary = binaryFiles
      .map((attachment) => `- ${attachment.name} (${attachment.type || 'application/octet-stream'}, ${formatFileSize(attachment.size)})`)
      .join('\n');
    parts.push({
      type: 'text',
      text: `[Binary file metadata only]\n${summary}`,
    });
  }

  return parts;
}

function buildApiMessage(message) {
  if (message.role !== 'user' || !message.attachments?.length) {
    return {
      role: message.role,
      content: message.content,
    };
  }

  const parts = [];
  const textParts = [];
  if (message.content?.trim()) {
    textParts.push(message.content);
  }

  let hasImage = false;
  message.attachments.forEach((attachment) => {
    if (attachment.kind === 'image' && attachment.dataUrl) {
      hasImage = true;
      parts.push({
        type: 'image_url',
        image_url: {
          url: attachment.dataUrl,
        },
      });
    }
  });

  const attachmentTextParts = buildAttachmentTextParts(message.attachments);
  attachmentTextParts.forEach((part) => {
    textParts.push(part.text);
  });

  if (!hasImage) {
    return {
      role: message.role,
      content: textParts.join('\n\n') || t('main.attachmentHint'),
    };
  }

  if (textParts.length) {
    parts.unshift({
      type: 'text',
      text: textParts.join('\n\n'),
    });
  }

  if (!parts.length) {
    parts.push({
      type: 'text',
      text: t('main.attachmentHint'),
    });
  }

  return {
    role: message.role,
    content: parts,
  };
}

function buildTopicHistoryMessages(topicId, historyCount) {
  const messages = state.messagesByTopic[topicId] || [];
  const lastCutoffIndex = messages.findLastIndex((message) => message.role === 'context_cutoff');

  let historyMessages = messages.filter((message) => message.role === 'user' || message.role === 'assistant');

  if (lastCutoffIndex !== -1) {
    historyMessages = messages.slice(lastCutoffIndex + 1)
      .filter((message) => message.role === 'user' || message.role === 'assistant');
  }

  return historyMessages
    .slice(-(historyCount || 12))
    .map((message) => buildApiMessage(message));
}

function buildImagePrompt(text, attachments) {
  const sections = [];
  if (text?.trim()) {
    sections.push(text.trim());
  }

  const textAttachments = attachments.filter((attachment) => attachment.kind === 'text');
  if (textAttachments.length) {
    const textBlock = textAttachments
      .map((attachment) => {
        const suffix = attachment.truncated ? '\n...[truncated]' : '';
        return `[Reference file: ${attachment.name}]\n${attachment.previewText || attachment.textContent || ''}${suffix}`;
      })
      .join('\n\n');
    sections.push(textBlock);
  }

  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image');
  if (imageAttachments.length) {
    const summary = imageAttachments
      .map((attachment) => `- ${attachment.name} (${formatFileSize(attachment.size)})`)
      .join('\n');
    sections.push(`[Reference image metadata only]\n${summary}`);
  }

  const binaryAttachments = attachments.filter((attachment) => attachment.kind === 'binary');
  if (binaryAttachments.length) {
    const summary = binaryAttachments
      .map((attachment) => `- ${attachment.name} (${attachment.type || 'application/octet-stream'}, ${formatFileSize(attachment.size)})`)
      .join('\n');
    sections.push(`[Reference metadata]\n${summary}`);
  }

  return sections.join('\n\n').trim();
}

async function generateImages(profile, prompt) {
  if (!profileIsReady(profile) || !isImageProfile(profile)) {
    throw new Error(t('message.imageEndpointMissing'));
  }

  const response = await fetch('api/image-generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target_url: profile.apiUrl,
      api_key: profile.apiKey || '',
      model: profile.model,
      prompt,
      size: '1024x1024',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || `${t('error.requestFailed')}${response.status}`;
    throw new Error(message);
  }

  const images = (data.data || []).map((item, index) => {
    if (item.url) {
      return {
        id: createId(`img${index}`),
        url: item.url,
        revisedPrompt: item.revised_prompt || '',
      };
    }
    if (item.b64_json) {
      return {
        id: createId(`img${index}`),
        url: `data:image/png;base64,${item.b64_json}`,
        revisedPrompt: item.revised_prompt || '',
      };
    }
    return null;
  }).filter(Boolean);

  if (!images.length) {
    throw new Error(t('error.imageResponse'));
  }

  return images;
}

async function generateTopicName(text, profile) {
  const payload = {
    model: profile.model,
    messages: [
      {
        role: 'system',
        content: t('topicNameGen.prompt')
      },
      {
        role: 'user',
        content: text
      }
    ],
    temperature: 0.3
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (profile.apiKey) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }

  const response = await fetch(profile.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || t('topic.generateName');
}

async function sendMessage() {
  if (sendInFlight) return;

  const text = elements.messageInput.value.trim();
  const attachments = cloneAttachmentsForMessage(draftAttachments);
  if (!text && !attachments.length) return;
  const profile = getActiveProfile();
  if (!profile) {
    alert(t('message.noModel'));
    return;
  }
  const profileMode = getProfileMode(profile);
  if (!profileIsReady(profile)) {
    alert(t('profile.incomplete'));
    return;
  }

  const imagePrompt = profileMode === 'image' ? buildImagePrompt(text, attachments) : '';
  if (profileMode === 'image' && !imagePrompt) {
    alert(t('message.noImagePrompt'));
    return;
  }

  sendInFlight = true;
  try {
    const topicSeedText = text || attachments.map((attachment) => attachment.name).join(', ');
    const activeTopic = ensureTopicForSend(topicSeedText, attachments);
    void refineTopicName(activeTopic.id, topicSeedText, profile);

    elements.messageInput.value = '';
    clearDraftAttachments();
    pushMessage(activeTopic.id, 'user', text, {
      attachments,
      mode: profileMode,
    });
    renderMessages();

    if (profileMode === 'image') {
      const assistantMessage = pushMessage(activeTopic.id, 'assistant', t('message.generatingImage'), {
        mode: 'image',
      });
      renderMessages();

      try {
        const images = await generateImages(profile, imagePrompt);
        patchMessage(activeTopic.id, assistantMessage.id, {
          content: t('message.imageGenerated'),
          generatedImages: images,
        });
      } catch (error) {
        patchMessage(activeTopic.id, assistantMessage.id, {
          role: 'error',
          content: `${t('message.error')}${error.message}`,
        });
      }

      renderMessages();
      return;
    }

    const recentMessages = buildTopicHistoryMessages(activeTopic.id, activeTopic.historyCount || 12);

    const assistantMessage = pushMessage(activeTopic.id, 'assistant', '');
    renderMessages();

    const payload = {
      model: profile.model,
      messages: [
        ...(activeTopic.prompt ? [{ role: 'system', content: activeTopic.prompt }] : []),
        ...recentMessages,
      ],
      temperature: Number(activeTopic.temperature || 0.7),
      stream: true,
    };

    try {
      const result = await streamChatCompletion(profile, payload, (_delta, full, reasoning) => {
        updateMessageContent(activeTopic.id, assistantMessage.id, full, reasoning);
      });

      if (!result) {
        updateMessageContent(activeTopic.id, assistantMessage.id, t('error.emptyResponse'));
      } else if (typeof result === 'object') {
        updateMessageContent(activeTopic.id, assistantMessage.id, result.content, result.reasoning);
      }
    } catch (error) {
      updateMessageContent(activeTopic.id, assistantMessage.id, `${t('message.error')}${error.message}`);
      const target = state.messagesByTopic[activeTopic.id].find(
        (message) => message.id === assistantMessage.id
      );
      if (target) {
        target.role = 'error';
      }
      renderMessages();
    }
  } finally {
    sendInFlight = false;
  }
}

async function streamChatCompletion(profile, payload, onDelta) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (profile.apiKey) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }

  const response = await fetch(profile.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !payload.stream || contentType.includes('application/json')) {
    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content || '';
    const reasoningContent = data?.choices?.[0]?.message?.reasoning_content || '';

    if (!message) {
      throw new Error('返回内容为空，请确认 API 格式是否兼容 OpenAI。');
    }

    // 优先使用 reasoning_content 字段，如果没有则检查标签
    let finalReasoning = reasoningContent;
    let finalContent = message;

    if (!finalReasoning && typeof extractReasoning === 'function') {
      const extracted = extractReasoning(message);
      finalReasoning = extracted.reasoning;
      finalContent = extracted.cleanedContent;
    }

    if (finalReasoning) {
      return {
        content: finalContent,
        reasoning: finalReasoning,
      };
    }

    return message;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let fullReasoning = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.replace(/^data:\s*/, '');
      if (data === '[DONE]') {
        // 最终处理：优先使用 reasoning_content，如果没有则检查标签
        let finalReasoning = fullReasoning;
        let finalContent = full;

        if (!finalReasoning && typeof extractReasoning === 'function') {
          const extracted = extractReasoning(full);
          finalReasoning = extracted.reasoning;
          finalContent = extracted.cleanedContent;
        }

        if (finalReasoning) {
          return {
            content: finalContent,
            reasoning: finalReasoning,
          };
        }
        return full;
      }
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content || '';
        const reasoningDelta = json?.choices?.[0]?.delta?.reasoning_content || '';
        const message = json?.choices?.[0]?.message?.content || '';
        const reasoning = json?.choices?.[0]?.message?.reasoning_content || '';
        const chunk = delta || message;

        // 处理 reasoning_content 字段
        if (reasoningDelta || reasoning) {
          fullReasoning += reasoningDelta || reasoning;
          onDelta('', full, fullReasoning);
        }

        // 处理内容增量
        if (chunk) {
          full += chunk;

          // 如果有 reasoning_content，直接使用；否则检查标签
          if (fullReasoning) {
            onDelta('', full, fullReasoning);
          } else if (typeof extractReasoning === 'function') {
            const extracted = extractReasoning(full);
            if (extracted.hasReasoning) {
              // 有思维链标签，使用清理后的内容
              onDelta('', extracted.cleanedContent, extracted.reasoning);
            } else {
              // 没有思维链标签，使用原始内容
              onDelta(chunk, full, '');
            }
          } else {
            onDelta(chunk, full, '');
          }
        }
      } catch (error) {
        // ignore parse errors from partial lines
      }
    }
  }

  // 最终处理：优先使用 reasoning_content，如果没有则检查标签
  let finalReasoning = fullReasoning;
  let finalContent = full;

  if (!finalReasoning && typeof extractReasoning === 'function') {
    const extracted = extractReasoning(full);
    finalReasoning = extracted.reasoning;
    finalContent = extracted.cleanedContent;
  }

  if (finalReasoning) {
    return {
      content: finalContent,
      reasoning: finalReasoning,
    };
  }

  return full;
}

function openTopicModal(topic) {
  if (topic) {
    elements.topicModalTitle.textContent = t('topic.edit');
    elements.topicId.value = topic.id;
    elements.topicName.value = topic.name;
    elements.topicPrompt.value = topic.prompt || '';
    elements.topicHistoryCount.value = topic.historyCount || 12;
    elements.topicTemperature.value = topic.temperature || 0.7;
    elements.topicTemperatureValue.textContent = Number(topic.temperature || 0.7).toFixed(2);
  } else {
    elements.topicModalTitle.textContent = t('topic.add');
    elements.topicId.value = '';
    elements.topicName.value = '';
    elements.topicPrompt.value = '';
    elements.topicHistoryCount.value = 12;
    elements.topicTemperature.value = 0.7;
    elements.topicTemperatureValue.textContent = '0.70';
  }
  openModal(elements.topicModal);
}

function removeTopic(id) {
  if (!confirm(t('topic.deleteConfirm'))) {
    return;
  }
  state.topics = state.topics.filter((topic) => topic.id !== id);
  if (state.activeTopicId === id) {
    state.activeTopicId = state.topics.length ? state.topics[0].id : null;
  }
  saveState();
  render();
}



function handleTopicSubmit(event) {
  event.preventDefault();
  const id = elements.topicId.value || createId('topic');
  const existing = state.topics.find((topic) => topic.id === id);
  if (existing) {
    existing.name = elements.topicName.value.trim();
    existing.prompt = elements.topicPrompt.value.trim();
    existing.historyCount = parseInt(elements.topicHistoryCount.value) || 12;
    existing.temperature = parseFloat(elements.topicTemperature.value) || 0.7;
  } else {
    state.topics.push({
      id,
      name: elements.topicName.value.trim(),
      prompt: elements.topicPrompt.value.trim(),
      historyCount: parseInt(elements.topicHistoryCount.value) || 12,
      temperature: parseFloat(elements.topicTemperature.value) || 0.7,
      activeProfileId: state.activeProfileId
    });
  }
  state.activeTopicId = id;
  saveState({ immediate: true });
  closeModal(elements.topicModal);
  render();
}

function handleKeydown(event) {
  if (event.key !== 'Enter') return;
  // 中文字符输入过程中不处理
  if (event.isComposing) return;

  const sendKey = state.settings.sendKey;
  const isCtrl = event.ctrlKey;
  const isMeta = event.metaKey; // Mac Cmd
  const isAlt = event.altKey; // Mac Option / Windows Alt
  const hasModifier = isCtrl || isMeta || isAlt;

  const shouldSend =
    (sendKey === 'enter' && !hasModifier) ||
    (sendKey === 'ctrl' && isCtrl && !isMeta && !isAlt) ||
    (sendKey === 'cmd' && isMeta && !isCtrl && !isAlt) ||
    (sendKey === 'alt' && isAlt && !isCtrl && !isMeta);

  if (shouldSend) {
    event.preventDefault();
    sendMessage();
  } else {
    // 其他情况都插入换行符
    event.preventDefault();
    const textarea = event.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.slice(0, start) + '\n' + value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + 1;
  }
}

function initListeners() {
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.messageInput.addEventListener('keydown', handleKeydown);
  elements.attachBtn.addEventListener('click', () => {
    elements.attachmentInput.click();
  });
  elements.attachmentInput.addEventListener('change', (event) => {
    handleAttachmentSelection(event.target.files);
  });
  if (elements.profileType) {
    elements.profileType.addEventListener('change', updateProfileFormHints);
  }

  elements.profileSelect.addEventListener('change', (event) => {
    const newProfileId = event.target.value || null;
    state.activeProfileId = newProfileId;

    // 如果有当前话题，同步更新该话题的模型
    if (state.activeTopicId) {
      const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId);
      if (activeTopic) {
        activeTopic.activeProfileId = newProfileId;
      }
    }

    saveState();
    renderProfiles();
    updateComposerForProfile();
  });

  elements.clearChatBtn.addEventListener('click', () => {
    const activeTopic = getActiveTopic();
    if (!activeTopic) return;
    if (!confirm(t('topic.clearConfirm'))) return;
    state.messagesByTopic[activeTopic.id] = [];
    saveState();
    renderMessages();
  });

  elements.newChatBtn.addEventListener('click', () => {
    const activeTopic = getActiveTopic();
    if (!activeTopic) {
      alert(t('topic.noTopicSelected'));
      return;
    }

    // 检查是否已有截断标记，如果有则移除旧的
    const messages = state.messagesByTopic[activeTopic.id] || [];
    const lastCutoffIndex = messages.findLastIndex(m => m.role === 'context_cutoff');

    if (lastCutoffIndex !== -1) {
      if (!confirm(t('topic.contextExists'))) {
        return;
      }
      // 移除旧的截断标记
      messages.splice(lastCutoffIndex, 1);
    }

    // 插入新的截断标记
    pushMessage(activeTopic.id, 'context_cutoff', '');
    saveState();
    renderMessages();
  });

  elements.addTopicBtn.addEventListener('click', () => openTopicModal());
  elements.topicForm.addEventListener('submit', handleTopicSubmit);
  elements.topicCancelBtn.addEventListener('click', () => closeModal(elements.topicModal));
  elements.closeTopicBtn.addEventListener('click', () => closeModal(elements.topicModal));

  // 温度滑块实时显示值
  elements.topicTemperature.addEventListener('input', (event) => {
    elements.topicTemperatureValue.textContent = Number(event.target.value).toFixed(2);
  });

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => setSettingsTab(tab.dataset.tab));
  });

  elements.settingsBtn.addEventListener('click', () => openSettingsModal());
  elements.closeSettingsBtn.addEventListener('click', cancelSettingsModal);
  if (elements.settingsCancelBtn) {
    elements.settingsCancelBtn.addEventListener('click', cancelSettingsModal);
  }
  if (elements.settingsSaveBtn) {
    elements.settingsSaveBtn.addEventListener('click', saveAllSettings);
  }
  if (elements.settingsProfileSelect) {
    elements.settingsProfileSelect.addEventListener('change', onSettingsProfileSelectChange);
  }
  if (elements.profileDeleteBtn) {
    elements.profileDeleteBtn.addEventListener('click', deleteSettingsProfileDraft);
  }

  elements.sendKeySelect.addEventListener('change', () => {
    updateSendHint();
  });

  // 导出数据按钮
  elements.exportBtn.addEventListener('click', exportData);

  // 导入数据按钮
  elements.importBtn.addEventListener('click', () => {
    elements.importFileInput.click();
  });

  // 文件选择后执行导入
  elements.importFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      importData(file);
      // 重置 input 以便可以重复导入同一文件
      elements.importFileInput.value = '';
    }
  });

  // 一键重置按钮
  elements.resetBtn.addEventListener('click', resetData);

  // Gist 同步按钮
  elements.uploadBtn.addEventListener('click', uploadToCloud);
  elements.downloadBtn.addEventListener('click', downloadFromCloud);
  elements.menuToggle.addEventListener('click', () => {
    elements.sidebar.classList.add('open');
    elements.sidebarOverlay.classList.add('open');
  });

  // 语言切换按钮事件监听
  elements.langOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      if (lang !== getCurrentLanguage()) {
        toggleLanguage();
        render();
      }
    });
  });

  // 监听语言变化事件（当从外部切换语言时）
  window.addEventListener('languageChange', () => {
    render();
  });

  elements.sidebarClose.addEventListener('click', () => {
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('open');
  });

  elements.sidebarOverlay.addEventListener('click', () => {
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('open');
  });

  // 当窗口宽度变足够大时，自动关闭移动端侧栏状态
  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) {
      elements.sidebar.classList.remove('open');
      elements.sidebarOverlay.classList.remove('open');
    }
  });

  window.addEventListener('click', (event) => {
    if (event.target === elements.settingsModal) {
      cancelSettingsModal();
    }
    if (event.target === elements.topicModal) {
      closeModal(elements.topicModal);
    }
  });
}

function boot() {
  ensureActiveSelections();
  applyTheme();
  setupThemeListener();
  render();
  renderDraftAttachments();
  updateComposerForProfile();
  initListeners();

  if (!isStorageWritable()) {
    window.setTimeout(() => alert(t('error.storageUnavailable')), 0);
  }

  window.addEventListener('beforeunload', () => {
    flushSaveState();
  });
}

function initApp() {
  hydrateState();
  boot();
}

// 导出数据为 JSON 文件
function exportData() {
  const dataStr = JSON.stringify(state, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  a.download = `chatbutte-backup-${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 导入数据从 JSON 文件
function importData(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);

      // 验证导入的数据结构
      if (!imported || typeof imported !== 'object') {
        alert(t('import.failed'));
        return;
      }

      // 合并导入的数据，保留默认结构
      state = {
        ...structuredClone(defaultState),
        ...imported,
        settings: { ...structuredClone(defaultState.settings), ...(imported.settings || {}) },
        messagesByTopic: imported.messagesByTopic || {},
      };

      if (!VALID_THEMES.has(state.settings.theme)) {
        state.settings.theme = 'system';
      }
      applyTheme();
      setupThemeListener();
      saveState({ immediate: true });
      render();
      alert(t('import.success'));
    } catch (error) {
      alert(t('import.parseError') + error.message);
    }
  };
  reader.readAsText(file);
}

// 一键重置所有数据
function resetData() {
  if (!confirm(t('reset.confirm'))) {
    return;
  }
  if (!confirm(t('reset.confirmAgain'))) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_BACKUP_KEY);
  state = structuredClone(defaultState);
  applyTheme();
  setupThemeListener();
  saveState({ immediate: true });
  render();
  alert(t('reset.success'));
}

// ============ Gist 同步相关函数 ============

// 生成数据哈希值，用于检测数据变化
function generateDataHash(data) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为 32 位整数
  }
  return hash.toString(36);
}

// 获取用于同步的数据（排除敏感信息）
function getSyncData() {
  const { gistToken, lastSyncHash, lastSyncTime, ...syncData } = state;
  return syncData;
}

// 格式化时间显示
function formatTime(timestamp) {
  if (!timestamp) return t('sync.never');
  const date = new Date(timestamp);
  const locale = getCurrentLanguage() === 'zh' ? 'zh-CN' : 'en-US';
  return date.toLocaleString(locale);
}

// 更新同步状态显示
function updateSyncStatus(message, type = 'info') {
  elements.syncStatus.textContent = message;
  elements.syncStatus.style.color = type === 'error' ? '#9f2d1f' : type === 'success' ? '#2d7a3f' : '';
}

// 上传数据到 Gist
async function uploadToGist() {
  if (!state.gistToken) {
    throw new Error('请先配置 GitHub Gist Token');
  }

  const syncData = getSyncData();
  const content = JSON.stringify(syncData, null, 2);
  const filename = 'chatbutte-data.json';
  const description = `Chatbutte Chat Data - Synced at ${new Date().toISOString()}`;

  const headers = {
    'Authorization': `Bearer ${state.gistToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
  };

  let url = 'https://api.github.com/gists';
  let method = 'POST';

  // 如果已有 gistId，则更新
  if (state.gistId) {
    url = `https://api.github.com/gists/${state.gistId}`;
    method = 'PATCH';
  }

  const body = state.gistId
    ? {
        description,
        files: {
          [filename]: {
            content,
          },
        },
      }
    : {
        description,
        public: false,
        files: {
          [filename]: {
            content,
          },
        },
      };

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '上传到 Gist 失败');
  }

  const data = await response.json();

  // 如果是新创建的 gist，保存 gistId
  if (!state.gistId && data.id) {
    state.gistId = data.id;
    elements.gistId.value = data.id;
  }

  return data;
}

// 从 Gist 下载数据
async function downloadFromGist() {
  if (!state.gistToken) {
    throw new Error('请先配置 GitHub Gist Token');
  }
  if (!state.gistId) {
    throw new Error('请先进行首次同步以创建 Gist');
  }

  const headers = {
    'Authorization': `Bearer ${state.gistToken}`,
    'Accept': 'application/vnd.github+json',
  };

  const response = await fetch(`https://api.github.com/gists/${state.gistId}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '从 Gist 下载数据失败');
  }

  const data = await response.json();

  // 获取文件内容和更新时间
  const files = data.files;
  const filename = Object.keys(files).find(f => f.endsWith('.json'));
  if (!filename || !files[filename]) {
    throw new Error('Gist 中没有找到数据文件');
  }

  const content = files[filename].content;
  return {
    data: JSON.parse(content),
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : Date.now(),
  };
}

// 上传到云端
async function uploadToCloud() {
  if (!state.gistToken) {
    updateSyncStatus(t('sync.needToken'), 'error');
    return;
  }

  try {
    // 如果没有 gistId，询问是否创建新的
    if (!state.gistId) {
      const shouldCreate = confirm(t('sync.createGist'));

      if (!shouldCreate) {
        updateSyncStatus(t('sync.uploadCancelled'), 'info');
        return;
      }
    } else {
      // 有 gistId，先检查云端数据
      try {
        const remote = await downloadFromGist();
        const remoteHash = generateDataHash(remote.data);
        const localHash = generateDataHash(getSyncData());

        // 检查数据是否一致
        if (localHash === remoteHash) {
          alert('✓ ' + t('sync.noUploadNeeded'));
          updateSyncStatus(t('sync.dataConsistent'), 'success');
          return;
        }

        // 检查云端是否比本地新（被其他客户端修改过）
        if (state.lastSyncHash && state.lastSyncHash !== remoteHash && localHash !== remoteHash) {
          const shouldOverwrite = confirm(
            t('sync.remoteModified') + formatTime(remote.updatedAt) + t('sync.confirmOverwriteRemote')
          );

          if (!shouldOverwrite) {
            updateSyncStatus(t('sync.uploadCancelledNoChange'), 'info');
            return;
          }
        }
      } catch (error) {
        // 无法下载云端数据（可能 Gist 被删除），询问是否创建新的
        const shouldRecreate = confirm(t('sync.gistNotFound'));

        if (!shouldRecreate) {
          updateSyncStatus(t('sync.uploadCancelled'), 'info');
          return;
        }

        state.gistId = '';
        elements.gistId.value = '';
      }
    }

    // 执行上传
    updateSyncStatus(t('sync.uploading'), 'info');
    const result = await uploadToGist();

    // 更新同步状态
    state.lastSyncTime = Date.now();
    state.lastSyncHash = generateDataHash(getSyncData());
    saveState();

    // 更新 UI
    if (!elements.gistId.value && result.id) {
      elements.gistId.value = result.id;
    }

    updateSyncStatus(t('sync.uploadSuccess') + formatTime(state.lastSyncTime), 'success');
  } catch (error) {
    updateSyncStatus(t('sync.uploadFailed') + error.message, 'error');
    console.error('Upload failed:', error);
  }
}

// 从云端下载
async function downloadFromCloud() {
  if (!state.gistToken) {
    updateSyncStatus(t('sync.needToken'), 'error');
    return;
  }

  if (!state.gistId) {
    updateSyncStatus(t('sync.needGistId'), 'error');
    return;
  }

  try {
    updateSyncStatus(t('sync.downloading'), 'info');

    const remote = await downloadFromGist();
    const remoteData = remote.data;
    const remoteHash = generateDataHash(remoteData);
    const localHash = generateDataHash(getSyncData());

    // 检查数据是否一致
    if (localHash === remoteHash) {
      alert('✓ ' + t('sync.noDownloadNeeded'));
      updateSyncStatus(t('sync.dataConsistent'), 'success');
      return;
    }

    // 数据不一致，询问是否覆盖
    const shouldOverwrite = confirm(t('sync.confirmOverwrite'));

    if (!shouldOverwrite) {
      updateSyncStatus(t('sync.downloadCancelledNoChange'), 'info');
      return;
    }

    updateSyncStatus(t('sync.downloading'), 'info');

    // 用云端数据覆盖本地
    const { gistToken, gistId } = state;
    state = {
      ...structuredClone(defaultState),
      ...remoteData,
      settings: { ...structuredClone(defaultState.settings), ...(remoteData.settings || {}) },
      gistToken,
      gistId,
      lastSyncTime: Date.now(),
      lastSyncHash: remoteHash,
    };

    if (!VALID_THEMES.has(state.settings.theme)) {
      state.settings.theme = 'system';
    }
    applyTheme();
    setupThemeListener();
    saveState();
    render();

    updateSyncStatus(t('sync.downloadSuccess'), 'success');
  } catch (error) {
    updateSyncStatus(t('sync.downloadFailed') + error.message, 'error');
    console.error('Download failed:', error);
  }
}

// 渲染 Gist 配置
function renderGistConfig() {
  elements.gistToken.value = state.gistToken || '';
  elements.gistId.value = state.gistId || '';

  if (state.lastSyncTime) {
    updateSyncStatus(t('sync.lastOperation') + formatTime(state.lastSyncTime));
  } else {
    updateSyncStatus(t('settings.syncStatus'));
  }
}

initApp();
