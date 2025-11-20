/**
 * 核心下载器类
 * 负责分块下载、速度计算和文件合并
 */
class Downloader {
    constructor(url, filename, options = {}) {
        this.url = url;
        this.filename = filename;
        this.options = {
            chunks: 4, // 默认分4块
            ...options
        };
        
        this.id = Date.now() + Math.random().toString(36).substr(2, 9);
        this.state = 'in_progress'; // in_progress, paused, complete, interrupted
        this.totalBytes = 0;
        this.bytesReceived = 0;
        this.startTime = Date.now();
        this.endTime = null;
        this.speed = 0; // bytes per second
        this.chunks = [];
        this.abortController = new AbortController();
        this.lastSpeedUpdate = Date.now();
        this.lastBytesReceived = 0;
        
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
            
            this.totalBytes = parseInt(headResponse.headers.get('content-length') || '0');
            const acceptRanges = headResponse.headers.get('accept-ranges');
            
            console.log(`开始下载: ${this.filename}, 大小: ${this.totalBytes}, 支持分块: ${acceptRanges === 'bytes'}`);

            if (this.totalBytes > 0 && acceptRanges === 'bytes') {
                // 支持分块下载
                await this.downloadChunks();
            } else {
                // 不支持分块或大小未知，单线程下载
                await this.downloadSingle();
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    // 分块下载
    async downloadChunks() {
        const chunkSize = Math.ceil(this.totalBytes / this.options.chunks);
        const promises = [];

        for (let i = 0; i < this.options.chunks; i++) {
            const start = i * chunkSize;
            const end = i === this.options.chunks - 1 ? this.totalBytes - 1 : (i + 1) * chunkSize - 1;
            
            promises.push(this.downloadChunk(i, start, end));
        }

        try {
            await Promise.all(promises);
            this.finish();
        } catch (error) {
            this.handleError(error);
        }
    }

    // 下载单个分块
    async downloadChunk(index, start, end) {
        if (this.state !== 'in_progress') return;

        const headers = { 'Range': `bytes=${start}-${end}` };
        const response = await fetch(this.url, { 
            headers, 
            signal: this.abortController.signal 
        });

        if (!response.ok) throw new Error(`Chunk ${index} failed: ${response.status}`);

        const reader = response.body.getReader();
        const chunks = [];
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            if (this.state === 'paused') {
                // 简单的暂停逻辑：中止当前请求，记录进度（实际生产环境需要更复杂的断点记录）
                // 这里简化为：暂停即中断，恢复需重试（或后续优化为真正的断点续传）
                // 为了演示快速下载，暂不实现复杂的持久化断点续传
                throw new Error('Paused');
            }

            chunks.push(value);
            this.updateProgress(value.length);
        }

        // 合并该分块的数据
        this.chunks[index] = new Blob(chunks);
    }

    // 单线程下载（不支持 Range 或大小未知）
    async downloadSingle() {
        const response = await fetch(this.url, { signal: this.abortController.signal });
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
                    state: this.state
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
                filename: this.filename
            });
        }
    }

    // 处理错误
    handleError(error) {
        if (error.message === 'Paused') return; // 暂停不是错误
        
        console.error(`下载错误: ${error.message}`);
        this.state = 'interrupted';
        this.error = error.message;
        
        if (this.onError) {
            this.onError({
                id: this.id,
                error: error.message
            });
        }
    }

    // 暂停
    pause() {
        if (this.state === 'in_progress') {
            this.state = 'paused';
            this.abortController.abort();
            // 重置控制器以便恢复（实际恢复需要记录Range）
            this.abortController = new AbortController();
        }
    }

    // 恢复
    resume() {
        if (this.state === 'paused') {
            this.state = 'in_progress';
            // 简单实现：重新开始（为了演示，实际应实现断点续传）
            this.bytesReceived = 0;
            this.chunks = [];
            this.start();
        }
    }

    // 取消
    cancel() {
        this.state = 'interrupted';
        this.abortController.abort();
    }
}

// 导出给 background.js 使用
// 在 Service Worker 环境中，直接挂载到全局或使用 ES Module (如果 manifest 配置了 module)
// 这里假设 background.js 会通过 importScripts 引入，或者我们将其内容合并
if (typeof self !== 'undefined') {
    self.Downloader = Downloader;
}
