import * as THREE from 'three';

/**
 * ParticleSystem.js — Simple 3D particle emitter for visual effects (sparks/dust)
 */
export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.maxParticles = 500;

        // Base geometry and material for sparks
        const geometry = new THREE.BufferGeometry();
        // Since we'll update positions dynamically, we create a reasonably sized buffer
        const positions = new Float32Array(this.maxParticles * 3);
        const colors = new Float32Array(this.maxParticles * 3);
        const sizes = new Float32Array(this.maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.2, // Base size
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false, // Don't write to depth buffer so sparks look nice together
        });

        // We use a custom shader to support per-particle size and fading if desired, 
        // but for simplicity, standard PointsMaterial is enough if we just animate the global opacity
        // or update sizes array.

        // Let's use custom shader for better per-particle life fade
        const customMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 customColor;
                attribute float opacity;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    vColor = customColor;
                    vOpacity = opacity;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (10.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    // Make it a soft circle
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.1, dist) * vOpacity;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Add opacity attribute
        const opacities = new Float32Array(this.maxParticles);
        geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
        // Use customColor instead of color to match our shader attribute name
        geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
        geometry.deleteAttribute('color'); // Remove unused default

        this.points = new THREE.Points(geometry, customMaterial);
        // Put points in frustum but hide all initially by setting sizes to 0
        this.points.frustumCulled = false;
        this.scene.add(this.points);

        this.nextIndex = 0;
    }

    /**
     * Emit sparks at a specific 3D coordinate
     * @param {THREE.Vector3} position - Where to emit
     * @param {string} type - 'capture' or 'move'
     */
    emit(position, type = 'capture') {
        const count = type === 'capture' ? 40 : 10;
        const colorBase = type === 'capture' ? new THREE.Color(0xffaa22) : new THREE.Color(0x88ccff);

        for (let i = 0; i < count; i++) {
            const idx = this.nextIndex;

            // Random velocity roughly upwards and outwards
            const vx = (Math.random() - 0.5) * 6;
            const vy = Math.random() * 5 + 2; // Upward bias
            const vz = (Math.random() - 0.5) * 6;

            // Variation in color
            const c = colorBase.clone();
            if (type === 'capture') {
                c.offsetHSL(Math.random() * 0.1 - 0.05, 0, Math.random() * 0.2 - 0.1);
            }

            this.particles[idx] = {
                x: position.x,
                y: position.y + 0.5, // slightly above the board
                z: position.z,
                vx: vx,
                vy: vy,
                vz: vz,
                life: 1.0, // 1.0 down to 0.0
                decay: Math.random() * 1.5 + 0.8, // how fast it dies
                size: Math.random() * 6 + 4, // 4 to 10
                r: c.r,
                g: c.g,
                b: c.b
            };

            this.nextIndex = (this.nextIndex + 1) % this.maxParticles;
        }
    }

    /**
     * Call this every frame in the render loop
     */
    update(deltaTime = 0.016) {
        const positions = this.points.geometry.attributes.position.array;
        const colors = this.points.geometry.attributes.customColor.array;
        const sizes = this.points.geometry.attributes.size.array;
        const opacities = this.points.geometry.attributes.opacity.array;

        let needsUpdate = false;

        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.particles[i];

            if (p && p.life > 0) {
                p.life -= p.decay * deltaTime;

                if (p.life > 0) {
                    // Gravity and physics
                    p.vy -= 15.0 * deltaTime; // gravity

                    // Friction/Drag
                    p.vx *= 0.95;
                    p.vz *= 0.95;

                    p.x += p.vx * deltaTime;
                    p.y += p.vy * deltaTime;
                    p.z += p.vz * deltaTime;

                    // Floor collision (bounce)
                    if (p.y < 0) {
                        p.y = 0;
                        p.vy *= -0.4;
                    }

                    positions[i * 3] = p.x;
                    positions[i * 3 + 1] = p.y;
                    positions[i * 3 + 2] = p.z;

                    colors[i * 3] = p.r;
                    colors[i * 3 + 1] = p.g;
                    colors[i * 3 + 2] = p.b;

                    sizes[i] = p.size;
                    opacities[i] = p.life;
                } else {
                    // Particle dead
                    sizes[i] = 0;
                    opacities[i] = 0;
                }
                needsUpdate = true;
            } else if (p && p.life <= 0 && sizes[i] > 0) {
                // Just died this frame, hide it
                sizes[i] = 0;
                opacities[i] = 0;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.points.geometry.attributes.position.needsUpdate = true;
            this.points.geometry.attributes.customColor.needsUpdate = true;
            this.points.geometry.attributes.size.needsUpdate = true;
            this.points.geometry.attributes.opacity.needsUpdate = true;
        }
    }
}
