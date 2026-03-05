/**
 * RoomManager.js — Room lifecycle management with memory optimization
 * Auto-cleans completed games, caps concurrent rooms, sweeps stale sessions.
 */
const GameSession = require('./GameSession');

const MAX_CONCURRENT_GAMES = 500; // Support 1000 simultaneous players
const STALE_ROOM_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
const FINISHED_GAME_CLEANUP_MS = 60 * 1000;     // 1 minute after game over
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;        // sweep every 2 minutes

class RoomManager {
    constructor() {
        this.rooms = new Map();        // roomCode -> room object
        this.playerRooms = new Map();  // socketId -> roomCode

        // Callback for matchmaker to hook into
        this.onRoomDestroyed = null;

        // Start periodic stale room sweeper
        this._sweepInterval = setInterval(() => this._sweepStaleRooms(), SWEEP_INTERVAL_MS);
    }

    /**
     * Generate a random 6-character room code
     */
    generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
        let code;
        do {
            code = '';
            for (let i = 0; i < 6; i++) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
        } while (this.rooms.has(code));
        return code;
    }

    /**
     * Create a new room. Returns the room object or null if at capacity.
     */
    createRoom(socketId) {
        // Remove player from any existing room first
        this.removePlayer(socketId);

        // Enforce game cap
        const activeCount = this._getActiveGameCount();
        if (activeCount >= MAX_CONCURRENT_GAMES) {
            return null; // at capacity
        }

        const code = this.generateCode();
        const room = {
            code,
            players: [
                { id: socketId, color: 'w' }
            ],
            spectators: [],
            session: new GameSession(),
            status: 'initializing',
            createdAt: Date.now(),
            lastActivity: Date.now(),
        };

        this.rooms.set(code, room);
        this.playerRooms.set(socketId, code);

        return room;
    }

    /**
     * Join an existing room by code. Returns { room } or { error }.
     */
    joinRoom(socketId, code) {
        code = code.toUpperCase().trim();
        const room = this.rooms.get(code);

        if (!room) return { error: 'Room not found' };
        if (room.players[0].id === socketId || (room.players[1] && room.players[1].id === socketId)) {
            return { error: 'You are already in this room' };
        }
        if (room.spectators.find(s => s.id === socketId)) {
            return { error: 'You are already spectating this room' };
        }

        // Remove from any existing room
        this.removePlayer(socketId);

        let isSpectator = false;
        if (room.players.length >= 2) {
            // Room is full, join as spectator
            room.spectators.push({ id: socketId });
            isSpectator = true;
        } else {
            // Join as active player
            room.players.push({ id: socketId, color: 'b' });
        }

        room.lastActivity = Date.now();
        this.playerRooms.set(socketId, code);

        return { room, isSpectator };
    }

    /**
     * Get the room a player is in
     */
    getRoom(socketId) {
        const code = this.playerRooms.get(socketId);
        if (!code) return null;
        return this.rooms.get(code) || null;
    }

    /**
     * Get the opponent's socket ID
     */
    getOpponentId(socketId) {
        const room = this.getRoom(socketId);
        if (!room) return null;
        const opponent = room.players.find(p => p.id !== socketId);
        return opponent ? opponent.id : null;
    }

    /**
     * Get the player's color in their room
     */
    getPlayerColor(socketId) {
        const room = this.getRoom(socketId);
        if (!room) return null;
        const player = room.players.find(p => p.id === socketId);
        return player ? player.color : null;
    }

    /**
     * Update room activity timestamp (called on each move)
     */
    touchRoom(socketId) {
        const room = this.getRoom(socketId);
        if (room) {
            room.lastActivity = Date.now();
        }
    }

    /**
     * Schedule cleanup of a finished game room after a short delay
     */
    scheduleCleanup(roomCode) {
        setTimeout(() => {
            const room = this.rooms.get(roomCode);
            if (room && room.session.isGameOver()) {
                this._destroyRoom(roomCode);
                console.log(`🧹 Cleaned up finished room: ${roomCode}`);
            }
        }, FINISHED_GAME_CLEANUP_MS);
    }

    /**
     * Remove a player from their room. Cleans up empty rooms.
     */
    removePlayer(socketId) {
        const code = this.playerRooms.get(socketId);
        if (!code) return null;

        const room = this.rooms.get(code);
        this.playerRooms.delete(socketId);

        if (!room) return null;

        // Check if they were an active player or spectator
        room.players = room.players.filter(p => p.id !== socketId);
        room.spectators = room.spectators.filter(s => s.id !== socketId);

        // If room has no active players, destroy it immediately
        if (room.players.length === 0) {
            this._destroyRoom(code);
        }

        return room;
    }

    /**
     * Destroy a room and free all associated memory
     */
    _destroyRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return;

        // Clean up player references
        room.players.forEach(p => {
            this.playerRooms.delete(p.id);
        });
        room.spectators.forEach(s => {
            this.playerRooms.delete(s.id);
        });

        // Null out session data to help GC
        room.session = null;
        room.players = null;
        room.spectators = null;

        this.rooms.delete(roomCode);

        if (this.onRoomDestroyed) {
            this.onRoomDestroyed();
        }
    }

    /**
     * Sweep and destroy stale rooms (no activity for STALE_ROOM_TIMEOUT_MS)
     */
    _sweepStaleRooms() {
        const now = Date.now();
        let swept = 0;

        for (const [code, room] of this.rooms) {
            const age = now - room.lastActivity;

            // Destroy rooms that are stale or finished
            if (age > STALE_ROOM_TIMEOUT_MS || (room.session && room.session.isGameOver())) {
                this._destroyRoom(code);
                swept++;
            }
        }

        if (swept > 0) {
            console.log(`🧹 Swept ${swept} stale room(s). Active: ${this.rooms.size}`);
        }
    }

    /**
     * Count active (non-finished) games
     */
    _getActiveGameCount() {
        let count = 0;
        for (const room of this.rooms.values()) {
            if (room.session && !room.session.isGameOver() && room.players.length === 2) {
                count++;
            }
        }
        return count;
    }

    /**
     * Check if server is at game capacity
     */
    isAtCapacity() {
        return this._getActiveGameCount() >= MAX_CONCURRENT_GAMES;
    }

    /**
     * Get stats for logging
     */
    getStats() {
        return {
            rooms: this.rooms.size,
            players: this.playerRooms.size,
            activeGames: this._getActiveGameCount(),
            maxGames: MAX_CONCURRENT_GAMES,
        };
    }

    /**
     * Cleanup on server shutdown
     */
    destroy() {
        if (this._sweepInterval) {
            clearInterval(this._sweepInterval);
        }
        this.rooms.clear();
        this.playerRooms.clear();
    }
}

module.exports = RoomManager;
