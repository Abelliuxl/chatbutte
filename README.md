<div align="center">
  <img src="favicon.png" alt="Chatbutte Logo" width="200" height="200">
</div>

# Chatbutte

一个简洁优雅的纯前端 LLM 聊天工作台，支持多模型配置、子话题管理和本地数据存储。

## 功能特性

- **多模型支持** - 配置多个 OpenAI 兼容的 API 模型，快速切换
- **子话题管理** - 为不同场景创建独立话题，每个话题可设置专属系统提示词
- **本地数据存储** - 所有聊天记录、话题和配置均存储在浏览器本地，无需服务器
- **数据导入/导出** - 支持将所有数据导出为 JSON 文件，或从备份文件恢复
- **流式输出** - 实时显示 AI 响应，提升交互体验
- **Markdown 渲染** - 完整支持 Markdown 格式和代码语法高亮
- **消息复制** - 鼠标悬停即可快速复制消息内容
- **快捷键支持** - 灵活配置发送快捷键（Enter / Cmd+Enter / Ctrl+Enter / Option+Enter）
- **响应式设计** - 完美适配桌面端和移动端，采用 Apple Mac 风格设计

## 快速开始

### 在线体验

您可以直接访问在线演示版本：

🔗 **[https://liuxl.com.cn/chatbutte](https://liuxl.com.cn/chatbutte)**

### 直接使用

1. 下载项目文件
2. 用浏览器打开 `index.html` 即可使用
3. 推荐使用 Chrome、Edge 或 Safari 等现代浏览器以获得最佳体验

### 本地开发

```bash
# 使用任意静态服务器
python -m http.server 8000
# 或
npx serve .
```

## 配置说明

首次使用需要在「设置」中配置模型：

1. 点击左侧边栏的「设置」按钮
2. 在「模型配置」部分添加新模型：
   - **名称**：自定义模型名称
   - **API 地址**：OpenAI 兼容的 API 端点
   - **API Key**：API 密钥（可选）
   - **模型**：模型名称（如 `gpt-4o-mini`）
3. 保存后即可开始对话

## 数据安全

- 所有数据存储在浏览器的 localStorage 中
- 不会上传到任何服务器
- 提交到 GitHub 的源代码不包含任何敏感信息
- 导出的 JSON 备份文件包含 API Key，请勿分享

## 技术栈

- 纯 HTML/CSS/JavaScript，无构建工具
- [Marked.js](https://marked.js.org/) - Markdown 解析
- [Highlight.js](https://highlightjs.org/) - 代码语法高亮

## 作者

**Abel Liu**
Email: [sylar19951010@gmail.com](mailto:sylar19951010@gmail.com)

## 许可证

MIT License
