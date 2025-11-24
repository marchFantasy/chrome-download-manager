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

    // 事件回调
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }

  // 开始下载
  async start() {
    try {
      // 1. 获取文件大小和是否支持断点续传
      const headResponse = await fetch(this.url, { method: 'HEAD' });
      if (!headResponse.ok) {
        throw new Error(`HTTP error! status: ${headResponse.status}`);
      }

      this.totalBytes = parseInt(
        headResponse.headers.get('content-length') || '0'
      );
      const acceptRanges = headResponse.headers.get('accept-ranges');
      this.supportsRange = acceptRanges === 'bytes';

      console.log(
        `开始下载: ${this.filename}, 大小: ${this.totalBytes}, 支持分块: ${this.supportsRange}`
      );

      if (this.totalBytes > 0 && this.supportsRange) {
        // 支持分块下载
        this.initChunkProgress();
        await this.downloadChunks();
      } else {
        // 不支持分块或大小未知，单线程下载
        await this.downloadSingle();
      }
    } catch (error) {
      this.handleError(error);
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

  // 下载单个分块（支持断点续传）
  async downloadChunk(index) {
    const chunkInfo = this.chunkProgress[index];

    if (chunkInfo.completed) {
      console.log(`分块 ${index} 已完成，跳过`);
      return;
    }

    // 计算当前分块的实际起始位置（考虑已下载的部分）
    const currentStart = chunkInfo.start + chunkInfo.downloaded;
    const currentEnd = chunkInfo.end;

    if (currentStart > currentEnd) {
      chunkInfo.completed = true;
      return;
    }

    console.log(`下载分块 ${index}: ${currentStart}-${currentEnd}`);

    try {
      const headers = { Range: `bytes=${currentStart}-${currentEnd}` };
      const response = await fetch(this.url, {
        headers,
        signal: this.abortControllers[index].signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Chunk ${index} failed: ${response.status}`);
      }

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 保存数据块
        chunkInfo.data.push(value);
        chunkInfo.downloaded += value.length;
        this.updateProgress(value.length);
      }

      // 标记分块完成
      chunkInfo.completed = true;
      this.chunks[index] = new Blob(chunkInfo.data);
      console.log(`分块 ${index} 下载完成`);
    } catch (error) {
      // 如果是 AbortError 且状态为 paused，不抛出错误
      if (error.name === 'AbortError' && this.state === 'paused') {
        console.log(
          `分块 ${index} 已暂停，已下载: ${chunkInfo.downloaded} 字节`
        );
        return;
      }
      console.error(`分块 ${index} 下载失败:`, error.message);
      throw error;
    }
  }

  // 单线程下载（不支持 Range 或大小未知）
  async downloadSingle() {
    const abortController = new AbortController();
    this.abortControllers = [abortController];

    try {
      const response = await fetch(this.url, {
        signal: abortController.signal,
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        this.updateProgress(value.length);
      }

      this.chunks = [new Blob(chunks)];
      this.finish();
    } catch (error) {
      if (error.name === 'AbortError' && this.state === 'paused') {
        console.log('单线程下载已暂停');
        return;
      }
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
    // 暂停不是错误，直接返回
    if (error.name === 'AbortError' && this.state === 'paused') {
      console.log('下载已暂停');
      return;
    }

    console.error(`下载错误: ${error.message}`);
    this.state = 'interrupted';
    this.error = error.message;

    if (this.onError) {
      this.onError({
        id: this.id,
        error: error.message,
      });
    }
  }

  // 暂停
  pause() {
    if (this.state === 'in_progress') {
      console.log('暂停下载:', this.filename);
      this.state = 'paused';

      // 中止所有分块的下载
      this.abortControllers.forEach((controller) => {
        try {
          controller.abort();
        } catch (e) {
          // 忽略已经中止的错误
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
