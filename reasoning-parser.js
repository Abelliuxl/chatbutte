// 思维链标签解析器
// 支持多种 LLM 的思维链标签格式（通用）

// 常见的思维链标签格式
const REASONING_TAGS = [
  // XML 风格的标签
  { start: '<thought>', end: '</thought>' },
  { start: '<thinking>', end: '</thinking>' },
  { start: '<think>', end: '</think>' },
  { start: '<reasoning>', end: '</reasoning>' },
  { start: '<reason>', end: '</reason>' },
  { start: '<thought_process>', end: '</thought_process>' },
  { start: '<think_process>', end: '</think_process>' },
  { start: '<cognitive>', end: '</cognitive>' },
  { start: '<analysis>', end: '</analysis>' },
  { start: '<step_by_step>', end: '</step_by_step>' },
  { start: '<monologue>', end: '</monologue>' },
  { start: '<inner_thought>', end: '</inner_thought>' },
  { start: '<chain_of_thought>', end: '</chain_of_thought>' },
  { start: '<cot>', end: '</cot>' },
  // 自定义标记
  { start: '【思维链】', end: '【思维链结束】' },
  { start: '【思考】', end: '【思考结束】' },
  { start: '---思考开始---', end: '---思考结束---' },
];

// 从文本中提取思维链内容
function extractReasoning(content) {
  const reasoningParts = [];
  let cleanedContent = content;

  // 遍历所有支持的标签格式
  for (const tag of REASONING_TAGS) {
    // 转义特殊字符用于正则表达式
    const escapedStart = tag.start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = tag.end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const regex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'gi');
    const matches = content.match(regex);

    if (matches) {
      matches.forEach((match) => {
        const extracted = match
          .replace(new RegExp(`^${escapedStart}`, 'i'), '')
          .replace(new RegExp(`${escapedEnd}$`, 'i'), '')
          .trim();
        if (extracted) {
          reasoningParts.push(extracted);
        }
      });
    }

    // 移除思维链标签
    cleanedContent = cleanedContent.replace(regex, '').trim();
  }

  // 清理多余的空行
  cleanedContent = cleanedContent.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

  return {
    reasoning: reasoningParts.join('\n\n---\n\n'),
    cleanedContent: cleanedContent,
    hasReasoning: reasoningParts.length > 0,
  };
}
