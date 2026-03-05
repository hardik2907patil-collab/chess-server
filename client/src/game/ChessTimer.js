/**
 * ChessTimer.js — Chess clock with configurable time controls
 * Tracks time for both players, switches on moves, fires callbacks on tick/timeout
 */

export class ChessTimer {
    constructor(timeSeconds = 600) {
        this.initialTime = timeSeconds; // seconds per player
        this.time = { w: timeSeconds, b: timeSeconds };
        this.activeColor = null;  // which clock is running
        this.intervalId = null;
        this.lastTick = null;
        this.enabled = timeSeconds > 0;

        // Callbacks
        this.onTick = null;       // (whiteTime, blackTime) each second
        this.onTimeout = null;    // (color) when a player runs out
    }

    /**
     * Start the clock for a given color
     */
    start(color) {
        if (!this.enabled) return;
        this.activeColor = color;
        this.lastTick = performance.now();

        if (this.intervalId) clearInterval(this.intervalId);

        this.intervalId = setInterval(() => {
            const now = performance.now();
            const elapsed = (now - this.lastTick) / 1000;
            this.lastTick = now;

            if (this.activeColor) {
                this.time[this.activeColor] = Math.max(0, this.time[this.activeColor] - elapsed);

                if (this.onTick) {
                    this.onTick(this.time.w, this.time.b);
                }

                if (this.time[this.activeColor] <= 0) {
                    this.stop();
                    if (this.onTimeout) {
                        this.onTimeout(this.activeColor);
                    }
                }
            }
        }, 200); // update 5x/sec for smooth display
    }

    /**
     * Stop the clock entirely
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.activeColor = null;
        this.lastTick = null;
    }

    /**
     * Switch the active clock to the other player
     */
    switchTurn(newColor) {
        if (!this.enabled) return;
        this.activeColor = newColor;
        this.lastTick = performance.now();
    }

    /**
     * Get remaining time for a color (in seconds)
     */
    getTime(color) {
        return this.time[color];
    }

    /**
     * Check if a player has run out of time
     */
    isExpired(color) {
        return this.time[color] <= 0;
    }

    /**
     * Reset with new time control
     */
    reset(timeSeconds) {
        this.stop();
        this.initialTime = timeSeconds;
        this.time = { w: timeSeconds, b: timeSeconds };
        this.enabled = timeSeconds > 0;
    }

    /**
     * Format seconds into MM:SS string
     */
    static formatTime(seconds) {
        if (seconds <= 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}
