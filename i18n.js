// 国际化 (i18n) 支持

const translations = {
  zh: {
    // 侧栏
    'sidebar.close': '关闭话题列表',
    'sidebar.brand': 'LLM 工作台',
    'sidebar.topics': '子话题',
    'sidebar.topics.add': '新增子话题',
    'sidebar.settings': '设置',

    // 主界面
    'main.noTopic': '未选择子话题',
    'main.noTopicHint': '请选择或创建一个子话题，并填写系统提示词。',
    'main.model': '模型',
    'main.input.placeholder': '输入消息...',
    'main.send': '发送',
    'main.clearChat': '清空对话',
    'main.newChat': '清除上下文',
    'main.contextCleared': '上下文已清除 - 后续对话不会上传此线之前的内容',

    // 设置
    'settings.title': '设置',
    'settings.modelConfig': '模型配置',
    'settings.apiUrl': 'API 地址',
    'settings.apiUrl.placeholder': 'https://api.openai.com/v1/chat/completions',
    'settings.apiKey': 'API Key',
    'settings.apiKey.placeholder': '可留空',
    'settings.model': '模型',
    'settings.model.placeholder': '例如: gpt-4o-mini',
    'settings.cancel': '取消',
    'settings.save': '保存模型',
    'settings.edit': '编辑',
    'settings.delete': '删除',
    'settings.noModel': '未配置模型',

    // 发送设置
    'settings.sendConfig': '发送设置',
    'settings.sendKey': '发送按键',
    'settings.sendKey.enter': 'Enter 发送',
    'settings.sendKey.cmd': 'Cmd + Enter 发送',
    'settings.sendKey.ctrl': 'Ctrl + Enter 发送',
    'settings.sendKey.alt': 'Option/Alt + Enter 发送',
    'settings.sendKey.hint.mac': 'Mac: Cmd / Ctrl / Option，Windows: Ctrl / Alt',

    // 云同步
    'settings.cloudSync': '云同步',
    'settings.gistToken': 'GitHub Gist Token',
    'settings.gistToken.placeholder': 'ghp_xxxxxxxxxxxx',
    'settings.gistToken.hint': '需要在 GitHub 创建具有 gist 权限的 Personal Access Token',
    'settings.gistId': 'Gist ID',
    'settings.gistId.placeholder': '首次同步将自动创建',
    'settings.gistId.hint': '自动创建的 Gist ID，保存后即可使用云同步功能',
    'settings.upload': '上传到云端',
    'settings.download': '从云端下载',
    'settings.saveConfig': '保存配置',
    'settings.syncStatus': '手动控制数据同步，可选择上传或下载',

    // 数据管理
    'settings.dataManagement': '数据管理',
    'settings.import': '导入数据',
    'settings.export': '导出数据',
    'settings.export.hint': '导出会将所有数据保存为 JSON 文件，导入可恢复聊天记录、话题、模型配置等所有数据。',
    'settings.reset': '一键重置所有数据',
    'settings.reset.hint': '清空所有聊天记录、话题、模型配置，恢复到初始状态。',

    // 话题编辑
    'topic.add': '新增子话题',
    'topic.edit': '编辑子话题',
    'topic.name': '子话题名称',
    'topic.name.placeholder': '例如: 产品头脑风暴',
    'topic.prompt': '系统提示词',
    'topic.prompt.placeholder': '为这个子话题定义固定提示词...',
    'topic.historyCount': '上传历史数',
    'topic.historyCount.hint': '每次对话时向前上传的历史消息数量（1-50）。',
    'topic.temperature': '温度',
    'topic.temperature.hint': '控制模型输出的随机性，值越高越随机。',
    'topic.save': '保存子话题',
    'topic.deleteConfirm': '确定删除该子话题吗？此操作不会删除已保存的消息，但会隐藏它们。',
    'topic.clearConfirm': '确定清空当前子话题的聊天记录吗？',
    'topic.noTopicSelected': '请先选择一个话题',
    'topic.contextExists': '已存在上下文截断标记，确定要重新截断吗？这将移除旧的截断线。',

    // 消息
    'message.copy': '复制',
    'message.copied': '已复制',
    'message.copy.title': '复制消息',
    'message.noModel': '请先在设置里配置模型。',
    'message.newTopic': '新话题',
    'message.error': '出错了：',

    // 发送快捷键提示
    'sendHint.enter.mac': 'Enter 发送 · Cmd/Ctrl/Option + Enter 换行',
    'sendHint.enter.windows': 'Enter 发送 · Ctrl/Alt + Enter 换行',
    'sendHint.cmd': 'Cmd + Enter 发送 · 其他组合键换行',
    'sendHint.ctrl': 'Ctrl + Enter 发送 · 其他组合键换行',
    'sendHint.alt.mac': 'Option + Enter 发送 · 其他组合键换行',
    'sendHint.alt.windows': 'Alt + Enter 发送 · 其他组合键换行',

    // 同步相关
    'sync.never': '从未同步',
    'sync.uploading': '正在上传...',
    'sync.downloading': '正在检查云端数据...',
    'sync.uploadSuccess': '上传成功！',
    'sync.downloadSuccess': '下载成功！已用云端数据覆盖本地',
    'sync.uploadFailed': '上传失败：',
    'sync.downloadFailed': '下载失败：',
    'sync.configSaved': '配置已保存',
    'sync.needToken': '请先配置 Gist Token',
    'sync.needGistId': '请先上传数据到云端以创建 Gist',
    'sync.uploadCancelled': '上传已取消',
    'sync.dataConsistent': '云端数据与本地数据已一致，无需',
    'sync.noUploadNeeded': '云端数据与本地数据已一致，无需上传。',
    'sync.noDownloadNeeded': '云端数据与本地数据已一致，无需下载。',
    'sync.confirmOverwrite': '⚠️ 即将用云端数据覆盖本地所有数据。\n\n此操作将替换所有聊天记录、话题和配置。\n点击「确定」继续下载并覆盖\n点击「取消」保留本地数据',
    'sync.createGist': '未检测到 Gist ID。\n\n点击「确定」创建新的 Gist 并上传数据\n点击「取消」取消上传',
    'sync.remoteModified': '云端数据已被其他客户端修改（更新时间：',
    'sync.confirmOverwriteRemote': '）。\n\n点击「确定」用本地数据覆盖云端\n点击「取消」取消上传',
    'sync.gistNotFound': '无法访问云端 Gist（可能已被删除）。\n\n点击「确定」创建新的 Gist\n点击「取消」取消上传',
    'sync.uploadCancelledNoChange': '上传已取消，云端数据未受影响',
    'sync.downloadCancelledNoChange': '下载已取消，本地数据未受影响',
    'sync.lastOperation': '上次操作：',

    // 导入导出
    'import.failed': '导入失败：文件格式不正确',
    'import.parseError': '导入失败：JSON 解析错误\n',
    'import.success': '数据导入成功！',

    // 重置
    'reset.confirm': '确定要重置所有数据吗？\n\n此操作将清空所有聊天记录、话题和模型配置，恢复到初始状态。\n此操作不可撤销！',
    'reset.confirmAgain': '再次确认：真的要删除所有数据吗？',
    'reset.success': '数据已重置，页面已恢复到初始状态。',

    // 删除模型配置
    'profile.deleteConfirm': '确定删除该模型配置吗？',

    // 生成话题名称的提示词
    'topicNameGen.prompt': '请用一句话总结以下内容作为聊天话题名称，要求简洁明了，不超过20个字。只返回话题名称，不要添加任何其他解释。',

    // 错误消息
    'error.requestFailed': '请求失败：',
    'error.emptyResponse': '未收到有效返回。',
    'error.emptyContent': '返回内容为空，请确认 API 格式是否兼容 OpenAI。',
  },

  en: {
    // Sidebar
    'sidebar.close': 'Close topic list',
    'sidebar.brand': 'LLM Workspace',
    'sidebar.topics': 'Topics',
    'sidebar.topics.add': 'Add Topic',
    'sidebar.settings': 'Settings',

    // Main interface
    'main.noTopic': 'No topic selected',
    'main.noTopicHint': 'Please select or create a topic and fill in the system prompt.',
    'main.model': 'Model',
    'main.input.placeholder': 'Type a message...',
    'main.send': 'Send',
    'main.clearChat': 'Clear Chat',
    'main.newChat': 'Clear Context',
    'main.contextCleared': 'Context cleared - subsequent conversations will not upload content before this line',

    // Settings
    'settings.title': 'Settings',
    'settings.modelConfig': 'Model Configuration',
    'settings.apiUrl': 'API URL',
    'settings.apiUrl.placeholder': 'https://api.openai.com/v1/chat/completions',
    'settings.apiKey': 'API Key',
    'settings.apiKey.placeholder': 'Optional',
    'settings.model': 'Model',
    'settings.model.placeholder': 'e.g. gpt-4o-mini',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save Model',
    'settings.edit': 'Edit',
    'settings.delete': 'Delete',
    'settings.noModel': 'No model configured',

    // Send settings
    'settings.sendConfig': 'Send Settings',
    'settings.sendKey': 'Send Key',
    'settings.sendKey.enter': 'Enter to send',
    'settings.sendKey.cmd': 'Cmd + Enter to send',
    'settings.sendKey.ctrl': 'Ctrl + Enter to send',
    'settings.sendKey.alt': 'Option/Alt + Enter to send',
    'settings.sendKey.hint.mac': 'Mac: Cmd / Ctrl / Option, Windows: Ctrl / Alt',

    // Cloud sync
    'settings.cloudSync': 'Cloud Sync',
    'settings.gistToken': 'GitHub Gist Token',
    'settings.gistToken.placeholder': 'ghp_xxxxxxxxxxxx',
    'settings.gistToken.hint': 'Create a Personal Access Token with gist permission on GitHub',
    'settings.gistId': 'Gist ID',
    'settings.gistId.placeholder': 'Auto-created on first sync',
    'settings.gistId.hint': 'Auto-created Gist ID, save it to use cloud sync',
    'settings.upload': 'Upload to Cloud',
    'settings.download': 'Download from Cloud',
    'settings.saveConfig': 'Save Config',
    'settings.syncStatus': 'Manually control data sync, choose upload or download',

    // Data management
    'settings.dataManagement': 'Data Management',
    'settings.import': 'Import Data',
    'settings.export': 'Export Data',
    'settings.export.hint': 'Export saves all data as JSON file. Import restores chat history, topics, model configs, etc.',
    'settings.reset': 'Reset All Data',
    'settings.reset.hint': 'Clear all chat history, topics, and model configs, restore to initial state.',

    // Topic editing
    'topic.add': 'Add Topic',
    'topic.edit': 'Edit Topic',
    'topic.name': 'Topic Name',
    'topic.name.placeholder': 'e.g. Product Brainstorming',
    'topic.prompt': 'System Prompt',
    'topic.prompt.placeholder': 'Define a fixed prompt for this topic...',
    'topic.historyCount': 'History Count',
    'topic.historyCount.hint': 'Number of historical messages to upload (1-50).',
    'topic.temperature': 'Temperature',
    'topic.temperature.hint': 'Control randomness of model output. Higher values are more random.',
    'topic.save': 'Save Topic',
    'topic.deleteConfirm': 'Are you sure you want to delete this topic? This will not delete saved messages but will hide them.',
    'topic.clearConfirm': 'Are you sure you want to clear the chat history for this topic?',
    'topic.noTopicSelected': 'Please select a topic first',
    'topic.contextExists': 'A context cutoff marker already exists. Are you sure you want to truncate again? This will remove the old marker.',
    'topic.generateName': 'New Topic',

    // Messages
    'message.copy': 'Copy',
    'message.copied': 'Copied',
    'message.copy.title': 'Copy message',
    'message.noModel': 'Please configure a model in settings first.',
    'message.error': 'Error:',

    // Send key hints
    'sendHint.enter.mac': 'Enter to send · Cmd/Ctrl/Option + Enter for newline',
    'sendHint.enter.windows': 'Enter to send · Ctrl/Alt + Enter for newline',
    'sendHint.cmd': 'Cmd + Enter to send · Other combinations for newline',
    'sendHint.ctrl': 'Ctrl + Enter to send · Other combinations for newline',
    'sendHint.alt.mac': 'Option + Enter to send · Other combinations for newline',
    'sendHint.alt.windows': 'Alt + Enter to send · Other combinations for newline',

    // Sync related
    'sync.never': 'Never synced',
    'sync.uploading': 'Uploading...',
    'sync.downloading': 'Checking cloud data...',
    'sync.uploadSuccess': 'Upload successful!',
    'sync.downloadSuccess': 'Download successful! Local data overwritten',
    'sync.uploadFailed': 'Upload failed:',
    'sync.downloadFailed': 'Download failed:',
    'sync.configSaved': 'Configuration saved',
    'sync.needToken': 'Please configure Gist Token first',
    'sync.needGistId': 'Please upload data to cloud first to create Gist',
    'sync.uploadCancelled': 'Upload cancelled',
    'sync.dataConsistent': 'Cloud and local data are consistent, no need to',
    'sync.noUploadNeeded': 'Cloud and local data are consistent, no upload needed.',
    'sync.noDownloadNeeded': 'Cloud and local data are consistent, no download needed.',
    'sync.confirmOverwrite': '⚠️ About to overwrite all local data with cloud data.\n\nThis will replace all chat history, topics, and settings.\nClick OK to continue download and overwrite\nClick Cancel to keep local data',
    'sync.createGist': 'No Gist ID detected.\n\nClick OK to create a new Gist and upload data\nClick Cancel to cancel upload',
    'sync.remoteModified': 'Cloud data has been modified by another client (updated: ',
    'sync.confirmOverwriteRemote': ').\n\nClick OK to overwrite cloud with local data\nClick Cancel to cancel upload',
    'sync.gistNotFound': 'Cannot access cloud Gist (may have been deleted).\n\nClick OK to create a new Gist\nClick Cancel to cancel upload',
    'sync.uploadCancelledNoChange': 'Upload cancelled, cloud data unchanged',
    'sync.downloadCancelledNoChange': 'Download cancelled, local data unchanged',
    'sync.lastOperation': 'Last operation:',

    // Import/Export
    'import.failed': 'Import failed: Invalid file format',
    'import.parseError': 'Import failed: JSON parse error\n',
    'import.success': 'Data imported successfully!',

    // Reset
    'reset.confirm': 'Are you sure you want to reset all data?\n\nThis will clear all chat history, topics, and model configs, restoring to initial state.\nThis action cannot be undone!',
    'reset.confirmAgain': 'Confirm again: Really want to delete all data?',
    'reset.success': 'Data has been reset. Page restored to initial state.',

    // Delete profile
    'profile.deleteConfirm': 'Are you sure you want to delete this model configuration?',

    // Topic name generation prompt
    'topicNameGen.prompt': 'Please summarize the following content in one sentence as a chat topic name. Keep it concise and no more than 20 characters. Only return the topic name, do not add any other explanation.',

    // Error messages
    'error.requestFailed': 'Request failed:',
    'error.emptyResponse': 'No valid response received.',
    'error.emptyContent': 'Response is empty. Please confirm if the API format is compatible with OpenAI.',
  }
};

// 当前语言（默认中文）
let currentLanguage = 'zh';

// 从 localStorage 读取语言设置
function loadLanguageSetting() {
  const saved = localStorage.getItem('chatbutte_language');
  if (saved && (saved === 'zh' || saved === 'en')) {
    currentLanguage = saved;
  }
}

// 保存语言设置到 localStorage
function saveLanguageSetting() {
  localStorage.setItem('chatbutte_language', currentLanguage);
}

// 切换语言
function toggleLanguage() {
  currentLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
  saveLanguageSetting();
  // 触发语言变化事件
  window.dispatchEvent(new CustomEvent('languageChange', { detail: { language: currentLanguage } }));
  return currentLanguage;
}

// 获取当前语言
function getCurrentLanguage() {
  return currentLanguage;
}

// 翻译函数
function t(key) {
  return translations[currentLanguage][key] || translations['zh'][key] || key;
}

// 初始化语言设置
loadLanguageSetting();
