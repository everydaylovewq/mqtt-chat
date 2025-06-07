class MQTTChatroom {
  constructor() {
      this.client = null;
      this.username = '';
      this.chatRoom = '';
      this.isConnected = false;
      this.onlineUsers = new Map();
      this.heartbeatInterval = null;
      this.userSyncInterval = null;
      this.lastHeartbeat = Date.now();
      
      this.initializeElements();
      this.bindEvents();
      this.loadSavedSettings();
  }

  initializeElements() {
      // 连接面板元素
      this.connectionPanel = document.getElementById('connectionPanel');
      this.brokerUrlInput = document.getElementById('brokerUrl');
      this.usernameInput = document.getElementById('username');
      this.chatRoomInput = document.getElementById('chatRoom');
      this.connectBtn = document.getElementById('connectBtn');
      
      // 聊天区域元素
      this.chatArea = document.getElementById('chatArea');
      this.messagesList = document.getElementById('messagesList');
      this.messageInput = document.getElementById('messageInput');
      this.sendBtn = document.getElementById('sendBtn');
      this.disconnectBtn = document.getElementById('disconnectBtn');
      
      // 状态显示元素
      this.connectionStatus = document.getElementById('connectionStatus');
      this.onlineCount = document.getElementById('onlineCount');
      this.usersList = document.getElementById('usersList');
      this.charCount = document.getElementById('charCount');
      
      // 通知容器
      this.notificationsContainer = document.getElementById('notifications');
  }

  bindEvents() {
      // 连接按钮事件
      this.connectBtn.addEventListener('click', () => this.connect());
      
      // 发送消息事件
      this.sendBtn.addEventListener('click', () => this.sendMessage());
      this.messageInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              this.sendMessage();
          }
      });
      
      // 字符计数
      this.messageInput.addEventListener('input', () => this.updateCharCount());
      
      // 断开连接事件
      this.disconnectBtn.addEventListener('click', () => this.disconnect());
      
      // 回车键连接
      [this.brokerUrlInput, this.usernameInput, this.chatRoomInput].forEach(input => {
          input.addEventListener('keypress', (e) => {
              if (e.key === 'Enter') {
                  this.connect();
              }
          });
      });

      // 页面关闭时清理
      window.addEventListener('beforeunload', () => {
          this.cleanup();
      });

      // 页面可见性变化处理
      document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
              this.handlePageHidden();
          } else {
              this.handlePageVisible();
          }
      });
  }

  loadSavedSettings() {
      const savedBroker = localStorage.getItem('mqttBroker');
      const savedUsername = localStorage.getItem('mqttUsername');
      const savedRoom = localStorage.getItem('mqttRoom');
      
      if (savedBroker) this.brokerUrlInput.value = savedBroker;
      if (savedUsername) this.usernameInput.value = savedUsername;
      if (savedRoom) this.chatRoomInput.value = savedRoom;
  }

  saveSettings() {
      localStorage.setItem('mqttBroker', this.brokerUrlInput.value);
      localStorage.setItem('mqttUsername', this.usernameInput.value);
      localStorage.setItem('mqttRoom', this.chatRoomInput.value);
  }

  async connect() {
      const brokerUrl = this.brokerUrlInput.value.trim();
      const username = this.usernameInput.value.trim();
      const chatRoom = this.chatRoomInput.value.trim();

      if (!brokerUrl || !username || !chatRoom) {
          this.showNotification('All neural parameters required', 'error');
          return;
      }

      // 检查mqtt是否可用
      if (typeof mqtt === 'undefined') {
          this.showNotification('MQTT library not loaded. Please refresh the page.', 'error');
          return;
      }

      this.connectBtn.disabled = true;
      this.connectBtn.textContent = 'CONNECTING...';

      try {
          const clientId = `neural_${username}_${chatRoom}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // 使用全局的mqtt对象
          this.client = mqtt.connect(brokerUrl, {
              clientId: clientId,
              username: username,
              clean: true,
              reconnectPeriod: 5000,
              keepalive: 30,
              connectTimeout: 10000,
              will: {
                  topic: `chatroom/${chatRoom}/users/leave`,
                  payload: JSON.stringify({
                      username: username,
                      timestamp: new Date().toISOString(),
                      action: 'leave',
                      reason: 'connection_lost'
                  }),
                  qos: 1,
                  retain: false
              }
          });

          this.setupMQTTEventListeners();
          
          this.username = username;
          this.chatRoom = chatRoom;
          this.saveSettings();

      } catch (error) {
          console.error('Connection failed:', error);
          this.showNotification('Neural link failed: ' + error.message, 'error');
          this.resetConnectButton();
      }
  }

  setupMQTTEventListeners() {
      this.client.on('connect', () => {
          console.log('MQTT connection established');
          this.isConnected = true;
          this.updateConnectionStatus(true);
          
          const topics = [
              `chatroom/${this.chatRoom}/messages`,
              `chatroom/${this.chatRoom}/users/join`,
              `chatroom/${this.chatRoom}/users/leave`,
              `chatroom/${this.chatRoom}/users/heartbeat`,
              `chatroom/${this.chatRoom}/users/query`,
              `chatroom/${this.chatRoom}/users/response`
          ];
          
          Promise.all(topics.map(topic => {
              return new Promise((resolve, reject) => {
                  this.client.subscribe(topic, { qos: 1 }, (err) => {
                      if (err) {
                          console.error(`Subscription failed ${topic}:`, err);
                          reject(err);
                      } else {
                          console.log(`Subscribed to: ${topic}`);
                          resolve();
                      }
                  });
              });
          })).then(() => {
              setTimeout(() => {
                  this.publishUserJoin();
                  this.startHeartbeat();
                  this.requestUserList();
              }, 500);
              
              this.showChatArea();
              this.showNotification('Neural link established', 'success');
          }).catch(err => {
              console.error('Subscription failed:', err);
              this.showNotification('Channel sync failed', 'error');
          });
      });

      this.client.on('message', (topic, message) => {
          this.handleIncomingMessage(topic, message.toString());
      });

      this.client.on('error', (error) => {
          console.error('MQTT connection error:', error);
          this.showNotification('Neural error: ' + error.message, 'error');
          this.resetConnectButton();
      });

      this.client.on('close', () => {
          console.log('MQTT connection closed');
          this.isConnected = false;
          this.updateConnectionStatus(false);
          this.stopHeartbeat();
          this.showNotification('Neural link severed', 'error');
      });

      this.client.on('reconnect', () => {
          console.log('Reconnecting...');
          this.showNotification('Reestablishing neural link...', 'info');
      });
  }

  handleIncomingMessage(topic, message) {
      try {
          const data = JSON.parse(message);
          
          if (topic.endsWith('/messages')) {
              this.displayMessage(data);
          } else if (topic.endsWith('/users/join')) {
              this.handleUserJoin(data);
          } else if (topic.endsWith('/users/leave')) {
              this.handleUserLeave(data);
          } else if (topic.endsWith('/users/heartbeat')) {
              this.handleUserHeartbeat(data);
          } else if (topic.endsWith('/users/query')) {
              this.handleUserQuery(data);
          } else if (topic.endsWith('/users/response')) {
              this.handleUserResponse(data);
          }
      } catch (error) {
          console.error('Message parsing failed:', error, message);
      }
  }

  publishUserJoin() {
      const joinMessage = {
          username: this.username,
          timestamp: new Date().toISOString(),
          action: 'join',
          clientId: this.client.options.clientId
      };
      
      this.client.publish(`chatroom/${this.chatRoom}/users/join`, JSON.stringify(joinMessage), { qos: 1 });
      
      this.onlineUsers.set(this.username, {
          username: this.username,
          lastSeen: Date.now(),
          clientId: this.client.options.clientId
      });
      this.updateUsersList();
  }

  publishUserLeave() {
      const leaveMessage = {
          username: this.username,
          timestamp: new Date().toISOString(),
          action: 'leave',
          clientId: this.client.options.clientId
      };
      
      this.client.publish(`chatroom/${this.chatRoom}/users/leave`, JSON.stringify(leaveMessage), { qos: 1 });
  }

  startHeartbeat() {
      this.heartbeatInterval = setInterval(() => {
          if (this.isConnected) {
              const heartbeatMessage = {
                  username: this.username,
                  timestamp: new Date().toISOString(),
                  clientId: this.client.options.clientId
              };
              
              this.client.publish(`chatroom/${this.chatRoom}/users/heartbeat`, JSON.stringify(heartbeatMessage), { qos: 0 });
          }
      }, 15000);

      this.userSyncInterval = setInterval(() => {
          this.cleanupOfflineUsers();
      }, 30000);
  }

  stopHeartbeat() {
      if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
      }
      if (this.userSyncInterval) {
          clearInterval(this.userSyncInterval);
          this.userSyncInterval = null;
      }
  }

  requestUserList() {
      const queryMessage = {
          username: this.username,
          timestamp: new Date().toISOString(),
          action: 'query_users',
          clientId: this.client.options.clientId
      };
      
      this.client.publish(`chatroom/${this.chatRoom}/users/query`, JSON.stringify(queryMessage), { qos: 1 });
  }

  handleUserJoin(data) {
      if (data.username !== this.username) {
          this.onlineUsers.set(data.username, {
              username: data.username,
              lastSeen: Date.now(),
              clientId: data.clientId
          });
          this.updateUsersList();
          this.displaySystemMessage(`${data.username} connected to neural network`);
          
          setTimeout(() => {
              this.respondToUserQuery(data.username);
          }, 1000);
      }
  }

  handleUserLeave(data) {
      if (data.username !== this.username) {
          this.onlineUsers.delete(data.username);
          this.updateUsersList();
          this.displaySystemMessage(`${data.username} disconnected from neural network`);
      }
  }

  handleUserHeartbeat(data) {
      if (data.username !== this.username) {
          this.onlineUsers.set(data.username, {
              username: data.username,
              lastSeen: Date.now(),
              clientId: data.clientId
          });
          this.updateUsersList();
      }
  }

  handleUserQuery(data) {
      if (data.username !== this.username) {
          this.respondToUserQuery(data.username);
      }
  }

  handleUserResponse(data) {
      if (data.targetUser === this.username && data.username !== this.username) {
          this.onlineUsers.set(data.username, {
              username: data.username,
              lastSeen: Date.now(),
              clientId: data.clientId
          });
          this.updateUsersList();
      }
  }

  respondToUserQuery(targetUser) {
      const responseMessage = {
          username: this.username,
          targetUser: targetUser,
          timestamp: new Date().toISOString(),
          action: 'user_response',
          clientId: this.client.options.clientId
      };
      
      this.client.publish(`chatroom/${this.chatRoom}/users/response`, JSON.stringify(responseMessage), { qos: 1 });
  }

  cleanupOfflineUsers() {
      const now = Date.now();
      const timeout = 60000;
      
      for (const [username, userData] of this.onlineUsers.entries()) {
          if (username !== this.username && now - userData.lastSeen > timeout) {
              this.onlineUsers.delete(username);
              this.displaySystemMessage(`${username} neural link timeout`);
          }
      }
      this.updateUsersList();
  }

  sendMessage() {
      const messageText = this.messageInput.value.trim();
      if (!messageText || !this.isConnected) return;

      const message = {
          username: this.username,
          text: messageText,
          timestamp: new Date().toISOString(),
          id: Date.now().toString(),
          clientId: this.client.options.clientId
      };

      this.client.publish(`chatroom/${this.chatRoom}/messages`, JSON.stringify(message), { qos: 1 });
      this.messageInput.value = '';
      this.updateCharCount();
  }

  displayMessage(message) {
      const messageElement = document.createElement('div');
      messageElement.className = `message-slide-in ${message.username === this.username ? 'flex flex-row-reverse' : 'flex'} items-start space-x-3 space-x-reverse`;
      
      const isOwn = message.username === this.username;
      
      messageElement.innerHTML = `
          <div class="flex-shrink-0">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br ${this.getUserGradient(message.username)} flex items-center justify-center text-white font-bold text-sm border border-cyan-500/30 neon-glow">
                  ${message.username.charAt(0).toUpperCase()}
              </div>
          </div>
          <div class="flex-1 max-w-xs sm:max-w-md ${isOwn ? 'text-right' : ''}">
              <div class="flex items-center ${isOwn ? 'justify-end' : ''} space-x-2 mb-1">
                  <span class="text-xs font-orbitron font-bold ${isOwn ? 'text-purple-400' : 'text-cyan-400'}">${message.username}</span>
                  <span class="text-xs text-gray-500 font-mono">${this.formatTime(message.timestamp)}</span>
              </div>
              <div class="inline-block px-4 py-2 rounded-lg ${isOwn ? 'bg-gradient-to-r from-purple-600/80 to-pink-600/80 text-white border border-purple-500/30' : 'bg-black/50 text-cyan-100 border border-cyan-500/30'} backdrop-blur-sm">
                  <p class="text-sm font-mono break-words">${this.escapeHtml(message.text)}</p>
              </div>
          </div>
      `;
      
      this.messagesList.appendChild(messageElement);
      this.scrollToBottom();
  }

  displaySystemMessage(text) {
      const messageElement = document.createElement('div');
      messageElement.className = 'text-center my-4';
      
      messageElement.innerHTML = `
          <div class="inline-block px-4 py-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full text-xs font-orbitron backdrop-blur-sm">
              <span class="mr-2">⚡</span>${text}
          </div>
      `;
      
      this.messagesList.appendChild(messageElement);
      this.scrollToBottom();
  }

  updateUsersList() {
      this.usersList.innerHTML = '';
      
      const sortedUsers = Array.from(this.onlineUsers.keys()).sort();
      
      sortedUsers.forEach(username => {
          const userElement = document.createElement('div');
          userElement.className = 'flex items-center space-x-3 p-2 rounded-lg bg-black/30 border border-cyan-500/20 hover:border-cyan-500/40 transition-all duration-300';
          
          const isCurrentUser = username === this.username;
          
          userElement.innerHTML = `
              <div class="w-8 h-8 rounded-lg bg-gradient-to-br ${this.getUserGradient(username)} flex items-center justify-center text-white font-bold text-xs border border-cyan-500/30">
                  ${username.charAt(0).toUpperCase()}
              </div>
              <div class="flex-1">
                  <div class="text-sm font-mono ${isCurrentUser ? 'text-purple-400 font-bold' : 'text-cyan-300'}">
                      ${username}${isCurrentUser ? ' (YOU)' : ''}
                  </div>
                  <div class="text-xs text-gray-500 font-orbitron">ONLINE</div>
              </div>
              <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
          `;
          
          this.usersList.appendChild(userElement);
      });
      
      this.updateOnlineCount();
  }

  updateOnlineCount() {
      this.onlineCount.textContent = `USERS: ${this.onlineUsers.size}`;
  }

  updateConnectionStatus(connected) {
      if (connected) {
          this.connectionStatus.textContent = 'ONLINE';
          this.connectionStatus.className = 'px-4 py-2 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse-neon';
      } else {
          this.connectionStatus.textContent = 'OFFLINE';
          this.connectionStatus.className = 'px-4 py-2 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30';
      }
  }

  updateCharCount() {
    const count = this.messageInput.value.length;
    this.charCount.textContent = `${count}/500`;
    
    if (count > 450) {
        this.charCount.className = 'text-red-400 font-mono animate-pulse';
    } else {
        this.charCount.className = 'text-cyan-400/70 font-mono';
    }
}

showChatArea() {
    this.connectionPanel.classList.add('hidden');
    this.chatArea.classList.remove('hidden');
    this.chatArea.classList.add('flex');
    this.messageInput.focus();
}

showConnectionPanel() {
    this.connectionPanel.classList.remove('hidden');
    this.chatArea.classList.add('hidden');
    this.chatArea.classList.remove('flex');
    this.messagesList.innerHTML = '';
    this.onlineUsers.clear();
    this.updateOnlineCount();
}

resetConnectButton() {
    this.connectBtn.disabled = false;
    this.connectBtn.textContent = 'ESTABLISH CONNECTION';
}

handlePageHidden() {
    if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                const heartbeatMessage = {
                    username: this.username,
                    timestamp: new Date().toISOString(),
                    clientId: this.client.options.clientId
                };
                
                this.client.publish(`chatroom/${this.chatRoom}/users/heartbeat`, JSON.stringify(heartbeatMessage), { qos: 0 });
            }
        }, 30000);
    }
}

handlePageVisible() {
    if (this.isConnected) {
        this.stopHeartbeat();
        this.startHeartbeat();
        this.requestUserList();
    }
}

cleanup() {
    if (this.client && this.isConnected) {
        this.publishUserLeave();
    }
    this.stopHeartbeat();
}

disconnect() {
    this.cleanup();
    
    if (this.client) {
        this.client.end(true);
    }
    
    this.isConnected = false;
    this.updateConnectionStatus(false);
    this.showConnectionPanel();
    this.showNotification('Neural link terminated', 'info');
}

scrollToBottom() {
    this.messagesList.scrollTop = this.messagesList.scrollHeight;
}

formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

getUserGradient(username) {
    const gradients = [
        'from-cyan-500 to-blue-600',
        'from-purple-500 to-pink-600',
        'from-green-500 to-teal-600',
        'from-yellow-500 to-orange-600',
        'from-red-500 to-pink-600',
        'from-indigo-500 to-purple-600',
        'from-teal-500 to-cyan-600',
        'from-orange-500 to-red-600'
    ];
    
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return gradients[Math.abs(hash) % gradients.length];
}

escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    
    const typeStyles = {
        success: 'bg-green-500/20 border-green-500/30 text-green-400',
        error: 'bg-red-500/20 border-red-500/30 text-red-400',
        info: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
    };
    
    notification.className = `glass-effect ${typeStyles[type]} border rounded-lg p-4 shadow-lg transform transition-all duration-300 translate-x-full`;
    
    notification.innerHTML = `
        <div class="flex items-center space-x-2">
            <div class="w-2 h-2 rounded-full bg-current animate-pulse"></div>
            <span class="font-mono text-sm">${message}</span>
        </div>
    `;
    
    this.notificationsContainer.appendChild(notification);
    
    // 动画进入
    setTimeout(() => {
        notification.classList.remove('translate-x-full');
    }, 100);
    
    // 动画退出并移除
    setTimeout(() => {
        notification.classList.add('translate-x-full');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 4000);
}
}

// 初始化聊天室应用
document.addEventListener('DOMContentLoaded', () => {
// 检查mqtt库是否加载
if (typeof mqtt === 'undefined') {
    console.error('MQTT library not loaded');
    alert('MQTT library failed to load. Please check your internet connection and refresh the page.');
    return;
}

new MQTTChatroom();
});
