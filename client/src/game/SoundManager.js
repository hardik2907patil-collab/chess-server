/**
 * SoundManager.js — Chess game sound effects using Web Audio API
 * Generates all sounds procedurally — no external audio files needed
 */

export class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.muted = false;
        this.volume = 0.3;
        this.captureMemeBuffer = null;
        this.captureMemePlayerBuffer = null;
        this.checkmateBuffer = null;
        this._assetsLoaded = false;
        this._assetsPromise = null;
    }

    async loadAssets() {
        if (!this.ctx) return;
        if (this._assetsLoaded) return;

        const assets = [
            { key: 'captureMemeBuffer', url: 'assets/capture_meme.mp3' },
            { key: 'captureMemePlayerBuffer', url: 'assets/capture_meme_player.mp3' },
            { key: 'checkmateBuffer', url: 'assets/checkmate.mp3' }
        ];

        for (const asset of assets) {
            try {
                const res = await fetch(asset.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const arrayBuffer = await res.arrayBuffer();
                this[asset.key] = await this.ctx.decodeAudioData(arrayBuffer);
                console.log(`✅ Audio loaded: ${asset.key}`);
            } catch (e) {
                console.warn(`Could not load audio asset: ${asset.url}`, e);
            }
        }
        this._assetsLoaded = true;
    }

    /**
     * Initialize the audio context (must be called after user interaction)
     */
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Start loading and keep the promise so playCheckmate can await it
            this._assetsPromise = this.loadAssets();
        } catch (e) {
            console.warn('Web Audio API not available');
            this.enabled = false;
        }
    }

    /**
     * Resume context if suspended (browsers require user gesture)
     */
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * Play a "piece placed" sound — solid wooden/marble thud
     */
    playMove() {
        if (!this.enabled || !this.ctx || this.muted) return;
        this.resume();

        const now = this.ctx.currentTime;

        // Low thud
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
        gain.gain.setValueAtTime(this.volume * 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);

        // Click overtone
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(800, now);
        osc2.frequency.exponentialRampToValueAtTime(200, now + 0.04);
        gain2.gain.setValueAtTime(this.volume * 0.3, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.06);

        // Noise burst for texture
        this._playNoiseBurst(now, 0.05, this.volume * 0.15);
    }

    /**
     * Play a "capture" sound — more aggressive impact
     */
    playCapture(isOpponentCapture = false) {
        if (!this.enabled || !this.ctx || this.muted) return;
        this.resume();

        // If the opponent captured our piece, play the opponent meme sound (fahhhhh)
        if (isOpponentCapture && this.captureMemeBuffer) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.captureMemeBuffer;
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = this.volume * 1.5;
            source.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            source.start(0);
            return;
        }

        // If WE captured the opponent's piece, play the player meme sound (Ainsley Harriott)
        if (!isOpponentCapture && this.captureMemePlayerBuffer) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.captureMemePlayerBuffer;
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = this.volume * 1.5;
            source.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            source.start(0);
            return;
        }

        const now = this.ctx.currentTime;

        // Hard impact
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        gain.gain.setValueAtTime(this.volume * 0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);

        // Bright crack
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(1200, now);
        osc2.frequency.exponentialRampToValueAtTime(100, now + 0.06);
        gain2.gain.setValueAtTime(this.volume * 0.25, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.08);

        // Noise burst
        this._playNoiseBurst(now, 0.08, this.volume * 0.3);
    }

    /**
     * Play a "check" sound — sharp alert
     */
    playCheck() {
        if (!this.enabled || !this.ctx || this.muted) return;
        this.resume();

        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(this.volume * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
    }

    /**
     * Play a "game over" sound — dramatic chord
     */
    playGameOver() {
        if (!this.enabled || !this.ctx || this.muted) return;
        this.resume();

        const now = this.ctx.currentTime;
        const freqs = [220, 277, 330];  // A minor chord

        freqs.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(this.volume * 0.3, now + i * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + i * 0.05);
            osc.stop(now + 1.2);
        });
    }

    /**
     * Play a special custom "checkmate" sound effect
     */
    async playCheckmate() {
        if (!this.enabled || !this.ctx || this.muted) return;
        this.resume();

        // Wait for assets to finish loading if they haven't yet
        if (!this.checkmateBuffer && this._assetsPromise) {
            try {
                await this._assetsPromise;
            } catch (e) {
                console.warn('Failed to wait for audio assets:', e);
            }
        }

        if (this.checkmateBuffer) {
            console.log('🔊 Playing checkmate sound!');
            const source = this.ctx.createBufferSource();
            source.buffer = this.checkmateBuffer;
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = this.volume * 2.5; // Play it loud and clear
            source.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            source.start(0);
        } else {
            console.warn('⚠️ Checkmate buffer not available, using fallback');
            // Louder fallback
            this._playCheckmateChord();
        }
    }

    /**
     * Fallback checkmate sound — dramatic triumphant chord (louder than gameOver)
     */
    _playCheckmateChord() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // Dramatic fanfare chord: C major with octave
        const freqs = [262, 330, 392, 523];
        freqs.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.06);
            gain.gain.setValueAtTime(this.volume * 0.6, now + i * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + i * 0.06);
            osc.stop(now + 1.8);
        });
    }

    /**
     * Helper: create a short noise burst for impact texture
     */
    _playNoiseBurst(startTime, duration, volume) {
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decaying noise
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start(startTime);
    }
}
