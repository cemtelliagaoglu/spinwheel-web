const COLORS = [
  '#E63946', '#F4A261', '#E9C46A', '#6A994E', '#D65108',
  '#9B2226', '#F28482', '#F7B801', '#588157', '#BC4749'
];

export function createWheel(canvas, { onTick, onResult }) {
  const ctx = canvas.getContext('2d');
  let items = [];
  let currentAngle = 0;
  let spinning = false;
  let animationId = null;
  let lastSegmentIndex = -1;
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const w = canvas.getBoundingClientRect().width;
    const cx = w / 2;
    const cy = w / 2;
    const r = w / 2 - 4;

    ctx.clearRect(0, 0, w, w);

    if (items.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#243447';
      ctx.fill();
      ctx.fillStyle = '#94A3B8';
      ctx.font = '600 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add places to spin!', cx, cy);
      return;
    }

    const sliceAngle = (Math.PI * 2) / items.length;
    const fontSize = Math.max(10, 18 - items.length * 0.5);

    items.forEach((item, i) => {
      const startAngle = currentAngle + i * sliceAngle;
      const endAngle = startAngle + sliceAngle;

      // Segment
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();

      // Segment border
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Text
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(startAngle + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2.5;
      const textX = r - 14;
      const maxWidth = r - 40;
      const label = truncateText(ctx, item, maxWidth);
      ctx.strokeText(label, textX, 0);
      ctx.fillText(label, textX, 0);
      ctx.restore();
    });

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#0F1B2D';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  function getSegmentAtPointer() {
    if (items.length === 0) return -1;
    const sliceAngle = (Math.PI * 2) / items.length;
    // Pointer is at top (–π/2). Normalize the angle.
    let pointerAngle = (-Math.PI / 2 - currentAngle) % (Math.PI * 2);
    if (pointerAngle < 0) pointerAngle += Math.PI * 2;
    return Math.floor(pointerAngle / sliceAngle) % items.length;
  }

  function spin() {
    if (spinning || items.length < 2) return;
    spinning = true;

    const targetIndex = Math.floor(Math.random() * items.length);
    const sliceAngle = (Math.PI * 2) / items.length;
    // Target: pointer at –π/2 lands on mid-segment of targetIndex
    const targetSegmentMid = targetIndex * sliceAngle + sliceAngle / 2;
    const targetAngle = -Math.PI / 2 - targetSegmentMid;
    const fullRotations = (3 + Math.random() * 2) * Math.PI * 2;
    // Normalize angular difference to [0, 2π) — JS % preserves sign so we fix it
    const diff = ((targetAngle - currentAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const finalTotalSpin = fullRotations + diff;

    const startAngle = currentAngle;
    const duration = reducedMotion ? 50 : 3000 + Math.random() * 2000;
    const startTime = performance.now();
    lastSegmentIndex = -1;

    if (reducedMotion) {
      currentAngle = startAngle + finalTotalSpin;
      currentAngle = ((currentAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      draw();
      spinning = false;
      const actualIndex = getSegmentAtPointer();
      onResult?.(items[actualIndex], actualIndex);
      return;
    }

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Quintic ease-out
      const eased = 1 - Math.pow(1 - t, 5);

      currentAngle = startAngle + finalTotalSpin * eased;
      draw();

      const seg = getSegmentAtPointer();
      if (seg !== lastSegmentIndex && seg >= 0) {
        lastSegmentIndex = seg;
        onTick?.();
      }

      if (t < 1) {
        animationId = requestAnimationFrame(animate);
      } else {
        currentAngle = ((currentAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        spinning = false;
        const actualIndex = getSegmentAtPointer();
        onResult?.(items[actualIndex], actualIndex);
      }
    }

    animationId = requestAnimationFrame(animate);
  }

  function setItems(newItems) {
    items = [...newItems];
    draw();
  }

  function isSpinning() {
    return spinning;
  }

  function destroy() {
    if (animationId) cancelAnimationFrame(animationId);
  }

  // Initial setup
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  return { setItems, spin, isSpinning, destroy };
}
