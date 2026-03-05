const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function runTest() {
    console.log('Starting Leaderboard Test...');

    // Connect User 1 (Winner)
    const p1 = io(SERVER_URL);
    // Connect User 2 (Loser)
    const p2 = io(SERVER_URL);

    // Track state
    let roomCode = null;

    p1.on('connect', () => {
        console.log('[P1] Connected as', p1.id);
        p1.emit('user-register', { userId: 'player_one_id', name: 'Alice_Test', avatar: '👩' });
    });

    p2.on('connect', () => {
        console.log('[P2] Connected as', p2.id);
        p2.emit('user-register', { userId: 'player_two_id', name: 'Bob_Test', avatar: '👨' });
    });

    p1.on('friend-list', () => {
        // Once registered, create a room
        if (!roomCode) {
            console.log('[P1] Creating room...');
            p1.emit('create-room');
        }
    });

    p1.on('room-created', ({ code }) => {
        console.log('[P1] Room created:', code);
        roomCode = code;
        // P2 joins the room
        p2.emit('join-room', code);
    });

    let p1Color, p2Color;

    p1.on('game-start', ({ color }) => {
        console.log('[P1] Game started. Color:', color);
        p1Color = color;
    });

    p2.on('game-start', ({ color }) => {
        console.log('[P2] Game started. Color:', color);
        p2Color = color;

        // Wait a tiny bit then start moving (Fool's mate)
        setTimeout(playFoolsMate, 500);
    });

    function playFoolsMate() {
        console.log('--- Playing Fool\'s Mate ---');
        // Fool's mate: 1. f3 e5 2. g4 Qh4#
        // Move 1: White f2-f3
        const wMove1 = p1Color === 'w' ? p1 : p2;
        const bMove1 = p1Color === 'b' ? p1 : p2;

        wMove1.emit('move', { from: 'f2', to: 'f3' });

        setTimeout(() => bMove1.emit('move', { from: 'e7', to: 'e5' }), 200);
        setTimeout(() => wMove1.emit('move', { from: 'g2', to: 'g4' }), 400);
        setTimeout(() => bMove1.emit('move', { from: 'd8', to: 'h4' }), 600);
    }

    let gameOverReceived = 0;
    p1.on('game-over', ({ result }) => {
        console.log('[P1] Game Over:', result);
        gameOverReceived++;
        checkLeaderboard();
    });

    p2.on('game-over', ({ result }) => {
        console.log('[P2] Game Over:', result);
        gameOverReceived++;
        checkLeaderboard();
    });

    function checkLeaderboard() {
        if (gameOverReceived === 2) {
            console.log('\n--- Requesting Leaderboard ---');
            setTimeout(() => {
                p1.emit('get-leaderboard');
            }, 500);
        }
    }

    p1.on('leaderboard-data', (data) => {
        console.log('\n===== LEADERBOARD RESULTS =====');
        data.slice(0, 5).forEach((u, i) => {
            console.log(`${i + 1}. ${u.name} | Rating: ${u.rating} | Wins: ${u.wins}`);
        });

        // Verify points
        const alice = data.find(u => u.name === 'Alice_Test');
        const bob = data.find(u => u.name === 'Bob_Test');

        if (alice && bob) {
            console.log('\nVerification:');
            // One of them should have 1225 (winner), the other 1175 (loser)
            if (alice.rating === 1225 || bob.rating === 1225) {
                console.log('✅ WINNER RATING INCREASED (+25)');
            } else {
                console.log('❌ WINNER RATING FAILED');
            }
            if (alice.rating === 1175 || bob.rating === 1175) {
                console.log('✅ LOSER RATING DECREASED (-25)');
            } else {
                console.log('❌ LOSER RATING FAILED');
            }
            if (alice.wins === 1 || bob.wins === 1) {
                console.log('✅ WINNER WIN COUNT INCREASED (+1)');
            } else {
                console.log('❌ WIN COUNT FAILED');
            }
        }

        console.log('\nTest Complete. Exiting...');
        p1.disconnect();
        p2.disconnect();
        process.exit(0);
    });

    // Handle errors
    p1.on('error-message', err => console.error('[P1] Error:', err));
    p2.on('error-message', err => console.error('[P2] Error:', err));
}

runTest();
