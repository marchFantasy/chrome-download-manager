// 智能下载管理器 - 内容脚本
// 现在只负责监听来自background的消息，不再拦截页面链接
// 所有链接由浏览器正常处理，扩展通过 chrome.downloads.onCreated 事件监听下载

class ContentScript {
  constructor() {
    this.init();
  }

  init() {
    // 监听来自background的消息
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
  }

  // 处理消息
  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'getPageLinks':
        sendResponse({ links: this.getPageLinks() });
        break;

      case 'downloadLink':
        // 这个action不再使用，因为不再拦截页面链接
        sendResponse({ success: false, error: '不再支持页面拦截下载' });
        break;

      default:
        sendResponse({ success: false, error: '未知操作' });
    }
  }

  // 获取页面链接
  getPageLinks() {
    const links = [];
    const linkElements = document.querySelectorAll('a[href]');

    linkElements.forEach((link, index) => {
      const href = link.href;
      const text = link.textContent.trim();
      const filename = this.extractFilename(href);

      links.push({
        index,
        url: href,
        text: text || filename,
        filename: filename,
      });
    });

    return links;
  }

  // 提取文件名
  extractFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);

      // URL 解码文件名（处理中文等特殊字符）
      try {
        filename = decodeURIComponent(filename);
      } catch (decodeError) {
        console.warn('文件名 URL 解码失败，使用原始文件名:', decodeError);
      }

      return filename || '未知文件';
    } catch (e) {
      return '未知文件';
    }
  }
}

// 初始化内容脚本
const contentScript = new ContentScript();
