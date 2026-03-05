/**
 * index.js — Express + Socket.io server for Checkmate Legends 3D multiplayer
 * Optimized for free-tier hosting: rate limiting, game cap, memory management
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./RoomManager');
const Matchmaker = require('./Matchmaker');
const UserManager = require('./UserManager');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    // Optimize Socket.io for low memory
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e4, // 10KB max message size
});

const PORT = process.env.PORT || 3000;

// ==========================================
// Rate Limiting
// ==========================================
const RATE_LIMIT_WINDOW_MS = 2000; // 2 second window
const RATE_LIMIT_MAX_MOVES = 3;    // max 3 moves per window
const rateLimitMap = new Map();    // socketId -> { moves: number, windowStart: number }

function isRateLimited(socketId) {
    const now = Date.now();
    let entry = rateLimitMap.get(socketId);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        // New window
        entry = { moves: 1, windowStart: now };
        rateLimitMap.set(socketId, entry);
        return false;
    }

    entry.moves++;
    if (entry.moves > RATE_LIMIT_MAX_MOVES) {
        return true; // rate limited
    }
    return false;
}

function cleanupRateLimit(socketId) {
    rateLimitMap.delete(socketId);
}

// Periodic rate limit map cleanup (every 30s)
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 5) {
            rateLimitMap.delete(id);
        }
    }
}, 30000);

// ==========================================
// Middleware
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later."
});
app.use("/api", apiLimiter);

// Disable caching for development
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Serve the client static files
app.use(express.static(path.join(__dirname, '..', 'client'), {
    maxAge: 0,
    etag: false,
    lastModified: false,
}));

app.post('/log', (req, res) => {
    console.error('\n[FRONTEND ERROR]', req.body, '\n');
    res.status(200).send('OK');
});

// Health check endpoint (useful for Render)
app.get('/health', (req, res) => {
    const stats = roomManager.getStats();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        ...stats,
    });
});

// ==========================================
// Managers
// ==========================================
const roomManager = new RoomManager();
const matchmaker = new Matchmaker(roomManager, io);
const userManager = new UserManager();

// ==========================================
// Safe Emit Wrapper — prevents crashes on dead rooms/sockets
// ==========================================
function safeEmit(target, event, payload) {
    try {
        if (!target) return;
        io.to(target).emit(event, payload);
    } catch (err) {
        console.error(`[SafeEmit Error] event=${event}:`, err.message);
    }
}

// Helper: check if a socket is still alive
function isSocketAlive(socketId) {
    return io.sockets.sockets.has(socketId);
}

// Helper: emit game-start to all players in a list of matched rooms
function startMatchedRooms(rooms) {
    for (const room of rooms) {
        if (!room || !room.players) continue;

        try {
            let joinFailed = false;

            room.players.forEach(player => {
                // Verify socket is still connected before joining
                if (!isSocketAlive(player.id)) { joinFailed = true; return; }

                // Verify player isn't already in another match
                const existingRoom = roomManager.getRoom(player.id);
                if (existingRoom && existingRoom.code !== room.code) { joinFailed = true; return; }

                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket && !playerSocket.disconnected) {
                    playerSocket.join(room.code);
                } else {
                    joinFailed = true;
                }
            });

            if (joinFailed) {
                // Rollback silently if any player failed to join
                if (typeof roomManager._destroyRoom === 'function') {
                    roomManager._destroyRoom(room.code);
                } else {
                    room.players.forEach(p => roomManager.removePlayer(p.id));
                }
                continue;
            }

            // Small delay to prevent connection avalanche races
            setTimeout(() => {
                // Fetch the room fresh to ensure it hasn't been destroyed
                const currentRoom = roomManager.rooms.get(room.code);
                if (currentRoom && currentRoom.status === 'initializing') {
                    currentRoom.status = 'active';

                    currentRoom.players.forEach(player => {
                        safeEmit(player.id, 'game-start', {
                            color: player.color,
                            roomCode: currentRoom.code,
                            opponentId: currentRoom.players.find(p => p.id !== player.id)?.id || null,
                        });
                    });
                }
            }, 10);

        } catch (err) {
            console.error('[startMatchedRooms Error]:', err.message);
            if (room && room.code) {
                // rollback
                room.players.forEach(p => roomManager.removePlayer(p.id));
            }
        }
    }
}

// Link RoomManager destruction to Matchmaker queue processing
roomManager.onRoomDestroyed = () => {
    try {
        const rooms = matchmaker.processQueue();
        startMatchedRooms(rooms);
    } catch (err) {
        console.error('[onRoomDestroyed Error]', err.message);
    }
};

// Helper to broadcast status changes to a user's friends
function broadcastPresence(userId) {
    const user = userManager.getUser(userId);
    if (!user) return;

    // For every friend this user has, tell them about the user's current status
    for (const friendId of user.friends) {
        const friend = userManager.getUser(friendId);
        // Only broadcast if the friend is currently connected
        if (friend && friend.socketId) {
            safeEmit(friend.socketId, 'friend-status-update', {
                id: userId,
                status: user.status
            });
        }
    }
}

async function updateMatchStats(winnerId, loserId) {
    try {
        if (winnerId) {
            const result = await db.updateUserStats(winnerId, true, 25);
            const user = userManager.getUser(winnerId);
            if (user && result) {
                user.wins = result.wins;
                user.rating = result.rating;
            }
        }
        if (loserId) {
            const result = await db.updateUserStats(loserId, false, -25);
            const user = userManager.getUser(loserId);
            if (user && result) {
                user.rating = result.rating;
            }
        }
    } catch (e) {
        console.error('Failed to update stats:', e);
    }
}

// ==========================================
// Socket.io Events
// ==========================================
io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);

    // ------------------------------------------
    // User presence & Friends
    // ------------------------------------------
    socket.on('auth-register', async (data) => {
        try {
            const dbUser = await db.registerUser(data.username, data.password, data.avatar);
            const user = userManager.loginUser(dbUser, socket.id);
            socket.emit('auth-success', {
                user: { id: dbUser.id, name: user.name, avatar: user.avatar, rating: user.rating, wins: user.wins }
            });
            socket.emit('friend-list', userManager.getFriendsData(dbUser.id));
            broadcastPresence(dbUser.id);
        } catch (err) {
            socket.emit('auth-error', err.message);
        }
    });

    socket.on('auth-login', async (data) => {
        try {
            const dbUser = await db.loginUser(data.username, data.password);
            const user = userManager.loginUser(dbUser, socket.id);
            socket.emit('auth-success', {
                user: { id: dbUser.id, name: user.name, avatar: user.avatar, rating: user.rating, wins: user.wins }
            });
            socket.emit('friend-list', userManager.getFriendsData(dbUser.id));
            broadcastPresence(dbUser.id);
        } catch (err) {
            socket.emit('auth-error', err.message);
        }
    });

    socket.on('add-friend', (friendName) => {
        console.log(`[DEBUG] Received add-friend from ${socket.id} for name: ${friendName}`);
        const result = userManager.addFriendByName(socket.id, friendName);
        console.log(`[DEBUG] addFriendByName result:`, result);

        if (result.success) {
            const { requesterId, friendId } = result;

            // Send updated list to requester
            socket.emit('friend-list', userManager.getFriendsData(requesterId));

            // If friend is online, send updated list to them too
            const friend = userManager.getUser(friendId);
            if (friend && friend.socketId) {
                safeEmit(friend.socketId, 'friend-list', userManager.getFriendsData(friendId));
            }
        } else {
            console.log(`[DEBUG] Sending friend-add-error to ${socket.id}:`, result.message);
            socket.emit('friend-add-error', result.message);
        }
    });

    socket.on('update-status', (status) => {
        const userId = userManager.updateStatus(socket.id, status);
        if (userId) {
            broadcastPresence(userId);
        }
    });

    socket.on('get-leaderboard', async () => {
        try {
            const leaderboard = await db.getLeaderboard(50);
            const formatted = leaderboard.map(u => ({
                name: u.username,
                avatar: '👤',
                rating: u.rating,
                wins: u.wins
            }));
            socket.emit('leaderboard-data', formatted);
        } catch (e) {
            console.error('Error fetching leaderboard:', e);
        }
    });

    socket.on('game-invite', (friendId) => {
        const requesterId = userManager.getUserIdBySocket(socket.id);
        const requester = userManager.getUser(requesterId);
        const friend = userManager.getUser(friendId);

        if (requester && friend && friend.socketId && friend.status === 'online') {
            // Ensure requester has a room
            let room = roomManager.getRoom(socket.id);
            if (!room) {
                room = roomManager.createRoom(socket.id);
                if (room) {
                    socket.join(room.code);
                    socket.emit('room-created', { code: room.code });
                }
            }

            if (room) {
                safeEmit(friend.socketId, 'game-invite-received', {
                    from: requester.name,
                    avatar: requester.avatar,
                    roomCode: room.code
                });
            }
        }
    });

    // ------------------------------------------
    // Create Room
    // ------------------------------------------
    socket.on('create-room', () => {
        if (roomManager.isAtCapacity()) {
            socket.emit('error-message', 'Server is at capacity. Please try again later.');
            return;
        }

        const room = roomManager.createRoom(socket.id);
        if (!room) {
            socket.emit('error-message', 'Could not create room. Server may be at capacity.');
            return;
        }

        socket.join(room.code);
        socket.emit('room-created', { code: room.code });
        console.log(`🏠 Room created: ${room.code} by ${socket.id}`);
    });

    // ------------------------------------------
    // Join Room
    // ------------------------------------------
    socket.on('join-room', (code) => {
        if (typeof code !== 'string' || code.length > 10) {
            socket.emit('error-message', 'Invalid room code');
            return;
        }

        const result = roomManager.joinRoom(socket.id, code);

        if (result.error) {
            socket.emit('error-message', result.error);
            return;
        }

        const room = result.room;
        socket.join(room.code);

        if (result.isSpectator) {
            // Send current game state to spectator
            socket.emit('spectator-start', {
                roomCode: room.code,
                fen: room.session.getFEN(),
            });
            console.log(`👁️ Spectator joined room ${room.code}`);
        } else {
            // Notify both players that game starts
            room.status = 'active';
            room.players.forEach(player => {
                safeEmit(player.id, 'game-start', {
                    color: player.color,
                    roomCode: room.code,
                    opponentId: room.players.find(p => p.id !== player.id)?.id || null,
                });
            });

            console.log(`🎮 Game started in room ${room.code}`);
        }
    });

    // ------------------------------------------
    // Quick Match (Matchmaking)
    // ------------------------------------------
    socket.on('find-match', () => {
        console.log(`🔍 Player ${socket.id} looking for match...`);
        const rooms = matchmaker.addToQueue(socket.id);

        if (rooms.length > 0) {
            startMatchedRooms(rooms);
        } else {
            socket.emit('match-queued', { position: matchmaker.getQueueLength() });
        }
    });

    // ------------------------------------------
    // Cancel matchmaking
    // ------------------------------------------
    socket.on('cancel-match', () => {
        matchmaker.removeFromQueue(socket.id);
        socket.emit('match-cancelled');
    });

    // ------------------------------------------
    // Make a move (with rate limiting) — HARDENED
    // ------------------------------------------
    socket.on('move', (data) => {
        try {
            // Guard: socket must still be connected
            if (socket.disconnected) return;

            // Destructure safely
            if (!data || typeof data !== 'object') return;
            const { from, to, promotion } = data;

            // Input validation
            if (typeof from !== 'string' || typeof to !== 'string' || from.length !== 2 || to.length !== 2) {
                socket.emit('error-message', 'Invalid move data');
                return;
            }

            // Rate limit check
            if (isRateLimited(socket.id)) {
                socket.emit('error-message', 'Too many moves. Slow down.');
                return;
            }

            const room = roomManager.getRoom(socket.id);
            if (!room || !room.session) {
                socket.emit('error-message', 'Not in a room');
                return;
            }

            // Guard: game must be fully active
            if (room.status !== 'active') return;

            // Guard: game must not already be over
            if (room.session.isGameOver()) return;

            const playerColor = roomManager.getPlayerColor(socket.id);
            const currentTurn = room.session.getTurn();

            // Verify it's this player's turn
            if (playerColor !== currentTurn) {
                socket.emit('error-message', 'Not your turn');
                return;
            }

            // Validate and execute the move on the server
            const move = room.session.makeMove(from, to, promotion || undefined);
            if (!move) {
                socket.emit('error-message', 'Invalid move');
                return;
            }

            // Update activity timestamp
            roomManager.touchRoom(socket.id);

            // Send the move to the opponent
            const opponentId = roomManager.getOpponentId(socket.id);
            if (opponentId && isSocketAlive(opponentId)) {
                safeEmit(opponentId, 'opponent-move', {
                    from: move.from,
                    to: move.to,
                    promotion: move.promotion || null,
                });
            }

            // Broadcast move to all spectators
            if (room.spectators) {
                room.spectators.forEach(s => {
                    if (isSocketAlive(s.id)) {
                        safeEmit(s.id, 'opponent-move', {
                            from: move.from,
                            to: move.to,
                            promotion: move.promotion || null,
                        });
                    }
                });
            }

            // Confirm move to the sender
            socket.emit('move-confirmed', {
                from: move.from,
                to: move.to,
            });

            // Check game over
            if (room.session.isGameOver()) {
                const resultMsg = room.session.getResult();
                safeEmit(room.code, 'game-over', { result: resultMsg });
                console.log(`🏁 Game over in room ${room.code}: ${resultMsg}`);

                // Update stats if it was a decisive win
                if (resultMsg.includes('wins')) {
                    const winnerSocketId = socket.id;
                    const loserSocketId = opponentId;

                    const winnerId = userManager.getUserIdBySocket(winnerSocketId);
                    const loserId = userManager.getUserIdBySocket(loserSocketId);

                    if (winnerId || loserId) {
                        updateMatchStats(winnerId, loserId);
                    }
                }

                // Schedule cleanup of finished game data
                roomManager.scheduleCleanup(room.code);
            }
        } catch (err) {
            console.error(`[Move Handler Error] socket=${socket.id}:`, err.message);
        }
    });

    // ------------------------------------------
    // In-Game Chat
    // ------------------------------------------
    socket.on('chat-message', (data) => {
        const room = roomManager.getRoom(socket.id);
        if (room) {
            // Get the sender's profile to display their name
            const userId = userManager.getUserIdBySocket(socket.id);
            const user = userManager.getUser(userId);
            const authorName = user ? user.name : 'Opponent';

            // Broadcast to the other player in the room
            socket.to(room.code).emit('chat-message', {
                text: data.text,
                author: authorName
            });
        }
    });

    // ------------------------------------------
    // Resign
    // ------------------------------------------
    socket.on('resign', () => {
        try {
            const room = roomManager.getRoom(socket.id);
            if (!room || !room.session) return;
            if (room.session.isGameOver()) return; // prevent double resign

            const playerColor = roomManager.getPlayerColor(socket.id);
            const opponentId = roomManager.getOpponentId(socket.id);
            const winner = playerColor === 'w' ? 'Black' : 'White';
            const result = `${winner} wins by resignation!`;
            room.session.setResult(result);

            safeEmit(room.code, 'game-over', { result });
            console.log(`🏳️ Player resigned in room ${room.code}`);

            // Update stats
            const loserId = userManager.getUserIdBySocket(socket.id);
            const winnerId = userManager.getUserIdBySocket(opponentId);
            updateMatchStats(winnerId, loserId);

            // Schedule cleanup
            roomManager.scheduleCleanup(room.code);
        } catch (err) {
            console.error(`[Resign Error] socket=${socket.id}:`, err.message);
        }
    });

    // ------------------------------------------
    // Offer Draw
    // ------------------------------------------
    socket.on('offer-draw', () => {
        try {
            const opponentId = roomManager.getOpponentId(socket.id);
            if (opponentId && isSocketAlive(opponentId)) {
                safeEmit(opponentId, 'draw-offered');
            }
        } catch (err) {
            console.error(`[Draw Offer Error]:`, err.message);
        }
    });

    socket.on('accept-draw', () => {
        try {
            const room = roomManager.getRoom(socket.id);
            if (!room || !room.session) return;
            if (room.session.isGameOver()) return; // prevent double accept

            const result = 'Game drawn by agreement!';
            room.session.setResult(result);
            safeEmit(room.code, 'game-over', { result });
            console.log(`🤝 Draw agreed in room ${room.code}`);

            // Schedule cleanup
            roomManager.scheduleCleanup(room.code);
        } catch (err) {
            console.error(`[Accept Draw Error]:`, err.message);
        }
    });

    socket.on('decline-draw', () => {
        try {
            const opponentId = roomManager.getOpponentId(socket.id);
            if (opponentId && isSocketAlive(opponentId)) {
                safeEmit(opponentId, 'draw-declined');
            }
        } catch (err) {
            console.error(`[Decline Draw Error]:`, err.message);
        }
    });

    // ------------------------------------------
    // Disconnect — graceful cleanup
    // ------------------------------------------
    socket.on('disconnect', () => {
        try {
            console.log(`❌ Player disconnected: ${socket.id}`);

            // Remove from matchmaking
            matchmaker.removeFromQueue(socket.id);

            // Clean up rate limit entry
            cleanupRateLimit(socket.id);

            // Notify opponent and clean up room
            const room = roomManager.getRoom(socket.id);
            if (room) {
                // Disconnect lock: if still initializing, delete silently to prevent race errors
                if (room.status === 'initializing') {
                    roomManager.removePlayer(socket.id);
                    if (typeof roomManager._destroyRoom === 'function') {
                        roomManager._destroyRoom(room.code);
                    }
                    return;
                }

                const opponentId = roomManager.getOpponentId(socket.id);

                if (opponentId && room.session && !room.session.isGameOver()) {
                    // Auto-forfeit: disconnected player loses
                    const result = 'Opponent disconnected. You win!';
                    room.session.setResult(result);
                    safeEmit(room.code, 'game-over', { result });
                    if (isSocketAlive(opponentId)) {
                        safeEmit(opponentId, 'opponent-disconnected');
                    }
                    console.log(`🔌 Player disconnected in room ${room.code}. Auto-forfeit.`);

                    // Update stats
                    const loserId = userManager.getUserIdBySocket(socket.id);
                    const winnerId = userManager.getUserIdBySocket(opponentId);
                    updateMatchStats(winnerId, loserId);

                    roomManager.removePlayer(socket.id);
                    matchmaker.removeFromQueue(socket.id);

                    const userId = userManager.disconnectUser(socket.id);
                    if (userId) {
                        broadcastPresence(userId);
                    }

                    const stats = roomManager.getStats();
                    console.log(`📊 Active: ${stats.rooms} rooms, ${stats.players} players, ${stats.activeGames}/${stats.maxGames} games`);

                    roomManager.scheduleCleanup(room.code);
                } else {
                    // Clean up non-active or already finished room connections
                    if (opponentId && isSocketAlive(opponentId)) {
                        safeEmit(opponentId, 'opponent-disconnected');
                    }
                    roomManager.removePlayer(socket.id);
                    const userId = userManager.disconnectUser(socket.id);
                    if (userId) broadcastPresence(userId);
                }
            } else {
                // Player wasn't in a room, just mark them offline
                const userId = userManager.disconnectUser(socket.id);
                if (userId) broadcastPresence(userId);
            }
        } catch (err) {
            console.error(`[Disconnect Handler Error] socket=${socket.id}:`, err.message);
            // Last-resort cleanup
            try {
                roomManager.removePlayer(socket.id);
                matchmaker.removeFromQueue(socket.id);
                cleanupRateLimit(socket.id);
                userManager.disconnectUser(socket.id);
            } catch (e) { /* swallow */ }
        }
    });
});

// ==========================================
// Periodic Memory Stats (every 5 min)
// ==========================================
setInterval(() => {
    const mem = process.memoryUsage();
    const stats = roomManager.getStats();
    console.log(`📊 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB | ${stats.activeGames}/${stats.maxGames} games | ${stats.players} players`);
}, 5 * 60 * 1000);

// ==========================================
// Graceful Shutdown
// ==========================================
function shutdown() {
    console.log('\n🛑 Shutting down gracefully...');
    roomManager.destroy();
    io.close();
    server.close(() => {
        console.log('👋 Server closed');
        process.exit(0);
    });
    // Force exit after 5s if graceful close hangs
    setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ==========================================
// USER STORAGE (temporary in-memory database)
// ==========================================
const users = [];

app.get("/", (req, res) => {
    res.send("Chess server running");
});

// REGISTER
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;

    if (!username || typeof username !== 'string' || username.length < 3 || username.length > 20) {
        return res.status(400).json({
            success: false,
            message: "Username must be between 3 and 20 characters"
        });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({
            success: false,
            message: "Password must be at least 6 characters long"
        });
    }

    const existing = users.find(u => u.username === username);
    if (existing) {
        return res.status(400).json({
            success: false,
            message: "User already exists"
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword });

        res.json({
            success: true,
            message: "User registered successfully"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// LOGIN
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
        return res.status(400).json({ success: false, message: "Username and password required" });
    }

    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({
            success: false,
            message: "Invalid username or password"
        });
    }

    try {
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        res.json({
            success: true,
            message: "Login successful"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ==========================================
// Start Server
// ==========================================
db.initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`\n🚀 Checkmate Legends 3D Server running on http://localhost:${PORT}`);
        console.log(`   Max concurrent games: ${roomManager.getStats().maxGames}`);
        console.log(`   Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
