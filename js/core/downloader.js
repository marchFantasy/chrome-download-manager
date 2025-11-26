/**
 * 核心下载器类
 * 负责分块下载、速度计算、文件合并和断点续传
 */
class Downloader {
  constructor(url, filename, options = {}) {
    this.url = url;
    this.filename = filename;
    this.options = {
      chunks: 4, // 默认分4块
      fetchTimeout: 30000, // fetch 请求超时时间 (30秒)
      ...options,
    };

    this.id = Date.now() + Math.random().toString(36).substr(2, 9);
    this.state = 'in_progress'; // in_progress, paused, complete, interrupted
    this.totalBytes = 0;
    this.bytesReceived = 0;
    this.startTime = Date.now();
    this.endTime = null;
    this.speed = 0; // bytes per second
    this.chunks = []; // 存储已下载的分块 Blob
    this.chunkProgress = []; // 记录每个分块的下载进度 {start, end, downloaded}
    this.abortControllers = []; // 每个分块一个 AbortController
    this.lastSpeedUpdate = Date.now();
    this.lastBytesReceived = 0;
    this.supportsRange = false; // 是否支持 Range 请求
    this.interruptReason = null; // 记录中断原因
    this.lastActivityTime = Date.now(); // 最后活动时间

    // 事件回调
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;

    // 日志前缀
    this.logPrefix = `[Downloader ${this.id.substr(0, 8)}]`;
    console.log(`${this.logPrefix} 创建下载任务: ${filename}`);
  }

  // 开始下载
  async start() {
    const startTimestamp = Date.now();
    console.log(`${this.logPrefix} 开始下载流程 [${new Date().toISOString()}]`);
    console.log(`${this.logPrefix} URL: ${this.url}`);

    try {
      // 1. 获取文件大小和是否支持断点续传
      console.log(`${this.logPrefix} 发送 HEAD 请求...`);
      const headStartTime = Date.now();

      let headResponse;
      let headFailed = false;

      try {
        headResponse = await this.fetchWithTimeout(this.url, {
          method: 'HEAD',
        });

        const headDuration = Date.now() - headStartTime;
        console.log(
          `${this.logPrefix} HEAD 请求完成,耗时: ${headDuration}ms, 状态: ${headResponse.status}`
        );

        // 如果返回 401/403/405,说明服务器不允许 HEAD 请求
        if (
          headResponse.status === 401 ||
          headResponse.status === 403 ||
          headResponse.status === 405
        ) {
          console.warn(
            `${this.logPrefix} HEAD 请求被拒绝 (${headResponse.status}),将使用单线程 GET 下载`
          );
          headFailed = true;
        } else if (!headResponse.ok) {
          throw new Error(`HTTP error! status: ${headResponse.status}`);
        }
      } catch (error) {
        console.warn(
          `${this.logPrefix} HEAD 请求失败: ${error.message},将使用单线程 GET 下载`
        );
        headFailed = true;
      }

      if (headFailed) {
        // HEAD 请求失败,直接使用单线程下载(不知道文件大小)
        console.log(`${this.logPrefix} 跳过 HEAD 请求,直接开始单线程下载`);
        await this.downloadSingle();
        return;
      }

      this.totalBytes = parseInt(
        headResponse.headers.get('content-length') || '0'
      );
      const acceptRanges = headResponse.headers.get('accept-ranges');
      this.supportsRange = acceptRanges === 'bytes';

      console.log(
        `${this.logPrefix} 文件信息: 大小=${this.totalBytes} bytes, 支持分块=${this.supportsRange}`
      );

      if (this.totalBytes > 0 && this.supportsRange) {
        // 支持分块下载
        console.log(
          `${this.logPrefix} 使用分块下载模式 (${this.options.chunks} 个分块)`
        );
        this.initChunkProgress();
        await this.downloadChunks();
      } else {
        // 不支持分块或大小未知,单线程下载
        console.log(`${this.logPrefix} 使用单线程下载模式`);
        await this.downloadSingle();
      }
    } catch (error) {
      const duration = Date.now() - startTimestamp;
      console.error(`${this.logPrefix} 下载失败,总耗时: ${duration}ms`);
      this.handleError(error);
    }
  }

  // 带超时的 fetch 请求
  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(
        `${this.logPrefix} fetch 请求超时 (${this.options.fetchTimeout}ms)`
      );
      controller.abort();
    }, this.options.fetchTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        credentials: 'include', // 携带 Cookie 和认证信息,解决 GitHub 等网站的 401 错误
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`请求超时 (${this.options.fetchTimeout}ms)`);
      }
      throw error;
    }
  }

  // 初始化分块进度
  initChunkProgress() {
    if (this.chunkProgress.length > 0) return; // 已初始化，跳过

    const chunkSize = Math.ceil(this.totalBytes / this.options.chunks);

    for (let i = 0; i < this.options.chunks; i++) {
      const start = i * chunkSize;
      const end =
        i === this.options.chunks - 1
          ? this.totalBytes - 1
          : (i + 1) * chunkSize - 1;

      this.chunkProgress.push({
        index: i,
        start: start,
        end: end,
        downloaded: 0, // 已下载字节数
        completed: false,
        data: [], // 存储已下载的数据块
      });

      this.abortControllers.push(new AbortController());
    }
  }

  // 分块下载
  async downloadChunks() {
    const promises = [];

    for (let i = 0; i < this.options.chunks; i++) {
      promises.push(this.downloadChunk(i));
    }

    try {
      // 使用 allSettled 而不是 all，这样单个分块失败不会中断其他分块
      const results = await Promise.allSettled(promises);

      // 如果已经暂停，不要标记为完成
      if (this.state === 'paused') {
        console.log('下载已暂停，等待恢复');
        return;
      }

      // 检查是否有失败的分块
      const failures = results.filter((r) => r.status === 'rejected');

      if (failures.length > 0) {
        console.error(`${failures.length} 个分块下载失败`);
        throw new Error(
          `${failures.length} 个分块下载失败: ${failures[0].reason}`
        );
      }

      // 检查是否所有分块都真正完成了
      const allCompleted = this.chunkProgress.every((chunk) => chunk.completed);
      if (allCompleted) {
        this.finish();
      } else {
        console.warn('部分分块未完成，下载未完成');
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  // 下载单个分块(支持断点续传)
  async downloadChunk(index) {
    const chunkInfo = this.chunkProgress[index];
    const chunkStartTime = Date.now();

    if (chunkInfo.completed) {
      console.log(`${this.logPrefix} 分块 ${index} 已完成,跳过`);
      return;
    }

    // 计算当前分块的实际起始位置(考虑已下载的部分)
    const currentStart = chunkInfo.start + chunkInfo.downloaded;
    const currentEnd = chunkInfo.end;

    if (currentStart > currentEnd) {
      chunkInfo.completed = true;
      return;
    }

    const chunkSize = currentEnd - currentStart + 1;
    console.log(
      `${this.logPrefix} 分块 ${index}: 范围=${currentStart}-${currentEnd} (${(
        chunkSize / 1024
      ).toFixed(2)} KB)`
    );

    try {
      const headers = { Range: `bytes=${currentStart}-${currentEnd}` };
      const fetchStartTime = Date.now();

      const response = await fetch(this.url, {
        headers,
        signal: this.abortControllers[index].signal,
        credentials: 'include', // 携带认证信息
      });

      const fetchDuration = Date.now() - fetchStartTime;
      console.log(
        `${this.logPrefix} 分块 ${index} 响应: 状态=${response.status}, 耗时=${fetchDuration}ms`
      );

      if (!response.ok && response.status !== 206) {
        throw new Error(`分块 ${index} HTTP 错误: ${response.status}`);
      }

      const reader = response.body.getReader();
      let lastLogTime = Date.now();
      let bytesInInterval = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 保存数据块
        chunkInfo.data.push(value);
        chunkInfo.downloaded += value.length;
        bytesInInterval += value.length;
        this.updateProgress(value.length);
        this.lastActivityTime = Date.now();

        // 每2秒记录一次分块进度
        const now = Date.now();
        if (now - lastLogTime > 2000) {
          const speed = (bytesInInterval / (now - lastLogTime)) * 1000;
          console.log(
            `${this.logPrefix} 分块 ${index} 进度: ${(
              (chunkInfo.downloaded / chunkSize) *
              100
            ).toFixed(1)}%, 速度: ${(speed / 1024).toFixed(2)} KB/s`
          );
          lastLogTime = now;
          bytesInInterval = 0;
        }
      }

      // 标记分块完成
      chunkInfo.completed = true;
      this.chunks[index] = new Blob(chunkInfo.data);
      const chunkDuration = Date.now() - chunkStartTime;
      console.log(
        `${
          this.logPrefix
        } 分块 ${index} 完成,耗时: ${chunkDuration}ms, 平均速度: ${(
          ((chunkSize / chunkDuration) * 1000) /
          1024
        ).toFixed(2)} KB/s`
      );
    } catch (error) {
      const chunkDuration = Date.now() - chunkStartTime;

      // 如果是 AbortError 且状态为 paused,不抛出错误
      if (error.name === 'AbortError' && this.state === 'paused') {
        console.log(
          `${this.logPrefix} 分块 ${index} 已暂停,已下载: ${chunkInfo.downloaded} 字节,耗时: ${chunkDuration}ms`
        );
        return;
      }

      console.error(
        `${this.logPrefix} 分块 ${index} 失败,耗时: ${chunkDuration}ms, 错误: ${error.name} - ${error.message}`
      );
      this.interruptReason = `分块 ${index} 失败: ${error.message}`;
      throw error;
    }
  }

  // 单线程下载(不支持 Range 或大小未知)
  async downloadSingle() {
    const abortController = new AbortController();
    this.abortControllers = [abortController];
    const downloadStartTime = Date.now();

    console.log(`${this.logPrefix} 开始单线程下载...`);

    try {
      const fetchStartTime = Date.now();
      const response = await fetch(this.url, {
        signal: abortController.signal,
        credentials: 'include', // 携带认证信息
      });

      const fetchDuration = Date.now() - fetchStartTime;
      console.log(
        `${this.logPrefix} 单线程响应: 状态=${response.status}, 耗时=${fetchDuration}ms`
      );

      if (!response.ok) {
        throw new Error(`下载失败: HTTP ${response.status}`);
      }

      // 尝试从响应头获取文件大小
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        this.totalBytes = parseInt(contentLength);
        console.log(
          `${this.logPrefix} 从响应头获取文件大小: ${this.totalBytes} bytes`
        );
      }

      const reader = response.body.getReader();
      const chunks = [];
      let lastLogTime = Date.now();
      let bytesInInterval = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        bytesInInterval += value.length;
        this.updateProgress(value.length);
        this.lastActivityTime = Date.now();

        // 每2秒记录一次进度
        const now = Date.now();
        if (now - lastLogTime > 2000) {
          const speed = (bytesInInterval / (now - lastLogTime)) * 1000;
          const progressInfo =
            this.totalBytes > 0
              ? `${((this.bytesReceived / this.totalBytes) * 100).toFixed(1)}%`
              : `${(this.bytesReceived / 1024).toFixed(2)} KB`;
          console.log(
            `${this.logPrefix} 单线程进度: ${progressInfo}, 速度: ${(
              speed / 1024
            ).toFixed(2)} KB/s`
          );
          lastLogTime = now;
          bytesInInterval = 0;
        }
      }

      this.chunks = [new Blob(chunks)];
      const downloadDuration = Date.now() - downloadStartTime;
      console.log(
        `${
          this.logPrefix
        } 单线程下载完成,总耗时: ${downloadDuration}ms, 平均速度: ${(
          ((this.bytesReceived / downloadDuration) * 1000) /
          1024
        ).toFixed(2)} KB/s`
      );
      this.finish();
    } catch (error) {
      const downloadDuration = Date.now() - downloadStartTime;

      if (error.name === 'AbortError' && this.state === 'paused') {
        console.log(
          `${this.logPrefix} 单线程下载已暂停,耗时: ${downloadDuration}ms`
        );
        return;
      }

      console.error(
        `${this.logPrefix} 单线程下载失败,耗时: ${downloadDuration}ms, 错误: ${error.name} - ${error.message}`
      );
      this.interruptReason = `单线程下载失败: ${error.message}`;
      throw error;
    }
  }

  // 更新进度和速度
  updateProgress(bytes) {
    this.bytesReceived += bytes;

    const now = Date.now();
    const timeDiff = now - this.lastSpeedUpdate;

    // 每500ms更新一次速度
    if (timeDiff > 500) {
      const bytesDiff = this.bytesReceived - this.lastBytesReceived;
      this.speed = (bytesDiff / timeDiff) * 1000; // bytes/s

      this.lastSpeedUpdate = now;
      this.lastBytesReceived = this.bytesReceived;

      if (this.onProgress) {
        this.onProgress({
          id: this.id,
          bytesReceived: this.bytesReceived,
          totalBytes: this.totalBytes,
          speed: this.speed,
          state: this.state,
        });
      }
    }
  }

  // 完成下载
  finish() {
    this.state = 'complete';
    this.endTime = Date.now();
    this.speed = 0;

    console.log(`下载完成: ${this.filename}`);

    // 合并所有分块
    const finalBlob = new Blob(this.chunks);

    if (this.onComplete) {
      this.onComplete({
        id: this.id,
        blob: finalBlob,
        filename: this.filename,
      });
    }
  }

  // 处理错误
  handleError(error) {
    // 暂停不是错误,直接返回
    if (error.name === 'AbortError' && this.state === 'paused') {
      console.log(`${this.logPrefix} 下载已暂停`);
      return;
    }

    const totalDuration = Date.now() - this.startTime;
    const inactiveTime = Date.now() - this.lastActivityTime;

    console.error(`${this.logPrefix} ========== 下载错误详情 ==========`);
    console.error(`${this.logPrefix} 文件名: ${this.filename}`);
    console.error(`${this.logPrefix} URL: ${this.url}`);
    console.error(`${this.logPrefix} 错误类型: ${error.name}`);
    console.error(`${this.logPrefix} 错误消息: ${error.message}`);
    console.error(`${this.logPrefix} 错误堆栈: ${error.stack || '无'}`);
    console.error(`${this.logPrefix} 总耗时: ${totalDuration}ms`);
    console.error(`${this.logPrefix} 无活动时间: ${inactiveTime}ms`);
    console.error(
      `${this.logPrefix} 已下载: ${this.bytesReceived} / ${
        this.totalBytes
      } bytes (${((this.bytesReceived / this.totalBytes) * 100).toFixed(2)}%)`
    );
    console.error(`${this.logPrefix} 当前状态: ${this.state}`);
    console.error(
      `${this.logPrefix} 中断原因: ${this.interruptReason || '未知'}`
    );
    console.error(`${this.logPrefix} =====================================`);

    this.state = 'interrupted';
    this.error = error.message;
    if (!this.interruptReason) {
      this.interruptReason = error.message;
    }

    if (this.onError) {
      this.onError({
        id: this.id,
        error: error.message,
        interruptReason: this.interruptReason,
        duration: totalDuration,
        bytesReceived: this.bytesReceived,
        totalBytes: this.totalBytes,
      });
    }
  }

  // 暂停
  pause() {
    if (this.state === 'in_progress') {
      const pauseTime = Date.now();
      const duration = pauseTime - this.startTime;
      console.log(
        `${this.logPrefix} 暂停下载: ${this.filename}, 已运行: ${duration}ms, 已下载: ${this.bytesReceived} bytes`
      );
      this.state = 'paused';

      // 中止所有分块的下载
      this.abortControllers.forEach((controller, index) => {
        try {
          controller.abort();
          console.log(`${this.logPrefix} 中止分块 ${index}`);
        } catch (e) {
          console.warn(`${this.logPrefix} 中止分块 ${index} 失败:`, e.message);
        }
      });

      // 重置 AbortControllers 以便恢复
      this.abortControllers = this.abortControllers.map(
        () => new AbortController()
      );
    }
  }

  // 恢复（真正的断点续传）
  resume() {
    if (this.state === 'paused') {
      console.log(
        '恢复下载:',
        this.filename,
        '已下载:',
        this.bytesReceived,
        '/',
        this.totalBytes
      );
      this.state = 'in_progress';

      if (this.supportsRange && this.chunkProgress.length > 0) {
        // 支持断点续传，从中断处继续
        this.downloadChunks();
      } else {
        // 不支持断点续传，只能重新开始
        console.warn('服务器不支持断点续传，将重新开始下载');
        this.bytesReceived = 0;
        this.chunks = [];
        this.start();
      }
    }
  }

  // 取消
  cancel() {
    this.state = 'interrupted';
    this.abortControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (e) {
        // 忽略
      }
    });
  }
}

// 导出给 background.js 使用
if (typeof self !== 'undefined') {
  self.Downloader = Downloader;
}
