// resources/js/diagram/modules-ai/live/LiveOrb.js
// La esfera de Nova: una masa de luz que respira en reposo, se agita con tu voz,
// gira mientras piensa y late con el ritmo de lo que dice. Dibujada en canvas con
// capas translúcidas que se suman; solo anima mientras es visible.

const TAU = Math.PI * 2;

/** Paletas por estado: [tono base, rango de tono, saturación %, luminosidad %]. */
const MOODS = {
    off: { hue: 220, spread: 10, sat: 10, light: 55, energy: 0.05, spin: 0.1 },
    idle: { hue: 214, spread: 34, sat: 88, light: 56, energy: 0.16, spin: 0.25 },
    capturing: { hue: 172, spread: 40, sat: 90, light: 52, energy: 0.5, spin: 0.5 },
    thinking: { hue: 268, spread: 48, sat: 88, light: 60, energy: 0.3, spin: 1.5 },
    speaking: { hue: 330, spread: 70, sat: 92, light: 58, energy: 0.58, spin: 0.7 },
    waiting: { hue: 38, spread: 22, sat: 92, light: 56, energy: 0.2, spin: 0.35 },
};

const BLOBS = 4;
const POINTS = 96;

export class LiveOrb {
    constructor(canvas, levelProvider = () => 0) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.levelProvider = levelProvider;
        this.mode = 'off';
        this.frame = null;
        this.time = Math.random() * 100;
        this.last = 0;

        // Valores que se suavizan hacia el estado actual.
        this.current = { ...MOODS.off };
        this.level = 0;
        this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }

    setMode(mode) {
        this.mode = MOODS[mode] ? mode : 'idle';
    }

    start() {
        if (this.frame) return;
        this.last = performance.now();
        const tick = (now) => {
            this.frame = requestAnimationFrame(tick);
            this.render(Math.min(0.05, (now - this.last) / 1000));
            this.last = now;
        };
        this.frame = requestAnimationFrame(tick);
    }

    stop() {
        cancelAnimationFrame(this.frame);
        this.frame = null;
    }

    resize() {
        const { width, height } = this.canvas.getBoundingClientRect();
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = Math.max(1, Math.round(width * ratio));
        this.canvas.height = Math.max(1, Math.round(height * ratio));
    }

    render(dt) {
        const { canvas, ctx } = this;
        const target = MOODS[this.mode];
        const ease = 1 - Math.exp(-dt * 4);

        Object.keys(target).forEach((key) => {
            this.current[key] += (target[key] - this.current[key]) * ease;
        });

        // El volumen real sube rápido y baja despacio, como una luz que se apaga.
        const raw = this.levelProvider() || 0;
        this.level += (raw - this.level) * (raw > this.level ? 0.5 : 0.12);

        const speedFactor = this.reducedMotion ? 0.25 : 1;
        this.time += dt * (0.6 + this.current.spin) * speedFactor;

        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const base = Math.min(w, h) * 0.3;
        const energy = this.current.energy + this.level * 0.9;

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

        // Resplandor de fondo
        const glow = ctx.createRadialGradient(cx, cy, base * 0.4, cx, cy, base * (2.0 + this.level * 0.8));
        glow.addColorStop(0, this.hsla(0, 0.34));
        glow.addColorStop(1, this.hsla(0, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = `blur(${Math.round(base * 0.06)}px)`;

        for (let b = 0; b < BLOBS; b++) {
            const phase = (b / BLOBS) * TAU;
            const orbit = base * 0.1 * (1 + this.level * 1.5);
            const ox = Math.cos(this.time * (0.7 + b * 0.23) + phase) * orbit;
            const oy = Math.sin(this.time * (0.9 + b * 0.19) + phase * 1.3) * orbit;
            const radius = base * (0.9 + 0.05 * b);

            this.blob(cx + ox, cy + oy, radius, energy, b, phase);
        }

        ctx.filter = 'none';

        // Aro fino de luz sobre el borde, para dar volumen
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = Math.max(1, base * 0.014);
        ctx.strokeStyle = this.hsla(30, 0.55);
        ctx.beginPath();
        for (let i = 0; i <= POINTS; i++) {
            const a = (i / POINTS) * TAU;
            const r = this.radiusAt(a, base * 0.93, energy, 0.4, 0);
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    blob(cx, cy, radius, energy, index, phase) {
        const { ctx } = this;
        const gradient = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.1);
        // Las capas se suman ('lighter'): con más opacidad el centro se quema a blanco.
        gradient.addColorStop(0, this.hsla(index * 22 - 20, 0.5));
        gradient.addColorStop(0.65, this.hsla(index * 22, 0.2));
        gradient.addColorStop(1, this.hsla(index * 22 + 20, 0));

        ctx.fillStyle = gradient;
        ctx.beginPath();
        for (let i = 0; i <= POINTS; i++) {
            const a = (i / POINTS) * TAU;
            const r = this.radiusAt(a, radius, energy, 1, phase + index);
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
    }

    /** Radio en un ángulo: un círculo deformado por ondas que se mueven. */
    radiusAt(angle, radius, energy, weight, phase) {
        const t = this.time;
        const wobble =
            Math.sin(angle * 2 + t * 1.3 + phase) * 0.5 +
            Math.sin(angle * 3 - t * 1.7 + phase * 2) * 0.32 +
            Math.sin(angle * 5 + t * 2.4 - phase) * 0.18 * (0.4 + this.level * 2);

        return radius * (1 + wobble * energy * 0.34 * weight);
    }

    hsla(hueOffset, alpha) {
        const { hue, spread, sat, light } = this.current;
        const swing = Math.sin(this.time * 0.35 + hueOffset * 0.05) * spread * 0.5;

        return `hsla(${(hue + hueOffset * 0.6 + swing + 360) % 360}, ${sat}%, ${light}%, ${alpha})`;
    }
}
