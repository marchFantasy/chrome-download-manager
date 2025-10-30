// 智能下载管理器 - 后台脚本
// 处理下载事件和管理下载状态

class DownloadManager {
  constructor() {
    this.downloads = new Map(); // 存储下载信息
    this.downloadCount = 0; // 活跃下载数量
    this.animationInterval = null;
    this.fileCheckTimer = null; // 文件检查定时器
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

        // 先查询下载项信息
        chrome.downloads.search({id: downloadId}, (downloads) => {
          if (chrome.runtime.lastError) {
            console.error('查询下载项失败:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }

          if (!downloads || downloads.length === 0) {
            console.warn('下载项不存在:', downloadId);
            resolve();
            return;
          }

          const downloadItem = downloads[0];

          // 1. 先删除磁盘文件（如果存在）
          if (downloadItem.exists) {
            chrome.downloads.removeFile(downloadId, () => {
              if (chrome.runtime.lastError) {
                console.warn('⚠️ 删除磁盘文件失败:', chrome.runtime.lastError.message);
              } else {
                console.log('✅ 磁盘文件已删除:', downloadItem.filename);
              }

              // 2. 然后从下载历史中删除记录
              chrome.downloads.erase({id: downloadId}, (erasedItems) => {
                if (chrome.runtime.lastError) {
                  console.error('删除下载记录失败:', chrome.runtime.lastError);
                  reject(chrome.runtime.lastError);
                } else {
                  console.log(`✅ 下载记录已删除: ID ${downloadId}`);
                  resolve();
                }
              });
            });
          } else {
            console.warn('⚠️ 文件已不存在:', downloadItem.filename);

            // 3. 直接从下载历史中删除记录
            chrome.downloads.erase({id: downloadId}, (erasedItems) => {
              if (chrome.runtime.lastError) {
                console.error('删除下载记录失败:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
              } else {
                console.log(`✅ 下载记录已删除: ID ${downloadId}`);
                resolve();
              }
            });
          }
        });
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
    return new Promise((resolve) => {
      try {
        const url = downloadItem.url;
        const filename = downloadItem.filename;

        // 只检查HTTP/HTTPS URL
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          console.log('非HTTP/HTTPS文件，跳过检查:', filename);
          resolve(true); // 对于本地文件，无法检查
          return;
        }

        // 检查danger字段（文件被标记为危险时表示可能不存在）
        if (downloadItem.danger && downloadItem.danger !== 'safe') {
          console.log('文件被标记为危险，可能不存在:', filename);
          resolve(false);
          return;
        }

        // 使用exists字段检查文件是否存在（Chrome API提供）
        // 注意：exists字段可能不存在，需要确保在正确的环境下使用
        if (downloadItem.exists !== undefined) {
          console.log(`使用exists字段检查 ${filename}: ${downloadItem.exists}`);
          resolve(downloadItem.exists);
          return;
        }

        // 如果exists字段不存在，尝试fetch检查
        console.log('exists字段不存在，使用fetch检查:', filename);
        fetch(url, {method: 'HEAD'})
          .then(response => {
            if (response.ok) {
              console.log('文件存在:', filename);
              resolve(true);
            } else {
              console.log('文件不存在（HTTP状态:', response.status, '）:', filename);
              resolve(false);
            }
          })
          .catch(error => {
            console.log('文件检查失败:', filename, error);
            // 检查失败时，尝试下载检查
            fetch(url, {method: 'GET'})
              .then(response => {
                resolve(response.ok);
              })
              .catch(() => resolve(false));
          });
      } catch (error) {
        console.error('检查文件存在性时发生错误:', error);
        resolve(true); // 检查失败时默认为存在
      }
    });
  }

  // 批量检查文件存在性
  async batchCheckFiles() {
    console.log('开始批量检查文件存在性...');
    chrome.downloads.search({state: 'complete'}, (downloads) => {
      if (chrome.runtime.lastError) {
        console.error('搜索下载失败:', chrome.runtime.lastError);
        return;
      }

      if (!downloads || downloads.length === 0) {
        console.log('没有完成的下载');
        return;
      }

      console.log(`找到 ${downloads.length} 个完成的下载，开始检查...`);

      downloads.forEach(async (download) => {
        try {
          const exists = await this.checkFileExists(download);
          if (!exists) {
            console.log('文件不存在，标记为已删除:', download.filename);
            // 更新下载信息，标记为不存在
            const downloadInfo = this.downloads.get(download.id);
            if (downloadInfo) {
              downloadInfo.fileNotExists = true;
              this.saveDownloadInfo(downloadInfo);
            }
          }
        } catch (error) {
          console.error('检查文件存在性时发生错误:', error);
        }
      });
    });
  }

  // 下载创建事件
  onDownloadCreated(downloadItem) {
    console.log('下载创建事件:', downloadItem);

    try {
      // 确保state字段有有效值
      let state = downloadItem.state;
      if (!state || state === '' || state === undefined) {
        state = 'in_progress'; // 默认状态
      }

      const downloadInfo = {
        id: downloadItem.id,
        url: downloadItem.url,
        // 优先使用纯文件名，避免显示完整路径
        filename: this.extractBaseFilename(downloadItem.filename) || this.extractFilename(downloadItem.url),
        mimeType: downloadItem.mime || '',
        state: state,
        bytesReceived: downloadItem.bytesReceived || 0,
        totalBytes: downloadItem.totalBytes || 0,
        startTime: Date.now(),
        endTime: null,
        paused: false,
        error: null
      };

      this.downloads.set(downloadItem.id, downloadInfo);
      this.saveDownloadInfo(downloadInfo);

      // 显示下载动画和通知
      this.showDownloadAnimation(downloadInfo.filename);

      console.log(`下载记录已保存: ${downloadInfo.filename} (ID: ${downloadItem.id}, 状态: ${state})`);
    } catch (error) {
      console.error('处理下载创建事件失败:', error);
    }
  }

  // 下载状态变化事件
  onDownloadChanged(downloadDelta) {
    const downloadInfo = this.downloads.get(downloadDelta.id);
    if (!downloadInfo) return;

    // 更新下载信息
    if (downloadDelta.filename) {
      const newFilename = downloadDelta.filename.newValue;
      if (newFilename) {
        downloadInfo.filename = this.extractBaseFilename(newFilename);
      } else {
        // 文件名变为空，仅记录日志但不标记状态
        console.log(`检测到文件名为空 (ID: ${downloadDelta.id})`);
        // 注意：已移除文件删除标记功能
      }
    }
    if (downloadDelta.state) {
      downloadInfo.state = downloadDelta.state.newValue;
    }
    if (downloadDelta.bytesReceived) {
      downloadInfo.bytesReceived = downloadDelta.bytesReceived.newValue;
    }
    if (downloadDelta.totalBytes) {
      downloadInfo.totalBytes = downloadDelta.totalBytes.newValue;
    }

    // 检查下载完成
    if (downloadDelta.state && downloadDelta.state.newValue === 'complete') {
      // 设置完成时间为当前时间（用于10秒缓冲期检查）
      const completionTime = Date.now();
      downloadInfo.endTime = completionTime;

      console.log(`下载完成 (ID: ${downloadInfo.id}): ${downloadInfo.filename}, 完成时间: ${completionTime}`);

      // 显示完成通知
      this.showNotification('下载完成', `✅ ${downloadInfo.filename}`);

      // 完成闪烁提示
      this.flashBadgeForCompletion();

      // 更新下载计数
      this.downloadCount = Math.max(0, this.downloadCount - 1);
      this.updateBadge();
    }

    // 检查下载错误
    if (downloadDelta.state && downloadDelta.state.newValue === 'interrupted') {
      downloadInfo.error = '下载被中断';
      this.showNotification('下载失败', `❌ ${downloadInfo.filename}`);
    }

    this.saveDownloadInfo(downloadInfo);
  }

  // 下载删除事件
  onDownloadErased(downloadId) {
    console.log('下载删除:', downloadId);

    // 注意：已移除文件删除标记功能

    // 延迟删除，给UI时间更新状态
    setTimeout(() => {
      this.downloads.delete(downloadId);
      this.removeDownloadInfo(downloadId);
    }, 100);
  }

  // 提取文件名（从完整路径中获取纯文件名+扩展名）
  extractFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      return filename || '未知文件';
    } catch (e) {
      return '未知文件';
    }
  }

  // 从完整文件路径中提取纯文件名
  extractBaseFilename(filePath) {
    try {
      if (!filePath) return '未知文件';
      // Windows 路径使用 \，Unix/Linux 使用 /
      const normalizedPath = filePath.replace(/\\/g, '/');
      const filename = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1);
      return filename || '未知文件';
    } catch (e) {
      return '未知文件';
    }
  }

  // 获取所有下载信息（按时间倒序，最新的在最上面）
  getAllDownloads() {
    const downloads = Array.from(this.downloads.values());

    // 按开始时间倒序排列，最新的在最上面
    downloads.sort((a, b) => {
      // 优先使用endTime，如果没有则使用startTime
      const timeA = b.endTime || b.startTime || 0;
      const timeB = a.endTime || a.startTime || 0;
      return timeA - timeB;
    });

    return downloads;
  }

  // 检查是否为HTML页面（调用全局函数）
  isHtmlPage(url) {
    return isHtmlPage(url);
  }

  // 暂停下载
  pauseDownload(downloadId) {
    return new Promise((resolve, reject) => {
      chrome.downloads.pause(downloadId, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          const downloadInfo = this.downloads.get(downloadId);
          if (downloadInfo) {
            downloadInfo.paused = true;
            this.saveDownloadInfo(downloadInfo);
          }
          resolve();
        }
      });
    });
  }

  // 继续下载
  resumeDownload(downloadId) {
    return new Promise((resolve, reject) => {
      chrome.downloads.resume(downloadId, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          const downloadInfo = this.downloads.get(downloadId);
          if (downloadInfo) {
            downloadInfo.paused = false;
            this.saveDownloadInfo(downloadInfo);
          }
          resolve();
        }
      });
    });
  }

  // 取消下载
  cancelDownload(downloadId) {
    return new Promise((resolve, reject) => {
      chrome.downloads.cancel(downloadId, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
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
    chrome.storage.local.set({
      [`download_${downloadInfo.id}`]: downloadInfo
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
          // 确保所有字段都有有效值
          if (!value.state || value.state === undefined || value.state === '') {
            value.state = 'in_progress'; // 默认状态
          }
          if (value.paused === undefined) {
            value.paused = false;
          }
          if (value.bytesReceived === undefined) {
            value.bytesReceived = 0;
          }
          if (value.totalBytes === undefined) {
            value.totalBytes = 0;
          }
          // 提取纯文件名（移除路径）
          if (value.filename) {
            value.filename = this.extractBaseFilename(value.filename);
          }

          this.downloads.set(value.id, value);
          count++;
        }
      }
      console.log(`已加载 ${count} 个下载记录`);

      // 通知popup已加载完成
      this.notifyPopupLoaded();
    });
  }

  // 通知popup已加载完成
  notifyPopupLoaded() {
    chrome.runtime.sendMessage({action: 'downloadsLoaded', count: this.downloads.size}).catch(() => {
      // popup可能未打开，忽略错误
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
  console.log('收到消息:', request);
  
  try {
    switch (request.action) {
      case 'ping':
        sendResponse({success: true, message: 'Background script is running'});
        break;
      
      case 'getDownloads':
        try {
          console.log('获取下载列表，当前数量:', downloadManager.downloads.size);
          const downloads = downloadManager.getAllDownloads();

          // 主动查询Chrome API获取最新状态
          chrome.downloads.search({}, (chromeDownloads) => {
            if (chrome.runtime.lastError) {
              console.error('查询Chrome下载API失败:', chrome.runtime.lastError);
              sendResponse({success: true, downloads: downloads});
              return;
            }

            // 合并最新状态到我们的下载列表
            const downloadsWithLatestState = downloads.map(download => {
              const chromeDownload = chromeDownloads.find(cd => cd.id === download.id);
              if (chromeDownload) {
                // 使用Chrome API的最新状态，确保state字段有效
                const newState = (chromeDownload.state && chromeDownload.state !== '' && chromeDownload.state !== undefined)
                  ? chromeDownload.state
                  : (download.state || 'in_progress');

                // 提取纯文件名（移除路径）
                const newFilename = chromeDownload.filename || download.filename;
                const pureFilename = downloadManager.extractBaseFilename(newFilename);

                return {
                  ...download,
                  state: newState,
                  bytesReceived: chromeDownload.bytesReceived || 0,
                  totalBytes: chromeDownload.totalBytes || 0,
                  filename: pureFilename,
                  mimeType: chromeDownload.mimeType || chromeDownload.mime || download.mimeType || '',
                  endTime: chromeDownload.endTime || download.endTime
                };
              }
              return download;
            });

            console.log(`返回 ${downloadsWithLatestState.length} 个下载记录`);
            sendResponse({success: true, downloads: downloadsWithLatestState});
          });
        } catch (error) {
          console.error('获取下载列表失败:', error);
          sendResponse({success: false, error: error.message});
        }
        break;
      
      case 'pauseDownload':
        downloadManager.pauseDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => {
            console.error('暂停下载失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;
      
      case 'resumeDownload':
        downloadManager.resumeDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => {
            console.error('恢复下载失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;
      
      case 'cancelDownload':
        downloadManager.cancelDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => {
            console.error('取消下载失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;

      case 'eraseDownload':
        downloadManager.eraseDownload(request.downloadId)
          .then(() => sendResponse({success: true}))
          .catch(error => {
            console.error('删除下载失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;

      case 'batchPause':
        downloadManager.batchPause(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => {
            console.error('批量暂停失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;
      
      case 'batchResume':
        downloadManager.batchResume(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => {
            console.error('批量恢复失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;
      
      case 'batchCancel':
        downloadManager.batchCancel(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => {
            console.error('批量取消失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;

      case 'batchErase':
        downloadManager.batchErase(request.downloadIds)
          .then(results => sendResponse({success: true, results}))
          .catch(error => {
            console.error('批量删除失败:', error);
            sendResponse({success: false, error: error.message});
          });
        break;

      case 'createDownload':
        // 已删除主动创建下载的逻辑
        // 让浏览器正常处理链接，使用 chrome.downloads.onCreated 监听所有下载
        console.log('[DEBUG] 收到createDownload请求，但忽略，让浏览器正常处理:', request.url);
        sendResponse({success: true, message: '浏览器将正常处理此链接'});
        break;

      case 'openDownloadFolder':
        const openFolderId = request.downloadId;
        console.log('[DEBUG] 打开下载文件夹:', openFolderId);

        try {
          chrome.downloads.show(openFolderId);
          console.log('[SUCCESS] 文件夹已打开，下载ID:', openFolderId);
          sendResponse({success: true, message: '文件夹已打开'});
        } catch (error) {
          console.error('[ERROR] 打开文件夹失败:', error);
          sendResponse({success: false, error: error.message});
        }
        break;

      case 'checkFileExists':
        if (!request.downloadId) {
          sendResponse({success: false, error: '缺少下载ID'});
          break;
        }

        try {
          const downloadId = parseInt(request.downloadId);
          if (isNaN(downloadId)) {
            sendResponse({success: false, error: '无效的下载ID'});
            break;
          }

          // 查找下载项
          chrome.downloads.search({id: downloadId}, (downloads) => {
            if (chrome.runtime.lastError) {
              console.error('查询下载项失败:', chrome.runtime.lastError);
              sendResponse({success: false, error: chrome.runtime.lastError.message});
              return;
            }

            if (!downloads || downloads.length === 0) {
              sendResponse({success: false, error: '下载项不存在'});
              return;
            }

            const download = downloads[0];
            downloadManager.checkFileExists(download)
              .then(exists => {
                sendResponse({success: true, exists: exists});
              })
              .catch(error => {
                console.error('检查文件存在性失败:', error);
                sendResponse({success: false, error: error.message});
              });
          });
        } catch (error) {
          console.error('检查文件存在性异常:', error);
          sendResponse({success: false, error: error.message});
        }
        break;

      case 'checkAllFiles':
        try {
          downloadManager.batchCheckFiles();
          sendResponse({success: true, message: '文件检查已开始'});
        } catch (error) {
          console.error('批量检查文件失败:', error);
          sendResponse({success: false, error: error.message});
        }
        break;

      case 'startFileCheck':
        try {
          downloadManager.startFileCheckTimer();
          sendResponse({success: true, message: '文件检查定时器已启动'});
        } catch (error) {
          console.error('启动文件检查定时器失败:', error);
          sendResponse({success: false, error: error.message});
        }
        break;

      case 'cancelFileCheck':
        try {
          downloadManager.cancelFileCheckTimer();
          sendResponse({success: true, message: '文件检查定时器已取消'});
        } catch (error) {
          console.error('取消文件检查定时器失败:', error);
          sendResponse({success: false, error: error.message});
        }
        break;

      default:
        console.warn('未知操作:', request.action);
        sendResponse({success: false, error: '未知操作'});
    }
  } catch (error) {
    console.error('处理消息时发生错误:', error);
    sendResponse({success: false, error: error.message});
  }
  
  return true; // 保持消息通道开放
});

// 右键菜单点击监听
// 提取文件名的辅助函数
function extractFilename(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    return filename || '未知文件';
  } catch (e) {
    return '未知文件';
  }
}