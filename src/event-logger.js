const EventEmitter = require('events');

/**
 * EventLogger - Real-time event logging system for Zoho replication
 * Emits structured events that can be consumed by SSE endpoints or other listeners
 */
class EventLogger extends EventEmitter {
  constructor() {
    super();
    this.operationId = null;
    this.startTime = null;
    this.logBuffer = [];
    this.maxBufferSize = 1000;

    // Track active SSE clients
    this.sseClients = new Set();

    // Statistics
    this.stats = {
      totalEvents: 0,
      errorCount: 0,
      successCount: 0,
      warningCount: 0
    };
  }

  /**
   * Generate a unique operation ID
   */
  startOperation(operationName = 'operation') {
    this.operationId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.startTime = Date.now();

    this.log('info', 'operation:start', {
      message: `Operation started: ${operationName}`,
      operationId: this.operationId
    });

    return this.operationId;
  }

  /**
   * End current operation
   */
  endOperation(success = true, summary = {}) {
    const duration = Date.now() - this.startTime;

    this.log(success ? 'success' : 'error', 'operation:end', {
      message: success ? 'Operation completed successfully' : 'Operation failed',
      operationId: this.operationId,
      duration,
      ...summary
    });

    this.operationId = null;
    this.startTime = null;
  }

  /**
   * Log an event with structured data
   * @param {string} level - Log level: info, success, warning, error, progress
   * @param {string} event - Event type (e.g., 'table:export:start')
   * @param {object} data - Event data
   */
  log(level, event, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      operationId: this.operationId,
      ...data
    };

    // Add to buffer
    this.logBuffer.push(logEntry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Update statistics
    this.stats.totalEvents++;
    if (level === 'error') this.stats.errorCount++;
    if (level === 'success') this.stats.successCount++;
    if (level === 'warning') this.stats.warningCount++;

    // Emit event for listeners
    this.emit('log', logEntry);
    this.emit(event, logEntry);

    // Console output
    const emoji = this.getEmoji(level, event);
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${emoji} ${data.message || event}`);

    // Send to SSE clients
    this.broadcastToSSEClients(logEntry);

    return logEntry;
  }

  /**
   * Convenience methods for different log levels
   */
  info(event, data) {
    return this.log('info', event, data);
  }

  success(event, data) {
    return this.log('success', event, data);
  }

  warning(event, data) {
    return this.log('warning', event, data);
  }

  error(event, data) {
    return this.log('error', event, data);
  }

  progress(event, data) {
    return this.log('progress', event, data);
  }

  /**
   * Get appropriate emoji for log level/event
   */
  getEmoji(level, event) {
    if (event.includes(':start')) return '🚀';
    if (event.includes(':complete') || event.includes(':end')) return '✅';
    if (event.includes(':failed')) return '❌';
    if (event.includes('export')) return '📊';
    if (event.includes('import')) return '💾';
    if (event.includes('language')) return '🌐';
    if (event.includes('scheduler')) return '📅';
    if (event.includes('progress')) return '⏳';

    switch (level) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'progress': return '⏳';
      case 'info':
      default: return 'ℹ️';
    }
  }

  /**
   * Register an SSE client
   */
  registerSSEClient(res) {
    this.sseClients.add(res);

    // Send initial connection message
    const welcomeMessage = {
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'connection:established',
      message: 'Connected to log stream'
    };

    this.sendSSE(res, welcomeMessage);

    // Send recent logs
    const recentLogs = this.getRecentLogs(50);
    recentLogs.forEach(log => this.sendSSE(res, log));

    console.log(`📡 New SSE client connected. Total clients: ${this.sseClients.size}`);
  }

  /**
   * Unregister an SSE client
   */
  unregisterSSEClient(res) {
    this.sseClients.delete(res);
    console.log(`📡 SSE client disconnected. Total clients: ${this.sseClients.size}`);
  }

  /**
   * Broadcast log entry to all SSE clients
   */
  broadcastToSSEClients(logEntry) {
    const deadClients = [];

    this.sseClients.forEach(res => {
      try {
        this.sendSSE(res, logEntry);
      } catch (error) {
        deadClients.push(res);
      }
    });

    // Clean up dead clients
    deadClients.forEach(client => this.unregisterSSEClient(client));
  }

  /**
   * Send SSE message to a client
   */
  sendSSE(res, data) {
    if (res.writableEnded) {
      throw new Error('Response already ended');
    }

    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count = 100) {
    return this.logBuffer.slice(-count);
  }

  /**
   * Get all logs
   */
  getAllLogs() {
    return [...this.logBuffer];
  }

  /**
   * Clear log buffer
   */
  clearLogs() {
    this.logBuffer = [];
    this.stats = {
      totalEvents: 0,
      errorCount: 0,
      successCount: 0,
      warningCount: 0
    };

    this.info('logs:cleared', {
      message: 'Log buffer cleared'
    });
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.logBuffer.length,
      connectedClients: this.sseClients.size,
      currentOperation: this.operationId,
      operationDuration: this.startTime ? Date.now() - this.startTime : null
    };
  }

  /**
   * Send heartbeat to keep SSE connections alive
   */
  startHeartbeat(interval = 30000) {
    this.heartbeatInterval = setInterval(() => {
      const heartbeat = {
        timestamp: new Date().toISOString(),
        event: 'heartbeat',
        stats: this.getStats()
      };

      this.broadcastToSSEClients(heartbeat);
    }, interval);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

// Create singleton instance
const eventLogger = new EventLogger();

// Start heartbeat
eventLogger.startHeartbeat();

module.exports = eventLogger;