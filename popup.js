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
    this.loadDownloads();

    // 添加页面卸载事件监听器，取消文件检查定时器
    window.addEventListener('beforeunload', () => {
      console.log('popup即将关闭，取消文件检查定时器');
      this.sendMessage({action: 'cancelFileCheck'});
    });

    // 添加页面可见性变化事件监听器
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // 页面隐藏时，取消定时器
        console.log('popup隐藏，取消文件检查定时器');
        this.sendMessage({action: 'cancelFileCheck'});
      } else {
        // 页面显示时，重新启动定时器
        console.log('popup显示，重新启动文件检查定时器');
        this.sendMessage({action: 'startFileCheck'});
      }
    });

    this.startAutoRefresh();
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
      console.log('开始加载下载列表...');
      const response = await this.sendMessage({action: 'getDownloads'});
      console.log('收到响应:', response);

      if (response && response.downloads) {
        this.downloads = response.downloads;
        console.log(`成功加载 ${this.downloads.length} 个下载记录`);
        this.renderDownloads();
        this.updateStats();

        // 启动文件检查定时器（3秒后执行）
        this.sendMessage({action: 'startFileCheck'});
      } else {
        console.warn('响应格式不正确:', response);
        this.showNotification('加载下载列表失败：响应格式错误', 'error');
      }
    } catch (error) {
      console.error('加载下载列表失败:', error);
      this.showNotification(`加载下载列表失败: ${error.message}`, 'error');
    }
  }

  // 渲染下载列表
  renderDownloads() {
    const listContainer = document.getElementById('downloadsList');
    const filteredDownloads = this.filterDownloads();

    if (filteredDownloads.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📥</div>
          <p>暂无下载记录</p>
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
    const sizeText = this.formatSize(download.bytesReceived) +
      (download.totalBytes ? ` / ${this.formatSize(download.totalBytes)}` : '');

    return `
      <div class="download-item ${isSelected ? 'selected' : ''}" data-id="${download.id}">
        <div class="download-header">
          <div class="download-info">
            <div class="download-filename">${this.escapeHtml(download.filename)}</div>
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
    }

    if (download.state === 'in_progress') {
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
        const downloadId = parseInt(e.target.dataset.id);
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
        const downloadId = parseInt(button.dataset.id);
        this.handleDownloadAction(action, downloadId);
      });
    });

    // 下载项目点击事件
    document.querySelectorAll('.download-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox' && !e.target.hasAttribute('data-action')) {
          const downloadId = parseInt(item.dataset.id);
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
          await this.sendMessage({action: 'openDownloadFolder', downloadId});
          this.showNotification(this._('openingFolder'));
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
    const download = this.downloads.find(d => d.id === downloadId);
    const fileName = download.filename || this._('fileNotExists');
    this.showModal(
      this._('confirmDelete'),
      this._('deleteConfirmMessage', fileName),
      async () => {
        try {
          // 先从本地列表移除，避免显示未知文件
          const index = this.downloads.findIndex(d => d.id === downloadId);
          if (index > -1) {
            this.downloads.splice(index, 1);
            this.renderDownloads(); // 立即更新UI
          }

          // 然后通知background script删除Chrome记录
          await this.sendMessage({action: 'eraseDownload', downloadId});
          this.showNotification(this._('operationSuccess'));
        } catch (error) {
          // 如果删除失败，恢复记录
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
      // 清除选择并隐藏批量操作栏
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
      // 清除选择并隐藏批量操作栏
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
          // 清除选择并隐藏批量操作栏
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
          // 先从本地列表移除所有选中的记录
          this.downloads = this.downloads.filter(d => !downloadIds.includes(d.id));
          this.renderDownloads(); // 立即更新UI

          // 然后通知background script批量删除
          await this.sendMessage({action: 'batchErase', downloadIds});
          this.showNotification(this._('operationSuccess'));
          this.selectedDownloads.clear(); // 清空选择
          this.updateBatchActions(); // 更新批量操作栏显示
        } catch (error) {
          // 如果删除失败，恢复记录
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

          // 先从本地列表移除所有已完成的记录
          this.downloads = this.downloads.filter(d => d.state !== 'complete');
          this.renderDownloads(); // 立即更新UI

          // 然后通知background script批量删除
          await this.sendMessage({action: 'batchErase', downloadIds});
          this.showNotification(this._('operationSuccess'));
        } catch (error) {
          // 如果删除失败，恢复记录
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
    try {
      this.showNotification('开始检查文件存在性...');
      await this.sendMessage({action: 'checkAllFiles'});
      this.showNotification('文件检查已开始，请稍候');
      // 3秒后刷新列表，显示检查结果
      setTimeout(() => {
        this.loadDownloads();
      }, 3000);
    } catch (error) {
      console.error('检查所有文件失败:', error);
      this.showNotification('检查失败: ' + error.message, 'error');
    }
  }

  // 检查单个文件存在性
  async checkSingleFile(downloadId) {
    try {
      const response = await this.sendMessage({action: 'checkFileExists', downloadId});
      if (response.success) {
        if (response.exists) {
          this.showNotification('文件存在');
        } else {
          this.showNotification('文件不存在，已标记');
          // 重新加载以显示更新后的状态
          this.loadDownloads();
        }
      } else {
        this.showNotification('检查失败: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('检查文件失败:', error);
      this.showNotification('检查失败: ' + error.message, 'error');
    }
  }

  // 导入下载
  importDownloads() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.downloads && Array.isArray(data.downloads)) {
            this.showNotification('导入功能开发中...');
          } else {
            this.showNotification('文件格式不正确', 'error');
          }
        } catch (error) {
          this.showNotification('文件解析失败', 'error');
        }
      };
      reader.readAsText(file);
    };
    
    input.click();
  }

  // 更新统计信息
  updateStats() {
    // 更新最后更新时间
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
      lastUpdate.textContent = this._('lastUpdate', new Date().toLocaleTimeString());
    }
  }

  // 刷新
  async refresh() {
    this.loadDownloads();
    // 同步文件状态
    try {
      await this.sendMessage({action: 'syncFileStatus'});
      console.log('文件状态同步完成');
    } catch (error) {
      console.error('文件状态同步失败:', error);
    }
  }

  // 仅同步文件状态（不刷新列表）
  async syncFileStatusOnly() {
    this.showNotification('正在检查文件状态...', 'info');
    try {
      await this.sendMessage({action: 'syncFileStatus'});
      this.showNotification('文件状态同步完成', 'success');
      this.loadDownloads(); // 刷新列表显示最新状态
    } catch (error) {
      console.error('文件状态同步失败:', error);
      this.showNotification('文件状态同步失败: ' + error.message, 'error');
    }
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
      this.showNotification('请输入下载地址', 'error');
      return;
    }

    // 验证URL格式
    if (!this.isValidUrl(url)) {
      this.showNotification('请输入有效的下载地址', 'error');
      return;
    }

    try {
      console.log('开始下载:', url);
      const response = await this.sendMessage({
        action: 'createDownload',
        url: url
      });

      if (response && response.success) {
        this.showNotification('下载已开始', 'success');
        urlInput.value = '';
        this.loadDownloads(); // 刷新列表
      } else {
        throw new Error(response?.error || '下载失败');
      }
    } catch (error) {
      console.error('添加下载失败:', error);
      this.showNotification('添加下载失败: ' + error.message, 'error');
    }
  }

  // 验证URL格式
  isValidUrl(url) {
    // 支持的协议
    const protocols = ['http://', 'https://', 'ftp://', 'sftp://', 'magnet:', 'ed2k:'];
    const isProtocolValid = protocols.some(protocol => url.toLowerCase().startsWith(protocol));

    if (!isProtocolValid) {
      return false;
    }

    // 基本URL格式验证
    try {
      if (url.startsWith('magnet:') || url.startsWith('ed2k:')) {
        // 磁力链接和电驴链接特殊验证
        return url.length > 10;
      } else {
        // 常规URL验证
        new URL(url);
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  // 开始自动刷新
  startAutoRefresh() {
    setInterval(() => {
      this.loadDownloads();
    }, 5000); // 每5秒刷新一次
  }

  // 发送消息到background script
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      console.log('发送消息到background:', message);
      
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Chrome运行时错误:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message || 'Chrome运行时错误'));
        } else if (response && response.success) {
          console.log('收到成功响应:', response);
          resolve(response);
        } else if (response && !response.success) {
          console.error('操作失败:', response.error);
          reject(new Error(response.error || '操作失败'));
        } else {
          console.warn('未知响应格式:', response);
          reject(new Error('未知响应格式'));
        }
      });
    });
  }

  // 显示模态框
  showModal(title, message, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('modal').style.display = 'flex';
    
    // 保存确认回调
    document.getElementById('modalConfirm').onclick = () => {
      this.hideModal();
      if (onConfirm) onConfirm();
    };
  }

  // 隐藏模态框
  hideModal() {
    document.getElementById('modal').style.display = 'none';
  }

  // 确认模态框
  confirmModal() {
    this.hideModal();
  }

  // 显示通知
  showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    const messageElement = document.getElementById('notificationMessage');
    
    messageElement.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
      this.hideNotification();
    }, 3000);
  }

  // 隐藏通知
  hideNotification() {
    document.getElementById('notification').style.display = 'none';
  }

  // 工具函数
  getStatusIcon(download) {
    // 检查文件不存在
    if (download.fileNotExists) {
      return 'status-not-exists';
    }
    if (download.paused) return 'status-paused';
    switch (download.state) {
      case 'in_progress': return 'status-in-progress';
      case 'complete': return 'status-complete';
      case 'interrupted': return 'status-interrupted';
      default: return 'status-in-progress';
    }
  }

  getStatusText(download) {
    // 检查文件不存在
    if (download.fileNotExists) {
      return this._('fileNotExists');
    }
    if (download.paused) return this._('statusPaused');
    switch (download.state) {
      case 'in_progress': return this._('statusInProgress');
      case 'complete': return this._('statusComplete');
      case 'interrupted': return this._('statusInterrupted');
      default: return this._('statusInProgress');
    }
  }

  getStatusEmoji(download) {
    // 检查文件不存在
    if (download.fileNotExists) {
      return '❌';
    }
    if (download.paused) return '⏸️';
    switch (download.state) {
      case 'in_progress': return '⬇️';
      case 'complete': return '✅';
      case 'interrupted': return '❌';
      default: return '⬇️';
    }
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    
    return date.toLocaleDateString();
  }

  formatFileType(mimeType) {
    if (!mimeType) return '未知类型';
    
    const types = {
      'application/pdf': 'PDF',
      'application/msword': 'Word',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
      'application/vnd.ms-excel': 'Excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'image/jpeg': '图片',
      'image/png': '图片',
      'image/gif': '图片',
      'video/mp4': '视频',
      'video/avi': '视频',
      'audio/mp3': '音频',
      'audio/wav': '音频'
    };
    
    return types[mimeType] || mimeType.split('/')[1]?.toUpperCase() || '未知';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化弹出界面管理器
document.addEventListener('DOMContentLoaded', async () => {
  const popupManager = new PopupManager();
  await popupManager.init();
});