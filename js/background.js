// 智能下载管理器 - 后台脚本
// 处理下载事件和管理下载状态

// 引入核心下载器
importScripts('/js/core/downloader.js');

class DownloadManager {
  constructor() {
    this.downloads = new Map(); // 存储下载信息 (包含 Downloader 实例)
    this.downloadCount = 0; // 活跃下载数量
    this.animationInterval = null;
    this.fileCheckTimer = null; // 文件检查定时器
    this.internalDownloadIds = new Set(); // 追踪由本扩展发起的下载ID（用于最终保存文件）
    this.init();
  }

  init() {
    console.log('DownloadManager 初始化开始...');

    // 检查权限
    if (!chrome.downloads) {
      console.error('chrome.downloads API 不可用');
      return;
    }

    try {
      // 监听下载事件
      chrome.downloads.onCreated.addListener(this.onDownloadCreated.bind(this));
      chrome.downloads.onChanged.addListener(this.onDownloadChanged.bind(this));
      chrome.downloads.onErased.addListener(this.onDownloadErased.bind(this));

      console.log('下载事件监听器已注册');

      // 禁用Chrome默认下载栏
      this.disableDownloadShelf();

      // 初始化badge
      this.updateBadge();
      this.updateBadgeColor('#4CAF50'); // 默认绿色

      // 加载已存在的下载
      this.loadExistingDownloads();

      console.log('DownloadManager 初始化完成');
    } catch (error) {
      console.error('DownloadManager 初始化失败:', error);
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
      priority: 1
    });
  }

  // 删除下载（包含同步删除磁盘文件）
  eraseDownload(downloadId) {
    return new Promise(async (resolve, reject) => {
      try {
        console.log(`删除下载记录: ID ${downloadId}`);
        
        // 1. 检查是否为内部下载
        const downloadInfo = this.downloads.get(downloadId);
        if (downloadInfo && downloadInfo.downloader) {
            // 如果正在下载，先取消
            downloadInfo.downloader.cancel();
        }

        // 2. 从内存和存储中移除
        this.downloads.delete(downloadId);
        this.removeDownloadInfo(downloadId);
        
        // 3. 尝试从Chrome历史中移除（如果是已保存的文件）
        // 注意：这里我们主要管理自己的记录，Chrome的历史记录作为辅助
        // 如果有对应的Chrome Download ID (finalDownloadId)，也尝试删除
        if (downloadInfo && downloadInfo.finalDownloadId) {
             chrome.downloads.erase({id: downloadInfo.finalDownloadId}, () => {
                 if (chrome.runtime.lastError) console.warn('删除Chrome记录失败:', chrome.runtime.lastError);
             });
        }

        console.log(`✅ 下载记录已删除: ID ${downloadId}`);
        resolve();

      } catch (error) {
        console.error('删除下载时发生错误:', error);
        reject(error);
      }
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
        results.push({id, success: true});
      } catch (error) {
        results.push({id, success: false, error: error.message});
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
          downloader: downloader // 引用实例，不保存到 storage
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
          chrome.runtime.sendMessage({
              action: 'downloadProgress',
              data: downloadInfo
          }).catch(() => {});
      };

      downloader.onComplete = async (data) => {
          downloadInfo.state = 'complete';
          downloadInfo.endTime = Date.now();
          downloadInfo.blob = data.blob; // 暂存 Blob
          
          console.log(`内部下载完成: ${filename}, 开始保存到磁盘...`);
          
          // 保存文件到磁盘
          // 注意: Service Worker 不支持 URL.createObjectURL
          // 我们需要使用 FileReader 将 Blob 转换为 Data URL
          try {
              const reader = new FileReader();
              
              reader.onload = () => {
                  const dataUrl = reader.result;
                  
                  // 使用 Data URL 创建下载
                  // 注意：必须先添加到 internalDownloadIds，然后再调用 download
                  // 否则会在 onCreated 中被拦截
                  const tempId = 'pending_' + Date.now();
                  
                  chrome.downloads.download({
                      url: dataUrl,
                      filename: filename,
                      saveAs: false // 自动保存，不弹窗
                  }, (downloadId) => {
                      if (chrome.runtime.lastError) {
                          console.error('保存文件失败:', chrome.runtime.lastError);
                          downloadInfo.error = chrome.runtime.lastError.message;
                          downloadInfo.state = 'interrupted';
                      } else {
                          console.log(`文件保存任务已创建，Chrome ID: ${downloadId}`);
                          // 立即标记为内部下载，防止被拦截
                          this.internalDownloadIds.add(downloadId);
                          downloadInfo.finalDownloadId = downloadId; // 关联 Chrome ID
                      }
                      this.saveDownloadInfo(downloadInfo);
                      this.showNotification('下载完成', `✅ ${filename}`);
                      this.flashBadgeForCompletion();
                  });
              };
              
              reader.onerror = () => {
                  console.error('Blob 转换失败:', reader.error);
                  downloadInfo.error = 'Blob 转换失败';
                  downloadInfo.state = 'interrupted';
                  this.saveDownloadInfo(downloadInfo);
              };
              
              // 开始转换
              reader.readAsDataURL(data.blob);
          } catch (e) {
              console.error('保存流程异常:', e);
              downloadInfo.error = e.message;
              downloadInfo.state = 'interrupted';
              this.saveDownloadInfo(downloadInfo);
          }
      };

      downloader.onError = (data) => {
          downloadInfo.state = 'interrupted';
          downloadInfo.error = data.error;
          this.saveDownloadInfo(downloadInfo);
          this.showNotification('下载失败', `❌ ${filename}`);
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

    // 1. 检查是否是我们自己发起的最终保存任务
    if (this.internalDownloadIds.has(downloadItem.id)) {
        console.log('检测到内部保存任务，放行:', downloadItem.id);
        this.internalDownloadIds.delete(downloadItem.id); // 用完即删
        return;
    }

    // 2. 检查是否是 Blob URL 或 Data URL (我们自己生成的)
    if (downloadItem.url.startsWith('blob:') || downloadItem.url.startsWith('data:')) {
        console.log('检测到 Blob/Data URL，放行:', downloadItem.url.substring(0, 50) + '...');
        return;
    }

    // 3. 拦截普通下载
    console.log('拦截到外部下载，准备接管:', downloadItem.url);
    
    // 取消原生下载
    chrome.downloads.cancel(downloadItem.id, () => {
        if (chrome.runtime.lastError) {
            console.warn('取消原生下载失败:', chrome.runtime.lastError);
        } else {
            console.log('原生下载已取消');
            // 删除原生记录，保持历史干净
            chrome.downloads.erase({id: downloadItem.id});
        }
    });

    // 启动内部下载
    const filename = this.extractBaseFilename(downloadItem.filename) || this.extractFilename(downloadItem.url);
    this.startInternalDownload(downloadItem.url, filename);
  }

  // 下载状态变化事件
  onDownloadChanged(downloadDelta) {
    // 我们主要关注内部下载的状态，这里只处理 Chrome 原生下载的变化（如果是我们关联的）
    // 比如用户在浏览器下载页取消了最终的保存任务
    
    // 查找关联的内部下载
    for (const [id, info] of this.downloads.entries()) {
        if (info.finalDownloadId === downloadDelta.id) {
            if (downloadDelta.state && downloadDelta.state.newValue === 'interrupted') {
                console.warn('最终保存任务被中断');
                info.state = 'interrupted';
                info.error = '文件保存被中断';
                this.saveDownloadInfo(info);
            }
        }
    }
  }

  // 下载删除事件
  onDownloadErased(downloadId) {
    // 忽略
  }

  // 提取文件名（从完整路径中获取纯文件名+扩展名）
  extractFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      
      // 如果文件名为空或只是查询参数，尝试从 URL 的其他部分提取
      if (!filename || filename.includes('?')) {
        filename = pathname.split('/').filter(p => p).pop() || '';
      }
      
      // 移除查询参数
      filename = filename.split('?')[0];
      
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
      const filename = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1);
      
      // 如果提取出的文件名为空或无效，返回 null
      if (!filename || filename.trim() === '') {
        return null;
      }
      
      return filename;
    } catch (e) {
      return null;
    }
  }

  // 获取所有下载信息（按时间倒序，最新的在最上面）
  getAllDownloads() {
    const downloads = Array.from(this.downloads.values()).map(d => {
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
      message: message
    });
  }

  // 保存下载信息到存储
  saveDownloadInfo(downloadInfo) {
    // 移除不应序列化的字段
    const { downloader, blob, ...dataToSave } = downloadInfo;
    chrome.storage.local.set({
      [`download_${downloadInfo.id}`]: dataToSave
    });
  }

  // 从存储中删除下载信息
  removeDownloadInfo(downloadId) {
    chrome.storage.local.remove([`download_${downloadId}`]);
  }

  // 加载已存在的下载
  loadExistingDownloads() {
    console.log('开始加载已存在的下载...');
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        console.error('加载存储数据失败:', chrome.runtime.lastError);
        return;
      }

      let count = 0;
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('download_') && value) {
          // 恢复时，所有未完成的任务标记为中断（因为没有实现持久化断点续传）
          if (value.state === 'in_progress' || value.state === 'paused') {
              value.state = 'interrupted';
              value.error = '会话已过期';
          }
          
          this.downloads.set(value.id, value);
          count++;
        }
      }
      console.log(`已加载 ${count} 个下载记录`);
    });
  }

  // 批量操作
  async batchPause(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.pauseDownload(id);
        results.push({id, success: true});
      } catch (error) {
        results.push({id, success: false, error: error.message});
      }
    }
    return results;
  }

  async batchResume(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.resumeDownload(id);
        results.push({id, success: true});
      } catch (error) {
        results.push({id, success: false, error: error.message});
      }
    }
    return results;
  }

  async batchCancel(downloadIds) {
    const results = [];
    for (const id of downloadIds) {
      try {
        await this.cancelDownload(id);
        results.push({id, success: true});
      } catch (error) {
        results.push({id, success: false, error: error.message});
      }
    }
    return results;
  }

}

// 初始化下载管理器
const downloadManager = new DownloadManager();

// 处理来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // console.log('收到消息:', request);
  
  try {
    switch (request.action) {
      case 'ping':
        sendResponse({success: true, message: 'Background script is running'});
        break;
      
      case 'getDownloads':
        try {
          const downloads = downloadManager.getAllDownloads();
          sendResponse({success: true, downloads: downloads});
        } catch (error) {
          console.error('获取下载列表失败:', error);
          sendResponse({success: false, error: error.message});
        }
        break;
      
      case 'pauseDownload':
        downloadManager.pauseDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;
      
      case 'resumeDownload':
        downloadManager.resumeDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;
      
      case 'cancelDownload':
        downloadManager.cancelDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;

      case 'eraseDownload':
        downloadManager.eraseDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;

      case 'batchPause':
        downloadManager.batchPause(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;
      
      case 'batchResume':
        downloadManager.batchResume(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;
      
      case 'batchCancel':
        downloadManager.batchCancel(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;

      case 'batchErase':
        downloadManager.batchErase(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => sendResponse({success: false, error: error.message}));
        break;
        
      case 'syncFileStatus':
          // 我们的实现不需要手动同步，直接返回成功
          sendResponse({success: true});
          break;
          
      case 'checkAllFiles':
          sendResponse({success: true});
          break;
    }
  } catch (error) {
    console.error('处理消息异常:', error);
    sendResponse({success: false, error: error.message});
  }
  
  return true; // 保持消息通道开启
});