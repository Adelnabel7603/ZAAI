(function () {
  class ZAAI3DProductViewer {
    constructor(canvas, stage) {
      this.canvas = canvas;
      this.stage = stage;
      this.context = canvas.getContext("2d");
      this.ready = false;
      this.readyPromise = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      this.currentColor = null;
      this.image = null;
      this.frameIndex = 0;
      this.dragging = false;
      this.lastPointerX = 0;
      this.lastInteraction = performance.now();
      this.animationFrame = 0;
      this.reducedMotion = window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
      this.attachControls();
    }

    loadImage(source) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load product view: ${source}`));
        image.src = source;
      });
    }

    async initialize(geometryColor, initialColor) {
      try {
        await this.applyColor(initialColor || geometryColor);
        this.ready = true;
        this.resolveReady(this);
        this.renderLoop();
      } catch (error) {
        this.rejectReady(error);
        throw error;
      }
      return this;
    }

    setColor(color) {
      if (!this.ready) {
        return this.readyPromise.then(() => this.applyColor(color));
      }
      return this.applyColor(color);
    }

    async applyColor(color) {
      this.stage.classList.add("is-changing");
      const image = await this.loadImage(color.sprite);
      this.currentColor = color;
      this.image = image;
      this.frameIndex = 0;
      this.resize();
      this.draw();
      this.stage.classList.remove("is-changing");
      return this;
    }

    attachControls() {
      this.canvas.addEventListener("pointerdown", (event) => {
        this.dragging = true;
        this.lastPointerX = event.clientX;
        this.lastInteraction = performance.now();
        this.stage.classList.add("is-dragging");
        this.canvas.setPointerCapture(event.pointerId);
      });

      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.dragging || !this.currentColor) return;
        const viewCount = this.currentColor.viewCount || 1;
        const threshold = Math.max(18, this.canvas.clientWidth / viewCount);
        const delta = event.clientX - this.lastPointerX;
        if (Math.abs(delta) >= threshold) {
          const step = delta < 0 ? 1 : -1;
          this.frameIndex = (this.frameIndex + step + viewCount) % viewCount;
          this.lastPointerX = event.clientX;
          this.lastInteraction = performance.now();
          this.draw();
        }
      });

      const release = (event) => {
        this.dragging = false;
        this.stage.classList.remove("is-dragging");
        if (event && this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        this.lastInteraction = performance.now();
      };

      this.canvas.addEventListener("pointerup", release);
      this.canvas.addEventListener("pointercancel", release);

      this.canvas.addEventListener("keydown", (event) => {
        if (!this.currentColor) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const viewCount = this.currentColor.viewCount || 1;
        const step = event.key === "ArrowLeft" ? 1 : -1;
        this.frameIndex = (this.frameIndex + step + viewCount) % viewCount;
        this.lastInteraction = performance.now();
        this.draw();
      });

      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => {
          this.resize();
          this.draw();
        });
        this.resizeObserver.observe(this.canvas);
      } else {
        window.addEventListener("resize", () => {
          this.resize();
          this.draw();
        });
      }
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
    }

    draw() {
      if (!this.ready && !this.image) return;
      if (!this.image || !this.currentColor) return;

      const context = this.context;
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);

      const columns = this.currentColor.columns || 1;
      const rows = this.currentColor.rows || Math.ceil((this.currentColor.viewCount || 1) / columns);
      const frameHeight = this.currentColor.frameHeight || 1;
      const cellWidth = this.image.naturalWidth / columns;
      const cellHeight = this.image.naturalHeight / rows;
      const sourceHeight = cellHeight * frameHeight;
      const sourceX = (this.frameIndex % columns) * cellWidth;
      const sourceY = Math.floor(this.frameIndex / columns) * cellHeight;

      const padding = Math.max(8, this.canvas.height * 0.02);
      const scale = Math.min(
        (this.canvas.width - padding * 2) / cellWidth,
        (this.canvas.height - padding * 2) / sourceHeight
      );
      const drawWidth = cellWidth * scale;
      const drawHeight = sourceHeight * scale;
      const drawX = (this.canvas.width - drawWidth) / 2;
      const drawY = (this.canvas.height - drawHeight) / 2;

      context.drawImage(
        this.image,
        sourceX,
        sourceY,
        cellWidth,
        sourceHeight,
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );
    }

    renderLoop() {
      this.animationFrame = window.requestAnimationFrame(() => this.renderLoop());
      if (!this.ready || !this.currentColor || this.dragging || this.reducedMotion) return;

      const now = performance.now();
      if (now - this.lastInteraction > 3200) {
        const viewCount = this.currentColor.viewCount || 1;
        if (now - this.lastInteraction > 5000) {
          this.frameIndex = (this.frameIndex + 1) % viewCount;
          this.lastInteraction = now - 3200;
          this.draw();
        }
      }
    }
  }

  window.ZAAI3DProductViewer = ZAAI3DProductViewer;
})();
