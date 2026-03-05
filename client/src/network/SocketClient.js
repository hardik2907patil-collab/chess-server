/**
 * SocketClient.js — Client-side Socket.io wrapper for multiplayer
 * Handles connection to the server, room management, and move synchronization
 */

export class SocketClient {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.playerColor = null;
        this.connected = false;
        this.lastErrorTime = 0;

        // Callbacks — set by main.js
        this.onConnected = null;
        this.onDisconnected = null;
        this.onRoomCreated = null;    // (code)
        this.onGameStart = null;      // ({ color, roomCode })
        this.onSpectatorStart = null; // ({ roomCode, fen })
        this.onOpponentMove = null;   // ({ from, to, promotion })
        this.onOpponentDisconnected = null;
        this.onMatchQueued = null;    // ({ position })
        this.onMatchCancelled = null;
        this.onError = null;          // (message)
        this.onGameOver = null;       // ({ result })
        this.onDrawOffered = null;
        this.onDrawDeclined = null;
        this.onChatMessage = null;    // ({ text, author })

        // Friends & Presence Callbacks
        this.onFriendListReceived = null; // (friendsArray)
        this.onFriendStatusUpdate = null; // ({id, status})
        this.onFriendAddError = null;     // (errorMessage)
        this.onGameInviteReceived = null; // ({from, avatar, roomCode})
        this.onLeaderboardReceived = null; // (leaderboardArray)
    }

    /**
     * Connect to the server
     */
    connect() {
        // Connect to the backend server
        // IMPORTANT: Replace 'https://your-backend-name.onrender.com' with your actual Render URL before deploying!
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const url = isLocal ? window.location.origin : 'https://chess-server-uscl.onrender.com';

        // Dynamic import for socket.io client from CDN
        return new Promise((resolve, reject) => {
            if (this.socket) {
                resolve();
                return;
            }

            // io should be available globally from the CDN script
            if (typeof io === 'undefined') {
                reject(new Error('Socket.io client not loaded'));
                return;
            }

            this.socket = io(url, {
                transports: ['websocket', 'polling'],
            });

            let connectTimeout = null;

            this.socket.on('connect', () => {
                this.connected = true;
                if (connectTimeout) clearTimeout(connectTimeout);
                console.log('🔌 Connected to server');
                this._setupEventListeners();
                if (this.onConnected) this.onConnected();
                resolve();
            });

            this.socket.on('disconnect', () => {
                this.connected = false;
                console.log('🔌 Disconnected from server');
                if (this.onDisconnected) this.onDisconnected();
            });

            this.socket.on('connect_error', (err) => {
                // Suppress UI modal spam during server restarts / internet drops.
                // Socket.io will automatically keep trying to reconnect in the background.
                console.warn('Socket connection error (reconnecting silently):', err.message);
            });

            // Set a timeout to avoid hanging forever
            connectTimeout = setTimeout(() => {
                if (!this.connected) {
                    if (this.socket) {
                        this.socket.disconnect();
                        this.socket = null;
                    }
                    reject(new Error('Connection timeout'));
                }
            }, 5000);
        });
    }

    /**
     * Set up all incoming event listeners
     */
    _setupEventListeners() {
        if (!this.socket) return;

        this.socket.on('room-created', (data) => {
            this.roomCode = data.code;
            this.playerColor = 'w'; // Creator is white by default
            if (this.onRoomCreated) this.onRoomCreated(data.code);
        });

        this.socket.on('game-start', (data) => {
            if (data.roomCode) this.roomCode = data.roomCode;
            this.playerColor = data.color;
            if (this.onGameStart) this.onGameStart(data);
        });

        this.socket.on('spectator-start', (data) => {
            if (data.roomCode) this.roomCode = data.roomCode;
            this.playerColor = 's'; // Spectator
            if (this.onSpectatorStart) this.onSpectatorStart(data);
        });

        this.socket.on('opponent-move', (move) => {
            if (this.onOpponentMove) this.onOpponentMove(move);
        });

        this.socket.on('opponent-disconnected', () => {
            if (this.onOpponentDisconnected) this.onOpponentDisconnected();
        });

        this.socket.on('match-queued', (data) => {
            if (this.onMatchQueued) this.onMatchQueued(data);
        });

        this.socket.on('match-cancelled', () => {
            if (this.onMatchCancelled) this.onMatchCancelled();
        });

        this.socket.on('error-message', (msg) => {
            if (this.onError) this.onError(msg);
        });

        this.socket.on('game-over', (data) => {
            if (this.onGameOver) this.onGameOver(data);
        });

        this.socket.on('draw-offered', () => {
            if (this.onDrawOffered) this.onDrawOffered();
        });

        this.socket.on('draw-declined', () => {
            if (this.onDrawDeclined) this.onDrawDeclined();
        });

        this.socket.on('chat-message', (data) => {
            if (this.onChatMessage) this.onChatMessage(data);
        });

        // Friends & Presence Events
        this.socket.on('friend-list', (friends) => {
            if (this.onFriendListReceived) this.onFriendListReceived(friends);
        });

        this.socket.on('friend-status-update', (data) => {
            if (this.onFriendStatusUpdate) this.onFriendStatusUpdate(data);
        });

        this.socket.on('friend-add-error', (msg) => {
            if (this.onFriendAddError) this.onFriendAddError(msg);
        });

        this.socket.on('game-invite-received', (data) => {
            if (this.onGameInviteReceived) this.onGameInviteReceived(data);
        });

        // Leaderboard Events
        this.socket.on('leaderboard-data', (data) => {
            if (this.onLeaderboardReceived) this.onLeaderboardReceived(data);
        });
    }

    /**
     * Create a new room
     */
    createRoom() {
        if (!this.socket) return;
        this.socket.emit('create-room');
    }

    /**
     * Join an existing room by code
     */
    joinRoom(code) {
        if (!this.socket) return;
        this.socket.emit('join-room', code);
    }

    /**
     * Enter the matchmaking queue
     */
    findMatch() {
        if (!this.socket) return;
        this.socket.emit('find-match');
    }

    /**
     * Cancel matchmaking
     */
    cancelMatch() {
        if (!this.socket) return;
        this.socket.emit('cancel-match');
    }

    /**
     * Send a move to the server
     */
    sendMove(from, to, promotion) {
        if (!this.socket) return;
        this.socket.emit('move', { from, to, promotion: promotion || null });
    }

    /**
     * Resign the current game
     */
    resign() {
        if (!this.socket) return;
        this.socket.emit('resign');
    }

    /**
     * Offer a draw
     */
    offerDraw() {
        if (!this.socket) return;
        this.socket.emit('offer-draw');
    }

    /**
     * Accept a draw offer
     */
    acceptDraw() {
        if (!this.socket) return;
        this.socket.emit('accept-draw');
    }

    /**
     * Decline a draw offer
     */
    declineDraw() {
        if (!this.socket) return;
        this.socket.emit('decline-draw');
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }

    // ==========================================
    // Network Actions — Authentication & Friends
    // ==========================================
    authLogin(username, password) {
        if (!this.connected) return Promise.reject(new Error('Not connected'));
        return new Promise((resolve, reject) => {
            this.socket.emit('auth-login', { username, password });
            this.socket.once('auth-success', (data) => resolve(data));
            this.socket.once('auth-error', (msg) => reject(new Error(msg)));
        });
    }

    authRegister(username, password, avatar) {
        if (!this.connected) return Promise.reject(new Error('Not connected'));
        return new Promise((resolve, reject) => {
            this.socket.emit('auth-register', { username, password, avatar });
            this.socket.once('auth-success', (data) => resolve(data));
            this.socket.once('auth-error', (msg) => reject(new Error(msg)));
        });
    }

    addFriend(friendName) {
        if (!this.connected) return;
        this.socket.emit('add-friend', friendName);
    }

    updatePresence(status) {
        if (!this.connected) return;
        this.socket.emit('update-status', status);
    }

    inviteFriend(friendId) {
        if (!this.connected) return;
        this.socket.emit('game-invite', friendId);
    }

    requestLeaderboard() {
        if (!this.connected) return;
        this.socket.emit('get-leaderboard');
    }

    sendChatMessage(text) {
        if (!this.connected) return;
        this.socket.emit('chat-message', { text });
    }
}
