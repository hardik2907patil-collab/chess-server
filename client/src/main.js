/**
 * main.js — Application entry point
 * Sets up Three.js scene, camera, lighting, and initializes the chess game
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChessGame } from './game/ChessGame.js?v=10';
import { PIECE_UNICODE } from './game/Pieces3D.js?v=10';
import { ChessTimer } from './game/ChessTimer.js?v=10';
import { SocketClient } from './network/SocketClient.js?v=10';
import { StockfishAI } from './ai/StockfishAI.js?v=10';
// ==========================================
// Scene Setup
// ==========================================
let currentLanguage = localStorage.getItem('appLanguage') || 'en';
let currentTheme = localStorage.getItem('appTheme') || 'classic';
const scene = new THREE.Scene();
scene.background = null; // transparent — CSS background shows through
scene.fog = new THREE.FogExp2(0x2a1840, 0.018);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
const container = document.getElementById('canvas-container');
container.appendChild(renderer.domElement);

// Camera
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 10, 12);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 20;
controls.minPolarAngle = Math.PI / 8;
controls.maxPolarAngle = Math.PI / 2.8; // prevent dipping too low
controls.target.set(0, -1.5, -2); // look down and deep to shift pieces UP and away from bottom UI

// ==========================================
// Lighting
// ==========================================
// Ambient — bright enough to see the board clearly
const ambient = new THREE.AmbientLight(0x606080, 1.4);
scene.add(ambient);

// Main directional light
const dirLight = new THREE.DirectionalLight(0xfff5e8, 1.8);
dirLight.position.set(5, 12, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 30;
dirLight.shadow.camera.left = -8;
dirLight.shadow.camera.right = 8;
dirLight.shadow.camera.top = 8;
dirLight.shadow.camera.bottom = -8;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

// Fill light (cooler)
const fillLight = new THREE.DirectionalLight(0x8888cc, 0.6);
fillLight.position.set(-5, 8, -3);
scene.add(fillLight);

// Top-down board spotlight for clear visibility
const boardLight = new THREE.PointLight(0xffffff, 1.0, 18);
boardLight.position.set(0, 8, 0);
scene.add(boardLight);

// Rim light
const rimLight = new THREE.PointLight(0xffffff, 0.4, 20);
rimLight.position.set(0, 5, -6);
scene.add(rimLight);

// Ground plane (subtle reflection feel)
const groundGeo = new THREE.PlaneGeometry(50, 50);
const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1e1230,
    roughness: 0.8,
    metalness: 0.2,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.25;
ground.receiveShadow = true;
scene.add(ground);

// ==========================================
// Game
// ==========================================
const game = new ChessGame(scene, camera, renderer.domElement);
game.setTheme(currentTheme);

// ==========================================
// Multiplayer — Socket.io Client
// ==========================================
// Load or generate a persistent User ID
let myUserId = localStorage.getItem('chessUserId');
if (!myUserId) {
    myUserId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('chessUserId', myUserId);
}

// ==========================================
// Setup Application
// ==========================================
let gameName = localStorage.getItem('playerName') || 'Player';
let gameAvatar = localStorage.getItem('playerAvatar') || '👤';

// Initialize network client
const socketClient = new SocketClient();

let isAuthenticated = false;

socketClient.onConnected = async () => {
    // Try auto-login if credentials exist
    const savedUser = localStorage.getItem('chessUsername');
    const savedPass = localStorage.getItem('chessPassword');

    if (savedUser && savedPass) {
        try {
            const data = await socketClient.authLogin(savedUser, savedPass);
            setPlayerName(data.user.name, data.user.avatar, data.user.rating, data.user.wins);
        } catch (e) {
            console.error('Auto-login failed:', e.message);
            localStorage.removeItem('chessPassword'); // Clear invalid password
            isAuthenticated = false;
        }
    }

    document.getElementById('badge-matchmaking').style.display = 'block';
    document.getElementById('badge-join').style.display = 'block';
};

// ==========================================
// UI References
// ==========================================
const loadingScreen = document.getElementById('loading-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const turnText = document.getElementById('turn-text');
const turnDot = document.querySelector('.turn-dot');
const moveListEl = document.getElementById('move-list');
const playerNameEl = document.getElementById('player-name');
const opponentNameEl = document.getElementById('opponent-name');
const playerCapturedEl = document.getElementById('player-captured');
const opponentCapturedEl = document.getElementById('opponent-captured');
const statusBar = document.getElementById('status-bar');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalActions = document.getElementById('modal-actions');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnToggleChat = document.getElementById('btn-toggle-chat');
const btnEmojiToggle = document.getElementById('btn-emoji-toggle');
const emojiPicker = document.getElementById('emoji-picker');
const chatBadge = document.getElementById('chat-badge');
let unreadChatCount = 0;

// ==========================================
// Screen Management
// ==========================================
function showScreen(screen) {
    [loadingScreen, lobbyScreen, gameScreen].forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
}

// Default camera position (white side)
const DEFAULT_CAM = { x: 0, y: 7.2, z: 8.5 }; // close again for size, angled slightly up
// Black side camera
const BLACK_CAM = { x: 0, y: 7.2, z: -8.5 };

function setCameraForColor(color) {
    const pos = color === 'b' ? BLACK_CAM : DEFAULT_CAM;
    camera.position.set(pos.x, pos.y, pos.z);
    // Look past the center and downwards to shift the whole board up on the 2D screen
    controls.target.set(0, -0.6, color === 'b' ? 1.0 : -1.0);
    controls.update();
}

function resetCamera() {
    setCameraForColor('w');
}

function showModal(title, message, buttons = []) {
    modalTitle.textContent = title;
    modalMessage.innerHTML = message;
    modalActions.innerHTML = '';
    buttons.forEach(btn => {
        const el = document.createElement('button');
        el.className = `modal-btn ${btn.type || 'primary'}`;
        el.textContent = btn.label;
        el.addEventListener('click', () => {
            hideModal();
            if (btn.action) btn.action();
        });
        modalActions.appendChild(el);
    });
    modalOverlay.classList.remove('hidden');
}

function hideModal() {
    modalOverlay.classList.add('hidden');
}

// ==========================================
// Game Callbacks
// ==========================================
game.onTurnChange = (turn) => {
    turnText.textContent = turn === 'w' ? "White's turn" : "Black's turn";
    if (turnDot) {
        turnDot.classList.toggle('black', turn === 'b');
    }
};

game.onMoveMade = (move, history, captured) => {
    updateMoveList(history);
    updateCapturedPieces(captured);
};

game.onGameOver = (result) => {
    showModal('Game Over', result, [
        { label: 'New Game', action: () => startLocalGame() },
        { label: 'Back to Lobby', type: 'secondary', action: () => { resetCamera(); showScreen(lobbyScreen); } },
    ]);
};

// Timer tick → update HUD timers
game.onTimerTick = (wt, bt) => {
    const playerTimer = document.getElementById('player-timer');
    const opponentTimer = document.getElementById('opponent-timer');

    // In online/AI mode for black, swap which timer is "yours"
    const viewAsBlack = game.mode !== 'local' && game.playerColor === 'b';
    const yourTime = viewAsBlack ? bt : wt;
    const theirTime = viewAsBlack ? wt : bt;

    playerTimer.textContent = ChessTimer.formatTime(yourTime);
    opponentTimer.textContent = ChessTimer.formatTime(theirTime);

    playerTimer.classList.toggle('low', yourTime <= 30 && yourTime > 0);
    opponentTimer.classList.toggle('low', theirTime <= 30 && theirTime > 0);
};

// Promotion choice → show modal with 4 piece options
game.onPromotionChoice = (color) => {
    return new Promise((resolve) => {
        const pieces = [
            { type: 'q', icon: color === 'w' ? '♕' : '♛', label: 'Queen' },
            { type: 'r', icon: color === 'w' ? '♖' : '♜', label: 'Rook' },
            { type: 'b', icon: color === 'w' ? '♗' : '♝', label: 'Bishop' },
            { type: 'n', icon: color === 'w' ? '♘' : '♞', label: 'Knight' },
        ];

        modalTitle.textContent = 'Pawn Promotion';
        modalMessage.innerHTML = 'Choose a piece:';
        modalActions.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'promotion-grid';

        pieces.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'promotion-btn';
            btn.innerHTML = `<span class="promo-icon">${p.icon}</span><span class="promo-label">${p.label}</span>`;
            btn.addEventListener('click', () => {
                hideModal();
                resolve(p.type);
            });
            grid.appendChild(btn);
        });

        modalActions.appendChild(grid);
        modalOverlay.classList.remove('hidden');
    });
};

function updateMoveList(history) {
    moveListEl.innerHTML = '';
    for (let i = 0; i < history.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const white = history[i] ? history[i].san : '';
        const black = history[i + 1] ? history[i + 1].san : '';

        const row = document.createElement('div');
        row.className = 'move-row';
        row.innerHTML = `
      <span class="move-num">${moveNum}.</span>
      <span class="move-white">${white}</span>
      <span class="move-black">${black}</span>
    `;
        moveListEl.appendChild(row);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
}

function updateCapturedPieces(captured) {
    // White's captured pieces (pieces black lost)
    playerCapturedEl.textContent = captured.w.map(p => PIECE_UNICODE[p] || p).join(' ');
    opponentCapturedEl.textContent = captured.b.map(p => PIECE_UNICODE[p.toUpperCase()] || p).join(' ');
}

// ==========================================
// Time Control Selection
// ==========================================
const TIME_CONTROLS = [
    { label: '5 min', seconds: 300 },
    { label: '10 min', seconds: 600 },
    { label: '15 min', seconds: 900 },
    { label: 'No Timer', seconds: 0 },
];

function showTimeControlModal() {
    return new Promise((resolve) => {
        modalTitle.textContent = 'Time Control';
        modalMessage.innerHTML = 'Select time for each player:';
        modalActions.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'time-control-grid';

        TIME_CONTROLS.forEach(tc => {
            const btn = document.createElement('button');
            btn.className = 'modal-btn primary';
            btn.textContent = tc.label;
            btn.addEventListener('click', () => {
                hideModal();
                resolve(tc.seconds);
            });
            grid.appendChild(btn);
        });

        modalActions.appendChild(grid);
        modalOverlay.classList.remove('hidden');
    });
}

function setTimerDisplay(seconds) {
    const display = seconds > 0 ? ChessTimer.formatTime(seconds) : '∞';
    document.getElementById('player-timer').textContent = display;
    document.getElementById('opponent-timer').textContent = display;
    document.getElementById('player-timer').classList.remove('low');
    document.getElementById('opponent-timer').classList.remove('low');
}

// ==========================================
// Lobby Buttons
// ==========================================
async function startLocalGame() {
    const timeSeconds = await showTimeControlModal();
    // Use timeout to let the modal close animation run before freezing the thread with 3D math
    setTimeout(() => {
        game.mode = 'local';
        game.timeControl = timeSeconds;
        game.onMoveSend = null; // no network in local mode
        game.init();
        playerNameEl.textContent = 'White';
        opponentNameEl.textContent = 'Black';
        setTimerDisplay(timeSeconds);
        resetCamera();
        showScreen(gameScreen);
    }, 50);
}

document.getElementById('btn-local-2p').addEventListener('click', startLocalGame);

// ==========================================
// Settings
// ==========================================
let soundEnabled = true;

const uiTranslations = {
    en: {
        tagline: "Realistic 3D Chess — Play Online or vs AI",
        quickMatchTitle: "Quick Match",
        quickMatchDesc: "Find an opponent online",
        createRoomTitle: "Create Room",
        createRoomDesc: "Invite a friend to play",
        joinRoomTitle: "Join Room",
        joinRoomDesc: "Enter a room code",
        playAITitle: "Play vs AI",
        playAIDesc: "Offline against Stockfish",
        local2PTitle: "Local 2 Player",
        local2PDesc: "Play on the same device",
        leaderboardTitle: "🏆 Top Players"
    },
    hi: {
        tagline: "यथार्थवादी 3D शतरंज — ऑनलाइन खेलें या AI के खिलाफ",
        quickMatchTitle: "त्वरित मैच",
        quickMatchDesc: "ऑनलाइन एक मैच खोजें",
        createRoomTitle: "रूम बनाएं",
        createRoomDesc: "मित्र को आमंत्रित करें",
        joinRoomTitle: "रूम से जुड़ें",
        joinRoomDesc: "रूम कोड दर्ज करें",
        playAITitle: "AI के खिलाफ खेलें",
        playAIDesc: "स्टॉकफ़िश के खिलाफ ऑफ़लाइन",
        local2PTitle: "स्थानीय 2 खिलाड़ी",
        local2PDesc: "एक ही डिवाइस पर खेलें",
        leaderboardTitle: "🏆 शीर्ष खिलाड़ी"
    },
    es: {
        tagline: "Ajedrez 3D Realista — Juega en línea o vs IA",
        quickMatchTitle: "Partida Rápida",
        quickMatchDesc: "Encuentra un oponente en línea",
        createRoomTitle: "Crear Sala",
        createRoomDesc: "Invita a un amigo a jugar",
        joinRoomTitle: "Unirse a Sala",
        joinRoomDesc: "Introduce un código de sala",
        playAITitle: "Jugar vs IA",
        playAIDesc: "Desconectado contra Stockfish",
        local2PTitle: "Local 2 Jugadores",
        local2PDesc: "Juega en el mismo dispositivo",
        leaderboardTitle: "🏆 Mejores Jugadores"
    },
    fr: {
        tagline: "Échecs 3D Réalistes — Jouer en ligne ou contre l'IA",
        quickMatchTitle: "Partie Rapide",
        quickMatchDesc: "Trouvez un adversaire en ligne",
        createRoomTitle: "Créer un Salon",
        createRoomDesc: "Invitez un ami à jouer",
        joinRoomTitle: "Rejoindre un Salon",
        joinRoomDesc: "Entrez un code de salon",
        playAITitle: "Jouer vs IA",
        playAIDesc: "Hors ligne contre Stockfish",
        local2PTitle: "Local 2 Joueurs",
        local2PDesc: "Jouez sur le même appareil",
        leaderboardTitle: "🏆 Meilleurs Joueurs"
    },
    de: {
        tagline: "Realistisches 3D-Schach — Online spielen oder gegen KI",
        quickMatchTitle: "Schnelles Spiel",
        quickMatchDesc: "Finde online einen Gegner",
        createRoomTitle: "Raum erstellen",
        createRoomDesc: "Lade einen Freund zum Spielen ein",
        joinRoomTitle: "Raum beitreten",
        joinRoomDesc: "Gib einen Raumcode ein",
        playAITitle: "Gegen KI spielen",
        playAIDesc: "Offline gegen Stockfish",
        local2PTitle: "Lokal 2 Spieler",
        local2PDesc: "Spielen Sie auf demselben Gerät",
        leaderboardTitle: "🏆 Top Spieler"
    }
};

function applyLanguage(lang) {
    const t = uiTranslations[lang] || uiTranslations['en'];
    const updateText = (id, selector, text) => {
        const el = document.getElementById(id);
        if (el) {
            const childel = el.querySelector(selector);
            if (childel) childel.textContent = text;
        }
    };

    const tag = document.querySelector('.tagline');
    if (tag) tag.textContent = t.tagline;

    updateText('btn-matchmaking', 'h3', t.quickMatchTitle);
    updateText('btn-matchmaking', 'p', t.quickMatchDesc);
    updateText('btn-create-room', 'h3', t.createRoomTitle);
    updateText('btn-create-room', 'p', t.createRoomDesc);
    updateText('btn-join-room', 'h3', t.joinRoomTitle);
    updateText('btn-join-room', 'p', t.joinRoomDesc);
    updateText('btn-play-ai', 'h3', t.playAITitle);
    updateText('btn-play-ai', 'p', t.playAIDesc);
    updateText('btn-local-2p', 'h3', t.local2PTitle);
    updateText('btn-local-2p', 'p', t.local2PDesc);

    const lbTitle = document.querySelector('.leaderboard-title');
    if (lbTitle) lbTitle.textContent = t.leaderboardTitle;
}

// Initial application of saved language
applyLanguage(currentLanguage);

document.getElementById('btn-settings').addEventListener('click', () => {
    modalTitle.textContent = 'Settings';
    modalMessage.innerHTML = '';
    modalActions.innerHTML = '';

    const group = document.createElement('div');
    group.className = 'settings-group';

    // Sound toggle
    const soundRow = document.createElement('div');
    soundRow.className = 'settings-row';
    soundRow.innerHTML = `<label>🔊 Sound Effects</label>`;
    const soundToggle = document.createElement('button');
    soundToggle.className = `toggle-switch ${soundEnabled ? 'active' : ''}`;
    soundToggle.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundToggle.classList.toggle('active', soundEnabled);
        game.sound.muted = !soundEnabled;
    });
    soundRow.appendChild(soundToggle);
    group.appendChild(soundRow);

    // Language selector
    const langRow = document.createElement('div');
    langRow.className = 'settings-row';
    langRow.innerHTML = `<label>🌐 Language</label>`;
    const langSelect = document.createElement('select');
    const languages = [
        { code: 'en', name: 'English' },
        { code: 'hi', name: 'हिन्दी (Hindi)' },
        { code: 'es', name: 'Español' },
        { code: 'fr', name: 'Français' },
        { code: 'de', name: 'Deutsch' },
    ];
    languages.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = lang.name;
        if (lang.code === currentLanguage) opt.selected = true;
        langSelect.appendChild(opt);
    });
    langSelect.addEventListener('change', () => {
        currentLanguage = langSelect.value;
        localStorage.setItem('appLanguage', currentLanguage);
        applyLanguage(currentLanguage);
    });
    langRow.appendChild(langSelect);
    group.appendChild(langRow);

    // Theme selector
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';
    themeRow.innerHTML = `<label>🎨 Theme</label>`;
    const themeSelect = document.createElement('select');
    const themes = [
        { code: 'classic', name: 'Classic Marble' },
        { code: 'wood', name: 'Elegant Wood' },
        { code: 'glass', name: 'Modern Glass' },
    ];
    themes.forEach(theme => {
        const opt = document.createElement('option');
        opt.value = theme.code;
        opt.textContent = theme.name;
        if (theme.code === currentTheme) opt.selected = true;
        themeSelect.appendChild(opt);
    });
    themeSelect.addEventListener('change', () => {
        currentTheme = themeSelect.value;
        localStorage.setItem('appTheme', currentTheme);
        game.setTheme(currentTheme);
    });
    themeRow.appendChild(themeSelect);
    group.appendChild(themeRow);

    modalMessage.appendChild(group);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn secondary';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => hideModal());
    modalActions.appendChild(closeBtn);

    modalOverlay.classList.remove('hidden');
});

document.getElementById('btn-play-ai').addEventListener('click', async () => {
    const timeSeconds = await showTimeControlModal();
    showModal('Play vs AI', 'Select difficulty:', [
        { label: 'Easy', action: () => { startAIGame(3, timeSeconds); } },
        { label: 'Medium', action: () => { startAIGame(8, timeSeconds); } },
        { label: 'Hard', action: () => { startAIGame(15, timeSeconds); } },
    ]);
});

// Stockfish AI instance (lazy-loaded)
let stockfishAI = null;

async function startAIGame(depth, timeSeconds = 0) {
    // Show loading
    showModal('Starting AI', 'Loading Stockfish engine...', []);

    // Lazy-load Stockfish on first use
    if (!stockfishAI) {
        try {
            stockfishAI = new StockfishAI();
            await stockfishAI.init();
        } catch (err) {
            console.error('Stockfish init failed:', err);
            hideModal();
            showModal('AI Error',
                'Could not load Stockfish engine.<br>Please try again or use Local 2 Player.', [
                { label: 'OK', action: () => { } },
            ]);
            return;
        }
    }

    stockfishAI.setDepth(depth);
    hideModal();

    setTimeout(() => {
        game.mode = 'ai';
        game.playerColor = 'w';
        game.timeControl = timeSeconds;
        game.onMoveSend = null;
        game.init();
        playerNameEl.textContent = 'You (White)';
        const diffLabel = depth <= 3 ? 'Easy' : depth <= 8 ? 'Medium' : 'Hard';
        opponentNameEl.textContent = `AI (${diffLabel})`;
        setTimerDisplay(timeSeconds);
        resetCamera();
        showScreen(gameScreen);
        showStatus('Your move — you are White');
    }, 50);

    // When it's the AI's turn, ask Stockfish for a move
    game.onAITurn = async (fen) => {
        showStatus('AI is thinking...');
        try {
            const { from, to, promotion } = await stockfishAI.getBestMove(fen);
            // Small delay so the "thinking" feels natural
            setTimeout(async () => {
                await game.receiveMove(from, to, promotion);
                game.isLocked = false;
            }, 300);
        } catch (err) {
            console.error('AI move error:', err);
            showStatus('AI error — your turn');
            game.isLocked = false;
        }
    };
}

// ------------------------------------------
// Multiplayer: Connect + start online game
// ------------------------------------------
async function ensureConnected() {
    if (!socketClient.isConnected()) {
        try {
            await socketClient.connect();
        } catch (e) {
            showModal('Connection Error',
                'Could not connect to the server.<br>Make sure the server is running on port 3000.', [
                { label: 'OK', action: () => { } },
            ]);
            return false;
        }
    }

    if (!isAuthenticated) {
        promptAuth();
        return false; // Wait for them to finish auth before continuing
    }

    return true;
}

function startOnlineGame(color, fen = null) {
    game.mode = 'online';
    game.playerColor = color;
    game.timeControl = selectedOnlineTimeControl;
    game.init(fen);

    if (color === 's') {
        playerNameEl.textContent = 'Spectator (You)';
        opponentNameEl.textContent = 'Active Players';
        setTimerDisplay(selectedOnlineTimeControl); // Time sync will happen via subsequent events or FEN isn't enough for exact time
        setCameraForColor('w'); // default to white's perspective
        showScreen(gameScreen);
        showStatus('Watching Game');
    } else {
        const colorName = color === 'w' ? 'White' : 'Black';
        playerNameEl.textContent = `You (${colorName})`;
        opponentNameEl.textContent = 'Opponent';
        setTimerDisplay(selectedOnlineTimeControl);
        setCameraForColor(color);
        showScreen(gameScreen);
        showStatus(`Game started! You are ${colorName}`);
    }

    // Show chat panel if online
    if (game.mode === 'online') {
        chatPanel.classList.remove('hidden');
        chatMessages.innerHTML = '<div class="chat-system">Opponent has joined. Say hi!</div>';
    } else {
        chatPanel.classList.add('hidden');
    }

    // Send moves over the network
    game.onMoveSend = (from, to, promotion) => {
        socketClient.sendMove(from, to, promotion);
    };
}

let selectedOnlineTimeControl = 600; // default 10 min for online

// Socket callbacks
socketClient.onRoomCreated = (code) => {
    showModal('Room Created',
        `Share this code with your friend:<br><br>
         <span style="font-size:2em;font-weight:700;letter-spacing:0.15em;color:#a78bfa">${code}</span><br><br>
         Waiting for opponent to join...`, [
        { label: 'Cancel', type: 'secondary', action: () => showScreen(lobbyScreen) },
    ]);
};

socketClient.onGameStart = ({ color, roomCode }) => {
    hideModal();
    startOnlineGame(color);
};

socketClient.onSpectatorStart = ({ roomCode, fen }) => {
    hideModal();
    startOnlineGame('s', fen);
};

socketClient.onChatMessage = ({ text, author }) => {
    appendChatMessage(author, text, false);
};

socketClient.onOpponentMove = ({ from, to, promotion }) => {
    game.receiveMove(from, to, promotion);
};

socketClient.onOpponentDisconnected = () => {
    game.isLocked = true;
    showModal('Opponent Left', 'Your opponent has disconnected.', [
        { label: 'Back to Lobby', action: () => { resetCamera(); showScreen(lobbyScreen); } },
    ]);
};

socketClient.onMatchQueued = ({ position }) => {
    showModal('Quick Match',
        `Searching for opponent...<br><br>
         <span style="color:#a78bfa">Queue position: ${position}</span>`, [
        { label: 'Cancel', type: 'secondary', action: () => { socketClient.cancelMatch(); hideModal(); } },
    ]);
};

socketClient.onError = (msg) => {
    showModal('Error', msg, [
        { label: 'OK', action: () => { } },
    ]);
};

socketClient.onDrawOffered = () => {
    showModal('Draw Offered', 'Your opponent is offering a draw.', [
        { label: 'Accept', action: () => { socketClient.acceptDraw(); } },
        { label: 'Decline', type: 'secondary', action: () => { socketClient.declineDraw(); } },
    ]);
};

socketClient.onDrawDeclined = () => {
    showModal('Offer Declined', 'Your opponent wants to keep playing.', [
        { label: 'Close', action: () => { } }
    ]);
};

// --- Friends System Callbacks ---
let activeFriends = [];

socketClient.onFriendListReceived = (friendsArray) => {
    activeFriends = friendsArray;
    renderFriendsList();
};

socketClient.onFriendStatusUpdate = ({ id, status }) => {
    const friend = activeFriends.find(f => f.id === id);
    if (friend) {
        friend.status = status;
        renderFriendsList();
    }
};

socketClient.onFriendAddError = (msg) => {
    showModal('Add Friend Error', msg, [{ label: 'OK', action: () => { } }]);
};

socketClient.onGameInviteReceived = ({ from, avatar, roomCode }) => {
    showModal('Game Invitation', `${avatar} ${from} has invited you to play!`, [
        {
            label: 'Accept',
            action: () => {
                socketClient.joinRoom(roomCode);
                hideModal();
            }
        },
        {
            label: 'Decline',
            action: () => { hideModal(); }
        }
    ]);
};

socketClient.onGameOver = ({ result }) => {
    game.isLocked = true;
    showModal('Game Over', result, [
        { label: 'Back to Lobby', action: () => { resetCamera(); showScreen(lobbyScreen); } },
    ]);
};

// ------------------------------------------
// Lobby button: Quick Match
// ------------------------------------------
document.getElementById('btn-matchmaking').addEventListener('click', async () => {
    if (!(await ensureConnected())) return;
    const timeSeconds = await showTimeControlModal();
    selectedOnlineTimeControl = timeSeconds;
    socketClient.findMatch();
    showModal('Quick Match', 'Searching for opponent...', [
        { label: 'Cancel', type: 'secondary', action: () => { socketClient.cancelMatch(); } },
    ]);
});

// ------------------------------------------
// Lobby button: Create Room
// ------------------------------------------
document.getElementById('btn-create-room').addEventListener('click', async () => {
    if (!(await ensureConnected())) return;
    socketClient.createRoom();
    showModal('Create Room', 'Creating room...', []);
});

// ------------------------------------------
// Lobby button: Join Room
// ------------------------------------------
document.getElementById('btn-join-room').addEventListener('click', async () => {
    if (!(await ensureConnected())) return;
    // Show a simple input modal for the room code
    modalTitle.textContent = 'Join Room';
    modalMessage.innerHTML = `
        <label for="room-code-input" style="display:block;margin-bottom:0.5em;color:#ccc;">Enter room code:</label>
        <input type="text" id="room-code-input" maxlength="6" placeholder="E.g. ABC123"
               style="width:100%;padding:0.75em;font-size:1.2em;text-align:center;letter-spacing:0.2em;
                      background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);
                      border-radius:8px;color:white;font-family:inherit;text-transform:uppercase;" />
    `;
    modalActions.innerHTML = '';
    const joinBtn = document.createElement('button');
    joinBtn.className = 'modal-btn primary';
    joinBtn.textContent = 'Join';
    joinBtn.addEventListener('click', () => {
        const code = document.getElementById('room-code-input').value.trim();
        if (code.length === 0) return;
        hideModal();
        socketClient.joinRoom(code);
        showModal('Joining Room', `Joining room <b>${code.toUpperCase()}</b>...`, []);
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => hideModal());
    modalActions.appendChild(joinBtn);
    modalActions.appendChild(cancelBtn);
    modalOverlay.classList.remove('hidden');

    // Auto-focus the input
    setTimeout(() => {
        const input = document.getElementById('room-code-input');
        if (input) input.focus();
    }, 100);
});

// ------------------------------------------
// Game controls
// ------------------------------------------
document.getElementById('btn-resign').addEventListener('click', () => {
    showModal('Resign', 'Are you sure you want to resign?', [
        {
            label: 'Yes, Resign', action: () => {
                if (game.mode === 'online') {
                    socketClient.resign();
                } else {
                    game.timer.stop();
                    const winner = game.getTurn() === 'w' ? 'Black' : 'White';
                    game.isLocked = true;
                    game.onGameOver(`${winner} wins by resignation!`);
                }
            }
        },
        { label: 'Cancel', type: 'secondary', action: () => { } },
    ]);
});

document.getElementById('btn-draw').addEventListener('click', () => {
    if (game.mode === 'online') {
        socketClient.offerDraw();
        showStatus('Draw offer sent...');
    } else {
        showModal('Offer Draw', 'In local mode, both players agree to draw?', [
            {
                label: 'Accept Draw', action: () => {
                    game.timer.stop();
                    game.isLocked = true;
                    game.onGameOver('Game drawn by agreement!');
                }
            },
            { label: 'Cancel', type: 'secondary', action: () => { } },
        ]);
    }
});

document.getElementById('btn-back-lobby').addEventListener('click', () => {
    showModal('Leave Game', 'Are you sure you want to leave?', [
        { label: 'Leave', action: () => { game.timer.stop(); resetCamera(); showScreen(lobbyScreen); } },
        { label: 'Stay', type: 'secondary', action: () => { } },
    ]);
});

// Panel toggle
document.getElementById('btn-toggle-panel').addEventListener('click', () => {
    document.getElementById('side-panel').classList.toggle('collapsed');
});

function showStatus(text, duration = 3000) {
    statusBar.textContent = text;
    statusBar.classList.remove('hidden');
    setTimeout(() => statusBar.classList.add('hidden'), duration);
}


// ==========================================
// Resize Handler
// ==========================================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// Render Loop
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    game.update();
    renderer.render(scene, camera);
}
animate();

// ==========================================
// Player Name & Avatar
// ==========================================
const AVATARS = ['🐱', '🐶', '🐰', '🐻', '🦁', '🐸', '🐧', '🐨', '🦄', '🐯', '🐮', '🐷', '🐵', '🦉', '🐺', '🐹'];
let playerDisplayName = localStorage.getItem('chessUsername') || '';
let playerPassword = localStorage.getItem('chessPassword') || '';
let playerAvatar = localStorage.getItem('playerAvatar') || AVATARS[0];
let playerRating = 1200;

function setPlayerName(name, avatar, rating = 1200, wins = 0) {
    playerDisplayName = name.trim() || 'Guest';
    playerAvatar = avatar || playerAvatar;
    playerRating = rating;

    localStorage.setItem('chessUsername', playerDisplayName);
    localStorage.setItem('playerAvatar', playerAvatar);

    document.getElementById('profile-name').textContent = playerDisplayName;
    document.getElementById('profile-avatar').textContent = playerAvatar;

    gameName = playerDisplayName;
    gameAvatar = playerAvatar;
    isAuthenticated = true;
}

function promptAuth(isRegistration = false) {
    let selectedAvatar = isRegistration ? null : playerAvatar;

    modalTitle.textContent = isRegistration ? 'Create Account' : 'Login';

    let avatarHtml = '';
    if (isRegistration) {
        avatarHtml = `<div class="avatar-picker" id="avatar-picker" style="margin-bottom: 1rem;"></div>`;
    }

    modalMessage.innerHTML = `
        ${avatarHtml}
        <input type="text" id="auth-username" maxlength="20" placeholder="Username"
               value="${playerDisplayName === 'Guest' ? '' : playerDisplayName}"
               style="width:100%;padding:0.75em;font-size:1.1em;text-align:center;
                      background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);
                      border-radius:8px;color:white;font-family:inherit;" />
        <input type="password" id="auth-password" placeholder="Password"
               value="${playerPassword}"
               style="width:100%;padding:0.75em;font-size:1.1em;text-align:center;
                      background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);
                      border-radius:8px;color:white;font-family:inherit;margin-top:0.8rem;" />
        <div style="margin-top: 1rem; font-size: 0.9em; text-align: center;">
            <a href="#" id="toggle-auth-mode" style="color: var(--accent); text-decoration: none;">${isRegistration ? 'Already have an account? Login' : 'Need an account? Register'}</a>
        </div>
    `;

    if (isRegistration) {
        const picker = document.getElementById('avatar-picker');
        AVATARS.forEach(av => {
            const btn = document.createElement('button');
            btn.className = `avatar-option${av === selectedAvatar ? ' selected' : ''}`;
            btn.textContent = av;
            btn.addEventListener('click', () => {
                selectedAvatar = av;
                picker.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
            picker.appendChild(btn);
        });
    }

    document.getElementById('toggle-auth-mode').addEventListener('click', (e) => {
        e.preventDefault();
        promptAuth(!isRegistration); // Toggle mode
    });

    modalActions.innerHTML = '';

    const actionBtn = document.createElement('button');
    actionBtn.className = 'modal-btn primary';
    actionBtn.textContent = isRegistration ? 'Register' : 'Login';

    actionBtn.addEventListener('click', async () => {
        const userVal = document.getElementById('auth-username').value.trim();
        const passVal = document.getElementById('auth-password').value;

        if (!userVal) {
            alert('Please enter a username.');
            return;
        }
        if (!passVal) {
            alert('Please enter a password.');
            return;
        }
        if (isRegistration && !selectedAvatar) {
            alert('Please select an Avatar above.');
            return;
        }

        actionBtn.textContent = 'Please wait...';
        actionBtn.disabled = true;

        try {
            // Ensure socket is connected before authenticating
            if (!socketClient.isConnected()) {
                await socketClient.connect();
            }

            let data;
            if (isRegistration) {
                // To register, we also update the avatar in localStorage just in case,
                // but the server currently doesn't store avatars in DB? Let's fix that later, we can still pass it as part of Auth but currently our SQLite schema has no avatar.
                // Wait, right! We need to make sure Avatar is kept on the client and sent upon connect, OR stored in DB.
                // For now, client handles it locally and sends it when joining/chatting.
                localStorage.setItem('playerAvatar', selectedAvatar);
                playerAvatar = selectedAvatar;
                data = await socketClient.authRegister(userVal, passVal, selectedAvatar);
            } else {
                data = await socketClient.authLogin(userVal, passVal);
            }

            // Save credentials
            localStorage.setItem('chessPassword', passVal);
            playerPassword = passVal;

            setPlayerName(data.user.name, data.user.avatar || playerAvatar, data.user.rating, data.user.wins);
            hideModal();
            showStatus(isRegistration ? 'Account created successfully!' : 'Logged in successfully!');
        } catch (err) {
            actionBtn.textContent = isRegistration ? 'Register' : 'Login';
            actionBtn.disabled = false;
            showModal('Authentication Failed', err.message, [{ label: 'Try Again', action: () => promptAuth(isRegistration) }]);
        }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn secondary';
    closeBtn.textContent = 'Cancel';
    closeBtn.addEventListener('click', hideModal);

    modalActions.appendChild(actionBtn);
    modalActions.appendChild(closeBtn);
    modalOverlay.classList.remove('hidden');
}

document.getElementById('player-profile').addEventListener('click', () => promptAuth(false));

// Initialize profile visuals from cache
if (playerDisplayName) {
    document.getElementById('profile-name').textContent = playerDisplayName;
    document.getElementById('profile-avatar').textContent = playerAvatar;
} else {
    document.getElementById('profile-name').textContent = 'Guest';
    document.getElementById('profile-avatar').textContent = AVATARS[0];
}

// ==========================================
// Loading Simulation
// ==========================================
setTimeout(() => {
    loadingScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    // Prompt for auth on first visit if not authenticated auto
    if (!localStorage.getItem('chessUsername')) {
        setTimeout(() => promptAuth(true), 300);
    }
}, 2500);

// ==========================================
// Status Toggle & Friends Panel
// ==========================================
const btnToggleStatus = document.getElementById('btn-toggle-status');
const myStatusDot = document.getElementById('my-status-dot');
// Reset to online upon every refresh as requested
let playerStatus = 'online';
localStorage.setItem('playerStatus', playerStatus);

let isOnline = true;

function updateStatusDisplay() {
    const btnLabel = document.getElementById('btn-status-label');
    myStatusDot.style.display = 'block';
    myStatusDot.className = `status-indicator ${playerStatus}`;
    if (btnLabel) btnLabel.textContent = playerStatus === 'online' ? 'ONLINE' : 'OFFLINE';
}
updateStatusDisplay();

btnToggleStatus.addEventListener('click', () => {
    modalTitle.textContent = 'Your Active Status';

    const descText = playerStatus === 'online'
        ? "You are currently <b>Online</b>.<br>Your friends can see you with a green dot and invite you to play."
        : playerStatus === 'offline'
            ? "You are currently <b>Offline</b>.<br>Your friends will see you with a red dot and cannot invite you."
            : "You have not set a status (Neutral).<br>Your friends cannot see you online. Toggle the switch to appear Online.";

    const dotHTML = playerStatus
        ? `<span class="status-dot ${playerStatus}" style="display:inline-block; margin-right:5px; border:none;" id="modal-status-dot"></span>`
        : `<span class="status-dot" style="display:none; margin-right:5px; border:none;" id="modal-status-dot"></span>`;

    const labelText = playerStatus ? (playerStatus === 'online' ? 'Online' : 'Offline') : 'Set Status';

    modalMessage.innerHTML = `
        <div style="font-size: 0.95em; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.5;">
            ${descText}
        </div>
        <div class="settings-row" style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-glass);">
            <span>
                ${dotHTML}
                <span id="modal-status-label" style="font-weight: 600;">${labelText}</span>
            </span>
            <div class="toggle-switch ${isOnline ? 'active' : ''}" id="status-toggle-switch"></div>
        </div>
    `;

    modalActions.innerHTML = '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', hideModal);
    modalActions.appendChild(closeBtn);

    modalOverlay.classList.remove('hidden');

    // Add logic to the switch inside the modal
    setTimeout(() => {
        const switchBtn = document.getElementById('status-toggle-switch');
        if (switchBtn) {
            switchBtn.addEventListener('click', () => {
                isOnline = !isOnline;
                playerStatus = isOnline ? 'online' : 'offline';
                switchBtn.classList.toggle('active', isOnline);
                localStorage.setItem('playerStatus', playerStatus);
                updateStatusDisplay();

                // Tell the server about the status change
                if (socketClient && socketClient.isConnected()) {
                    socketClient.updatePresence(playerStatus);
                }

                // Update the modal text dynamically
                const newDesc = isOnline
                    ? "You are currently <b>Online</b>.<br>Your friends can see you with a green dot and invite you to play."
                    : "You are currently <b>Offline</b>.<br>Your friends will see you with a red dot and cannot invite you.";

                // Update text and dot inside modal without closing it
                modalMessage.querySelector('div').innerHTML = newDesc;
                const modalDot = document.getElementById('modal-status-dot');
                if (modalDot) {
                    modalDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
                    // Important: override the default border so it's visible in the modal
                    modalDot.style.border = 'none';
                    modalDot.style.display = 'inline-block';
                    modalDot.style.marginRight = '5px';
                }
                const modalLabel = document.getElementById('modal-status-label');
                if (modalLabel) {
                    modalLabel.textContent = isOnline ? 'Online' : 'Offline';
                }
            });
        }
    }, 50);
});

const friendsPanel = document.getElementById('friends-panel');
const btnToggleFriends = document.getElementById('btn-toggle-friends');
const btnCloseFriends = document.getElementById('btn-close-friends');

btnToggleFriends.addEventListener('click', () => {
    friendsPanel.classList.add('open');
    // Clear notification badge
    const badge = document.getElementById('badge-friends');
    if (badge) badge.style.display = 'none';
});

btnCloseFriends.addEventListener('click', () => {
    friendsPanel.classList.remove('open');
});

function renderFriendsList() {
    const list = document.getElementById('friends-list');
    list.innerHTML = '';

    if (activeFriends.length === 0) {
        list.innerHTML = '<div style="text-align:center; color: var(--text-muted); padding: 1rem;">No friends added yet.</div>';
        return;
    }

    activeFriends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'friend-item';

        const statusText = f.status === 'online' ? 'Online' : f.status === 'playing' ? 'In Game' : 'Offline';
        const isOnline = f.status === 'online';

        let inviteBtnHtml = '';
        if (isOnline) {
            // Create element directly to safely attach onclick
            inviteBtnHtml = `<button class="btn-invite" id="invite-${f.id}">Invite</button>`;
        } else {
            inviteBtnHtml = `<button class="btn-invite" disabled>${f.status === 'playing' ? 'Playing' : 'Offline'}</button>`;
        }

        item.innerHTML = `
            <div class="friend-info">
                <div class="friend-avatar">${f.avatar}</div>
                <div class="friend-details">
                    <span class="friend-name">${f.name}</span>
                    <span class="friend-status">
                        <span class="status-dot ${f.status}"></span> ${statusText}
                    </span>
                </div>
            </div>
            ${inviteBtnHtml}
        `;
        list.appendChild(item);

        if (isOnline) {
            const btn = document.getElementById(`invite-${f.id}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    socketClient.inviteFriend(f.id);
                    btn.textContent = 'Sent!';
                    btn.disabled = true;
                    setTimeout(() => { btn.textContent = 'Invite'; btn.disabled = false; }, 3000);
                });
            }
        }
    });
}
renderFriendsList();

document.getElementById('btn-add-friend').addEventListener('click', () => {
    const inp = document.getElementById('add-friend-input');
    const name = inp.value.trim();
    if (name) {
        socketClient.addFriend(name);
        renderFriendsList();
        inp.value = '';
    }
});

// ==========================================
// Input Handling
// ==========================================
// ==========================================
// Leaderboard Logic
// ==========================================
const btnOpenLeaderboard = document.getElementById('btn-open-leaderboard');
const btnCloseLeaderboard = document.getElementById('btn-close-leaderboard');
const leaderboardModal = document.getElementById('leaderboard-modal');
const lbTbody = document.getElementById('leaderboard-tbody');

if (btnOpenLeaderboard && btnCloseLeaderboard && leaderboardModal && lbTbody) {
    btnOpenLeaderboard.addEventListener('click', () => {
        leaderboardModal.classList.remove('hidden');
        lbTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Fetching live data...</td></tr>';
        if (socketClient && socketClient.isConnected()) {
            socketClient.requestLeaderboard();
        } else {
            lbTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Not connected to server.</td></tr>';
        }
    });

    btnCloseLeaderboard.addEventListener('click', () => {
        leaderboardModal.classList.add('hidden');
    });

    // Wire up the socket callback directly here
    socketClient.onLeaderboardReceived = (data) => {
        lbTbody.innerHTML = '';

        if (!data || data.length === 0) {
            lbTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No players ranked yet.</td></tr>';
            return;
        }

        const rankIcons = ['🥇', '🥈', '🥉', '4', '5'];

        data.forEach((p, i) => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

            let rankStr = (i < 3) ? rankIcons[i] : (i + 1).toString();

            row.innerHTML = `
                <td style="padding: 10px; font-weight: bold; color: var(--accent);">${rankStr}</td>
                <td style="padding: 10px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.2rem;">${p.avatar}</span>
                    <span>${p.name}</span>
                </td>
                <td style="padding: 10px; text-align: center; color: #ffd700; font-weight: bold;">${p.rating}</td>
                <td style="padding: 10px; text-align: center; color: var(--text-secondary);">${p.wins} W</td>
            `;
            lbTbody.appendChild(row);
        });
    };
}

// ==========================================
// Rules Overlay Logic
// ==========================================
const rulesOverlay = document.getElementById('rules-overlay');
const btnOpenRules = document.getElementById('btn-open-rules');
const btnCloseRules = document.getElementById('btn-close-rules');
const ruleSlides = document.querySelectorAll('.rule-slide');
const ruleDots = document.querySelectorAll('.rule-indicators .dot');
const btnRuleNext = document.getElementById('btn-rule-next');
const btnRulePrev = document.getElementById('btn-rule-prev');
let currentSlide = 0;

function updateRulesSlider() {
    ruleSlides.forEach((slide, idx) => {
        slide.classList.remove('active', 'previous');
        if (idx === currentSlide) {
            slide.classList.add('active');
        } else if (idx < currentSlide) {
            slide.classList.add('previous');
        }
    });

    ruleDots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentSlide);
    });

    btnRulePrev.style.visibility = currentSlide === 0 ? 'hidden' : 'visible';

    if (currentSlide === ruleSlides.length - 1) {
        btnRuleNext.textContent = 'Finish';
    } else {
        btnRuleNext.textContent = 'Next →';
    }
}

btnOpenRules.addEventListener('click', () => {
    currentSlide = 0;
    updateRulesSlider();
    rulesOverlay.classList.remove('hidden');
});

btnCloseRules.addEventListener('click', () => {
    rulesOverlay.classList.add('hidden');
});

btnRuleNext.addEventListener('click', () => {
    if (currentSlide < ruleSlides.length - 1) {
        currentSlide++;
        updateRulesSlider();
    } else {
        // Finish clicked
        rulesOverlay.classList.add('hidden');
    }
});

btnRulePrev.addEventListener('click', () => {
    if (currentSlide > 0) {
        currentSlide--;
        updateRulesSlider();
    }
});

// Clear badges when clicked
document.getElementById('btn-matchmaking').addEventListener('click', () => {
    const badge = document.getElementById('badge-matchmaking');
    if (badge) badge.style.display = 'none';
}, { once: true });
document.getElementById('btn-join-room').addEventListener('click', () => {
    const badge = document.getElementById('badge-join');
    if (badge) badge.style.display = 'none';
}, { once: true });

// ==========================================
// Chat UI Logic
// ==========================================
function appendChatMessage(author, text, isSelf) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;

    const authorSpan = document.createElement('span');
    authorSpan.className = 'author';
    authorSpan.textContent = author;
    msgDiv.appendChild(authorSpan);

    const textNode = document.createTextNode(text);
    msgDiv.appendChild(textNode);

    if (chatMessages) {
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Add badge notification if message is received while minimized
    if (!isSelf && chatPanel && chatPanel.classList.contains('minimized') && chatBadge) {
        unreadChatCount++;
        chatBadge.textContent = unreadChatCount;
        chatBadge.classList.remove('hidden');
    }
}

if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent Three.js/OrbitControls from stealing this

        const text = chatInput.value.trim();
        if (text && socketClient.isConnected() && game.mode === 'online') {
            socketClient.sendChatMessage(text);
            appendChatMessage('You', text, true);
            chatInput.value = '';
            emojiPicker.classList.add('hidden'); // Close picker on send
        }
    });

    // Prevent OrbitControls or the canvas from stealing focus when interacting with the chat
    const blockEvents = (e) => e.stopPropagation();
    chatPanel.addEventListener('mousedown', blockEvents);
    chatPanel.addEventListener('touchstart', blockEvents);
    chatPanel.addEventListener('pointerdown', blockEvents);
    chatPanel.addEventListener('wheel', blockEvents);
    chatPanel.addEventListener('click', blockEvents);

    const chatHeader = chatPanel.querySelector('.chat-header');

    // Toggle on header click or button click
    const toggleChat = () => {
        chatPanel.classList.toggle('minimized');
        btnToggleChat.textContent = chatPanel.classList.contains('minimized') ? '□' : '_';

        // Hide emoji picker if chat minimizes
        if (chatPanel.classList.contains('minimized')) {
            if (emojiPicker) emojiPicker.classList.add('hidden');
        } else {
            // chat opened
            if (chatBadge) {
                unreadChatCount = 0;
                chatBadge.classList.add('hidden');
            }
            // Auto-focus input when opened
            setTimeout(() => chatInput.focus(), 100);
        }
    };

    btnToggleChat.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent header click from firing twice
        toggleChat();
    });

    chatHeader.addEventListener('click', toggleChat);

    // Emoji UI Logic
    if (btnEmojiToggle && emojiPicker) {
        btnEmojiToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            emojiPicker.classList.toggle('hidden');
        });

        // Setup emoji click handlers
        const emojis = emojiPicker.querySelectorAll('.emoji');
        emojis.forEach(emojiEl => {
            emojiEl.addEventListener('click', (e) => {
                e.stopPropagation();
                chatInput.value += emojiEl.textContent;
                chatInput.focus();
            });
        });

        // Close emoji picker if user clicks outside
        document.addEventListener('click', (e) => {
            if (!chatForm.contains(e.target) && !emojiPicker.contains(e.target)) {
                emojiPicker.classList.add('hidden');
            }
        });
    }

    // Initialize sound on first interaction (required by browsers)
    const initSound = () => {
        game.sound.init();
        document.removeEventListener('mousedown', initSound);
        document.removeEventListener('keydown', initSound);
    };
    document.addEventListener('mousedown', initSound);
    document.addEventListener('keydown', initSound);
}

// Log
console.log('🎮 Checkmate Legends 3D initialized');
