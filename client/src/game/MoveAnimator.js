/**
 * MoveAnimator.js — Smooth piece movement animations
 * Enhanced with arc lift, easing, and marble-sliding feel
 */
import * as THREE from 'three';

export class MoveAnimator {
    constructor() {
        this.animations = [];
    }

    /**
     * Animate a piece mesh from its current position to a target position
     * @param {THREE.Mesh} mesh - the piece to animate
     * @param {THREE.Vector3} targetPosition - where to move to
     * @param {number} duration - animation time in seconds
     * @param {Function|null} onComplete - callback when done
     */
    animate(mesh, targetPosition, duration = 0.4, onComplete = null) {
        const startPos = mesh.position.clone();
        const startTime = performance.now();
        const durationMs = duration * 1000;

        // Calculate distance for dynamic arc height
        const dist = startPos.distanceTo(targetPosition);
        const arcHeight = Math.min(0.3, 0.08 + dist * 0.06); // scales with distance

        return new Promise((resolve) => {
            const anim = {
                mesh,
                startPos,
                targetPosition: targetPosition.clone(),
                startTime,
                durationMs,
                arcHeight,
                startRotY: mesh.rotation.y,
                onComplete: () => {
                    if (onComplete) onComplete();
                    resolve();
                },
            };
            this.animations.push(anim);
        });
    }

    /**
     * Call this in the render loop
     */
    update() {
        const now = performance.now();
        const completed = [];

        for (const anim of this.animations) {
            const elapsed = now - anim.startTime;
            let t = Math.min(elapsed / anim.durationMs, 1);

            // Smooth ease-in-out (cubic bezier feel)
            t = t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // Interpolate XZ
            anim.mesh.position.x = THREE.MathUtils.lerp(anim.startPos.x, anim.targetPosition.x, t);
            anim.mesh.position.z = THREE.MathUtils.lerp(anim.startPos.z, anim.targetPosition.z, t);

            // Arc Y — smoother parabolic lift
            const arcT = Math.sin(t * Math.PI);
            anim.mesh.position.y = THREE.MathUtils.lerp(anim.startPos.y, anim.targetPosition.y, t) + arcT * anim.arcHeight;

            // Subtle tilt during movement (leans forward slightly)
            const tiltAmount = 0.04;
            const tilt = arcT * tiltAmount;
            anim.mesh.rotation.x = -tilt;

            if (t >= 1) {
                anim.mesh.position.copy(anim.targetPosition);
                anim.mesh.rotation.x = 0;
                completed.push(anim);
            }
        }

        for (const anim of completed) {
            const idx = this.animations.indexOf(anim);
            if (idx !== -1) this.animations.splice(idx, 1);
            if (anim.onComplete) anim.onComplete();
        }
    }

    isAnimating() {
        return this.animations.length > 0;
    }
}
