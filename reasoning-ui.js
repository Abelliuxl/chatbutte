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

    bubble.replaceChildren();
    const textSpan = document.createElement('span');
    textSpan.className = 'reasoning-text';
    textSpan.textContent = reasoning.replace(/\s+/g, ' ').trim();
    const expandSpan = document.createElement('span');
    expandSpan.className = 'reasoning-expand';
    expandSpan.textContent = '…';
    expandSpan.setAttribute('aria-hidden', 'true');
    bubble.append(textSpan, expandSpan);
    bubble.title = reasoning;
  }
}
