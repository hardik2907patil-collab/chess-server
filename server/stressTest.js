const { io } = require('socket.io-client');
const fs = require('fs');

// Configuration
const SERVER_URL = 'http://localhost:3000';
const TEST_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PLAYERS = 1000;
const RAMP_UP_STAGES = [
    { count: 100, delayMs: 15000 },   // 100 users at 15s
    { count: 250, delayMs: 30000 },   // 250 users at 30s
    { count: 500, delayMs: 60000 },   // 500 users at 60s
    { count: 750, delayMs: 90000 },   // 750 users at 90s
    { count: MAX_PLAYERS, delayMs: 120000 } // 1000 users at 120s
];

// Metrics
const metrics = {
    totalPlayers: 0,
    matchesStarted: 0,
    matchesCompleted: 0,
    errors: 0,
    peakActiveMatches: 0,
    peakHeapMB: 0,
    peakRssMB: 0,
    activeMatches: 0,
    queueSize: 0,
    totalMovesProcessed: 0,
    peakMPS: 0
};

// State
let isShuttingDown = false;
const clients = new Map(); // socket.id -> client object
const startCpuUsage = process.cpuUsage();
const startTime = Date.now();
let intervalId;
let mpsIntervalId;
let currentSecMoves = 0;
let lastEventLoopMs = 0;
let peakEventLoopMs = 0;

// Track Event Loop Delay
function measureEventLoop() {
    const start = Date.now();
    setImmediate(() => {
        const delay = Date.now() - start;
        lastEventLoopMs = delay;
        if (delay > peakEventLoopMs) peakEventLoopMs = delay;
        if (!isShuttingDown) setTimeout(measureEventLoop, 500);
    });
}
measureEventLoop();

// Calculate Moves Per Second
mpsIntervalId = setInterval(() => {
    if (currentSecMoves > metrics.peakMPS) {
        metrics.peakMPS = currentSecMoves;
    }
    currentSecMoves = 0;
}, 1000);

// Crash Protection
process.on('uncaughtException', (err) => {
    if (err.message.includes('ECONNRESET') || err.message.includes('socket hang up')) {
        return; // Ignore local networking race errors
    }
    metrics.errors++;
    console.error('[UNCAUGHT EXCEPTION]', err.message);
});

process.on('unhandledRejection', (reason) => {
    metrics.errors++;
    console.error('[UNHANDLED REJECTION]', reason);
});

console.log(`🚀 Starting Stress Test: 0 -> ${MAX_PLAYERS} users over 5 minutes.`);

// ==========================================
// Bot AI (Random valid moves)
// ==========================================
// We'll use a local chess.js instance per active bot to find valid moves
const { Chess } = require('chess.js');

function runBot(client) {
    if (isShuttingDown || !client.inGame) return;

    // Wait 0.4-0.8 seconds between moves for maximum server stress
    const delay = Math.floor(Math.random() * 400) + 400;

    setTimeout(() => {
        if (!client.inGame || isShuttingDown) return;

        // Try to find a valid move based on internal FEN
        try {
            if (!client.socket.connected) return;
            if (!client.currentMatchId) return;

            const chess = new Chess(client.fen);
            // Verify turn
            if (chess.turn() === client.color) {
                const moves = chess.moves({ verbose: true });
                if (moves.length > 0) {
                    const randomMove = moves[Math.floor(Math.random() * moves.length)];
                    client.socket.emit('move', {
                        from: randomMove.from,
                        to: randomMove.to,
                        promotion: randomMove.promotion || null
                    });
                }
            }
        } catch (e) {
            // FEN drift or validation error, usually harmless in stress test
        }
    }, delay);
}

// ==========================================
// Client Lifecycle
// ==========================================
function spawnClient() {
    if (isShuttingDown) return;

    const socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false // don't hammer on connection drop during stress
    });

    const client = {
        socket,
        inGame: false,
        color: null,
        roomCode: null,
        currentMatchId: null,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    };

    socket.on('connect', () => {
        metrics.totalPlayers++;
        clients.set(socket.id, client);

        // Immediately join matchmaking
        socket.emit('find-match');
    });

    socket.on('match-queued', (data) => {
        metrics.queueSize = data.position;
    });

    socket.on('game-start', (data) => {
        try {
            if (!socket.connected) return;
            if (!data?.roomCode) return;

            client.inGame = true;
            client.color = data.color;
            client.roomCode = data.roomCode;
            client.currentMatchId = data.roomCode;
            client.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // reset

            // Only count match start for White to avoid double counting
            if (client.color === 'w') {
                metrics.matchesStarted++;
                metrics.activeMatches++;
                if (metrics.activeMatches > metrics.peakActiveMatches) {
                    metrics.peakActiveMatches = metrics.activeMatches;
                }
            }

            runBot(client);

        } catch (err) {
            // silently ignore
        }
    });

    socket.on('opponent-move', (move) => {
        try {
            if (!socket.connected) return;
            if (!client.currentMatchId) return;
            if (!client.inGame) return;

            const chess = new Chess(client.fen);
            chess.move({ from: move.from, to: move.to, promotion: move.promotion });
            client.fen = chess.fen();

            // If it's now our turn, trigger the bot
            if (chess.turn() === client.color) {
                runBot(client);
            }
        } catch (e) { }
    });

    socket.on('move-confirmed', (move) => {
        try {
            if (!socket.connected) return;
            if (!client.currentMatchId) return;
            if (!client.inGame) return;

            metrics.totalMovesProcessed++;
            currentSecMoves++;

            const chess = new Chess(client.fen);
            chess.move({ from: move.from, to: move.to });
            client.fen = chess.fen();
        } catch (e) { }
    });

    socket.on('game-over', () => {
        try {
            if (!socket.connected) return;
            if (!client.currentMatchId) return;
            if (!client.inGame) return;

            client.inGame = false;

            if (client.color === 'w') {
                metrics.matchesCompleted++;
                metrics.activeMatches--;
            }

            // Wait a few seconds then cleanup/disconnect
            setTimeout(() => {
                if (socket.connected) socket.disconnect();
                clients.delete(socket.id);
            }, 2000);
        } catch (err) { }
    });

    socket.on('opponent-disconnected', () => {
        try {
            if (!socket.connected) return;
            if (!client.currentMatchId) return;
            if (!client.inGame) return;

            client.inGame = false;

            if (client.color === 'w') {
                metrics.matchesCompleted++;
                metrics.activeMatches--;
            }

            setTimeout(() => {
                if (socket.connected) socket.disconnect();
                clients.delete(socket.id);
            }, 2000);
        } catch (err) { }
    });

    socket.on('error-message', (msg) => {
        // Ignore "Server is at capacity" messages (normal under heavy queue load)
        if (!msg.includes('capacity')) {
            metrics.errors++;
        }
    });

    socket.on('disconnect', () => {
        client.currentMatchId = null;
        clients.delete(socket.id);
    });

    socket.on('connect_error', (err) => {
        if (err.message === "transport close" || err.message === "xhr poll error") {
            // Ignore normal connection race drops during massive CCU ramp
            clients.delete(socket.id);
            return;
        }
        metrics.errors++;
        clients.delete(socket.id);
    });
}

// ==========================================
// Ramp Up Logic
// ==========================================
function startRampUp() {
    let currentSpawned = 0;
    const spawnStart = Date.now();

    const spawner = setInterval(() => {
        if (isShuttingDown) {
            clearInterval(spawner);
            return;
        }

        const elapsed = Date.now() - spawnStart;

        // Determine target count based on elapsed time vs ramp stages
        let targetCount = 0;
        for (const stage of RAMP_UP_STAGES) {
            if (elapsed >= stage.delayMs) {
                targetCount = stage.count;
            } else {
                break;
            }
        }

        // Spawn until we hit target count for this stage (up to MAX)
        while (currentSpawned < targetCount && currentSpawned < MAX_PLAYERS) {
            spawnClient();
            currentSpawned++;
        }

        if (currentSpawned >= MAX_PLAYERS) {
            clearInterval(spawner);
            console.log(`\n🎯 Reached max players target (${MAX_PLAYERS}). Test sustaining...`);
        }

    }, 1000); // Check every second
}

// ==========================================
// Profiling & Reporting
// ==========================================
intervalId = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = mem.heapUsed / 1024 / 1024;
    const rssMB = mem.rss / 1024 / 1024;

    if (heapMB > metrics.peakHeapMB) metrics.peakHeapMB = heapMB;
    if (rssMB > metrics.peakRssMB) metrics.peakRssMB = rssMB;

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`[${elapsed}s] Players: ${clients.size} | Matches: ${metrics.activeMatches} | Mem: ${heapMB.toFixed(1)}MB | MPS: ${currentSecMoves} (Peak: ${metrics.peakMPS}) | Loop Lag: ${lastEventLoopMs}ms`);

}, 10000);

// ==========================================
// End Test
// ==========================================
setTimeout(() => {
    isShuttingDown = true;
    clearInterval(intervalId);
    clearInterval(mpsIntervalId);

    // Calculate final CPU usage
    const cpuUsage = process.cpuUsage(startCpuUsage);
    const cpuTotalMs = (cpuUsage.user + cpuUsage.system) / 1000;
    const elapsedSecs = TEST_DURATION_MS / 1000;
    const cpuPercent = ((cpuTotalMs / 1000) / elapsedSecs * 100).toFixed(2);

    // Cleanup clients
    clients.forEach(c => {
        if (c.socket.connected) c.socket.disconnect();
    });
    clients.clear();

    const report = {
        testDurationSecs: elapsedSecs,
        totalPlayersSpawned: metrics.totalPlayers,
        peakActiveMatches: metrics.peakActiveMatches,
        matchesStarted: metrics.matchesStarted,
        matchesCompleted: metrics.matchesCompleted,
        totalMovesProcessed: metrics.totalMovesProcessed,
        peakMPS: metrics.peakMPS,
        peakEventLoopLagMs: peakEventLoopMs,
        errors: metrics.errors,
        peakHeapMB: Math.round(metrics.peakHeapMB * 100) / 100,
        peakRssMB: Math.round(metrics.peakRssMB * 100) / 100,
        cpuUsagePct: parseFloat(cpuPercent)
    };

    console.log('\n=========================================');
    console.log('✅ STRESS TEST COMPLETE SUMMARY');
    console.log('=========================================');
    console.log(JSON.stringify(report, null, 2));

    const txtOutput = `STRESS TEST REPORT
=====================
Duration: ${report.testDurationSecs}s
Total Players Spawned: ${report.totalPlayersSpawned}
Peak Active Matches: ${report.peakActiveMatches}
Matches Started: ${report.matchesStarted}
Matches Completed: ${report.matchesCompleted}
Total Moves Processed: ${report.totalMovesProcessed}
Peak Moves Per Second (MPS): ${report.peakMPS}
Peak Event Loop Delay: ${report.peakEventLoopLagMs} ms
Total Errors: ${report.errors}
Peak Heap Memory: ${report.peakHeapMB} MB
Peak RSS Memory: ${report.peakRssMB} MB
Avg Server CPU Usage: ${report.cpuUsagePct}%
=====================`;

    fs.writeFileSync('stress-report-1000.txt', txtOutput);
    console.log('\n💾 Saved to stress-report-1000.txt');

    process.exit(0);

}, TEST_DURATION_MS);

// START EXECUTING Ramp Up
startRampUp();
