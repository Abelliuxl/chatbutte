// Incremental SSE parser: UTF-8, CRLF, multiline data, comments and an EOF tail.
export async function* readSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    data = [],
    event = '',
    size = 0;
  const line = (value) => {
    if (value === '') {
      const item = data.length ? { event, data: data.join('\n') } : null;
      data = [];
      event = '';
      size = 0;
      return item;
    }
    if (value.startsWith(':')) return null;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let text = colon < 0 ? '' : value.slice(colon + 1);
    if (text.startsWith(' ')) text = text.slice(1);
    if (field === 'data') {
      data.push(text);
      size += text.length;
    }
    if (field === 'event') event = text;
    if (size > 4_000_000) throw new Error('Stream event too large');
    return null;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r\n|\n|\r/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const item = line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (item) yield item;
      }
      if (buffer.length > 4_000_000) throw new Error('Stream line too large');
      if (done) {
        if (buffer) {
          const item = line(buffer);
          if (item) yield item;
        }
        const tail = line('');
        if (tail) yield tail;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
