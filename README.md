<div align="center">
  <img src="favicon.png" alt="Chatbutte Logo" width="200" height="200">
</div>

<div align="center">
  <a href="#english">English</a> | <a href="#中文">中文</a>
</div>

# Chatbutte

A sleek and elegant pure frontend LLM chat workstation, supporting multi-model configuration, subtopic management, and local data storage.

一个简洁优雅的纯前端 LLM 聊天工作台，支持多模型配置、子话题管理和本地数据存储。

---

<a name="english"></a>
## 🇺🇸 English Version

### Features

- **Multi-model Support** - Configure multiple OpenAI-compatible API models and switch quickly
- **Subtopic Management** - Create independent topics for different scenarios, each with its own system prompt
- **Local Data Storage** - All chat history, topics, and configurations are stored in browser localStorage, no server required
- **Data Import/Export** - Export all data as JSON files or restore from backup files
- **Streaming Output** - Real-time display of AI responses for better interaction experience
- **Markdown Rendering** - Full support for Markdown formatting and code syntax highlighting
- **Message Copy** - Quickly copy message content by hovering
- **Shortcut Support** - Flexible send shortcut configuration (Enter / Cmd+Enter / Ctrl+Enter / Option+Enter)
- **Responsive Design** - Perfectly adapted for desktop and mobile, featuring Apple Mac-style design
- **Internationalization** - Built-in i18n support with Chinese/English language switching

### Quick Start

#### Online Demo

You can directly access the online demo version:

🔗 **[https://liuxl.com.cn/chatbutte](https://liuxl.com.cn/chatbutte)**

![Demo GIF](assets/demo.gif)

*Screen recording showing the usage of Chatbutte*

#### Direct Use

1. Download the project files
2. Open `index.html` in your browser to start using
3. Recommended to use modern browsers like Chrome, Edge, or Safari for the best experience

#### Local Development

```bash
# Start the built-in server (includes image proxy support)
python3 server.py --port 8000
```

For providers such as Alibaba Bailian `z-image-turbo`, image generation must go through the built-in proxy route instead of a pure static file server.

If your local Python reports SSL certificate verification errors on macOS, you can use this for local testing only:

```bash
CHATBUTTE_INSECURE_SSL=1 python3 server.py --port 8000
```

#### Deploy To `server94`

```bash
./scripts/deploy-server94.sh
```

This deploys the current project directory to `/home/ubuntu/chatbutte` on `server94`,
then restarts the `chatbutte` supervisor service.

### Configuration

First-time use requires model configuration in "Settings":

1. Click the "Settings" button in the left sidebar
2. Add a new model in the "Model Configuration" section:
   - **Name**: Custom model name
   - **API Address**: OpenAI-compatible API endpoint
   - **API Key**: API key (optional)
   - **Model**: Model name (e.g., `gpt-4o-mini`)
3. Save and start chatting

### Data Security

- All data is stored in browser's localStorage
- No data is uploaded to any server
- Source code submitted to GitHub contains no sensitive information
- Exported JSON backup files contain API Keys - do not share

### Tech Stack

- Pure HTML/CSS/JavaScript, no build tools
- [Marked.js](https://marked.js.org/) - Markdown parsing
- [Highlight.js](https://highlightjs.org/) - Code syntax highlighting

### Author

**Abel Liu**
Email: [sylar19951010@gmail.com](mailto:sylar19951010@gmail.com)

### License

MIT License

---

<a name="中文"></a>
## 🇨🇳 中文版本

### 功能特性

- **多模型支持** - 配置多个 OpenAI 兼容的 API 模型，快速切换
- **子话题管理** - 为不同场景创建独立话题，每个话题可设置专属系统提示词
- **本地数据存储** - 所有聊天记录、话题和配置均存储在浏览器本地，无需服务器
- **数据导入/导出** - 支持将所有数据导出为 JSON 文件，或从备份文件恢复
- **流式输出** - 实时显示 AI 响应，提升交互体验
- **Markdown 渲染** - 完整支持 Markdown 格式和代码语法高亮
- **消息复制** - 鼠标悬停即可快速复制消息内容
- **快捷键支持** - 灵活配置发送快捷键（Enter / Cmd+Enter / Ctrl+Enter / Option+Enter）
- **响应式设计** - 完美适配桌面端和移动端，采用 Apple Mac 风格设计
- **国际化支持** - 内置中英文双语切换功能

### 快速开始

#### 在线体验

您可以直接访问在线演示版本：

🔗 **[https://liuxl.com.cn/chatbutte](https://liuxl.com.cn/chatbutte)**

![演示 GIF](assets/demo.gif)

*屏幕录制展示 Chatbutte 的使用过程*

#### 直接使用

1. 下载项目文件
2. 用浏览器打开 `index.html` 即可使用
3. 推荐使用 Chrome、Edge 或 Safari 等现代浏览器以获得最佳体验

#### 本地开发

```bash
# 启动内置服务（包含图片代理）
python3 server.py --port 8000
```

对于阿里百炼 `z-image-turbo` 这类接口，图片生成必须通过内置代理转发，不能只用纯静态文件服务器。

如果你本机的 Python 在 macOS 下出现 SSL 证书校验错误，可仅在本地测试时这样启动：

```bash
CHATBUTTE_INSECURE_SSL=1 python3 server.py --port 8000
```

#### 部署到 `server94`

```bash
./scripts/deploy-server94.sh
```

该脚本会把当前项目目录同步到 `server94` 的 `/home/ubuntu/chatbutte`，
然后重启 `chatbutte` 的 supervisor 服务。

### 配置说明

首次使用需要在「设置」中配置模型：

1. 点击左侧边栏的「设置」按钮
2. 在「模型配置」部分添加新模型：
   - **名称**：自定义模型名称
   - **API 地址**：OpenAI 兼容的 API 端点
   - **API Key**：API 密钥（可选）
   - **模型**：模型名称（如 `gpt-4o-mini`）
3. 保存后即可开始对话

### 数据安全

- 所有数据存储在浏览器的 localStorage 中
- 不会上传到任何服务器
- 提交到 GitHub 的源代码不包含任何敏感信息
- 导出的 JSON 备份文件包含 API Key，请勿分享

### 技术栈

- 纯 HTML/CSS/JavaScript，无构建工具
- [Marked.js](https://marked.js.org/) - Markdown 解析
- [Highlight.js](https://highlightjs.org/) - 代码语法高亮

### 作者

**Abel Liu**
Email: [sylar19951010@gmail.com](mailto:sylar19951010@gmail.com)

### 许可证

MIT License
