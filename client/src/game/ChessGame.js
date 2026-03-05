/**
 * ChessGame.js — Game controller integrating chess.js logic with 3D rendering
 */
import { Chess } from 'chess.js';
import { Board3D } from './Board3D.js?v=10';
import { Pieces3D, PIECE_UNICODE } from './Pieces3D.js?v=10';
import { MoveAnimator } from './MoveAnimator.js?v=10';
import { InputHandler } from './InputHandler.js?v=10';
import { SoundManager } from './SoundManager.js?v=10';
import { ChessTimer } from './ChessTimer.js?v=10';
import { ParticleSystem } from './ParticleSystem.js?v=10';

export class ChessGame {
    constructor(scene, camera, canvas) {
        this.chess = new Chess();
        this.board3D = new Board3D(scene);
        this.pieces3D = new Pieces3D(scene);
        this.particles = new ParticleSystem(scene);
        this.animator = new MoveAnimator();
        this.input = new InputHandler(camera, canvas, this.board3D, this.pieces3D);
        this.sound = new SoundManager();
        this.timer = new ChessTimer(0); // disabled by default

        this.selectedSquare = null; // { col, row }
        this.validMoves = [];
        this.isLocked = false; // lock input during animations
        this.moveHistory = [];
        this.capturedPieces = { w: [], b: [] };

        // Callbacks for UI updates
        this.onTurnChange = null;
        this.onMoveMade = null;
        this.onGameOver = null;
        this.onCheck = null;
        this.onMoveSend = null; // called after a local move so the network layer can send it
        this.onAITurn = null;   // called when it's the AI's turn (passes FEN)
        this.onTimerTick = null;  // (whiteTime, blackTime)
        this.onPromotionChoice = null; // (color) => Promise<pieceType>

        // Game mode
        this.mode = 'local'; // 'local', 'online', 'ai'
        this.playerColor = 'w'; // which color this player controls (for online/ai)
        this.timeControl = 0; // seconds, 0 = unlimited

        this.input.setClickHandler((col, row) => this.handleSquareClick(col, row));
    }

    /**
     * Initialize the board with starting position or from FEN
     */
    init(fen = null) {
        if (fen) {
            this.chess.load(fen);
        } else {
            this.chess.reset();
        }
        this.selectedSquare = null;
        this.validMoves = [];
        this.moveHistory = [];
        this.capturedPieces = { w: [], b: [] };
        this.isLocked = false;

        // Setup timer
        this.timer.reset(this.timeControl);
        this.timer.onTick = (wt, bt) => {
            if (this.onTimerTick) this.onTimerTick(wt, bt);
        };
        this.timer.onTimeout = (color) => {
            const winner = color === 'w' ? 'Black' : 'White';
            const result = `${winner} wins on time!`;
            if (this.onGameOver) this.onGameOver(result);
            this.sound.playGameOver();
            this.isLocked = true;
        };

        const boardState = this.chess.board();
        this.pieces3D.setupFromBoard(boardState);
        this.board3D.clearHighlights();

        if (this.onTurnChange) {
            this.onTurnChange(this.chess.turn());
        }

        // Fire initial timer display
        if (this.onTimerTick && this.timer.enabled) {
            this.onTimerTick(this.timer.getTime('w'), this.timer.getTime('b'));
        }
    }

    /**
     * Handle click on a square or piece
     */
    handleSquareClick(col, row) {
        if (this.isLocked) return;

        // In online/ai mode, only allow moving your own pieces
        if (this.mode !== 'local' && this.chess.turn() !== this.playerColor) return;

        const algebraic = this.board3D.coordsToAlgebraic(col, row);
        const piece = this.chess.get(algebraic);

        // If no piece is selected yet
        if (!this.selectedSquare) {
            if (piece && piece.color === this.chess.turn()) {
                this.selectSquare(col, row, algebraic);
            }
            return;
        }

        // If clicking the already selected square, deselect
        if (this.selectedSquare.col === col && this.selectedSquare.row === row) {
            this.deselectSquare();
            return;
        }

        // If clicking on another piece of the same color, switch selection
        if (piece && piece.color === this.chess.turn()) {
            this.deselectSquare();
            this.selectSquare(col, row, algebraic);
            return;
        }

        // Try to make a move
        const from = this.board3D.coordsToAlgebraic(this.selectedSquare.col, this.selectedSquare.row);
        const to = algebraic;

        this.tryMove(from, to);
    }

    selectSquare(col, row, algebraic) {
        this.selectedSquare = { col, row, algebraic };
        this.board3D.clearHighlights();
        this.board3D.highlightSquare(col, row, 'selected');

        // Get valid moves for this piece
        this.validMoves = this.chess.moves({ square: algebraic, verbose: true });
        this.board3D.highlightValidMoves(this.validMoves);
    }

    deselectSquare() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.board3D.clearHighlights();

        // Re-highlight last move if any
        if (this.moveHistory.length > 0) {
            const last = this.moveHistory[this.moveHistory.length - 1];
            this.board3D.highlightLastMove(last.from, last.to);
        }
    }

    /**
     * Attempt to make a move
     */
    async tryMove(from, to) {
        // Check for pawn promotion
        let promotion = undefined;
        const fromPiece = this.chess.get(from);
        if (fromPiece && fromPiece.type === 'p') {
            const toRow = parseInt(to[1]);
            if ((fromPiece.color === 'w' && toRow === 8) || (fromPiece.color === 'b' && toRow === 1)) {
                // Ask user to choose promotion piece
                if (this.onPromotionChoice) {
                    try {
                        promotion = await this.onPromotionChoice(fromPiece.color);
                    } catch {
                        this.deselectSquare();
                        return; // cancelled
                    }
                } else {
                    promotion = 'q'; // fallback: auto-queen
                }
            }
        }

        const move = this.chess.move({ from, to, promotion });

        if (!move) {
            this.deselectSquare();
            return;
        }

        this.isLocked = true;

        // Start timer on first move
        if (this.moveHistory.length === 0 && this.timer.enabled) {
            this.timer.start('w');
        }

        // Track captures
        if (move.captured) {
            this.capturedPieces[move.color].push(move.captured);
        }

        // Animate the move
        await this.animateMove(move);

        // Play sound
        this.sound.init();
        if (move.captured) {
            const isOpponentCapture = move.color !== this.playerColor;
            this.sound.playCapture(isOpponentCapture);
        } else {
            this.sound.playMove();
        }

        // Update state
        this.moveHistory.push(move);
        this.deselectSquare();

        // Highlight last move
        this.board3D.highlightLastMove(move.from, move.to);

        // Clear any existing check indicator (the move may have resolved it)
        this.board3D.clearCheck();

        // Check for check (but not checkmate — checkmate has its own sound)
        if (this.chess.isCheck() && !this.chess.isCheckmate()) {
            // Find king position
            const board = this.chess.board();
            const turn = this.chess.turn();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = board[r][c];
                    if (p && p.type === 'k' && p.color === turn) {
                        const sq = this.board3D.coordsToAlgebraic(c, 7 - r);
                        this.board3D.highlightCheck(sq);
                    }
                }
            }
            if (this.onCheck) this.onCheck(this.chess.turn());
            this.sound.playCheck();
        }

        // Notify UI
        if (this.onMoveMade) {
            this.onMoveMade(move, this.moveHistory, this.capturedPieces);
        }

        // Notify network layer to send the move
        if (this.onMoveSend) {
            this.onMoveSend(move.from, move.to, move.promotion || null);
        }

        // Check game over
        if (this.chess.isGameOver()) {
            let result = 'Game Over';
            if (this.chess.isCheckmate()) {
                result = move.color === 'w' ? 'White wins by checkmate!' : 'Black wins by checkmate!';
            } else if (this.chess.isStalemate()) {
                result = 'Stalemate — Draw!';
            } else if (this.chess.isThreefoldRepetition()) {
                result = 'Draw by Repetition!';
            } else if (this.chess.isInsufficientMaterial()) {
                result = 'Draw — Insufficient Material!';
            } else if (this.chess.isDraw()) {
                result = 'Draw!';
            }

            this.timer.stop();
            if (this.onGameOver) this.onGameOver(result);

            if (this.chess.isCheckmate()) {
                // playCheckmate is async — awaits asset loading if needed
                this.sound.playCheckmate();
            } else {
                this.sound.playGameOver();
            }

            this.isLocked = true; // Stay locked after game over
        } else {
            // Switch timer to next player
            this.timer.switchTurn(this.chess.turn());
            if (this.onTurnChange) this.onTurnChange(this.chess.turn());

            // Trigger AI if it's the AI's turn
            if (this.mode === 'ai' && this.chess.turn() !== this.playerColor) {
                // Keep locked while AI is thinking
                if (this.onAITurn) this.onAITurn(this.chess.fen());
            } else {
                this.isLocked = false;
            }
        }
    }

    /**
     * Animate a chess move in 3D
     */
    async animateMove(move) {
        const fromCoords = this.board3D.algebraicToCoords(move.from);
        const toCoords = this.board3D.algebraicToCoords(move.to);

        // Remove captured piece
        if (move.captured) {
            // En passant capture is at a different square
            if (move.flags.includes('e')) {
                const epRow = move.color === 'w' ? toCoords.row - 1 : toCoords.row + 1;
                this.pieces3D.removePiece(toCoords.col, epRow);
            } else {
                this.pieces3D.removePiece(toCoords.col, toCoords.row);
            }
        }

        // Animate main piece
        const pieceMesh = this.pieces3D.getPieceMesh(fromCoords.col, fromCoords.row);
        if (pieceMesh) {
            const targetPos = this.pieces3D.getWorldPosition(toCoords.col, toCoords.row);
            await this.animator.animate(pieceMesh, targetPos, 0.35);
            this.pieces3D.movePieceMesh(fromCoords.col, fromCoords.row, toCoords.col, toCoords.row);
        }

        // Handle castling — move the rook
        if (move.flags.includes('k') || move.flags.includes('q')) {
            let rookFrom, rookTo;
            if (move.flags.includes('k')) {
                // Kingside
                rookFrom = { col: 7, row: fromCoords.row };
                rookTo = { col: 5, row: fromCoords.row };
            } else {
                // Queenside
                rookFrom = { col: 0, row: fromCoords.row };
                rookTo = { col: 3, row: fromCoords.row };
            }
            const rookMesh = this.pieces3D.getPieceMesh(rookFrom.col, rookFrom.row);
            if (rookMesh) {
                const rookTarget = this.pieces3D.getWorldPosition(rookTo.col, rookTo.row);
                await this.animator.animate(rookMesh, rookTarget, 0.3);
                this.pieces3D.movePieceMesh(rookFrom.col, rookFrom.row, rookTo.col, rookTo.row);
            }
        }

        // Handle promotion — replace pawn with promoted piece
        if (move.promotion) {
            this.pieces3D.removePiece(toCoords.col, toCoords.row);
            this.pieces3D.addPiece(move.promotion, move.color, toCoords.col, toCoords.row);
        }
    }

    /**
     * Receive a move from the network (opponent's move)
     */
    async receiveMove(from, to, promotion) {
        const move = this.chess.move({ from, to, promotion });
        if (!move) return false;

        this.isLocked = true;

        // Start timer on first move if not yet started
        if (this.moveHistory.length === 0 && this.timer.enabled) {
            this.timer.start('w');
        }

        if (move.captured) {
            this.capturedPieces[move.color].push(move.captured);
        }

        await this.animateMove(move);

        // Play sound
        this.sound.init();
        if (move.captured) {
            const isOpponentCapture = true; // receiveMove represents opponent actions
            this.sound.playCapture(isOpponentCapture);
        } else {
            this.sound.playMove();
        }

        this.moveHistory.push(move);
        this.board3D.clearHighlights();
        this.board3D.highlightLastMove(move.from, move.to);

        // Clear any existing check indicator
        this.board3D.clearCheck();

        // Highlight check (but skip sound if it's checkmate — handled below)
        if (this.chess.isCheck() && !this.chess.isCheckmate()) {
            const board = this.chess.board();
            const turn = this.chess.turn();
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = board[r][c];
                    if (p && p.type === 'k' && p.color === turn) {
                        const sq = this.board3D.coordsToAlgebraic(c, 7 - r);
                        this.board3D.highlightCheck(sq);
                    }
                }
            }
        }

        if (this.onMoveMade) this.onMoveMade(move, this.moveHistory, this.capturedPieces);

        if (this.chess.isGameOver()) {
            let result = 'Game Over';
            if (this.chess.isCheckmate()) {
                result = move.color === 'w' ? 'White wins by checkmate!' : 'Black wins by checkmate!';
            } else if (this.chess.isStalemate()) {
                result = 'Stalemate — Draw!';
            } else if (this.chess.isThreefoldRepetition()) {
                result = 'Draw by Repetition!';
            } else if (this.chess.isInsufficientMaterial()) {
                result = 'Draw — Insufficient Material!';
            } else if (this.chess.isDraw()) {
                result = 'Draw!';
            }

            this.timer.stop();
            if (this.onGameOver) this.onGameOver(result);

            if (this.chess.isCheckmate()) {
                this.sound.playCheckmate();
            } else {
                this.sound.playGameOver();
            }
            this.isLocked = true;
        } else {
            this.timer.switchTurn(this.chess.turn());
            if (this.onTurnChange) this.onTurnChange(this.chess.turn());
        }

        this.isLocked = false;
        return true;
    }

    /**
     * Update — call in render loop
     */
    update() {
        this.animator.update();
        if (this.particles) this.particles.update(0.016);
        // Animate check glow ring pulse
        this.board3D.updateCheckGlow(0.016);
    }

    /**
     * Get current FEN
     */
    getFEN() {
        return this.chess.fen();
    }

    /**
     * Get current turn
     */
    getTurn() {
        return this.chess.turn();
    }

    /**
     * Change the visual theme of the board and pieces
     */
    setTheme(theme) {
        if (this.board3D) this.board3D.setTheme(theme);
        if (this.pieces3D) this.pieces3D.setTheme(theme);
    }
}
