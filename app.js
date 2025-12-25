const STORAGE_KEY = 'chatbutte_state_v1';

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
  profileSelect: document.getElementById('profileSelect'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  addTopicBtn: document.getElementById('addTopicBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  profileList: document.getElementById('profileList'),
  profileForm: document.getElementById('profileForm'),
  profileId: document.getElementById('profileId'),
  profileName: document.getElementById('profileName'),
  profileUrl: document.getElementById('profileUrl'),
  profileKey: document.getElementById('profileKey'),
  profileModel: document.getElementById('profileModel'),
  profileCancelBtn: document.getElementById('profileCancelBtn'),
  sendKeySelect: document.getElementById('sendKeySelect'),
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
  saveGistBtn: document.getElementById('saveGistBtn'),
  syncStatus: document.getElementById('syncStatus'),
  // 语言切换器
  langOptions: document.querySelectorAll('.lang-option'),
};

let state = loadState();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return structuredClone(defaultState);
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...structuredClone(defaultState.settings), ...(parsed.settings || {}) },
      messagesByTopic: parsed.messagesByTopic || {},
    };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureActiveSelections() {
  if (!state.activeTopicId && state.topics.length) {
    state.activeTopicId = state.topics[0].id;
  }
  if (!state.activeProfileId && state.profiles.length) {
    state.activeProfileId = state.profiles[0].id;
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

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
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

function renderTopicHeader() {
  const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId);
  if (!activeTopic) {
    elements.topicTitle.textContent = t('main.noTopic');
    elements.topicPromptPreview.textContent = t('main.noTopicHint');
    return;
  }
  elements.topicTitle.textContent = activeTopic.name;
  elements.topicPromptPreview.textContent = activeTopic.prompt || (getCurrentLanguage() === 'zh' ? '未设置系统提示词' : 'No system prompt set');
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

function createMessageBubble(message) {
  const bubble = document.createElement('div');

  // 处理上下文截断标记
  if (message.role === 'context_cutoff') {
    bubble.className = 'context-cutoff';
    bubble.innerHTML = `
      <div class="cutoff-line"></div>
      <div class="cutoff-label">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="9" x2="15" y2="9"></line>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <span>${t('main.contextCleared')}</span>
      </div>
    `;
    return bubble;
  }

  bubble.className = `message ${message.role}`;
  if (message.id) {
    bubble.dataset.messageId = message.id;
  }
  if (message.role === 'error') {
    bubble.classList.add('error');
  }

  // 如果有思维链内容，添加思维链小气泡
  if (message.reasoning && typeof updateReasoningBubble === 'function') {
    const reasoningBubble = document.createElement('div');
    reasoningBubble.className = 'message-reasoning';
    updateReasoningBubble(reasoningBubble, message.reasoning, false);
    bubble.appendChild(reasoningBubble);
  }

  // 消息内容容器
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'message-content';
  contentWrapper.innerHTML = renderMarkdown(message.content || '').trim();
  bubble.appendChild(contentWrapper);

  // 添加复制按钮（error 消息也显示）
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

  // 复制按钮点击事件
  copyBtn.addEventListener('click', async () => {
    const text = message.content || '';
    try {
      await navigator.clipboard.writeText(text);
      // 显示复制成功状态
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${t('message.copied')}</span>
      `;
      // 2秒后恢复原状
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
  return bubble;
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
    option.textContent = profile.model;
    if (profile.id === state.activeProfileId) option.selected = true;
    elements.profileSelect.appendChild(option);
  });

  elements.profileList.innerHTML = '';
  state.profiles.forEach((profile) => {
    const card = document.createElement('div');
    card.className = 'card profile-item';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = profile.model;
    const meta = document.createElement('div');
    meta.className = 'profile-meta';
    meta.textContent = profile.apiUrl;
    info.append(name, meta);

    const actions = document.createElement('div');
    const editBtn = document.createElement('button');
    editBtn.className = 'ghost-btn';
    editBtn.textContent = t('settings.edit');
    editBtn.addEventListener('click', () => fillProfileForm(profile));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ghost-btn';
    deleteBtn.textContent = t('settings.delete');
    deleteBtn.addEventListener('click', () => removeProfile(profile.id));

    actions.append(editBtn, deleteBtn);
    card.append(info, actions);
    elements.profileList.appendChild(card);
  });
}

function renderSettings() {
  elements.sendKeySelect.value = state.settings.sendKey;
  updateSendHint();
  renderGistConfig();
}

// 更新界面文本（多语言支持）
function updateUIText() {
  const lang = getCurrentLanguage();

  // 侧栏
  const sidebarClose = document.querySelector('.sidebar-close');
  if (sidebarClose) sidebarClose.title = t('sidebar.close');

  const brandSub = document.querySelector('.brand-sub');
  if (brandSub) brandSub.textContent = t('sidebar.brand');

  const sectionHeaderH3 = document.querySelector('.section-header h3');
  if (sectionHeaderH3) sectionHeaderH3.textContent = t('sidebar.topics');

  if (elements.addTopicBtn) elements.addTopicBtn.title = t('sidebar.topics.add');
  if (elements.settingsBtn) elements.settingsBtn.textContent = t('sidebar.settings');

  // 主界面
  if (elements.messageInput) elements.messageInput.placeholder = t('main.input.placeholder');
  if (elements.sendBtn) elements.sendBtn.textContent = t('main.send');
  if (elements.clearChatBtn) elements.clearChatBtn.textContent = t('main.clearChat');
  if (elements.newChatBtn) elements.newChatBtn.textContent = t('main.newChat');

  const controlInlineLabel = document.querySelector('.control-inline label');
  if (controlInlineLabel) controlInlineLabel.textContent = t('main.model');

  // 设置模态框
  const settingsTitle = document.querySelector('#settingsModal .modal-header h3');
  if (settingsTitle) settingsTitle.textContent = t('settings.title');

  const settingsSections = document.querySelectorAll('#settingsModal .settings-section');
  if (settingsSections[0]) {
    const title = settingsSections[0].querySelector('.section-title');
    if (title) title.textContent = t('settings.modelConfig');
  }
  if (settingsSections[1]) {
    const title = settingsSections[1].querySelector('.section-title');
    if (title) title.textContent = t('settings.sendConfig');
  }
  if (settingsSections[2]) {
    const title = settingsSections[2].querySelector('.section-title');
    if (title) title.textContent = t('settings.cloudSync');
  }
  if (settingsSections[3]) {
    const title = settingsSections[3].querySelector('.section-title');
    if (title) title.textContent = t('settings.dataManagement');
  }

  // 模型配置表单
  if (elements.profileUrl) {
    elements.profileUrl.placeholder = t('settings.apiUrl.placeholder');
    const label = document.querySelector('#profileUrl');
    if (label && label.previousElementSibling) label.previousElementSibling.textContent = t('settings.apiUrl');
  }
  if (elements.profileKey) {
    elements.profileKey.placeholder = t('settings.apiKey.placeholder');
    const label = document.querySelector('#profileKey');
    if (label && label.previousElementSibling) label.previousElementSibling.textContent = t('settings.apiKey');
  }
  if (elements.profileModel) {
    elements.profileModel.placeholder = t('settings.model.placeholder');
    const label = document.querySelector('#profileModel');
    if (label && label.previousElementSibling) label.previousElementSibling.textContent = t('settings.model');
  }

  if (elements.profileCancelBtn) elements.profileCancelBtn.textContent = t('settings.cancel');
  const profileSaveBtn = document.querySelector('#profileSaveBtn');
  if (profileSaveBtn) profileSaveBtn.textContent = t('settings.save');

  // 发送设置
  const sendKeySelectLabel = document.querySelector('#sendKeySelect');
  if (sendKeySelectLabel && sendKeySelectLabel.previousElementSibling) {
    sendKeySelectLabel.previousElementSibling.textContent = t('settings.sendKey');
  }

  if (elements.sendKeySelect) {
    const sendKeyOptions = elements.sendKeySelect.querySelectorAll('option');
    if (sendKeyOptions[0]) sendKeyOptions[0].textContent = t('settings.sendKey.enter');
    if (sendKeyOptions[1]) sendKeyOptions[1].textContent = t('settings.sendKey.cmd');
    if (sendKeyOptions[2]) sendKeyOptions[2].textContent = t('settings.sendKey.ctrl');
    if (sendKeyOptions[3]) sendKeyOptions[3].textContent = t('settings.sendKey.alt');

    const sendKeyParent = elements.sendKeySelect.parentElement;
    if (sendKeyParent) {
      const hint = sendKeyParent.querySelector('.muted');
      if (hint) hint.textContent = t('settings.sendKey.hint.mac');
    }
  }

  // 云同步
  if (elements.gistToken) {
    const label = elements.gistToken.previousElementSibling;
    if (label) label.textContent = t('settings.gistToken');
    elements.gistToken.placeholder = t('settings.gistToken.placeholder');

    const parent = elements.gistToken.parentElement;
    if (parent) {
      const hint = parent.querySelector('.muted');
      if (hint) hint.textContent = t('settings.gistToken.hint');
    }
  }

  if (elements.gistId) {
    const label = elements.gistId.previousElementSibling;
    if (label) label.textContent = t('settings.gistId');
    elements.gistId.placeholder = t('settings.gistId.placeholder');

    const parent = elements.gistId.parentElement;
    if (parent) {
      const hint = parent.querySelector('.muted');
      if (hint) hint.textContent = t('settings.gistId.hint');
    }
  }

  if (elements.uploadBtn) elements.uploadBtn.textContent = t('settings.upload');
  if (elements.downloadBtn) elements.downloadBtn.textContent = t('settings.download');
  if (elements.saveGistBtn) elements.saveGistBtn.textContent = t('settings.saveConfig');

  // 数据管理
  if (elements.importBtn) elements.importBtn.textContent = t('settings.import');
  if (elements.exportBtn) elements.exportBtn.textContent = t('settings.export');

  if (elements.importFileInput) {
    const parent = elements.importFileInput.parentElement;
    if (parent) {
      const hint = parent.querySelector('.muted');
      if (hint) hint.textContent = t('settings.export.hint');
    }
  }

  if (elements.resetBtn) elements.resetBtn.textContent = t('settings.reset');

  const resetBtnParent = document.querySelector('#resetBtn');
  if (resetBtnParent && resetBtnParent.parentElement) {
    const hint = resetBtnParent.parentElement.querySelector('.muted');
    if (hint) hint.textContent = t('settings.reset.hint');
  }

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
  saveState();
}

function getActiveProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId);
}

function getActiveTopic() {
  return state.topics.find((topic) => topic.id === state.activeTopicId);
}

function pushMessage(topicId, role, content, id = null) {
  if (!state.messagesByTopic[topicId]) {
    state.messagesByTopic[topicId] = [];
  }
  const message = { id: id || createId('msg'), role, content, time: Date.now() };
  state.messagesByTopic[topicId].push(message);
  saveState();
  return message;
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
  const text = elements.messageInput.value.trim();
  let activeTopic = getActiveTopic();
  if (!text) return;
  const profile = getActiveProfile();
  if (!profile) {
    alert(t('message.noModel'));
    return;
  }

  // 如果没有激活话题，自动创建一个
  if (!activeTopic) {
    try {
      const topicName = await generateTopicName(text, profile);
      const topicId = createId('topic');
      state.topics.push({
        id: topicId,
        name: topicName,
        prompt: '',
        historyCount: 12,
        temperature: 0.7,
        activeProfileId: state.activeProfileId
      });
      state.activeTopicId = topicId;
      saveState();
      render();
      activeTopic = getActiveTopic();
    } catch (error) {
      // 如果生成话题名称失败，使用默认名称
      const topicId = createId('topic');
      state.topics.push({
        id: topicId,
        name: t('topic.generateName'),
        prompt: '',
        historyCount: 12,
        temperature: 0.7,
        activeProfileId: state.activeProfileId
      });
      state.activeTopicId = topicId;
      saveState();
      render();
      activeTopic = getActiveTopic();
    }
  }

  elements.messageInput.value = '';
  pushMessage(activeTopic.id, 'user', text);
  renderMessages();

  const messages = state.messagesByTopic[activeTopic.id] || [];

  // 找到最后一个截断标记的位置
  const lastCutoffIndex = messages.findLastIndex(m => m.role === 'context_cutoff');

  // 获取历史消息，只保留截断线之后的
  let historyMessages = messages.filter((message) => message.role === 'user' || message.role === 'assistant');

  if (lastCutoffIndex !== -1) {
    // 计算截断线之后有多少条有效消息
    const messagesAfterCutoff = messages.slice(lastCutoffIndex + 1)
      .filter((message) => message.role === 'user' || message.role === 'assistant');
    historyMessages = messagesAfterCutoff;
  }

  // 应用 historyCount 限制
  const recentMessages = historyMessages.slice(-(activeTopic.historyCount || 12)).map((message) => ({
    role: message.role,
    content: message.content,
  }));

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

    // 处理返回值（可能是字符串或对象）
    if (!result) {
      updateMessageContent(activeTopic.id, assistantMessage.id, t('error.emptyResponse'));
    } else if (typeof result === 'object') {
      // 对象格式：{ content, reasoning } - 有思维链
      updateMessageContent(activeTopic.id, assistantMessage.id, result.content, result.reasoning);
    } else if (typeof result === 'string') {
      // 字符串格式 - 没有思维链，但在流式响应中已经更新过了，这里只需要确认
      // 通常不需要做任何事，因为流式回调已经处理了
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

function fillProfileForm(profile) {
  elements.profileId.value = profile.id;
  // profileName 不存在于 HTML 中，注释掉
  // elements.profileName.value = profile.name;
  elements.profileUrl.value = profile.apiUrl;
  elements.profileKey.value = profile.apiKey || '';
  elements.profileModel.value = profile.model;
  openModal(elements.settingsModal);
}

function removeProfile(id) {
  if (!confirm(t('profile.deleteConfirm'))) return;
  state.profiles = state.profiles.filter((profile) => profile.id !== id);
  if (state.activeProfileId === id) {
    state.activeProfileId = state.profiles.length ? state.profiles[0].id : null;
  }
  saveState();
  render();
}

function resetProfileForm() {
  elements.profileId.value = '';
  // profileName 不存在于 HTML 中，注释掉
  // elements.profileName.value = '';
  elements.profileUrl.value = '';
  elements.profileKey.value = '';
  elements.profileModel.value = '';
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
  saveState();
  closeModal(elements.topicModal);
  render();
}

function handleProfileSubmit(event) {
  event.preventDefault();
  const id = elements.profileId.value || createId('profile');
  const modelValue = elements.profileModel.value.trim();
  const data = {
    id,
    name: modelValue, // 使用 model 作为 name
    apiUrl: elements.profileUrl.value.trim(),
    apiKey: elements.profileKey.value.trim(),
    model: modelValue,
  };
  const existing = state.profiles.find((profile) => profile.id === id);
  if (existing) {
    Object.assign(existing, data);
  } else {
    state.profiles.push(data);
  }
  state.activeProfileId = id;
  resetProfileForm();
  saveState();
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

  elements.settingsBtn.addEventListener('click', () => openModal(elements.settingsModal));
  elements.closeSettingsBtn.addEventListener('click', () => closeModal(elements.settingsModal));
  elements.profileForm.addEventListener('submit', handleProfileSubmit);
  elements.profileCancelBtn.addEventListener('click', resetProfileForm);

  elements.sendKeySelect.addEventListener('change', (event) => {
    state.settings.sendKey = event.target.value;
    updateSendHint();
    saveState();
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
  elements.saveGistBtn.addEventListener('click', saveGistConfig);

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
      closeModal(elements.settingsModal);
    }
    if (event.target === elements.topicModal) {
      closeModal(elements.topicModal);
    }
  });
}

function boot() {
  ensureActiveSelections();
  render();
  initListeners();
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

      saveState();
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
  state = structuredClone(defaultState);
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
      gistToken,
      gistId,
      lastSyncTime: Date.now(),
      lastSyncHash: remoteHash,
    };

    saveState();
    render();

    updateSyncStatus(t('sync.downloadSuccess'), 'success');
  } catch (error) {
    updateSyncStatus(t('sync.downloadFailed') + error.message, 'error');
    console.error('Download failed:', error);
  }
}

// 保存 Gist 配置
function saveGistConfig() {
  state.gistToken = elements.gistToken.value.trim();
  state.gistId = elements.gistId.value.trim();
  saveState();
  updateSyncStatus(t('sync.configSaved'), 'success');
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

boot();
