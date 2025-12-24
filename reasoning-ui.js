// 思维链 UI 渲染相关代码

// 思维链动画状态
const reasoningAnimations = new Map();

// 更新思维链气泡显示
function updateReasoningBubble(bubble, reasoning, isLoading = false) {
  if (isLoading) {
    // 显示加载动画
    let animationInterval = reasoningAnimations.get(bubble);
    if (!animationInterval) {
      let dots = 0;
      bubble.innerHTML = `<span class="reasoning-text">思考中</span><span class="reasoning-dots">${'.'.repeat(dots || 1)}</span>`;
      bubble.classList.add('loading');
      animationInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        const dotsElement = bubble.querySelector('.reasoning-dots');
        if (dotsElement) {
          dotsElement.textContent = '.'.repeat(dots || 1);
        }
      }, 300);
      reasoningAnimations.set(bubble, animationInterval);
    }
  } else {
    // 停止动画，显示预览文本
    let animationInterval = reasoningAnimations.get(bubble);
    if (animationInterval) {
      clearInterval(animationInterval);
      reasoningAnimations.delete(bubble);
    }
    bubble.classList.remove('loading');

    // 获取预览文本（最多一行）
    const previewText = reasoning.slice(0, 50) + (reasoning.length > 50 ? '...' : '');
    bubble.innerHTML = `
      <span class="reasoning-text">${previewText}</span>
      <span class="reasoning-expand">📖</span>
    `;
    bubble.title = reasoning; // hover 时显示完整内容
  }
}
