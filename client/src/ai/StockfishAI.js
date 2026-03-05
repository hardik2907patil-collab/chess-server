/**
 * StockfishAI.js — Stockfish chess engine wrapper using Web Worker
 * Communicates via UCI protocol for move calculation
 */

export class StockfishAI {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.thinking = false;
        this.depth = 8; // default depth
        this.onBestMove = null; // callback: (from, to, promotion) => {}
        this._resolveMove = null;
    }

    /**
     * Initialize Stockfish Web Worker from CDN
     */
    async init() {
        return new Promise((resolve, reject) => {
            try {
                // Load stockfish.js from CDN as a Web Worker
                // Using a Blob URL since CDN scripts can't be loaded directly as workers
                const workerCode = `importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');`;
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);

                this.worker = new Worker(workerUrl);

                this.worker.onmessage = (e) => {
                    const line = typeof e.data === 'string' ? e.data : '';
                    this._handleMessage(line);
                };

                this.worker.onerror = (err) => {
                    console.error('Stockfish worker error:', err);
                    reject(err);
                };

                // Wait for uciok
                const timeout = setTimeout(() => {
                    if (!this.ready) {
                        reject(new Error('Stockfish initialization timeout'));
                    }
                }, 10000);

                this._onReady = () => {
                    clearTimeout(timeout);
                    this.ready = true;
                    resolve();
                };

                // Send UCI init commands
                this.worker.postMessage('uci');
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Handle messages from the Stockfish worker
     */
    _handleMessage(line) {
        // UCI initialization complete
        if (line === 'uciok') {
            this.worker.postMessage('isready');
        }

        if (line === 'readyok') {
            if (this._onReady) {
                this._onReady();
                this._onReady = null;
            }
        }

        // Best move response
        if (line.startsWith('bestmove')) {
            const parts = line.split(' ');
            const moveStr = parts[1]; // e.g., "e2e4" or "e7e8q" (with promotion)

            if (moveStr && moveStr !== '(none)') {
                const from = moveStr.substring(0, 2);
                const to = moveStr.substring(2, 4);
                const promotion = moveStr.length > 4 ? moveStr[4] : null;

                this.thinking = false;

                if (this._resolveMove) {
                    this._resolveMove({ from, to, promotion });
                    this._resolveMove = null;
                }

                if (this.onBestMove) {
                    this.onBestMove(from, to, promotion);
                }
            }
        }
    }

    /**
     * Set the AI difficulty (search depth)
     * Easy: 3, Medium: 8, Hard: 15
     */
    setDepth(depth) {
        this.depth = depth;
    }

    /**
     * Calculate the best move for the given FEN position
     * Returns a promise that resolves with { from, to, promotion }
     */
    async getBestMove(fen) {
        if (!this.ready || !this.worker) {
            throw new Error('Stockfish not ready');
        }

        this.thinking = true;

        return new Promise((resolve) => {
            this._resolveMove = resolve;

            this.worker.postMessage('ucinewgame');
            this.worker.postMessage(`position fen ${fen}`);
            this.worker.postMessage(`go depth ${this.depth}`);
        });
    }

    /**
     * Stop current calculation
     */
    stop() {
        if (this.worker && this.thinking) {
            this.worker.postMessage('stop');
        }
    }

    /**
     * Check if the engine is currently thinking
     */
    isThinking() {
        return this.thinking;
    }

    /**
     * Destroy the worker
     */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.ready = false;
        }
    }
}
