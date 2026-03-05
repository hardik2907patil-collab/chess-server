/**
 * Board3D.js — Renders the 3D chess board with Three.js
 * Black and white marble squares with dark elegant frame
 */
import * as THREE from 'three';

const SQUARE_SIZE = 1;
const BOARD_SIZE = 8;
const BOARD_OFFSET = (BOARD_SIZE * SQUARE_SIZE) / 2 - SQUARE_SIZE / 2;

// Black & white palette with accent highlights
const COLORS = {
    lightSquare: 0xeeeeee,     // bright white marble
    darkSquare: 0x444444,      // dark grey
    boardFrame: 0x0a0a0a,      // dark obsidian frame
    highlight: 0x7c6aef,       // accent purple
    validMove: 0x4ecb7a,       // green
    lastMove: 0xd4a843,        // gold
    check: 0xe54d6b,           // red
    selected: 0x7c6aef,        // purple
};

/**
 * Generate a procedural marble texture on a canvas
 */
function createMarbleTexture(baseColor, veinColor, size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base fill
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);

    // Draw marble veins using overlapping semi-transparent curves
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = veinColor;
    for (let i = 0; i < 40; i++) {
        ctx.lineWidth = Math.random() * 2 + 0.5;
        ctx.beginPath();
        const startX = Math.random() * size;
        const startY = Math.random() * size;
        ctx.moveTo(startX, startY);
        for (let j = 0; j < 4; j++) {
            ctx.quadraticCurveTo(
                Math.random() * size, Math.random() * size,
                Math.random() * size, Math.random() * size
            );
        }
        ctx.stroke();
    }

    // Add subtle noise grain
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 2;
        ctx.fillStyle = Math.random() > 0.5 ? veinColor : baseColor;
        ctx.fillRect(x, y, r, r);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

const TEXTURE_CACHE = {};

function getCachedTexture(baseHex, veinHex) {
    const key = `${baseHex}-${veinHex}`;
    if (!TEXTURE_CACHE[key]) {
        TEXTURE_CACHE[key] = createMarbleTexture(baseHex, veinHex);
    }
    return TEXTURE_CACHE[key];
}

export class Board3D {
    constructor(scene) {
        this.scene = scene;
        this.squares = [];       // 2D array [col][row]
        this.squareMeshes = [];  // flat array of square meshes
        this.highlightedSquares = [];
        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.currentTheme = 'classic';

        // Persistent check highlight tracking
        this._checkHighlight = null; // { mesh, originalMat, col, row }
        this._checkGlow = null;      // glowing ring mesh
        this._checkTime = 0;         // for pulse animation

        // Materials updated by setTheme and used by buildBoard / buildFrame
        this.lightMaterial = new THREE.MeshStandardMaterial();
        this.darkMaterial = new THREE.MeshStandardMaterial();
        this.frameMaterial = new THREE.MeshStandardMaterial();

        // Initialize with default theme colors before building
        this.setTheme(this.currentTheme, false);

        this.buildBoard();
        this.buildFrame();
        this.buildLabels();
    }

    setTheme(theme, needsUpdate = true) {
        this.currentTheme = theme;
        if (theme === 'wood') {
            this.lightMaterial.map = null;
            this.lightMaterial.color.setHex(0xe8c396);
            this.lightMaterial.roughness = 0.8;
            this.lightMaterial.metalness = 0.05;
            this.lightMaterial.transparent = false;

            this.darkMaterial.map = null;
            this.darkMaterial.color.setHex(0x5c3a21);
            this.darkMaterial.roughness = 0.8;
            this.darkMaterial.metalness = 0.05;
            this.darkMaterial.transparent = false;

            this.frameMaterial.map = null;
            this.frameMaterial.color.setHex(0x351f10);
            this.frameMaterial.roughness = 0.9;
            this.frameMaterial.metalness = 0.0;
            this.frameMaterial.transparent = false;
        } else if (theme === 'glass') {
            this.lightMaterial.map = null;
            this.lightMaterial.color.setHex(0xccddff);
            this.lightMaterial.roughness = 0.1;
            this.lightMaterial.metalness = 0.9;
            this.lightMaterial.transparent = true;
            this.lightMaterial.opacity = 0.4;

            this.darkMaterial.map = null;
            this.darkMaterial.color.setHex(0x2a3a50);
            this.darkMaterial.roughness = 0.2;
            this.darkMaterial.metalness = 0.9;
            this.darkMaterial.transparent = true;
            this.darkMaterial.opacity = 0.8;

            this.frameMaterial.map = null;
            this.frameMaterial.color.setHex(0x99aacc);
            this.frameMaterial.roughness = 0.2;
            this.frameMaterial.metalness = 0.8;
            this.frameMaterial.transparent = false;
        } else {
            // Classic
            this.lightMaterial.map = getCachedTexture('#eeeeee', '#aaaaaa');
            this.lightMaterial.color.setHex(0xd8d8d8);
            this.lightMaterial.roughness = 0.5;
            this.lightMaterial.metalness = 0.1;
            this.lightMaterial.transparent = false;
            this.lightMaterial.opacity = 1.0;

            this.darkMaterial.map = getCachedTexture('#333333', '#555555');
            this.darkMaterial.color.setHex(0x2a2a2a);
            this.darkMaterial.roughness = 0.5;
            this.darkMaterial.metalness = 0.1;
            this.darkMaterial.transparent = false;
            this.darkMaterial.opacity = 1.0;

            this.frameMaterial.map = getCachedTexture('#0a0a0a', '#1a1a1a');
            this.frameMaterial.color.setHex(COLORS.boardFrame);
            this.frameMaterial.roughness = 0.6;
            this.frameMaterial.metalness = 0.05;
            this.frameMaterial.transparent = false;
        }

        if (needsUpdate) {
            this.lightMaterial.needsUpdate = true;
            this.darkMaterial.needsUpdate = true;
            this.frameMaterial.needsUpdate = true;
        }
    }

    buildBoard() {
        const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE, 0.15, SQUARE_SIZE);

        this.squares = Array.from({ length: 8 }, () => Array(8).fill(null));

        for (let col = 0; col < BOARD_SIZE; col++) {
            for (let row = 0; row < BOARD_SIZE; row++) {
                const isLight = (col + row) % 2 === 0;
                const mesh = new THREE.Mesh(squareGeo, isLight ? this.lightMaterial : this.darkMaterial);
                mesh.position.set(
                    col * SQUARE_SIZE - BOARD_OFFSET,
                    0,
                    row * SQUARE_SIZE - BOARD_OFFSET
                );
                mesh.receiveShadow = true;
                mesh.userData = { type: 'square', col, row };
                this.group.add(mesh);
                this.squares[col][row] = mesh;
                this.squareMeshes.push(mesh);
            }
        }
    }

    buildFrame() {
        const frameWidth = 0.45;
        const totalSize = BOARD_SIZE * SQUARE_SIZE;
        const frameHeight = 0.35;

        // Perfectly abut the outside edges of the 8x8 board
        // Current board goes from -4 to +4. Center is 0.
        // A square edge is at offset +/- 4. The frame center needs to be at 4 + frameWidth/2 = 4.225.
        const frameCenterOffset = (totalSize / 2) + (frameWidth / 2);

        // Four sides of the frame
        const sides = [
            // Top and Bottom sides (span the full width + corners)
            { w: totalSize + frameWidth * 2, d: frameWidth, x: 0, z: -frameCenterOffset },
            { w: totalSize + frameWidth * 2, d: frameWidth, x: 0, z: frameCenterOffset },
            // Left and Right sides (fit exactly between Top and Bottom)
            { w: frameWidth, d: totalSize, x: -frameCenterOffset, z: 0 },
            { w: frameWidth, d: totalSize, x: frameCenterOffset, z: 0 },
        ];

        sides.forEach(s => {
            const geo = new THREE.BoxGeometry(s.w, frameHeight, s.d);
            const mesh = new THREE.Mesh(geo, this.frameMaterial);
            // Lower the frame slightly so squares protrude just a tiny bit on top, but frame protects edges
            mesh.position.set(s.x, -0.05, s.z);
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            this.group.add(mesh);
        });

        // Base underneath the entire structure
        const baseGeo = new THREE.BoxGeometry(totalSize + frameWidth * 2, 0.12, totalSize + frameWidth * 2);
        const baseMesh = new THREE.Mesh(baseGeo, this.frameMaterial);
        baseMesh.position.set(0, -0.25, 0); // Drop base down
        baseMesh.receiveShadow = true;
        this.group.add(baseMesh);
    }

    buildLabels() {
        const files = 'abcdefgh';
        const ranks = '12345678';
        const labelGroup = new THREE.Group();

        // Push labels slightly further out so they rest neatly on the frame
        const labelOffset = BOARD_OFFSET + 0.85;

        for (let i = 0; i < 8; i++) {
            // File labels (a-h) along bottom
            const fileLabel = this.createTextSprite(files[i], 0.3);
            fileLabel.position.set(
                i * SQUARE_SIZE - BOARD_OFFSET,
                0.01,
                labelOffset
            );
            labelGroup.add(fileLabel);

            // Rank labels (1-8) along left side
            const rankLabel = this.createTextSprite(ranks[7 - i], 0.3);
            rankLabel.position.set(
                -labelOffset,
                0.01,
                i * SQUARE_SIZE - BOARD_OFFSET
            );
            labelGroup.add(rankLabel);
        }

        this.group.add(labelGroup);
    }

    createTextSprite(text, size) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#666666';
        ctx.font = 'bold 42px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(size, size, 1);
        return sprite;
    }

    /**
     * @param {string} algebraic e.g. 'e4'
     * @returns {{col: number, row: number}}
     */
    algebraicToCoords(algebraic) {
        const col = algebraic.charCodeAt(0) - 97; // 'a' = 0
        const row = parseInt(algebraic[1]) - 1;
        return { col, row };
    }

    /**
     * @param {number} col
     * @param {number} row
     * @returns {string} algebraic notation e.g. 'e4'
     */
    coordsToAlgebraic(col, row) {
        return String.fromCharCode(97 + col) + (row + 1);
    }

    getWorldPosition(col, row) {
        return new THREE.Vector3(
            col * SQUARE_SIZE - BOARD_OFFSET,
            0.15,
            (7 - row) * SQUARE_SIZE - BOARD_OFFSET
        );
    }

    getSquareMesh(col, row) {
        return this.squares[col] ? this.squares[col][7 - row] : null;
    }

    clearHighlights() {
        this.highlightedSquares.forEach(({ mesh, originalMat }) => {
            // Don't clear the check highlight — it persists until clearCheck()
            if (this._checkHighlight && mesh === this._checkHighlight.mesh) return;
            if (mesh.material !== originalMat) {
                mesh.material.dispose();
            }
            mesh.material = originalMat;
        });
        // Keep check highlight entries, remove everything else
        this.highlightedSquares = this.highlightedSquares.filter(
            h => this._checkHighlight && h.mesh === this._checkHighlight.mesh
        );
    }

    highlightSquare(col, row, type = 'selected') {
        const mesh = this.getSquareMesh(col, row);
        if (!mesh) return;

        let existing = this.highlightedSquares.find(h => h.mesh === mesh);
        let originalMat;

        if (!existing) {
            originalMat = mesh.material;
            this.highlightedSquares.push({ mesh, originalMat });
        } else {
            originalMat = existing.originalMat;
            // Dispose the previous highlight material
            if (mesh.material !== originalMat) {
                mesh.material.dispose();
            }
        }

        const color = COLORS[type] || COLORS.selected;
        const highlightMat = originalMat.clone();
        highlightMat.color.setHex(color);

        mesh.material = highlightMat;
    }

    highlightValidMoves(moves) {
        moves.forEach(move => {
            const { col, row } = this.algebraicToCoords(move.to);
            this.highlightSquare(col, row, 'validMove');
        });
    }

    highlightLastMove(from, to) {
        const f = this.algebraicToCoords(from);
        const t = this.algebraicToCoords(to);
        this.highlightSquare(f.col, f.row, 'lastMove');
        this.highlightSquare(t.col, t.row, 'lastMove');
    }

    highlightCheck(kingSquare) {
        // Clear any previous check highlight first
        this.clearCheck();

        const { col, row } = this.algebraicToCoords(kingSquare);
        this.highlightSquare(col, row, 'check');

        // Track check highlight separately for persistence
        const mesh = this.getSquareMesh(col, row);
        const entry = this.highlightedSquares.find(h => h.mesh === mesh);
        if (entry) {
            this._checkHighlight = { mesh, originalMat: entry.originalMat, col, row };
        }

        // Add a glowing red ring around the king's square
        const ringGeo = new THREE.RingGeometry(0.38, 0.48, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff2222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(
            col * SQUARE_SIZE - BOARD_OFFSET,
            0.16,
            (7 - row) * SQUARE_SIZE - BOARD_OFFSET
        );
        this.group.add(ring);
        this._checkGlow = ring;
        this._checkTime = 0;
    }

    /**
     * Clear the persistent check indicator
     */
    clearCheck() {
        if (this._checkHighlight) {
            const { mesh, originalMat } = this._checkHighlight;
            if (mesh.material !== originalMat) {
                mesh.material.dispose();
            }
            mesh.material = originalMat;
            // Remove from highlightedSquares too
            this.highlightedSquares = this.highlightedSquares.filter(h => h.mesh !== mesh);
            this._checkHighlight = null;
        }
        if (this._checkGlow) {
            this.group.remove(this._checkGlow);
            this._checkGlow.geometry.dispose();
            this._checkGlow.material.dispose();
            this._checkGlow = null;
        }
    }

    /**
     * Call in the render loop to animate the check glow pulse
     */
    updateCheckGlow(dt = 0.016) {
        if (this._checkGlow) {
            this._checkTime += dt;
            const pulse = 0.5 + 0.5 * Math.sin(this._checkTime * 5);
            this._checkGlow.material.opacity = 0.4 + pulse * 0.6;
            this._checkGlow.scale.setScalar(0.9 + pulse * 0.2);
        }
    }

    getAllSquareMeshes() {
        return this.squareMeshes;
    }
}

export { SQUARE_SIZE, BOARD_OFFSET, COLORS };
