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
    temperature: 0.7,
    historyCount: 12,
    sendKey: 'enter',
  },
  messagesByTopic: {},
};

const elements = {
  topicList: document.getElementById('topicList'),
  topicTitle: document.getElementById('topicTitle'),
  topicPromptPreview: document.getElementById('topicPromptPreview'),
  messages: document.getElementById('messages'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  sendHint: document.getElementById('sendHint'),
  tempRange: document.getElementById('tempRange'),
  tempValue: document.getElementById('tempValue'),
  historyCount: document.getElementById('historyCount'),
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
  topicCancelBtn: document.getElementById('topicCancelBtn'),
  menuToggle: document.getElementById('menuToggle'),
  sidebarClose: document.getElementById('sidebarClose'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  sidebar: document.querySelector('.sidebar'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFileInput: document.getElementById('importFileInput'),
  resetBtn: document.getElementById('resetBtn'),
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
  state.topics.forEach((topic) => {
    const card = document.createElement('div');
    card.className = 'topic-card';
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
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openTopicModal(topic);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ghost-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      removeTopic(topic.id);
    });

    actions.append(editBtn, deleteBtn);
    card.append(title, actions);
    card.addEventListener('click', () => {
      state.activeTopicId = topic.id;
      saveState();
      render();
    });
    elements.topicList.appendChild(card);
  });
}

function renderTopicHeader() {
  const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId);
  if (!activeTopic) {
    elements.topicTitle.textContent = '未选择子话题';
    elements.topicPromptPreview.textContent = '请选择或创建一个子话题，并填写系统提示词。';
    return;
  }
  elements.topicTitle.textContent = activeTopic.name;
  elements.topicPromptPreview.textContent = activeTopic.prompt || '未设置系统提示词';
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
  bubble.className = `message ${message.role}`;
  if (message.id) {
    bubble.dataset.messageId = message.id;
  }
  if (message.role === 'error') {
    bubble.classList.add('error');
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
    <span>复制</span>
  `;
  copyBtn.title = '复制消息';

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
        <span>已复制</span>
      `;
      // 2秒后恢复原状
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>复制</span>
        `;
      }, 2000);
    } catch (err) {
      console.error('复制失败:', err);
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
    option.textContent = '未配置模型';
    elements.profileSelect.appendChild(option);
  }

  state.profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.model})`;
    if (profile.id === state.activeProfileId) option.selected = true;
    elements.profileSelect.appendChild(option);
  });

  elements.profileList.innerHTML = '';
  state.profiles.forEach((profile) => {
    const card = document.createElement('div');
    card.className = 'card profile-item';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = profile.name;
    const meta = document.createElement('div');
    meta.className = 'profile-meta';
    meta.textContent = `${profile.model} · ${profile.apiUrl}`;
    info.append(name, meta);

    const actions = document.createElement('div');
    const editBtn = document.createElement('button');
    editBtn.className = 'ghost-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => fillProfileForm(profile));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ghost-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => removeProfile(profile.id));

    actions.append(editBtn, deleteBtn);
    card.append(info, actions);
    elements.profileList.appendChild(card);
  });
}

function renderSettings() {
  elements.tempRange.value = state.settings.temperature;
  elements.tempValue.textContent = Number(state.settings.temperature).toFixed(2);
  elements.historyCount.value = state.settings.historyCount;
  elements.sendKeySelect.value = state.settings.sendKey;
  updateSendHint();
}

function updateSendHint() {
  // 检测操作系统平台
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  const map = {
    enter: isMac
      ? 'Enter 发送 · Cmd/Ctrl/Option + Enter 换行'
      : 'Enter 发送 · Ctrl/Alt + Enter 换行',
    cmd: 'Cmd + Enter 发送 · 其他组合键换行',
    ctrl: 'Ctrl + Enter 发送 · 其他组合键换行',
    alt: isMac
      ? 'Option + Enter 发送 · 其他组合键换行'
      : 'Alt + Enter 发送 · 其他组合键换行',
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

function updateMessageContent(topicId, messageId, content) {
  const list = state.messagesByTopic[topicId] || [];
  const target = list.find((message) => message.id === messageId);
  if (!target) return;
  target.content = content;
  saveState();
  const bubble = elements.messages.querySelector(`[data-message-id=\"${messageId}\"]`);
  if (bubble) {
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
        <span>复制</span>
      `;
      copyBtn.title = '复制消息';

      copyBtn.addEventListener('click', async () => {
        const text = content || '';
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>已复制</span>
          `;
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>复制</span>
            `;
          }, 2000);
        } catch (err) {
          console.error('复制失败:', err);
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
        content: '请用一句话总结以下内容作为聊天话题名称，要求简洁明了，不超过20个字。只返回话题名称，不要添加任何其他解释。'
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
  return data?.choices?.[0]?.message?.content || '新话题';
}

async function sendMessage() {
  const text = elements.messageInput.value.trim();
  let activeTopic = getActiveTopic();
  if (!text) return;
  const profile = getActiveProfile();
  if (!profile) {
    alert('请先在设置里配置模型。');
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
        prompt: ''
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
        name: '新话题',
        prompt: ''
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

  const historyMessages = (state.messagesByTopic[activeTopic.id] || [])
    .filter((message) => message.role === 'user' || message.role === 'assistant');

  const recentMessages = historyMessages.slice(-state.settings.historyCount).map((message) => ({
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
    temperature: Number(state.settings.temperature),
    stream: true,
  };

  try {
    const message = await streamChatCompletion(profile, payload, (delta, full) => {
      updateMessageContent(activeTopic.id, assistantMessage.id, full);
    });
    if (!message) {
      updateMessageContent(activeTopic.id, assistantMessage.id, '未收到有效返回。');
    }
  } catch (error) {
    updateMessageContent(activeTopic.id, assistantMessage.id, `出错了：${error.message}`);
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
    const message = data?.choices?.[0]?.message?.content;
    if (!message) {
      throw new Error('返回内容为空，请确认 API 格式是否兼容 OpenAI。');
    }
    return message;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

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
        return full;
      }
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content || '';
        const message = json?.choices?.[0]?.message?.content || '';
        const chunk = delta || message;
        if (chunk) {
          full += chunk;
          onDelta(chunk, full);
        }
      } catch (error) {
        // ignore parse errors from partial lines
      }
    }
  }

  return full;
}

function openTopicModal(topic) {
  if (topic) {
    elements.topicModalTitle.textContent = '编辑子话题';
    elements.topicId.value = topic.id;
    elements.topicName.value = topic.name;
    elements.topicPrompt.value = topic.prompt || '';
  } else {
    elements.topicModalTitle.textContent = '新增子话题';
    elements.topicId.value = '';
    elements.topicName.value = '';
    elements.topicPrompt.value = '';
  }
  openModal(elements.topicModal);
}

function removeTopic(id) {
  if (!confirm('确定删除该子话题吗？此操作不会删除已保存的消息，但会隐藏它们。')) {
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
  elements.profileName.value = profile.name;
  elements.profileUrl.value = profile.apiUrl;
  elements.profileKey.value = profile.apiKey || '';
  elements.profileModel.value = profile.model;
  openModal(elements.settingsModal);
}

function removeProfile(id) {
  if (!confirm('确定删除该模型配置吗？')) return;
  state.profiles = state.profiles.filter((profile) => profile.id !== id);
  if (state.activeProfileId === id) {
    state.activeProfileId = state.profiles.length ? state.profiles[0].id : null;
  }
  saveState();
  render();
}

function resetProfileForm() {
  elements.profileId.value = '';
  elements.profileName.value = '';
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
  } else {
    state.topics.push({
      id,
      name: elements.topicName.value.trim(),
      prompt: elements.topicPrompt.value.trim(),
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
  const data = {
    id,
    name: elements.profileName.value.trim(),
    apiUrl: elements.profileUrl.value.trim(),
    apiKey: elements.profileKey.value.trim(),
    model: elements.profileModel.value.trim(),
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

  elements.tempRange.addEventListener('input', (event) => {
    state.settings.temperature = event.target.value;
    elements.tempValue.textContent = Number(state.settings.temperature).toFixed(2);
    saveState();
  });

  elements.historyCount.addEventListener('change', (event) => {
    const value = Number(event.target.value);
    state.settings.historyCount = Number.isNaN(value) ? 12 : Math.max(1, value);
    saveState();
  });

  elements.profileSelect.addEventListener('change', (event) => {
    state.activeProfileId = event.target.value || null;
    saveState();
    renderProfiles();
  });

  elements.clearChatBtn.addEventListener('click', () => {
    const activeTopic = getActiveTopic();
    if (!activeTopic) return;
    if (!confirm('确定清空当前子话题的聊天记录吗？')) return;
    state.messagesByTopic[activeTopic.id] = [];
    saveState();
    renderMessages();
  });

  elements.newChatBtn.addEventListener('click', () => {
    // 创建一个新的空白话题
    const topicId = createId('topic');
    state.topics.push({
      id: topicId,
      name: '新话题',
      prompt: ''
    });
    state.activeTopicId = topicId;
    saveState();
    render();
  });

  elements.addTopicBtn.addEventListener('click', () => openTopicModal());
  elements.topicForm.addEventListener('submit', handleTopicSubmit);
  elements.topicCancelBtn.addEventListener('click', () => closeModal(elements.topicModal));
  elements.closeTopicBtn.addEventListener('click', () => closeModal(elements.topicModal));

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

  elements.menuToggle.addEventListener('click', () => {
    elements.sidebar.classList.add('open');
    elements.sidebarOverlay.classList.add('open');
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
        alert('导入失败：文件格式不正确');
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
      alert('数据导入成功！');
    } catch (error) {
      alert('导入失败：JSON 解析错误\n' + error.message);
    }
  };
  reader.readAsText(file);
}

// 一键重置所有数据
function resetData() {
  if (!confirm('确定要重置所有数据吗？\n\n此操作将清空所有聊天记录、话题和模型配置，恢复到初始状态。\n此操作不可撤销！')) {
    return;
  }
  if (!confirm('再次确认：真的要删除所有数据吗？')) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(defaultState);
  render();
  alert('数据已重置，页面已恢复到初始状态。');
}

boot();
