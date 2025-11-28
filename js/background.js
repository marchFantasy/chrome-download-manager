// 智能下载管理器 - 后台脚本
// 处理下载事件和管理下载状态

// 引入核心下载器

importScripts('/js/core/downloader.js');

/* global Downloader */

// ============================================================================
// 全局变量和顶层事件监听器
// ============================================================================
// 说明: Service Worker 在休眠后唤醒时,需要立即能够拦截下载事件
// 因此必须在脚本顶层立即注册事件监听器,而不是在异步 init() 方法中注册

let downloadManager = null; // 全局下载管理器实例引用

// 立即注册下载创建事件监听器
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (downloadManager) {
    downloadManager.onDownloadCreated(downloadItem);
  } else {
    console.warn(
      'DownloadManager 尚未初始化,下载事件被忽略:',
      downloadItem.url
    );
  }
});

// 立即注册下载状态变化监听器
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadManager) {
    downloadManager.onDownloadChanged(downloadDelta);
  }
});

// 立即注册下载删除监听器
chrome.downloads.onErased.addListener((downloadId) => {
  if (downloadManager) {
    downloadManager.onDownloadErased(downloadId);
  }
});

// 监听文件名确定事件（用于获取 Blob URL 的真实文件名）
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (downloadManager) {
    // 返回 true 表示异步处理
    return downloadManager.handleDeterminingFilename(downloadItem, suggest);
  }
  return false;
});

console.log('下载事件监听器已在顶层注册 (Service Worker 唤醒时立即可用)');

// ============================================================================
// DownloadManager 类定义
// ============================================================================

class DownloadManager {
  constructor() {
    this.downloads = new Map(); // 存储下载信息 (包含 Downloader 实例)
    this.downloadCount = 0; // 活跃下载数量
    this.animationInterval = null;
    this.fileCheckTimer = null; // 文件检查定时器
    this.internalDownloadIds = new Set(); // 追踪由本扩展发起的下载ID（用于最终保存文件）
    this.largeFileUrls = new Set(); // 追踪大文件的 URL，避免重复拦截
    this.internalBlobUrls = new Set(); // 追踪扩展自己生成的 Blob/Data URL，避免拦截内部保存任务
    this.pendingBlobDownloads = new Set(); // 追踪等待文件名确定的 Blob 下载
    this.tempDownloads = new Set(); // 追踪需要清理的临时 Blob 下载
    this.isReady = false; // 标记初始化是否完成
    this.isFirstRun = false; // 标记是否是首次运行（区分首次启动和 Service Worker 唤醒）
    this.initStartTime = Date.now(); // 记录初始化开始时间
    this.INIT_GRACE_PERIOD = 3000; // 初始化保护期：3秒，避免拦截 Chrome 自动恢复的下载
    this.init();
  }

  async init() {
    console.log('DownloadManager 初始化开始...');

    // 检查权限
    if (!chrome.downloads) {
      console.error('chrome.downloads API 不可用');
      return;
    }

    try {
      // 检查是否是首次运行（使用 session storage 区分首次启动和 Service Worker 唤醒）
      const session = await chrome.storage.session.get('initialized');
      this.isFirstRun = !session.initialized;

      if (this.isFirstRun) {
        console.log('首次运行检测: 这是扩展首次启动或更新后的首次运行');
        console.log(
          '初始化保护期已启用，将在 3 秒内忽略下载事件（避免拦截 Chrome 自动恢复的下载）'
        );
        await chrome.storage.session.set({ initialized: true });
      } else {
        console.log('Service Worker 唤醒检测: 跳过初始化保护期，立即拦截下载');
      }

      // 注意: 事件监听器已在脚本顶层注册，无需在此重复注册

      // 禁用默认下载栏
      this.disableDownloadShelf();

      // 更新徽章
      this.updateBadge();
      this.updateBadgeColor('#4CAF50');

      // 等待加载已存在的下载（重要：必须等待完成）
      await this.loadExistingDownloads();

      this.isReady = true; // 标记初始化完成
      console.log('DownloadManager 初始化完成');
    } catch (error) {
      console.error('DownloadManager 初始化失败:', error);
      this.isReady = true; // 即使失败也标记为完成，避免阻塞
    }
  }

  // 更新图标badge
  updateBadge() {
    if (this.downloadCount > 0) {
      chrome.action.setBadgeText({ text: String(this.downloadCount) });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }

  // 设置badge颜色
  updateBadgeColor(color) {
    chrome.action.setBadgeBackgroundColor({ color: color });
  }

  // 禁用Chrome默认下载栏
  disableDownloadShelf() {
    try {
      // 尝试禁用下载栏
      if (chrome.downloads.setShelfEnabled) {
        chrome.downloads.setShelfEnabled(false);
        console.log('下载管理器: 已禁用Chrome默认下载栏');
      }
    } catch (error) {
      console.log('下载管理器: 无法禁用下载栏 (权限不足)', error);
    }
  }

  // 启用Chrome默认下载栏
  enableDownloadShelf() {
    try {
      if (chrome.downloads.setShelfEnabled) {
        chrome.downloads.setShelfEnabled(true);
        console.log('下载管理器: 已启用Chrome默认下载栏');
      }
    } catch (error) {
      console.error('启用下载栏失败:', error);
    }
  }

  // 显示下载动画
  showDownloadAnimation(filename) {
    // 显示下载数量
    this.downloadCount++;
    this.updateBadge();

    // 颜色动画效果
    this.animateBadge();

    // 显示下载提示动画
    this.showDownloadNotification(filename);

    // 5秒后停止动画（如果有的话）
    setTimeout(() => {
      this.downloadCount = Math.max(0, this.downloadCount - 1);
      this.updateBadge();
      if (this.downloadCount === 0) {
        this.updateBadgeColor('#4CAF50');
      }
    }, 5000);
  }

  // 颜色动画效果
  animateBadge() {
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#F44336', '#9C27B0'];
    let index = 0;

    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }

    this.animationInterval = setInterval(() => {
      this.updateBadgeColor(colors[index]);
      index = (index + 1) % colors.length;
    }, 300);

    // 3秒后停止动画
    setTimeout(() => {
      if (this.animationInterval) {
        clearInterval(this.animationInterval);
        this.animationInterval = null;
        this.updateBadgeColor('#4CAF50'); // 恢复绿色
      }
    }, 3000);
  }

  // 完成闪烁提示
  flashBadgeForCompletion() {
    const originalColor = '#4CAF50';
    let isOn = false;

    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }

    this.animationInterval = setInterval(() => {
      isOn = !isOn;
      if (isOn) {
        this.updateBadgeColor('#FFD700'); // 金色
      } else {
        this.updateBadgeColor(originalColor);
      }
    }, 400);

    // 2秒后停止闪烁
    setTimeout(() => {
      if (this.animationInterval) {
        clearInterval(this.animationInterval);
        this.animationInterval = null;
        this.updateBadgeColor(originalColor);
      }
    }, 2000);
  }

  // 显示下载提示通知
  showDownloadNotification(filename) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: '📥 新下载',
      message: `${filename}`,
      priority: 1,
    });
  }

  // 删除下载记录（包括本地文件）
  eraseDownload(downloadId) {
    const downloadInfo = this.downloads.get(downloadId);

    if (!downloadInfo) {
      return Promise.reject(new Error('下载记录不存在'));
    }

    // 先删除存储中的记录
    const storageKey = `download_${downloadId}`;

    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(storageKey, () => {
        if (chrome.runtime.lastError) {
          console.error('删除存储记录失败:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // 从内存中删除
        this.downloads.delete(downloadId);
        console.log(`已删除下载记录: ${downloadId}`);

        // 如果有关联的 Chrome 下载 ID，尝试删除文件
        if (downloadInfo.finalDownloadId) {
          chrome.downloads.removeFile(downloadInfo.finalDownloadId, () => {
            if (chrome.runtime.lastError) {
              console.warn(
                '删除文件失败（可能已被删除）:',
                chrome.runtime.lastError
              );
            }
            // 删除 Chrome 下载记录
            chrome.downloads.erase({ id: downloadInfo.finalDownloadId }, () => {
              if (chrome.runtime.lastError) {
                console.warn('删除 Chrome 记录失败:', chrome.runtime.lastError);
              }
              resolve();
            });
          });
        } else {
          resolve();
        }
      });
    });
  }

  // 启动文件检查定时器（3秒后执行，可取消）
  startFileCheckTimer() {
    // 先取消已有的定时器
    this.cancelFileCheckTimer();

    console.log('启动文件检查定时器（3秒后执行）...');
    this.fileCheckTimer = setTimeout(() => {
      console.log('开始文件存在性检查...');
      this.batchCheckFiles();
      this.fileCheckTimer = null; // 清除引用
    }, 3000);
  }

  // 取消文件检查定时器
  cancelFileCheckTimer() {
    if (this.fileCheckTimer) {
      console.log('取消文件检查定时器');
      clearTimeout(this.fileCheckTimer);
      this.fileCheckTimer = null;
    }
  }

  // 批量删除下载（包含同步删除磁盘文件）
  async batchErase(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.eraseDownload(id);
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }
    return results;
  }

  // 检查文件是否存在（仅限HTTP/HTTPS）
  async checkFileExists(downloadItem) {
    // 对于内部下载，如果已完成，我们假设文件存在（除非用户手动删除了）
    // 这里简化处理，只对Chrome原生下载做检查，或者后续实现文件系统访问
    return true;
  }

  // 批量检查文件存在性
  async batchCheckFiles() {
    // 暂不实现复杂的批量检查，因为现在主要依赖内部状态
    console.log('批量检查文件存在性 (跳过)');
  }

  // 核心：开始内部下载
  startInternalDownload(url, filename) {
    const downloader = new Downloader(url, filename);

    const downloadInfo = {
      id: downloader.id, // 使用 Downloader 生成的 ID
      url: url,
      filename: filename,
      state: 'in_progress',
      bytesReceived: 0,
      totalBytes: 0,
      startTime: Date.now(),
      endTime: null,
      paused: false,
      error: null,
      speed: 0,
      downloader: downloader, // 引用实例，不保存到 storage
    };

    // 绑定回调
    downloader.onProgress = (data) => {
      downloadInfo.bytesReceived = data.bytesReceived;
      downloadInfo.totalBytes = data.totalBytes;
      downloadInfo.speed = data.speed;
      downloadInfo.state = data.state;

      // 实时保存状态（可选：为了性能可以减少保存频率）
      // this.saveDownloadInfo(downloadInfo);

      // 发送进度更新给 popup (如果打开)
      // 注意：只发送必要的数据，不包含 downloader 实例和大数据对象
      chrome.runtime
        .sendMessage({
          action: 'downloadProgress',
          data: {
            id: downloadInfo.id,
            filename: downloadInfo.filename,
            url: downloadInfo.url,
            state: downloadInfo.state,
            bytesReceived: downloadInfo.bytesReceived,
            totalBytes: downloadInfo.totalBytes,
            speed: downloadInfo.speed,
            startTime: downloadInfo.startTime,
          },
        })
        .catch(() => {});
    };

    downloader.onComplete = async (data) => {
      downloadInfo.endTime = Date.now();
      const fileSize = data.blob.size;

      console.log(`内部下载完成: ${filename}, 大小: ${fileSize} 字节`);

      // 对于大文件（> 50MB），Data URL 方案性能太差
      // 改为直接使用原始 URL 让 Chrome 下载
      const SIZE_LIMIT = 50 * 1024 * 1024; // 50MB

      if (fileSize > SIZE_LIMIT) {
        console.log(
          `文件过大 (${(fileSize / 1024 / 1024).toFixed(2)} MB)，使用原生下载`
        );

        // 先添加到 largeFileUrls，防止被拦截
        this.largeFileUrls.add(downloadInfo.url);

        // 直接使用原始 URL 创建下载，不拦截
        chrome.downloads.download(
          {
            url: downloadInfo.url,
            filename: filename,
            saveAs: false,
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('创建原生下载失败:', chrome.runtime.lastError);
              downloadInfo.error = chrome.runtime.lastError.message;
              downloadInfo.state = 'interrupted';
              this.saveDownloadInfo(downloadInfo);
              this.showNotification('下载失败', `❌ ${filename}`);
              // 失败时移除 URL
              this.largeFileUrls.delete(downloadInfo.url);
            } else {
              console.log(`已创建原生下载任务，Chrome ID: ${downloadId}`);
              this.internalDownloadIds.add(downloadId);
              downloadInfo.finalDownloadId = downloadId;
              downloadInfo.state = 'saving';
              this.saveDownloadInfo(downloadInfo);
              // 完成通知由 onDownloadChanged 处理
            }
          }
        );
        return;
      }

      // 小文件使用 Data URL 方案
      console.log(`文件较小，使用 Data URL 保存`);

      try {
        const reader = new FileReader();

        reader.onload = () => {
          const dataUrl = reader.result;

          // 标记这是扩展自己生成的下载,避免被拦截
          this.internalBlobUrls.add(dataUrl);

          chrome.downloads.download(
            {
              url: dataUrl,
              filename: filename,
              saveAs: false,
            },
            (downloadId) => {
              // 用完即删,防止内存泄漏
              this.internalBlobUrls.delete(dataUrl);

              if (chrome.runtime.lastError) {
                console.error('保存文件失败:', chrome.runtime.lastError);
                downloadInfo.error = chrome.runtime.lastError.message;
                downloadInfo.state = 'interrupted';
                this.saveDownloadInfo(downloadInfo);
                this.showNotification('保存失败', `❌ ${filename}`);
              } else {
                console.log(`文件保存任务已创建，Chrome ID: ${downloadId}`);
                this.internalDownloadIds.add(downloadId);
                downloadInfo.finalDownloadId = downloadId;
                downloadInfo.state = 'saving';
                this.saveDownloadInfo(downloadInfo);
              }
            }
          );
        };

        reader.onerror = () => {
          console.error('Blob 转换失败:', reader.error);
          downloadInfo.error = 'Blob 转换失败';
          downloadInfo.state = 'interrupted';
          this.saveDownloadInfo(downloadInfo);
          this.showNotification('转换失败', `❌ ${filename}`);
        };

        reader.readAsDataURL(data.blob);
      } catch (e) {
        console.error('保存流程异常:', e);
        downloadInfo.error = e.message;
        downloadInfo.state = 'interrupted';
        this.saveDownloadInfo(downloadInfo);
        this.showNotification('保存异常', `❌ ${filename}`);
      }
    };

    downloader.onError = (data) => {
      const errorTime = Date.now();
      const duration = errorTime - downloadInfo.startTime;

      console.error('========== 下载错误 (background.js) ==========');
      console.error(`文件名: ${filename}`);
      console.error(`URL: ${url}`);
      console.error(`错误信息: ${data.error}`);
      console.error(`中断原因: ${data.interruptReason || '未知'}`);
      console.error(`耗时: ${duration}ms (${(duration / 1000).toFixed(2)}秒)`);
      console.error(
        `已下载: ${data.bytesReceived || 0} / ${data.totalBytes || 0} bytes`
      );
      console.error(`错误发生时间: ${new Date(errorTime).toISOString()}`);
      console.error('==========================================');

      downloadInfo.state = 'interrupted';
      downloadInfo.error = data.error;
      downloadInfo.interruptReason = data.interruptReason;
      downloadInfo.endTime = errorTime;
      this.saveDownloadInfo(downloadInfo);
      this.showNotification('下载失败', `❌ ${filename}\n原因: ${data.error}`);
    };

    // 存储并开始
    this.downloads.set(downloadInfo.id, downloadInfo);
    this.saveDownloadInfo(downloadInfo);

    downloader.start();
    this.showDownloadAnimation(filename);
  }

  // 下载创建事件
  onDownloadCreated(downloadItem) {
    console.log('下载创建事件:', downloadItem);

    // 0. 初始化保护期：只在首次运行时启用,避免拦截 Chrome 自动恢复的下载
    // Service Worker 唤醒时跳过此检查,立即拦截下载
    if (this.isFirstRun) {
      const timeSinceInit = Date.now() - this.initStartTime;
      if (timeSinceInit < this.INIT_GRACE_PERIOD) {
        console.log(
          `首次运行保护期内（${timeSinceInit}ms < ${this.INIT_GRACE_PERIOD}ms），忽略下载事件:`,
          downloadItem.url
        );
        return;
      }
    }

    // 1. 检查是否是我们自己发起的最终保存任务
    if (this.internalDownloadIds.has(downloadItem.id)) {
      console.log('检测到内部保存任务，放行:', downloadItem.id);
      this.internalDownloadIds.delete(downloadItem.id); // 用完即删
      return;
    }

    // 2. 检查是否是大文件重新下载（避免重复拦截）
    if (this.largeFileUrls.has(downloadItem.url)) {
      console.log('检测到大文件重新下载任务，放行:', downloadItem.url);
      // 下载开始后可以从 Set 中移除
      this.largeFileUrls.delete(downloadItem.url);
      return;
    }

    // 3. Blob/Data URL 检查
    if (
      downloadItem.url.startsWith('blob:') ||
      downloadItem.url.startsWith('data:')
    ) {
      // 检查是否是扩展内部生成的（白名单）
      if (this.internalBlobUrls.has(downloadItem.url)) {
        console.log(
          '检测到扩展内部保存任务，放行:',
          downloadItem.url.substring(0, 50) + '...'
        );
        this.internalBlobUrls.delete(downloadItem.url);
        return;
      }

      // 对于外部 Blob URL，推迟拦截，等待 onDeterminingFilename 获取真实文件名
      console.log(
        '检测到外部 Blob/Data URL，推迟拦截以获取文件名:',
        downloadItem.url
      );
      this.pendingBlobDownloads.add(downloadItem.id);
      return;
    }

    // ============================================================
    // 4. 拦截普通下载 (HTTP/HTTPS)
    // ============================================================
    console.log('拦截到外部下载，准备接管:', downloadItem.url);
    console.log('downloadItem 详细信息:', {
      id: downloadItem.id,
      url: downloadItem.url,
      filename: downloadItem.filename,
      mime: downloadItem.mime,
      fileSize: downloadItem.fileSize,
    });

    // 提取文件名
    // 对于 HTTP/HTTPS URL，使用现有的提取逻辑
    const filename =
      this.extractBaseFilename(downloadItem.filename) ||
      this.extractFilename(downloadItem.url);

    console.log('========== 拦截下载详情 ==========');
    console.log(`时间: ${new Date().toISOString()}`);
    console.log(`文件名: ${filename}`);
    console.log(`URL: ${downloadItem.url}`);
    console.log(`原始下载ID: ${downloadItem.id}`);
    console.log(`MIME类型: ${downloadItem.mime || '未知'}`);
    console.log('====================================');

    // 取消原生下载
    chrome.downloads.cancel(downloadItem.id, () => {
      if (chrome.runtime.lastError) {
        console.warn('取消原生下载失败:', chrome.runtime.lastError);
      } else {
        console.log('原生下载已取消');
        // 删除原生记录，保持历史干净
        chrome.downloads.erase({ id: downloadItem.id });
      }
    });

    // 启动内部下载
    this.startInternalDownload(downloadItem.url, filename);
  }

  // 下载状态变化事件
  onDownloadChanged(downloadDelta) {
    // 我们主要关注内部下载的状态，这里只处理 Chrome 原生下载的变化（如果是我们关联的）
    // 比如用户在浏览器下载页取消了最终的保存任务

    // 查找关联的内部下载
    for (const [id, info] of this.downloads.entries()) {
      if (info.finalDownloadId === downloadDelta.id) {
        // 检查最终保存任务的状态变化
        if (downloadDelta.state) {
          if (downloadDelta.state.current === 'complete') {
            // 文件真正保存完成
            console.log(`文件保存完成: ${info.filename}`);
            info.state = 'complete';
            this.saveDownloadInfo(info);
            this.showNotification('下载完成', `✅ ${info.filename}`);
            this.flashBadgeForCompletion();
          } else if (downloadDelta.state.current === 'interrupted') {
            console.warn('最终保存任务被中断');
            info.state = 'interrupted';
            info.error = '文件保存被中断';
            this.saveDownloadInfo(info);
            this.showNotification('保存中断', `❌ ${info.filename}`);
          }
        }
      }
    }

    // 检查是否是临时 Blob 下载（重命名策略）
    if (this.tempDownloads.has(downloadDelta.id)) {
      if (downloadDelta.state && downloadDelta.state.current === 'complete') {
        console.log('临时 Blob 下载完成，清理文件:', downloadDelta.id);
        // 删除文件
        chrome.downloads.removeFile(downloadDelta.id, () => {
          if (chrome.runtime.lastError) {
            console.warn('清理临时文件失败:', chrome.runtime.lastError);
          }
          // 删除记录
          chrome.downloads.erase({ id: downloadDelta.id });
        });
        this.tempDownloads.delete(downloadDelta.id);
      }
    }
  }

  // 下载删除事件
  onDownloadErased(downloadId) {
    // 忽略
  }

  // 处理文件名确定事件
  handleDeterminingFilename(downloadItem, suggest) {
    // 检查是否是等待处理的 Blob 下载
    if (this.pendingBlobDownloads.has(downloadItem.id)) {
      console.log(
        'onDeterminingFilename 捕获到等待的 Blob 下载:',
        downloadItem.id
      );
      console.log('建议文件名:', downloadItem.filename);

      this.pendingBlobDownloads.delete(downloadItem.id);

      // 1. 获取文件名
      let filename = downloadItem.filename;

      // 如果文件名为空，尝试使用 MIME 类型推断（作为后备）
      if (!filename) {
        const timestamp = Date.now();
        const mimeToExt = {
          'application/json': 'json',
          'application/x-yaml': 'yaml',
          'text/yaml': 'yaml',
          'application/yaml': 'yaml',
          'text/csv': 'csv',
          'text/plain': 'txt',
          'application/xml': 'xml',
          'text/xml': 'xml',
          'application/pdf': 'pdf',
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/gif': 'gif',
          'image/svg+xml': 'svg',
        };
        const ext = mimeToExt[downloadItem.mime] || 'bin';
        filename = `download_${timestamp}.${ext}`;
        console.log(`仍无文件名，使用 MIME 推断: ${filename}`);
      } else {
        // 提取基础文件名（去掉路径）
        const normalizedPath = filename.replace(/\\/g, '/');
        filename = normalizedPath.substring(
          normalizedPath.lastIndexOf('/') + 1
        );
      }

      // 2. 启动内部下载 (使用真实文件名)
      console.log('使用获取到的文件名启动内部下载:', filename);
      this.startInternalDownload(downloadItem.url, filename);

      // 3. 处理原生下载：重命名为临时文件，稍后删除
      // 避免直接 cancel 导致 "Download must be in progress" 报错
      // 同时也避免文件名冲突（原生下载占用真实文件名）
      const tempFilename = `chrome_download_manager_tmp/${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.tmp`;
      console.log('原生 Blob 下载重命名为临时文件:', tempFilename);

      this.tempDownloads.add(downloadItem.id);

      // 4. 建议使用临时文件名
      // 注意：这里不需要调用 cancel，也不需要 pause，直接 suggest 即可
      // 浏览器会等待 suggest 被调用
      try {
        suggest({ filename: tempFilename, conflictAction: 'overwrite' });
        console.log('已建议临时文件名，原生下载将继续但稍后被清理');
      } catch (e) {
        console.error('调用 suggest 失败:', e);
      }
      return true;
    }

    // 对于其他下载，不干预
    return false;
  }

  // 提取文件名（从完整路径中获取纯文件名+扩展名）
  extractFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);

      // 如果文件名为空或只是查询参数，尝试从 URL 的其他部分提取
      if (!filename || filename.includes('?')) {
        filename =
          pathname
            .split('/')
            .filter((p) => p)
            .pop() || '';
      }

      // 移除查询参数
      filename = filename.split('?')[0];

      // URL 解码文件名（处理中文等特殊字符）
      try {
        filename = decodeURIComponent(filename);
      } catch (decodeError) {
        console.warn('文件名 URL 解码失败，使用原始文件名:', decodeError);
      }

      // 如果仍然没有文件名，使用域名 + 时间戳
      if (!filename) {
        const hostname = urlObj.hostname.replace(/\./g, '_');
        filename = `${hostname}_${Date.now()}`;
      }

      // 确保有扩展名，如果没有则添加默认扩展名
      if (!filename.includes('.')) {
        filename += '.download';
      }

      return filename;
    } catch (e) {
      console.error('提取文件名失败:', e);
      return `download_${Date.now()}.download`;
    }
  }

  // 从完整文件路径中提取纯文件名
  extractBaseFilename(filePath) {
    try {
      if (!filePath) return null;
      // Windows 路径使用 \，Unix/Linux 使用 /
      const normalizedPath = filePath.replace(/\\/g, '/');
      let filename = normalizedPath.substring(
        normalizedPath.lastIndexOf('/') + 1
      );

      // 如果提取出的文件名为空或无效，返回 null
      if (!filename || filename.trim() === '') {
        return null;
      }

      // URL 解码文件名（处理中文等特殊字符）
      try {
        filename = decodeURIComponent(filename);
      } catch (decodeError) {
        console.warn('文件名 URL 解码失败，使用原始文件名:', decodeError);
      }

      return filename;
    } catch (e) {
      return null;
    }
  }

  // 获取所有下载信息（按时间倒序，最新的在最上面）
  getAllDownloads() {
    const downloads = Array.from(this.downloads.values()).map((d) => {
      // 移除 downloader 实例和大数据对象，只返回必要数据
      const { downloader, blob, dataUrl, ...rest } = d;
      return rest;
    });

    // 按开始时间倒序排列，最新的在最上面
    downloads.sort((a, b) => {
      const timeA = b.endTime || b.startTime || 0;
      const timeB = a.endTime || a.startTime || 0;
      return timeA - timeB;
    });

    console.log(`getAllDownloads: 返回 ${downloads.length} 个下载记录`);
    return downloads;
  }

  // 暂停下载
  pauseDownload(downloadId) {
    return new Promise((resolve, reject) => {
      const downloadInfo = this.downloads.get(downloadId);
      if (downloadInfo && downloadInfo.downloader) {
        downloadInfo.downloader.pause();
        downloadInfo.paused = true;
        downloadInfo.state = 'paused';
        this.saveDownloadInfo(downloadInfo);
        resolve();
      } else {
        reject(new Error('下载任务不存在或已完成'));
      }
    });
  }

  // 继续下载
  resumeDownload(downloadId) {
    return new Promise((resolve, reject) => {
      const downloadInfo = this.downloads.get(downloadId);
      if (downloadInfo && downloadInfo.downloader) {
        downloadInfo.downloader.resume();
        downloadInfo.paused = false;
        downloadInfo.state = 'in_progress';
        this.saveDownloadInfo(downloadInfo);
        resolve();
      } else {
        // 如果是持久化恢复（重启浏览器后），需要重新创建 Downloader
        // 这里暂未实现完全的持久化恢复
        reject(new Error('下载任务无法恢复'));
      }
    });
  }

  // 取消下载
  cancelDownload(downloadId) {
    return new Promise((resolve, reject) => {
      const downloadInfo = this.downloads.get(downloadId);
      if (downloadInfo && downloadInfo.downloader) {
        downloadInfo.downloader.cancel();
        downloadInfo.state = 'interrupted';
        this.saveDownloadInfo(downloadInfo);
        resolve();
      } else {
        reject(new Error('下载任务不存在'));
      }
    });
  }

  // 显示通知
  showNotification(title, message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: title,
      message: message,
    });
  }

  // 保存下载信息到存储
  saveDownloadInfo(downloadInfo) {
    // 移除不能序列化的对象
    const { downloader, blob, dataUrl, ...serializableInfo } = downloadInfo;

    const key = `download_${downloadInfo.id}`;
    chrome.storage.local.set({ [key]: serializableInfo }, () => {
      if (chrome.runtime.lastError) {
        console.error(
          `保存下载信息失败 (ID: ${downloadInfo.id}):`,
          chrome.runtime.lastError
        );
      } else {
        console.log(
          `下载信息已保存到存储 (ID: ${downloadInfo.id}, 状态: ${serializableInfo.state})`
        );
      }
    });
  }

  // 从存储中删除下载信息
  removeDownloadInfo(downloadId) {
    chrome.storage.local.remove([`download_${downloadId}`]);
  }

  // 加载已存在的下载
  loadExistingDownloads() {
    console.log('开始加载已存在的下载...');
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        if (chrome.runtime.lastError) {
          console.error('加载存储数据失败:', chrome.runtime.lastError);
          resolve(); // 即使失败也要 resolve，不阻塞初始化
          return;
        }

        const MAX_AGE_DAYS = 7; // 保留最近 7 天的记录
        const now = Date.now();
        const toRemove = [];
        let count = 0;

        for (const [key, value] of Object.entries(items)) {
          if (key.startsWith('download_') && value) {
            // 检查是否过期（只清理已完成或已中断的记录）
            const age = now - (value.endTime || value.startTime || 0);
            const ageDays = age / (1000 * 60 * 60 * 24);

            if (
              ageDays > MAX_AGE_DAYS &&
              (value.state === 'complete' || value.state === 'interrupted')
            ) {
              console.log(
                `清理过期记录: ${value.filename} (${ageDays.toFixed(1)} 天前)`
              );
              toRemove.push(key);
              continue;
            }

            // 恢复时，所有未完成的任务标记为中断（因为没有实现持久化断点续传）
            if (
              value.state === 'in_progress' ||
              value.state === 'paused' ||
              value.state === 'saving'
            ) {
              value.state = 'interrupted';
              value.error = '会话已过期';
            }

            this.downloads.set(value.id, value);
            count++;
          }
        }

        // 批量删除过期记录
        if (toRemove.length > 0) {
          chrome.storage.local.remove(toRemove, () => {
            if (chrome.runtime.lastError) {
              console.error('清理过期记录失败:', chrome.runtime.lastError);
            } else {
              console.log(`已清理 ${toRemove.length} 个过期下载记录`);
            }
          });
        }

        console.log(`已加载 ${count} 个下载记录`);
        resolve();
      });
    });
  }

  // 批量操作
  async batchPause(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.pauseDownload(id);
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }
    return results;
  }

  async batchResume(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.resumeDownload(id);
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }
    return results;
  }

  async batchCancel(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.cancelDownload(id);
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }
    return results;
  }
}

// 初始化下载管理器 (赋值给全局变量,已在顶层声明)
downloadManager = new DownloadManager();

// 处理来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request.action);

  // 异步处理消息
  (async () => {
    try {
      switch (request.action) {
        case 'ping':
          sendResponse({
            success: true,
            message: 'Background script is running',
          });
          break;

        case 'getDownloads':
          try {
            // 等待初始化完成
            while (!downloadManager.isReady) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const downloads = downloadManager.getAllDownloads();
            sendResponse({ success: true, downloads: downloads });
          } catch (error) {
            console.error('获取下载列表失败:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'pauseDownload':
          downloadManager
            .pauseDownload(request.downloadId)
            .then(() => sendResponse({ success: true }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'resumeDownload':
          downloadManager
            .resumeDownload(request.downloadId)
            .then(() => sendResponse({ success: true }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'cancelDownload':
          downloadManager
            .cancelDownload(request.downloadId)
            .then(() => sendResponse({ success: true }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'eraseDownload':
          downloadManager
            .eraseDownload(request.downloadId)
            .then(() => sendResponse({ success: true }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'batchPause':
          downloadManager
            .batchPause(request.downloadIds)
            .then((results) => sendResponse({ success: true, results }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'batchResume':
          downloadManager
            .batchResume(request.downloadIds)
            .then((results) => sendResponse({ success: true, results }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'batchCancel':
          downloadManager
            .batchCancel(request.downloadIds)
            .then((results) => sendResponse({ success: true, results }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'batchErase':
          downloadManager
            .batchErase(request.downloadIds)
            .then((results) => sendResponse({ success: true, results }))
            .catch((error) =>
              sendResponse({ success: false, error: error.message })
            );
          break;

        case 'syncFileStatus':
          // 我们的实现不需要手动同步，直接返回成功
          sendResponse({ success: true });
          break;

        case 'checkAllFiles':
          sendResponse({ success: true });
          break;
      }
    } catch (error) {
      console.error('处理消息异常:', error);
      sendResponse({ success: false, error: error.message });
    }
  })(); // 立即执行异步函数

  return true; // 保持消息通道开启
});
