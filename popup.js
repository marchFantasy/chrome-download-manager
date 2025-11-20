// 智能下载管理器 - 弹出界面脚本
// 处理用户界面交互和下载管理

class PopupManager {
  constructor() {
    this.downloads = [];
    this.selectedDownloads = new Set();
    this.filter = 'all';
    this.supportedLanguages = ['en', 'zh_CN', 'ko', 'ja'];
    this.currentLanguage = 'en';
    this.messages = {}; // 存储所有语言包数据
    this.translations = {}; // 当前语言翻译
    this.isLoading = true; // 添加加载状态标志
  }

  // 加载所有语言包数据
  async loadAllLanguagePacks() {
    try {
      console.log('开始加载语言包...');

      for (const lang of this.supportedLanguages) {
        try {
          const response = await fetch(`_locales/${lang}/messages.json`);
          if (response.ok) {
            const data = await response.json();
            this.messages[lang] = data;
            console.log(`加载语言包成功: ${lang}`);
          } else {
            console.warn(`加载语言包失败: ${lang}`, response.status);
          }
        } catch (error) {
          console.error(`加载语言包 ${lang} 失败:`, error);
        }
      }

      console.log('所有语言包加载完成');
    } catch (error) {
      console.error('加载语言包失败:', error);
    }
  }

  // 获取浏览器首选语言
  getBrowserLanguage() {
    try {
      // 首先检查用户存储的语言设置
      const storedLang = localStorage.getItem('preferred_language');
      if (storedLang && this.supportedLanguages.includes(storedLang)) {
        console.log('使用已保存的语言设置:', storedLang);
        return storedLang;
      }

      // 获取浏览器Accept-Language
      const browserLang = navigator.language || navigator.userLanguage || 'en';
      console.log('浏览器语言:', browserLang);

      // 匹配支持的语言
      for (const lang of this.supportedLanguages) {
        if (browserLang.startsWith(lang)) {
          console.log('匹配到支持的语言:', lang);
          return lang;
        }
      }

      // 默认返回英语
      console.log('未匹配到支持的语言，使用默认英语');
      return 'en';
    } catch (error) {
      console.error('获取浏览器语言失败:', error);
      return 'en';
    }
  }

  // 切换语言
  async switchLanguage(lang) {
    try {
      if (!this.supportedLanguages.includes(lang)) {
        console.warn('不支持的语言:', lang, '使用默认英语');
        lang = 'en';
      }

      this.currentLanguage = lang;
      // 保存语言设置
      localStorage.setItem('preferred_language', lang);

      // 更新当前语言的翻译数据
      if (this.messages[lang]) {
        this.translations = this.messages[lang];
      }

      // 重新设置所有文本
      this.updateLanguageUI();
      this.setI18nTexts();

      console.log('切换语言到:', lang);
    } catch (error) {
      console.error('切换语言失败:', error);
    }
  }

  // 更新语言选择器UI
  updateLanguageUI() {
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
      languageSelect.value = this.currentLanguage;
    }
  }

  // 国际化辅助函数
  _(key, ...args) {
    // 优先使用自定义翻译数据
    let message = key;
    if (this.translations[key]) {
      message = this.translations[key].message || key;
    }
    // 替换占位符
    args.forEach((arg, index) => {
      message = message.replace(`$${index + 1}`, arg);
    });
    return message;
  }

  // 设置国际化文本
  setI18nTexts() {
    // 更新筛选器选项
    const filterSelect = document.getElementById('filterSelect');
    if (filterSelect) {
      const options = filterSelect.querySelectorAll('option');
      if (options[0]) options[0].textContent = this._('allDownloads');
      if (options[1]) options[1].textContent = this._('inProgress');
      if (options[2]) options[2].textContent = this._('completed');
      if (options[3]) options[3].textContent = this._('interrupted');
      if (options[4]) options[4].textContent = this._('paused');
    }

    // 更新按钮文本
    const selectAllBtn = document.getElementById('selectAllBtn');
    if (selectAllBtn) selectAllBtn.textContent = this._('selectAll');

    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    if (clearSelectionBtn) clearSelectionBtn.textContent = this._('clearSelection');

    const clearCompletedBtn = document.getElementById('clearCompletedBtn');
    if (clearCompletedBtn) clearCompletedBtn.textContent = this._('clearCompleted');

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.textContent = `📤 ${this._('exportDownloads')}`;

    const importBtn = document.getElementById('importBtn');
    if (importBtn) importBtn.textContent = `📥 ${this._('importDownloads')}`;

    // 更新模态框按钮
    const modalCancel = document.getElementById('modalCancel');
    if (modalCancel) modalCancel.textContent = this._('cancel');

    const modalConfirm = document.getElementById('modalConfirm');
    if (modalConfirm) modalConfirm.textContent = this._('confirm');

    // 更新空状态文本
    const emptyState = document.querySelector('.empty-state p');
    if (emptyState) emptyState.textContent = this._('noDownloads');

    // 更新标题
    const popupTitle = document.getElementById('popupTitle');
    if (popupTitle) popupTitle.textContent = this._('extensionName');

    // 更新添加下载按钮
    const addDownloadBtn = document.getElementById('addDownloadBtn');
    if (addDownloadBtn) addDownloadBtn.textContent = `➕ ${this._('addDownloadBtn')}`;

    // 更新批量操作相关文本
    this.updateBatchActions();
  }

  async init() {
    // 加载所有语言包
    await this.loadAllLanguagePacks();

    // 首先检测并设置语言
    this.currentLanguage = this.getBrowserLanguage();
    this.updateLanguageUI();

    // 设置当前语言的翻译数据
    if (this.messages[this.currentLanguage]) {
      this.translations = this.messages[this.currentLanguage];
    }

    this.setI18nTexts();
    this.bindEvents();
    this.checkBackgroundScript();
    
    // 等待加载下载列表
    await this.loadDownloads();
    
    // 监听实时进度更新
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'downloadProgress') {
            this.updateDownloadItem(request.data);
        }
    });

    this.startAutoRefresh();
  }
  
  // 自动刷新（降低频率，主要依赖消息推送）
  startAutoRefresh() {
      setInterval(() => {
          this.loadDownloads();
      }, 2000);
  }

  // 检查background script是否可用
  async checkBackgroundScript() {
    try {
      await this.sendMessage({action: 'ping'});
      console.log('Background script连接正常');
    } catch (error) {
      console.error('Background script连接失败:', error);
      this.showNotification('扩展程序后台服务未响应，请重新加载扩展', 'error');
    }
  }

  // 绑定事件
  bindEvents() {
    // 语言切换
    document.getElementById('languageSelect').addEventListener('change', (e) => {
      this.switchLanguage(e.target.value);
    });

    // 头部按钮
    document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
    document.getElementById('syncFileStatusBtn').addEventListener('click', () => this.syncFileStatusOnly());
    document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());

    // 新增下载
    document.getElementById('addDownloadBtn').addEventListener('click', () => this.addDownload());
    document.getElementById('downloadUrlInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addDownload();
      }
    });

    // 筛选
    document.getElementById('filterSelect').addEventListener('change', (e) => {
      this.filter = e.target.value;
      this.renderDownloads();
    });

    // 选择操作
    document.getElementById('selectAllBtn').addEventListener('click', () => this.selectAll());
    document.getElementById('clearSelectionBtn').addEventListener('click', () => this.clearSelection());

    // 批量操作
    document.getElementById('batchPauseBtn').addEventListener('click', () => this.batchPause());
    document.getElementById('batchResumeBtn').addEventListener('click', () => this.batchResume());
    document.getElementById('batchCancelBtn').addEventListener('click', () => this.batchCancel());
    document.getElementById('batchDeleteBtn').addEventListener('click', () => this.batchDelete());

    // 底部操作
    document.getElementById('clearCompletedBtn').addEventListener('click', () => this.clearCompleted());
    document.getElementById('exportBtn').addEventListener('click', () => this.exportDownloads());
    document.getElementById('importBtn').addEventListener('click', () => this.importDownloads());

    // 模态框
    document.getElementById('closeModal').addEventListener('click', () => this.hideModal());
    document.getElementById('modalCancel').addEventListener('click', () => this.hideModal());
    document.getElementById('modalConfirm').addEventListener('click', () => this.confirmModal());

    // 通知
    document.getElementById('closeNotification').addEventListener('click', () => this.hideNotification());

    // 点击模态框背景关闭
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') {
        this.hideModal();
      }
    });
  }

  // 加载下载列表
  async loadDownloads() {
    try {
      const response = await this.sendMessage({action: 'getDownloads'});

      if (response && response.downloads) {
        // 只有当列表长度变化或状态发生重大变化时才全量重新渲染
        // 简单的 diff 检查
        if (JSON.stringify(this.downloads.map(d => d.id)) !== JSON.stringify(response.downloads.map(d => d.id))) {
             this.downloads = response.downloads;
             this.isLoading = false; // 数据加载完成
             this.renderDownloads();
        } else {
            // 仅更新数据，不重绘 DOM（由 updateDownloadItem 处理）
            this.downloads = response.downloads;
            this.isLoading = false;
            // 强制更新一次状态文本
            this.downloads.forEach(d => this.updateDownloadItem(d));
        }
        this.updateStats();
      }
    } catch (error) {
      console.error('加载下载列表失败:', error);
      this.isLoading = false;
    }
  }
  
  // 更新单个下载项的 UI
  updateDownloadItem(data) {
      const item = document.querySelector(`.download-item[data-id="${data.id}"]`);
      if (!item) return;
      
      // 更新进度条
      const progressFill = item.querySelector('.progress-fill');
      if (progressFill) {
          const percentage = data.totalBytes > 0 ? (data.bytesReceived / data.totalBytes) * 100 : 0;
          progressFill.style.width = `${percentage}%`;
      }
      
      // 更新大小和速度
      const metaSpan = item.querySelector('.download-meta span:first-child');
      if (metaSpan) {
          let text = this.formatSize(data.bytesReceived);
          if (data.totalBytes) text += ` / ${this.formatSize(data.totalBytes)}`;
          if (data.state === 'in_progress' && data.speed) {
              text += ` • ${this.formatSpeed(data.speed)}`;
          }
          metaSpan.textContent = text;
      }
      
      // 更新状态文本
      const statusText = item.querySelector('.status-text');
      if (statusText) {
          statusText.textContent = this.getStatusText(data);
      }
      
      // 如果状态变为完成或失败，可能需要重新渲染按钮
      const currentStatus = item.getAttribute('data-status');
      if (currentStatus !== data.state) {
          item.setAttribute('data-status', data.state);
          const actionsDiv = item.querySelector('.status-actions');
          if (actionsDiv) {
              actionsDiv.innerHTML = this.createActionButtons(data);
              // 重新绑定按钮事件
              this.bindDownloadItemEvents(); 
          }
          
          // 处理进度条的显示/隐藏
          const progressBar = item.querySelector('.progress-bar');
          
          if (data.state === 'in_progress') {
              // 如果恢复下载，需要重新添加进度条
              if (!progressBar) {
                  const percentage = data.totalBytes > 0 ? (data.bytesReceived / data.totalBytes) * 100 : 0;
                  const progressHtml = `
                      <div class="progress-bar">
                          <div class="progress-fill" style="width: ${percentage}%"></div>
                      </div>
                  `;
                  item.insertAdjacentHTML('beforeend', progressHtml);
              }
          } else {
              // 如果下载完成或中断，移除进度条
              if (progressBar) {
                  progressBar.remove();
              }
          }
      }
  }

  // 渲染下载列表
  renderDownloads() {
    const listContainer = document.getElementById('downloadsList');
    const filteredDownloads = this.filterDownloads();

    // 如果正在加载，显示加载状态
    if (this.isLoading) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <p>加载中...</p>
        </div>
      `;
      return;
    }

    // 如果没有下载记录，显示空状态
    if (filteredDownloads.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📥</div>
          <p>${this._('noDownloads')}</p>
          <small>开始下载文件时会显示在这里</small>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filteredDownloads.map(download => 
      this.createDownloadItem(download)
    ).join('');

    // 绑定下载项目事件
    this.bindDownloadItemEvents();
  }

  // 筛选下载
  filterDownloads() {
    switch (this.filter) {
      case 'in_progress':
        return this.downloads.filter(d => d.state === 'in_progress');
      case 'complete':
        return this.downloads.filter(d => d.state === 'complete');
      case 'interrupted':
        return this.downloads.filter(d => d.state === 'interrupted');
      case 'paused':
        return this.downloads.filter(d => d.paused);
      default:
        return this.downloads;
    }
  }

  // 创建下载项目
  createDownloadItem(download) {
    const isSelected = this.selectedDownloads.has(download.id);
    const progress = download.totalBytes > 0 ?
      Math.round((download.bytesReceived / download.totalBytes) * 100) : 0;

    const statusIcon = this.getStatusIcon(download);
    const statusText = this.getStatusText(download);
    
    let sizeText = this.formatSize(download.bytesReceived) +
      (download.totalBytes ? ` / ${this.formatSize(download.totalBytes)}` : '');
      
    if (download.state === 'in_progress' && download.speed) {
        sizeText += ` • ${this.formatSpeed(download.speed)}`;
    }

    return `
      <div class="download-item ${isSelected ? 'selected' : ''}" data-id="${download.id}" data-status="${download.state}">
        <div class="download-header">
          <div class="download-info">
            <div class="download-filename" title="${this.escapeHtml(download.filename)}">${this.escapeHtml(download.filename)}</div>
            <div class="download-meta">
              <span>${sizeText}</span>
              <span>${this.formatTime(download.startTime)}</span>
            </div>
          </div>
          <div class="download-actions">
            <input type="checkbox" class="download-checkbox" ${isSelected ? 'checked' : ''}
                   data-id="${download.id}">
          </div>
        </div>
        <div class="download-status">
          <div class="status-left">
            <div class="status-icon ${statusIcon}">${this.getStatusEmoji(download)}</div>
            <span class="status-text">${statusText}</span>
          </div>
          <div class="status-actions">
            ${this.createActionButtons(download)}
          </div>
        </div>
        ${download.state === 'in_progress' ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 创建操作按钮
  createActionButtons(download) {
    const buttons = [];

    if (download.state === 'in_progress' && !download.paused) {
      buttons.push(`<button class="btn btn-sm" data-action="pause" data-id="${download.id}">⏸️</button>`);
    } else if (download.state === 'in_progress' && download.paused) {
      buttons.push(`<button class="btn btn-sm" data-action="resume" data-id="${download.id}">▶️</button>`);
    } else if (download.state === 'paused') { // 兼容 paused 状态
      buttons.push(`<button class="btn btn-sm" data-action="resume" data-id="${download.id}">▶️</button>`);
    }

    if (download.state === 'in_progress' || download.state === 'paused') {
      buttons.push(`<button class="btn btn-sm" data-action="cancel" data-id="${download.id}">❌</button>`);
    }

    // 添加打开文件夹按钮（仅对已完成的下载显示）
    if (download.state === 'complete') {
      buttons.push(`<button class="btn btn-sm" data-action="openFolder" data-id="${download.id}">📁</button>`);
    }

    buttons.push(`<button class="btn btn-sm btn-danger" data-action="delete" data-id="${download.id}">🗑️</button>`);

    return buttons.join('');
  }

  // 绑定下载项目事件
  bindDownloadItemEvents() {
    // 复选框事件
    document.querySelectorAll('.download-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const downloadId = e.target.dataset.id; // ID 可能是字符串
        if (e.target.checked) {
          this.selectedDownloads.add(downloadId);
        } else {
          this.selectedDownloads.delete(downloadId);
        }
        this.updateBatchActions();
        this.updateDownloadItemSelection(downloadId, e.target.checked);
      });
    });

    // 操作按钮事件
    document.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = button.dataset.action;
        const downloadId = button.dataset.id;
        this.handleDownloadAction(action, downloadId);
      });
    });

    // 下载项目点击事件
    document.querySelectorAll('.download-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox' && !e.target.hasAttribute('data-action')) {
          const downloadId = item.dataset.id;
          this.toggleDownloadSelection(downloadId);
        }
      });
    });
  }

  // 处理下载操作
  async handleDownloadAction(action, downloadId) {
    try {
      switch (action) {
        case 'pause':
          await this.sendMessage({action: 'pauseDownload', downloadId});
          break;
        case 'resume':
          await this.sendMessage({action: 'resumeDownload', downloadId});
          break;
        case 'cancel':
          await this.sendMessage({action: 'cancelDownload', downloadId});
          break;
        case 'delete':
          this.showDeleteConfirm(downloadId);
          return;
        case 'openFolder':
          // 打开文件所在的文件夹
          const download = this.downloads.find(d => d.id == downloadId);
          if (download && download.finalDownloadId) {
            // 使用 Chrome API 在文件管理器中显示文件
            chrome.downloads.show(download.finalDownloadId);
          } else {
            this.showNotification('无法打开文件夹：文件未保存或已被删除', 'error');
          }
          return;
      }
      this.showNotification(this._('operationSuccess'));
      this.loadDownloads();
    } catch (error) {
      console.error('操作失败:', error);
      this.showNotification(this._('operationFailed', error.message), 'error');
    }
  }

  // 显示删除确认
  showDeleteConfirm(downloadId) {
    const download = this.downloads.find(d => d.id == downloadId);
    const fileName = download ? download.filename : this._('fileNotExists');
    this.showModal(
      this._('confirmDelete'),
      this._('deleteConfirmMessage', fileName),
      async () => {
        try {
          // 先从本地列表移除
          this.downloads = this.downloads.filter(d => d.id != downloadId);
          this.renderDownloads(); 

          await this.sendMessage({action: 'eraseDownload', downloadId});
          this.showNotification(this._('operationSuccess'));
        } catch (error) {
          this.loadDownloads();
          this.showNotification(this._('operationFailed', error.message), 'error');
        }
      }
    );
  }

  // 选择/取消选择下载
  toggleDownloadSelection(downloadId) {
    const checkbox = document.querySelector(`.download-checkbox[data-id="${downloadId}"]`);
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    }
  }

  // 更新下载项目选择状态
  updateDownloadItemSelection(downloadId, selected) {
    const item = document.querySelector(`.download-item[data-id="${downloadId}"]`);
    if (item) {
      item.classList.toggle('selected', selected);
    }
  }

  // 全选
  selectAll() {
    const filteredDownloads = this.filterDownloads();
    this.selectedDownloads.clear();
    
    filteredDownloads.forEach(download => {
      this.selectedDownloads.add(download.id);
    });
    
    this.renderDownloads();
    this.updateBatchActions();
  }

  // 清除选择
  clearSelection() {
    this.selectedDownloads.clear();
    this.renderDownloads();
    this.updateBatchActions();
  }

  // 更新批量操作栏
  updateBatchActions() {
    const batchActions = document.getElementById('batchActions');
    const selectedCount = document.getElementById('selectedCount');

    if (this.selectedDownloads.size > 0) {
      batchActions.style.display = 'flex';
      selectedCount.textContent = this._('selectedCount', String(this.selectedDownloads.size));
    } else {
      batchActions.style.display = 'none';
    }
  }

  // 批量暂停
  async batchPause() {
    const downloadIds = Array.from(this.selectedDownloads);
    try {
      await this.sendMessage({action: 'batchPause', downloadIds});
      this.showNotification('批量暂停成功');
      this.loadDownloads();
      this.selectedDownloads.clear();
      this.updateBatchActions();
    } catch (error) {
      this.showNotification('批量暂停失败: ' + error.message, 'error');
    }
  }

  // 批量继续
  async batchResume() {
    const downloadIds = Array.from(this.selectedDownloads);
    try {
      await this.sendMessage({action: 'batchResume', downloadIds});
      this.showNotification('批量继续成功');
      this.loadDownloads();
      this.selectedDownloads.clear();
      this.updateBatchActions();
    } catch (error) {
      this.showNotification('批量继续失败: ' + error.message, 'error');
    }
  }

  // 批量取消
  async batchCancel() {
    const downloadIds = Array.from(this.selectedDownloads);
    this.showModal(
      this._('batchCancel'),
      this._('batchCancelConfirmMessage', String(downloadIds.length)),
      async () => {
        try {
          await this.sendMessage({action: 'batchCancel', downloadIds});
          this.showNotification(this._('operationSuccess'));
          this.loadDownloads();
          this.selectedDownloads.clear();
          this.updateBatchActions();
        } catch (error) {
          this.showNotification(this._('operationFailed', error.message), 'error');
        }
      }
    );
  }

  // 批量删除
  async batchDelete() {
    const downloadIds = Array.from(this.selectedDownloads);
    if (downloadIds.length === 0) {
      this.showNotification(this._('operationFailed', '请先选择要删除的下载'), 'error');
      return;
    }

    this.showModal(
      this._('confirmBatchDelete'),
      this._('batchDeleteConfirmMessage', String(downloadIds.length)),
      async () => {
        try {
          this.downloads = this.downloads.filter(d => !downloadIds.includes(d.id));
          this.renderDownloads();

          await this.sendMessage({action: 'batchErase', downloadIds});
          this.showNotification(this._('operationSuccess'));
          this.selectedDownloads.clear();
          this.updateBatchActions();
        } catch (error) {
          this.loadDownloads();
          this.showNotification(this._('operationFailed', error.message), 'error');
        }
      }
    );
  }

  // 清除已完成
  async clearCompleted() {
    const completedDownloads = this.downloads.filter(d => d.state === 'complete');
    if (completedDownloads.length === 0) {
      this.showNotification(this._('operationFailed', '没有已完成的下载'), 'error');
      return;
    }

    this.showModal(
      this._('clearCompleted'),
      this._('clearCompletedConfirmMessage', String(completedDownloads.length)),
      async () => {
        try {
          const downloadIds = completedDownloads.map(d => d.id);

          this.downloads = this.downloads.filter(d => d.state !== 'complete');
          this.renderDownloads();

          await this.sendMessage({action: 'batchErase', downloadIds});
          this.showNotification(this._('operationSuccess'));
        } catch (error) {
          this.loadDownloads();
          this.showNotification(this._('operationFailed', error.message), 'error');
        }
      }
    );
  }

  // 导出下载
  exportDownloads() {
    const data = {
      downloads: this.downloads,
      exportTime: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `downloads_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    this.showNotification('导出成功');
  }

  // 检查所有文件存在性
  async checkAllFiles() {
    // 暂不实现
  }

  // 检查单个文件存在性
  async checkSingleFile(downloadId) {
    // 暂不实现
  }

  // 导入下载
  importDownloads() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
      this.showNotification('导入功能开发中...');
    };
    
    input.click();
  }

  // 更新统计信息
  updateStats() {
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
      lastUpdate.textContent = this._('lastUpdate', new Date().toLocaleTimeString());
    }
  }

  // 刷新
  async refresh() {
    this.loadDownloads();
  }

  // 仅同步文件状态
  async syncFileStatusOnly() {
    this.showNotification('正在同步...', 'info');
    this.loadDownloads();
  }

  // 显示设置
  showSettings() {
    this.showNotification('设置功能开发中...');
  }

  // 新增下载
  async addDownload() {
    const urlInput = document.getElementById('downloadUrlInput');
    const url = urlInput.value.trim();

    if (!url) {
        this.showNotification('请输入下载链接', 'error');
        return;
    }
    
    // 直接调用 background 的下载方法（通过创建下载事件触发拦截，或者直接发消息）
    // 为了统一逻辑，我们直接发消息给 background 让它开始内部下载
    // 但是 background 目前是通过拦截 onCreated 工作的。
    // 所以我们这里调用 chrome.downloads.download，它会触发 onCreated，然后被 background 拦截。
    
    try {
        chrome.downloads.download({url: url}, (id) => {
            if (chrome.runtime.lastError) {
                this.showNotification('创建下载失败: ' + chrome.runtime.lastError.message, 'error');
            } else {
                this.showNotification('下载已开始');
                urlInput.value = '';
            }
        });
    } catch (e) {
        this.showNotification('创建下载异常: ' + e.message, 'error');
    }
  }

  // 发送消息给后台
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  // 显示通知
  showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    const messageEl = document.getElementById('notificationMessage');
    
    if (notification && messageEl) {
      messageEl.textContent = message;
      notification.className = `notification show ${type}`;
      
      setTimeout(() => {
        this.hideNotification();
      }, 3000);
    }
  }

  // 隐藏通知
  hideNotification() {
    const notification = document.getElementById('notification');
    if (notification) {
      notification.classList.remove('show');
    }
  }

  // 显示模态框
  showModal(title, message, onConfirm) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    
    if (modal && modalTitle && modalMessage) {
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      this.modalConfirmCallback = onConfirm;
      modal.style.display = 'flex';
    }
  }

  // 隐藏模态框
  hideModal() {
    const modal = document.getElementById('modal');
    if (modal) {
      modal.style.display = 'none';
      this.modalConfirmCallback = null;
    }
  }

  // 确认模态框
  confirmModal() {
    if (this.modalConfirmCallback) {
      this.modalConfirmCallback();
    }
    this.hideModal();
  }

  // 格式化文件大小
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // 格式化速度
  formatSpeed(bytesPerSec) {
      return this.formatSize(bytesPerSec) + '/s';
  }

  // 格式化时间
  formatTime(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString();
  }

  // 获取状态图标
  getStatusIcon(download) {
    switch (download.state) {
      case 'in_progress': return 'status-active';
      case 'complete': return 'status-complete';
      case 'interrupted': return 'status-error';
      case 'paused': return 'status-paused';
      default: return '';
    }
  }

  // 获取状态文本
  getStatusText(download) {
    switch (download.state) {
      case 'in_progress': return this._('inProgress');
      case 'complete': return this._('completed');
      case 'interrupted': return this._('interrupted');
      case 'paused': return this._('paused');
      default: return download.state;
    }
  }

  // 获取状态Emoji
  getStatusEmoji(download) {
    switch (download.state) {
      case 'in_progress': return '⬇️';
      case 'complete': return '✅';
      case 'interrupted': return '❌';
      case 'paused': return '⏸️';
      default: return '❓';
    }
  }

  // 转义HTML
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const popupManager = new PopupManager();
  popupManager.init();
});