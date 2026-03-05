/**
 * GameSession.js — Lightweight server-side chess game state
 * Stores only minimal data: FEN string, result, and move count.
 * chess.js is used on-demand for validation, then released.
 */
const { Chess } = require('chess.js');

class GameSession {
    constructor() {
        this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        this.result = null;   // null = ongoing, string = result message
        this.moveHistory = [];
        this.players = {
            w: null, // { id: socketId, userId: dbId, name: '...', rating: 1200 }
            b: null
        };
        this.startTime = Date.now();
        this.lastMoveTime = Date.now();
        this.status = 'active'; // active, completed, abandoned
    }

    /**
     * Assign players to the session
     */
    setPlayers(whitePlayer, blackPlayer) {
        this.players.w = whitePlayer;
        this.players.b = blackPlayer;
    }

    /**
     * Validate and execute a move. Returns the move object or null if invalid.
     * Creates a temporary chess.js instance, validates, stores move in history, and updates FEN.
     */
    makeMove(from, to, promotion) {
        if (this.result) return null; // game already over

        const chess = new Chess(this.fen);
        const move = chess.move({ from, to, promotion });
        if (!move) return null;

        // Store move in memory history
        this.moveHistory.push({
            color: move.color,
            from: move.from,
            to: move.to,
            piece: move.piece,
            san: move.san,
            timestamp: Date.now()
        });

        // Store only the updated FEN string in memory
        this.fen = chess.fen();
        this.lastMoveTime = Date.now();

        // Check for game over
        if (chess.isGameOver()) {
            this.status = 'completed';
            if (chess.isCheckmate()) {
                this.result = move.color === 'w'
                    ? 'White wins by checkmate!'
                    : 'Black wins by checkmate!';
            } else if (chess.isStalemate()) {
                this.result = 'Stalemate — Draw!';
            } else if (chess.isThreefoldRepetition()) {
                this.result = 'Draw by Repetition!';
            } else if (chess.isInsufficientMaterial()) {
                this.result = 'Draw — Insufficient Material!';
            } else if (chess.isDraw()) {
                this.result = 'Draw!';
            }
        }

        // chess instance is garbage-collected after this function returns
        return move;
    }

    /**
     * Get full serialized state for reconnects or spectators
     */
    getSerializedState() {
        return {
            fen: this.fen,
            result: this.result,
            status: this.status,
            moveHistory: this.moveHistory, // full history sent for UI recreation
            players: this.players,
            turn: this.getTurn(),
            startTime: this.startTime
        };
    }

    /**
     * Get the color whose turn it is ('w' or 'b')
     */
    getTurn() {
        // Parse turn from FEN (second field)
        const parts = this.fen.split(' ');
        return parts[1] || 'w';
    }

    /**
     * Get the current FEN string
     */
    getFEN() {
        return this.fen;
    }

    /**
     * Check if the game is over
     */
    isGameOver() {
        return this.result !== null;
    }

    /**
     * Get the game result string
     */
    getResult() {
        return this.result;
    }

    /**
     * Set a result manually (for resign, draw, disconnect)
     */
    setResult(result, status = 'completed') {
        this.result = result;
        this.status = status;
    }
}

module.exports = GameSession;
