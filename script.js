class MQTTChatroom {
    constructor() {
        this.client = null;
        this.username = '';
        this.chatRoom = '';
        this.isConnected = false;
        this.onlineUsers = new Set();
        
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
            this.showNotification('请填写所有必要信息', 'error');
            return;
        }

        this.connectBtn.disabled = true;
        this.connectBtn.textContent = '连接中...';

        try {
            // 创建MQTT客户端
            this.client = mqtt.connect(brokerUrl, {
                clientId: `chat_${username}_${Date.now()}`,
                username: username,
                clean: true,
                reconnectPeriod: 5000,
                keepalive: 60
            });

            // 设置连接事件监听器
            this.setupMQTTEventListeners();
            
            this.username = username;
            this.chatRoom = chatRoom;
            this.saveSettings();

        } catch (error) {
            console.error('连接失败:', error);
            this.showNotification('连接失败: ' + error.message, 'error');
            this.resetConnectButton();
        }
    }

    setupMQTTEventListeners() {
        // 连接成功
        this.client.on('connect', () => {
            console.log('MQTT连接成功');
            this.isConnected = true;
            this.updateConnectionStatus(true);
            
            // 订阅聊天室主题
            const topics = [
                `chatroom/${this.chatRoom}/messages`,
                `chatroom/${this.chatRoom}/users/join`,
                `chatroom/${this.chatRoom}/users/leave`,
                `chatroom/${this.chatRoom}/users/list`
            ];
            
            topics.forEach(topic => {
                this.client.subscribe(topic, (err) => {
                    if (err) {
                        console.error(`订阅主题失败 ${topic}:`, err);
                    }
                });
            });
            
            // 发送用户加入通知
            this.publishUserJoin();
            
            // 显示聊天区域
            this.showChatArea();
            this.showNotification('成功连接到聊天室!', 'success');
        });

        // 接收消息
        this.client.on('message', (topic, message) => {
            this.handleIncomingMessage(topic, message.toString());
        });

        // 连接错误
        this.client.on('error', (error) => {
            console.error('MQTT连接错误:', error);
            this.showNotification('连接错误: ' + error.message, 'error');
            this.resetConnectButton();
        });

        // 连接断开
        this.client.on('close', () => {
            console.log('MQTT连接已断开');
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.showNotification('连接已断开', 'error');
        });

        // 重连中
        this.client.on('reconnect', () => {
            console.log('正在重连...');
            this.showNotification('正在重连...', 'info');
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
            } else if (topic.endsWith('/users/list')) {
                this.updateUsersList(data.users);
            }
        } catch (error) {
            console.error('解析消息失败:', error);
        }
    }

    publishUserJoin() {
        const joinMessage = {
            username: this.username,
            timestamp: new Date().toISOString(),
            action: 'join'
        };
        
        this.client.publish(`chatroom/${this.chatRoom}/users/join`, JSON.stringify(joinMessage));
    }

    publishUserLeave() {
        const leaveMessage = {
            username: this.username,
            timestamp: new Date().toISOString(),
            action: 'leave'
        };
        
        this.client.publish(`chatroom/${this.chatRoom}/users/leave`, JSON.stringify(leaveMessage));
    }

    sendMessage() {
        const messageText = this.messageInput.value.trim();
        if (!messageText || !this.isConnected) return;

        const message = {
            username: this.username,
            text: messageText,
            timestamp: new Date().toISOString(),
            id: Date.now().toString()
        };

        this.client.publish(`chatroom/${this.chatRoom}/messages`, JSON.stringify(message));
        this.messageInput.value = '';
        this.updateCharCount();
    }

    displayMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.username === this.username ? 'own' : ''}`;
        
        const avatar = this.createAvatar(message.username);
        const content = this.createMessageContent(message);
        
        messageElement.appendChild(avatar);
        messageElement.appendChild(content);
        
        this.messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    createAvatar(username) {
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = username.charAt(0).toUpperCase();
        avatar.style.background = this.getUserColor(username);
        return avatar;
    }

    createMessageContent(message) {
        const content = document.createElement('div');
        content.className = 'message-content';
        
        const header = document.createElement('div');
        header.className = 'message-header';
        
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'message-username';
        usernameSpan.textContent = message.username;
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = this.formatTime(message.timestamp);
        
        header.appendChild(usernameSpan);
        header.appendChild(timeSpan);
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = message.text;
        
        content.appendChild(header);
        content.appendChild(textDiv);
        
        return content;
    }

    handleUserJoin(data) {
        this.onlineUsers.add(data.username);
        this.updateOnlineCount();
        this.updateUsersList();
        
        if (data.username !== this.username) {
            this.displaySystemMessage(`${data.username} 加入了聊天室`);
        }
    }

    handleUserLeave(data) {
        this.onlineUsers.delete(data.username);
        this.updateOnlineCount();
        this.updateUsersList();
        
        if (data.username !== this.username) {
            this.displaySystemMessage(`${data.username} 离开了聊天室`);
        }
    }

    displaySystemMessage(text) {
        const messageElement = document.createElement('div');
        messageElement.className = 'system-message';
        messageElement.textContent = text;
        this.messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    updateUsersList(users = null) {
        if (users) {
            this.onlineUsers = new Set(users);
        }
        
        this.usersList.innerHTML = '';
        
        Array.from(this.onlineUsers).sort().forEach(username => {
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            
            const avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            avatar.textContent = username.charAt(0).toUpperCase();
            avatar.style.background = this.getUserColor(username);
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = username;
            
            userElement.appendChild(avatar);
            userElement.appendChild(nameSpan);
            this.usersList.appendChild(userElement);
        });
        
        this.updateOnlineCount();
    }

    updateOnlineCount() {
        this.onlineCount.textContent = `在线: ${this.onlineUsers.size}`;
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.connectionStatus.textContent = '已连接';
            this.connectionStatus.className = 'status-connected';
        } else {
            this.connectionStatus.textContent = '未连接';
            this.connectionStatus.className = 'status-disconnected';
        }
    }

    updateCharCount() {
        const count = this.messageInput.value.length;
        this.charCount.textContent = `${count}/500`;
        
        if (count > 450) {
            this.charCount.style.color = '#ff4757';
        } else {
            this.charCount.style.color = '#999';
        }
    }

    showChatArea() {
        this.connectionPanel.style.display = 'none';
        this.chatArea.style.display = 'grid';
        this.messageInput.focus();
    }

    showConnectionPanel() {
        this.connectionPanel.style.display = 'flex';
        this.chatArea.style.display = 'none';
        this.messagesList.innerHTML = '';
        this.onlineUsers.clear();
        this.updateOnlineCount();
    }

    resetConnectButton() {
        this.connectBtn.disabled = false;
        this.connectBtn.textContent = '连接聊天室';
    }

    disconnect() {
        if (this.client && this.isConnected) {
            this.publishUserLeave();
            this.client.end();
        }
        
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.showConnectionPanel();
        this.showNotification('已断开连接', 'info');
    }

    scrollToBottom() {
        this.messagesList.scrollTop = this.messagesList.scrollHeight;
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    getUserColor(username) {
        const colors = [
            'linear-gradient(45deg, #667eea, #764ba2)',
            'linear-gradient(45deg, #f093fb, #f5576c)',
            'linear-gradient(45deg, #4facfe, #00f2fe)',
            'linear-gradient(45deg, #43e97b, #38f9d7)',
            'linear-gradient(45deg, #fa709a, #fee140)',
            'linear-gradient(45deg, #a8edea, #fed6e3)',
            'linear-gradient(45deg, #ff9a9e, #fecfef)',
            'linear-gradient(45deg, #ffecd2, #fcb69f)'
        ];
        
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        return colors[Math.abs(hash) % colors.length];
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        this.notificationsContainer.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// 初始化聊天室应用
document.addEventListener('DOMContentLoaded', () => {
    new MQTTChatroom();
});
