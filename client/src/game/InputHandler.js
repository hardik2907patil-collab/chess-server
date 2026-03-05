/**
 * InputHandler.js — Mouse/touch raycasting for 3D chess interaction
 */
import * as THREE from 'three';

export class InputHandler {
    constructor(camera, canvas, board3D, pieces3D) {
        this.camera = camera;
        this.canvas = canvas;
        this.board3D = board3D;
        this.pieces3D = pieces3D;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.onSquareClick = null; // callback(col, row)

        this.setupListeners();
    }

    setupListeners() {
        // Mouse click
        this.canvas.addEventListener('click', (e) => this.handleClick(e));

        // Touch tap
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (e.changedTouches.length > 0) {
                const touch = e.changedTouches[0];
                this.handleClick(touch);
            }
        }, { passive: false });
    }

    handleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);

        // Check pieces first
        const pieceMeshes = this.pieces3D.getAllMeshes();
        const pieceHits = this.raycaster.intersectObjects(pieceMeshes, false);

        if (pieceHits.length > 0) {
            const hit = pieceHits[0].object;
            if (hit.userData.type === 'piece' && this.onSquareClick) {
                this.onSquareClick(hit.userData.col, hit.userData.row);
                return;
            }
        }

        // Check board squares
        const squareMeshes = this.board3D.getAllSquareMeshes();
        const squareHits = this.raycaster.intersectObjects(squareMeshes, false);

        if (squareHits.length > 0) {
            const hit = squareHits[0].object;
            if (hit.userData.type === 'square' && this.onSquareClick) {
                // Convert visual row to chess row
                const col = hit.userData.col;
                const row = 7 - hit.userData.row;
                this.onSquareClick(col, row);
            }
        }
    }

    setClickHandler(callback) {
        this.onSquareClick = callback;
    }
}
