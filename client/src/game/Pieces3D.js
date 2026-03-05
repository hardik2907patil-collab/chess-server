/**
 * Pieces3D.js — Realistic 3D chess pieces with marble texture
 * Uses LatheGeometry with detailed profiles for classic Staunton-style pieces
 * Knight uses ExtrudeGeometry for horse-head silhouette
 */
import * as THREE from 'three';
import { BOARD_OFFSET, SQUARE_SIZE } from './Board3D.js';

// Piece unicode for captured display
const PIECE_UNICODE = {
    p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
    P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
};

// ==========================================
// Procedural marble texture
// ==========================================
function createMarbleCanvas(baseHex, veinHex, size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, size, size);

    // Veins
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = veinHex;
    for (let i = 0; i < 30; i++) {
        ctx.lineWidth = Math.random() * 1.5 + 0.3;
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, Math.random() * size);
        for (let j = 0; j < 3; j++) {
            ctx.quadraticCurveTo(
                Math.random() * size, Math.random() * size,
                Math.random() * size, Math.random() * size
            );
        }
        ctx.stroke();
    }

    // Grain
    ctx.globalAlpha = 0.02;
    for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? veinHex : baseHex;
        ctx.fillRect(Math.random() * size, Math.random() * size, Math.random() * 2, Math.random() * 2);
    }

    return canvas;
}

const TEXTURE_CACHE = {};

function getCachedTexture(baseHex, veinHex) {
    const key = `${baseHex}-${veinHex}`;
    if (!TEXTURE_CACHE[key]) {
        TEXTURE_CACHE[key] = new THREE.CanvasTexture(createMarbleCanvas(baseHex, veinHex));
    }
    return TEXTURE_CACHE[key];
}

// ==========================================
// Materials — Matte marble (non-shiny)
// ==========================================
function createWhiteMaterial() {
    return new THREE.MeshStandardMaterial({
        map: getCachedTexture('#e8e4de', '#b0aaa0'),
        color: 0xe8e4de,
        roughness: 0.7,      // matte, non-shiny
        metalness: 0.0,
    });
}

function createBlackMaterial() {
    // Lighten the base to a clear grey color as requested by the user
    return new THREE.MeshStandardMaterial({
        map: getCachedTexture('#888890', '#a0a0a8'),
        color: 0x888890, // Light grey
        roughness: 0.4,  // Standard matte/satin finish
        metalness: 0.1,  // Minimal metalness for a stone/plastic look
    });
}

// ==========================================
// Detailed LatheGeometry profiles (Staunton style)
// ==========================================
function createPawnProfile() {
    return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.20, 0),       // base
        new THREE.Vector2(0.22, 0.02),
        new THREE.Vector2(0.22, 0.04),
        new THREE.Vector2(0.12, 0.06),    // base taper
        new THREE.Vector2(0.10, 0.08),
        new THREE.Vector2(0.08, 0.14),    // stem
        new THREE.Vector2(0.07, 0.22),
        new THREE.Vector2(0.06, 0.26),
        new THREE.Vector2(0.08, 0.28),    // collar ring
        new THREE.Vector2(0.10, 0.30),
        new THREE.Vector2(0.10, 0.32),
        new THREE.Vector2(0.08, 0.34),
        new THREE.Vector2(0.12, 0.36),    // head sphere start
        new THREE.Vector2(0.13, 0.39),
        new THREE.Vector2(0.12, 0.42),
        new THREE.Vector2(0.09, 0.44),
        new THREE.Vector2(0.05, 0.45),
        new THREE.Vector2(0, 0.455),      // top
    ];
}

function createRookProfile() {
    return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.24, 0),       // wide base
        new THREE.Vector2(0.26, 0.02),
        new THREE.Vector2(0.26, 0.05),
        new THREE.Vector2(0.14, 0.07),    // base step
        new THREE.Vector2(0.12, 0.10),
        new THREE.Vector2(0.10, 0.15),    // stem
        new THREE.Vector2(0.10, 0.32),
        new THREE.Vector2(0.12, 0.34),    // collar
        new THREE.Vector2(0.16, 0.36),
        new THREE.Vector2(0.18, 0.38),    // parapet start
        new THREE.Vector2(0.18, 0.46),
        new THREE.Vector2(0.16, 0.46),    // crenellation outer
        new THREE.Vector2(0.16, 0.42),
        new THREE.Vector2(0.12, 0.42),    // crenellation gap
        new THREE.Vector2(0.12, 0.46),
        new THREE.Vector2(0.08, 0.46),
        new THREE.Vector2(0.08, 0.42),
        new THREE.Vector2(0.04, 0.42),
        new THREE.Vector2(0.04, 0.46),
        new THREE.Vector2(0, 0.46),       // inner top
    ];
}

function createBishopProfile() {
    return [
        // Bishop: Slender stem, deep collar, prominent bulbous mitre with a sharp pointy tip
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.22, 0),       // base
        new THREE.Vector2(0.24, 0.02),
        new THREE.Vector2(0.24, 0.05),
        new THREE.Vector2(0.12, 0.07),    // tight base taper
        new THREE.Vector2(0.10, 0.12),    // stem start (thin)
        new THREE.Vector2(0.08, 0.25),
        new THREE.Vector2(0.06, 0.38),
        new THREE.Vector2(0.08, 0.40),    // lower collar
        new THREE.Vector2(0.11, 0.42),
        new THREE.Vector2(0.08, 0.44),    // neck
        new THREE.Vector2(0.13, 0.46),    // mitre base (wide)
        new THREE.Vector2(0.14, 0.48),    // mitre bulge
        new THREE.Vector2(0.12, 0.52),
        new THREE.Vector2(0.08, 0.56),
        new THREE.Vector2(0.04, 0.59),    // sharp tip taper
        new THREE.Vector2(0.02, 0.61),    // small neck for bead
        new THREE.Vector2(0.04, 0.62),    // tiny bead
        new THREE.Vector2(0.03, 0.64),
        new THREE.Vector2(0, 0.65),
    ];
}

function createQueenProfile() {
    return [
        // Queen: Graceful stem, dramatic wide-flaring crown cup
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.25, 0),       // base
        new THREE.Vector2(0.27, 0.02),
        new THREE.Vector2(0.27, 0.05),
        new THREE.Vector2(0.14, 0.08),
        new THREE.Vector2(0.11, 0.15),
        new THREE.Vector2(0.09, 0.28),    // graceful stem
        new THREE.Vector2(0.08, 0.40),
        new THREE.Vector2(0.12, 0.43),    // double collar
        new THREE.Vector2(0.14, 0.45),
        new THREE.Vector2(0.10, 0.47),    // neck
        new THREE.Vector2(0.15, 0.49),    // crown base
        new THREE.Vector2(0.22, 0.54),    // **WIDE flare** for crown
        new THREE.Vector2(0.26, 0.58),    // crown tip (outer rim)
        new THREE.Vector2(0.22, 0.58),    // inner rim width
        new THREE.Vector2(0.14, 0.52),    // slopes down into the cup
        new THREE.Vector2(0, 0.50),       // deep cup center
    ];
}

function createKingProfile() {
    return [
        // King: Tallest, thickest base and stem, large rounded dome
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.28, 0),       // heaviest base
        new THREE.Vector2(0.30, 0.03),
        new THREE.Vector2(0.30, 0.06),
        new THREE.Vector2(0.18, 0.10),
        new THREE.Vector2(0.14, 0.16),
        new THREE.Vector2(0.12, 0.28),    // sturdy, thicker stem
        new THREE.Vector2(0.11, 0.42),
        new THREE.Vector2(0.15, 0.45),    // major collar
        new THREE.Vector2(0.18, 0.48),    // wide shoulder
        new THREE.Vector2(0.14, 0.51),    // neck
        new THREE.Vector2(0.18, 0.54),    // crown base
        new THREE.Vector2(0.16, 0.60),    // domed crown (classic king)
        new THREE.Vector2(0.12, 0.65),
        new THREE.Vector2(0.06, 0.68),
        new THREE.Vector2(0, 0.70),       // top of dome
    ];
}

/**
 * Create a knight piece using a horse-head silhouette via ExtrudeGeometry
 * This gives a distinctive horse-head shape instead of rotationally symmetric
 */
function createKnightGeometry(scale) {
    const shape = new THREE.Shape();

    // Horse head side-profile (scaled down)
    const s = 0.22 * scale;
    shape.moveTo(0, 0);
    shape.lineTo(s * 1.2, 0);          // base right
    shape.lineTo(s * 1.2, s * 0.3);
    shape.lineTo(s * 0.8, s * 0.4);    // base taper
    shape.lineTo(s * 0.6, s * 0.8);    // neck start
    shape.lineTo(s * 0.5, s * 1.4);    // neck
    shape.lineTo(s * 0.4, s * 1.8);    // chin/jaw
    shape.lineTo(s * 0.8, s * 2.0);    // nose
    shape.lineTo(s * 0.9, s * 2.1);    // nose tip
    shape.lineTo(s * 0.7, s * 2.2);    // forehead bend
    shape.lineTo(s * 0.3, s * 2.4);    // forehead
    shape.lineTo(s * 0.1, s * 2.5);    // ear tip
    shape.lineTo(-s * 0.1, s * 2.3);   // ear inner
    shape.lineTo(-s * 0.2, s * 2.0);   // back of head
    shape.lineTo(-s * 0.3, s * 1.5);   // mane/back of neck
    shape.lineTo(-s * 0.4, s * 1.0);   // lower back
    shape.lineTo(-s * 0.5, s * 0.5);   // back taper
    shape.lineTo(-s * 0.6, s * 0.3);
    shape.lineTo(-s * 1.0, 0);         // base left
    shape.lineTo(0, 0);

    const extrudeSettings = {
        depth: s * 0.8,
        bevelEnabled: true,
        bevelThickness: s * 0.12,
        bevelSize: s * 0.1,
        bevelSegments: 3,
    };

    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Center the geometry
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    geo.translate(-cx, 0, -cz);

    return geo;
}

// ==========================================
// Profile map and scales
// ==========================================
const PROFILE_MAP = {
    p: createPawnProfile,
    r: createRookProfile,
    b: createBishopProfile,
    q: createQueenProfile,
    k: createKingProfile,
};

const SCALE_MAP = {
    p: 1.0,
    r: 1.15,
    n: 1.15,
    b: 1.30,
    q: 1.45,
    k: 1.6,
};

// ==========================================
// Pieces3D class
// ==========================================
export class Pieces3D {
    constructor(scene) {
        this.scene = scene;
        this.pieceMeshes = new Map(); // key: "col-row", value: mesh
        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.whiteMaterial = createWhiteMaterial();
        this.blackMaterial = createBlackMaterial();
        this.currentTheme = 'classic';
    }

    setTheme(theme) {
        this.currentTheme = theme;
        if (theme === 'wood') {
            this.whiteMaterial.map = null;
            this.whiteMaterial.color.setHex(0xf3c08f);
            this.whiteMaterial.roughness = 0.9;
            this.whiteMaterial.metalness = 0.0;
            this.whiteMaterial.transparent = false;

            this.blackMaterial.map = null;
            this.blackMaterial.color.setHex(0x3e2723);
            this.blackMaterial.roughness = 0.9;
            this.blackMaterial.metalness = 0.0;
            this.blackMaterial.transparent = false;
        } else if (theme === 'glass') {
            this.whiteMaterial.map = null;
            this.whiteMaterial.color.setHex(0xeeeeff);
            this.whiteMaterial.roughness = 0.05;
            this.whiteMaterial.metalness = 0.8;
            this.whiteMaterial.transparent = true;
            this.whiteMaterial.opacity = 0.85;

            this.blackMaterial.map = null;
            this.blackMaterial.color.setHex(0x556688);
            this.blackMaterial.roughness = 0.1;
            this.blackMaterial.metalness = 0.6;
            this.blackMaterial.transparent = true;
            this.blackMaterial.opacity = 0.9;
        } else {
            // Classic
            this.whiteMaterial.map = getCachedTexture('#e8e4de', '#b0aaa0');
            this.whiteMaterial.color.setHex(0xe8e4de);
            this.whiteMaterial.roughness = 0.7;
            this.whiteMaterial.metalness = 0.0;
            this.whiteMaterial.transparent = false;
            this.whiteMaterial.opacity = 1.0;

            this.blackMaterial.map = getCachedTexture('#888890', '#a0a0a8');
            this.blackMaterial.color.setHex(0x888890);
            this.blackMaterial.roughness = 0.4;
            this.blackMaterial.metalness = 0.1;
            this.blackMaterial.transparent = false;
            this.blackMaterial.opacity = 1.0;
        }
        this.whiteMaterial.needsUpdate = true;
        this.blackMaterial.needsUpdate = true;
    }

    createPieceMesh(type, color) {
        const mat = color === 'w' ? this.whiteMaterial : this.blackMaterial;
        let mesh;
        const scale = SCALE_MAP[type] || 1;

        // Ensure GEOMETRY_CACHE exists
        if (!this.constructor.GEOMETRY_CACHE) {
            this.constructor.GEOMETRY_CACHE = {};
        }
        const cacheKey = `${type}-${scale}`;
        let geo = this.constructor.GEOMETRY_CACHE[cacheKey];

        if (!geo) {
            if (type === 'n') {
                geo = createKnightGeometry(scale);
            } else {
                const profileFn = PROFILE_MAP[type];
                if (!profileFn) return null;
                const profile = profileFn();
                geo = new THREE.LatheGeometry(profile, 32);
                geo.scale(scale, scale, scale);
            }
            this.constructor.GEOMETRY_CACHE[cacheKey] = geo;
        }

        mesh = new THREE.Mesh(geo, mat);

        if (type === 'n') {
            mesh.rotation.y = color === 'w' ? Math.PI * 0.5 : -Math.PI * 0.5;
        } else {

            // Add clear composite features for King and Queen
            if (type === 'k') {
                // Add a distinct 3D cross (+) to the King
                const crossGroup = new THREE.Group();
                const vertGeo = new THREE.BoxGeometry(0.06 * scale, 0.2 * scale, 0.05 * scale);
                const horizGeo = new THREE.BoxGeometry(0.18 * scale, 0.06 * scale, 0.05 * scale);
                const vMesh = new THREE.Mesh(vertGeo, mat);
                const hMesh = new THREE.Mesh(horizGeo, mat);
                vMesh.position.y = (0.70 * scale) + (0.1 * scale);
                hMesh.position.y = (0.70 * scale) + (0.12 * scale);
                vMesh.castShadow = true;
                hMesh.castShadow = true;
                crossGroup.add(vMesh);
                crossGroup.add(hMesh);
                mesh.add(crossGroup);
            } else if (type === 'q') {
                // Add tiny crown jewels (points) around the Queen's rim
                const crownGroup = new THREE.Group();
                const numJewels = 8;
                const radius = 0.24 * scale;
                const jewelGeo = new THREE.SphereGeometry(0.04 * scale, 8, 8);
                const yPos = 0.58 * scale;
                for (let i = 0; i < numJewels; i++) {
                    const angle = (i / numJewels) * Math.PI * 2;
                    const jewel = new THREE.Mesh(jewelGeo, mat);
                    jewel.position.set(Math.cos(angle) * radius, yPos, Math.sin(angle) * radius);
                    jewel.castShadow = true;
                    crownGroup.add(jewel);
                }
                mesh.add(crownGroup);
            }
        }

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    /**
     * Place all pieces from a chess.js board array
     * @param {Array} boardState - chess.js board() result (8x8 array)
     */
    setupFromBoard(boardState) {
        this.clearAll();

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = boardState[row][col];
                if (piece) {
                    this.addPiece(piece.type, piece.color, col, 7 - row);
                }
            }
        }
    }

    addPiece(type, color, col, row) {
        const key = `${col}-${row}`;
        if (this.pieceMeshes.has(key)) {
            this.removePiece(col, row);
        }

        const mesh = this.createPieceMesh(type, color);
        if (!mesh) return;

        const worldPos = this.getWorldPosition(col, row);
        mesh.position.copy(worldPos);
        mesh.userData = { type: 'piece', pieceType: type, pieceColor: color, col, row };

        this.group.add(mesh);
        this.pieceMeshes.set(key, mesh);
    }

    removePiece(col, row) {
        const key = `${col}-${row}`;
        const mesh = this.pieceMeshes.get(key);
        if (mesh) {
            this.group.remove(mesh);
            // DO NOT dispose geometry/material here, as they are globally cached/shared
            this.pieceMeshes.delete(key);
        }
    }

    getPieceMesh(col, row) {
        return this.pieceMeshes.get(`${col}-${row}`);
    }

    getWorldPosition(col, row) {
        return new THREE.Vector3(
            col * SQUARE_SIZE - BOARD_OFFSET,
            0.075,
            (7 - row) * SQUARE_SIZE - BOARD_OFFSET
        );
    }

    clearAll() {
        this.pieceMeshes.forEach(mesh => {
            this.group.remove(mesh);
            // DO NOT dispose geometry/material here, as they are globally cached/shared
        });
        this.pieceMeshes.clear();
    }

    getAllMeshes() {
        return Array.from(this.pieceMeshes.values());
    }

    /**
     * Move a piece mesh from one position to another (instant)
     */
    movePieceMesh(fromCol, fromRow, toCol, toRow) {
        const key = `${fromCol}-${fromRow}`;
        const mesh = this.pieceMeshes.get(key);
        if (!mesh) return;

        this.pieceMeshes.delete(key);
        const newKey = `${toCol}-${toRow}`;

        // Remove any existing piece at destination
        this.removePiece(toCol, toRow);

        const worldPos = this.getWorldPosition(toCol, toRow);
        mesh.position.copy(worldPos);
        mesh.userData.col = toCol;
        mesh.userData.row = toRow;
        this.pieceMeshes.set(newKey, mesh);
    }
}

export { PIECE_UNICODE };
