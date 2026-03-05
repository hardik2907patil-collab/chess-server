/**
 * Matchmaker.js — Auto-matchmaking queue
 * Drains the entire queue each cycle, creating as many matches as possible.
 */

class Matchmaker {
    constructor(roomManager, io) {
        this.queue = [];           // array of socket IDs waiting
        this.roomManager = roomManager;
        this.io = io;              // socket.io server instance (for connectivity checks)
    }

    /**
     * Add a player to the matchmaking queue.
     * Returns an array of all rooms created by draining the queue.
     */
    addToQueue(socketId) {
        // Don't add duplicates
        if (this.queue.includes(socketId)) return [];

        this.queue.push(socketId);

        // Drain the queue — returns array of rooms
        return this.processQueue();
    }

    /**
     * Drain the queue: keep pairing players until < 2 remain.
     * Returns an array of all rooms that were created this cycle.
     */
    processQueue() {
        const matchedRooms = [];

        // Filter out any disconnected sockets before matching
        if (this.io) {
            this.queue = this.queue.filter(id => this.io.sockets.sockets.has(id));
        }

        // Deduplicate (safety net)
        this.queue = [...new Set(this.queue)];

        const queueBefore = this.queue.length;

        while (this.queue.length >= 2) {
            const player1 = this.queue.shift();
            const player2 = this.queue.shift();

            // Double-check both sockets still exist
            if (this.io) {
                const s1 = this.io.sockets.sockets.get(player1);
                const s2 = this.io.sockets.sockets.get(player2);
                if (!s1 && !s2) continue;          // both gone
                if (!s1) { this.queue.unshift(player2); continue; }
                if (!s2) { this.queue.unshift(player1); continue; }
            }

            const room = this.pairPlayers(player1, player2);
            if (room) {
                matchedRooms.push(room);
            } else {
                // pairPlayers failed (capacity) — stop trying
                break;
            }
        }

        if (matchedRooms.length > 0 || queueBefore >= 2) {
            console.log(`[Matchmaker] Queue: ${queueBefore} → ${this.queue.length} | Matches created: ${matchedRooms.length}`);
        }

        return matchedRooms;
    }

    /**
     * Remove a player from the queue (if they cancel or disconnect)
     */
    removeFromQueue(socketId) {
        this.queue = this.queue.filter(id => id !== socketId);
    }

    /**
     * Pair two players by creating a room
     */
    pairPlayers(player1Id, player2Id) {
        const room = this.roomManager.createRoom(player1Id);
        if (!room) {
            // Server at capacity — re-queue both players at front
            this.queue.unshift(player2Id);
            this.queue.unshift(player1Id);
            console.warn('Matchmaking failed: server at capacity');
            return null;
        }

        const result = this.roomManager.joinRoom(player2Id, room.code);

        if (result.error) {
            console.error('Matchmaking pair error:', result.error);
            return null;
        }

        return result.room;
    }

    /**
     * Check if a player is in the queue
     */
    isInQueue(socketId) {
        return this.queue.includes(socketId);
    }

    /**
     * Get queue length
     */
    getQueueLength() {
        return this.queue.length;
    }
}

module.exports = Matchmaker;
