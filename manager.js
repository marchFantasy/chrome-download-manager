class DownloadManagerPage {
  constructor() {
    this.downloads = [];
    this.currentFilter = 'all';
    this.currentType = null;
    this.searchQuery = '';

    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadDownloads();
    this.startAutoRefresh();

    // 监听来自后台的消息
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'downloadProgress') {
        this.updateDownloadItem(request.data);
      } else if (
        request.action === 'downloadCreated' ||
        request.action === 'downloadChanged'
      ) {
        this.loadDownloads();
      }
    });
  }

  bindEvents() {
    // 侧边栏过滤
    document.querySelectorAll('.nav-menu .nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        document
          .querySelectorAll('.nav-menu .nav-item')
          .forEach((i) => i.classList.remove('active'));
        document
          .querySelectorAll('.file-types-menu .nav-item')
          .forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
        this.currentFilter = item.dataset.filter;
        this.currentType = null;
        this.renderList();
      });
    });

    // 文件类型过滤
    document.querySelectorAll('.file-types-menu .nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        document
          .querySelectorAll('.nav-menu .nav-item')
          .forEach((i) => i.classList.remove('active'));
        document
          .querySelectorAll('.file-types-menu .nav-item')
          .forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
        this.currentFilter = 'all';
        this.currentType = item.dataset.type;
        this.renderList();
      });
    });

    // 搜索
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderList();
    });

    // 模态框控制
    const modal = document.getElementById('newDownloadModal');
    const newBtn = document.getElementById('newDownloadBtn');
    const closeBtns = document.querySelectorAll('.close-btn');

    newBtn.addEventListener('click', () => {
      modal.classList.add('show');
      document.getElementById('urlInput').focus();
    });

    closeBtns.forEach((btn) => {
      btn.addEventListener('click', () => modal.classList.remove('show'));
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });

    // 开始下载
    document
      .getElementById('startDownloadBtn')
      .addEventListener('click', () => this.startNewDownload());

    // 清除已完成
    document
      .getElementById('clearCompletedBtn')
      .addEventListener('click', () => this.clearCompleted());
  }

  async loadDownloads() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getDownloads',
      });
      if (response && response.downloads) {
        this.downloads = response.downloads;

        // 检查文件是否存在
        await this.checkFilesExistence();

        this.updateCounts();
        this.renderList();
      }
    } catch (error) {
      console.error('加载下载列表失败:', error);
    }
  }

  async checkFilesExistence() {
    const downloadIds = this.downloads
      .map((d) => d.finalDownloadId)
      .filter((id) => id !== undefined && id !== null);

    if (downloadIds.length === 0) return;

    try {
      // 找到最早的开始时间，用于过滤查询
      // 减去 24 小时以防时间偏差
      const minTime = Math.min(
        ...this.downloads.map((d) => d.startTime || Date.now())
      );
      const searchTime = new Date(minTime - 24 * 60 * 60 * 1000).toISOString();

      // 查询该时间之后的所有下载
      const chromeDownloads = await new Promise((resolve) => {
        chrome.downloads.search({ startedAfter: searchTime }, resolve);
      });

      const chromeMap = new Map(chromeDownloads.map((cd) => [cd.id, cd]));

      this.downloads.forEach((d) => {
        if (d.finalDownloadId) {
          const cd = chromeMap.get(d.finalDownloadId);
          // 如果记录存在且 exists 为 true，则文件存在
          // 如果记录不存在（被清除历史）或者 exists 为 false，则文件不存在
          d.exists = cd ? cd.exists : false;
        } else {
          // 没有 finalDownloadId 的（如下载失败的），默认 false
          d.exists = false;
        }
      });
    } catch (error) {
      console.error('检查文件存在性失败:', error);
    }
  }

  startAutoRefresh() {
    setInterval(() => this.loadDownloads(), 2000);
  }

  updateCounts() {
    const counts = {
      all: this.downloads.length,
      in_progress: this.downloads.filter((d) => d.state === 'in_progress')
        .length,
      complete: this.downloads.filter((d) => d.state === 'complete').length,
      interrupted: this.downloads.filter((d) => d.state === 'interrupted')
        .length,
    };

    Object.keys(counts).forEach((key) => {
      const el = document.getElementById(`count-${key}`);
      if (el) el.textContent = counts[key];
    });

    // 更新总下载数显示
    const totalEl = document.getElementById('total-downloads-count');
    if (totalEl) totalEl.textContent = this.downloads.length;
  }

  getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
      image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'],
      video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'],
      audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'],
      document: [
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'ppt',
        'pptx',
        'txt',
        'md',
      ],
      archive: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
    };

    for (const [type, exts] of Object.entries(types)) {
      if (exts.includes(ext)) return type;
    }
    return 'other';
  }

  getFileIcon(type) {
    const icons = {
      image: '🖼️',
      video: '🎬',
      audio: '🎵',
      document: '📄',
      archive: '📦',
      other: '❓',
    };
    return icons[type] || icons.other;
  }

  filterDownloads() {
    return this.downloads.filter((d) => {
      // 状态过滤
      if (this.currentFilter !== 'all' && d.state !== this.currentFilter)
        return false;

      // 类型过滤
      if (this.currentType) {
        const type = this.getFileType(d.filename);
        if (type !== this.currentType) return false;
      }

      // 搜索过滤
      if (this.searchQuery) {
        return (
          d.filename.toLowerCase().includes(this.searchQuery) ||
          d.url.toLowerCase().includes(this.searchQuery)
        );
      }

      return true;
    });
  }

  renderList() {
    const list = document.getElementById('downloadList');
    const filtered = this.filterDownloads();

    if (filtered.length === 0) {
      list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <p>没有找到相关下载任务</p>
                </div>
            `;
      return;
    }

    list.innerHTML = filtered
      .map((d) => this.createDownloadItemHTML(d))
      .join('');
    this.bindItemEvents();
  }

  createDownloadItemHTML(d) {
    const type = this.getFileType(d.filename);
    const icon = this.getFileIcon(type);
    const size = this.formatSize(d.totalBytes);
    const received = this.formatSize(d.bytesReceived);
    const speed = d.state === 'in_progress' ? this.formatSpeed(d.speed) : '-';
    const time = new Date(d.startTime).toLocaleString();

    let statusClass = `status-${d.state}`;
    let statusText = this.getStatusText(d.state);

    // 如果是完成状态但文件不存在
    if (d.state === 'complete' && d.exists === false) {
      statusClass = 'status-not-exists';
      statusText = '文件不存在';
    }

    let progressHTML = '';
    if (d.state === 'in_progress') {
      const percent =
        d.totalBytes > 0 ? (d.bytesReceived / d.totalBytes) * 100 : 0;
      const indeterminate = d.totalBytes === 0;
      const width = indeterminate ? 30 : percent;

      progressHTML = `
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill${
                          indeterminate ? ' indeterminate' : ''
                        }" style="width: ${width}%"></div>
                    </div>
                </div>
            `;
    }

    return `
            <div class="download-item" data-id="${d.id}">
                <div class="col-name">
                    <div class="file-icon">${icon}</div>
                    <div class="file-info">
                        <div class="filename" title="${d.filename}">${
      d.filename
    }</div>
                        <div class="file-url" title="${d.url}">${d.url}</div>
                        ${progressHTML}
                    </div>
                </div>
                <div class="col-status">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="col-size">${received} / ${size}</div>
                <div class="col-speed">${speed}</div>
                <div class="col-time">${time}</div>
                <div class="col-actions">
                    ${this.createActionButtons(d)}
                </div>
            </div>
        `;
  }

  createActionButtons(d) {
    let buttons = '';

    if (d.state === 'in_progress') {
      if (d.paused) {
        buttons += `<button class="action-btn" data-action="resume" title="继续">▶️</button>`;
      } else {
        buttons += `<button class="action-btn" data-action="pause" title="暂停">⏸️</button>`;
      }
      buttons += `<button class="action-btn" data-action="cancel" title="取消">❌</button>`;
    } else if (d.state === 'complete') {
      // 只有文件存在时才显示打开文件夹按钮
      if (d.exists !== false) {
        buttons += `<button class="action-btn" data-action="openFolder" title="打开文件夹">📁</button>`;
      }
    } else {
      buttons += `<button class="action-btn" data-action="retry" title="重试">🔄</button>`;
    }

    buttons += `<button class="action-btn" data-action="copyLink" title="复制链接">🔗</button>`;
    buttons += `<button class="action-btn" data-action="delete" title="删除记录">🗑️</button>`;

    return buttons;
  }

  bindItemEvents() {
    document.querySelectorAll('.action-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const item = e.target.closest('.download-item');
        const id = item.dataset.id;
        const action = e.target.closest('.action-btn').dataset.action;

        await this.handleAction(action, id);
      });
    });
  }

  async handleAction(action, id) {
    try {
      switch (action) {
        case 'pause':
          await chrome.runtime.sendMessage({
            action: 'pauseDownload',
            downloadId: id,
          });
          break;
        case 'resume':
          await chrome.runtime.sendMessage({
            action: 'resumeDownload',
            downloadId: id,
          });
          break;
        case 'cancel':
          await chrome.runtime.sendMessage({
            action: 'cancelDownload',
            downloadId: id,
          });
          break;
        case 'delete':
          await chrome.runtime.sendMessage({
            action: 'eraseDownload',
            downloadId: id,
          });
          this.loadDownloads();
          break;
        case 'openFolder': {
          const download = this.downloads.find((d) => d.id == id);
          if (download && download.finalDownloadId) {
            chrome.downloads.show(download.finalDownloadId);
          }
          break;
        }
        case 'copyLink': {
          const d = this.downloads.find((item) => item.id == id);
          if (d) {
            await navigator.clipboard.writeText(d.url);
            this.showNotification('链接已复制', 'success');
          }
          break;
        }
      }
    } catch (error) {
      this.showNotification('操作失败: ' + error.message, 'error');
    }
  }

  async startNewDownload() {
    const url = document.getElementById('urlInput').value.trim();
    const filename = document.getElementById('filenameInput').value.trim();
    const threads = parseInt(document.getElementById('threadsInput').value);

    if (!url) {
      this.showNotification('请输入下载链接', 'error');
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        action: 'startDownload',
        url: url,
        filename: filename || undefined,
        options: { threads: threads },
      });

      document.getElementById('newDownloadModal').classList.remove('show');
      document.getElementById('urlInput').value = '';
      document.getElementById('filenameInput').value = '';
      this.showNotification('下载任务已开始', 'success');
      this.loadDownloads();
    } catch (error) {
      this.showNotification('创建任务失败: ' + error.message, 'error');
    }
  }

  async clearCompleted() {
    // 实现清除已完成逻辑
    // 这里需要 background.js 支持批量删除，或者循环调用
    // 暂时简单实现
    const completed = this.downloads.filter((d) => d.state === 'complete');
    for (const d of completed) {
      await chrome.runtime.sendMessage({
        action: 'eraseDownload',
        downloadId: d.id,
      });
    }
    this.loadDownloads();
    this.showNotification('已清除所有完成任务', 'success');
  }

  updateDownloadItem(data) {
    // 找到对应的 DOM 元素并更新
    // 为了简单起见，这里可以不做细粒度更新，因为有自动刷新
    // 但为了性能，最好是只更新进度条和状态
    const item = document.querySelector(`.download-item[data-id="${data.id}"]`);
    if (item) {
      // 更新进度条等...
      // 鉴于时间，这里依赖 loadDownloads 的刷新
    }
  }

  // 工具函数
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatSpeed(bytesPerSec) {
    return this.formatSize(bytesPerSec) + '/s';
  }

  getStatusText(state) {
    const map = {
      in_progress: '下载中',
      interrupted: '已中断',
      complete: '已完成',
      paused: '已暂停',
    };
    return map[state] || state;
  }

  showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    container.appendChild(notif);

    setTimeout(() => {
      notif.remove();
    }, 3000);
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new DownloadManagerPage();
});
