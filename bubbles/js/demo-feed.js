// Demo feed: an animated canvas that stands in for the camera (?demo=1), so anyone can try the mirror.
// A dim room lit by a tall window, with a silhouette that breathes and sways in front of it. The
// window's hard lines show off how each shard shifts the reflection. It has the same shape as the
// camera source: { element, width, height, takeFrame(), stop() }.

const WIDTH = 1280;
const HEIGHT = 720;

export function createDemoFeed() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  // Gradients are made once around the origin and moved with translate(), so drawing allocates nothing.
  const wall = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  wall.addColorStop(0, '#2a2d33');
  wall.addColorStop(1, '#141519');
  const daylight = ctx.createLinearGradient(0, -260, 0, 260);
  daylight.addColorStop(0, '#dfe6ee');
  daylight.addColorStop(1, '#9aa6b4');
  const spill = ctx.createRadialGradient(0, 0, 0, 0, 0, 520);
  spill.addColorStop(0, 'rgba(210, 222, 236, 0.32)');
  spill.addColorStop(1, 'rgba(210, 222, 236, 0)');
  const lamp = ctx.createRadialGradient(0, 0, 0, 0, 0, 300);
  lamp.addColorStop(0, 'rgba(255, 196, 140, 0.35)');
  lamp.addColorStop(1, 'rgba(255, 196, 140, 0)');
  const start = performance.now();

  function draw(t) {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // A tall window with mullions, and the light it throws on the wall.
    ctx.save();
    ctx.translate(WIDTH / 2, 300);
    ctx.fillStyle = spill;
    ctx.fillRect(-520, -520, 1040, 1040);
    ctx.fillStyle = daylight;
    ctx.fillRect(-150, -260, 300, 520);
    ctx.fillStyle = '#1b1c20';
    ctx.fillRect(-6, -260, 12, 520);
    ctx.fillRect(-150, -40, 300, 10);
    ctx.fillRect(-160, -270, 320, 12);
    ctx.fillRect(-160, 258, 320, 14);
    ctx.restore();

    // A warm lamp off to one side, breathing very slightly.
    ctx.save();
    ctx.translate(250, 220);
    ctx.globalAlpha = 0.85 + Math.sin(t * 0.7) * 0.08;
    ctx.fillStyle = lamp;
    ctx.fillRect(-300, -300, 600, 600);
    ctx.restore();

    // Skirting board and door frame lines.
    ctx.fillStyle = '#0e0f12';
    ctx.fillRect(0, 610, WIDTH, 6);
    ctx.fillRect(960, 120, 5, 490);

    // The silhouette: head and shoulders, swaying gently, with a faint cool rim light.
    const x = WIDTH / 2 + Math.sin(t * 0.45) * 90 + Math.sin(t * 1.3) * 8;
    const y = 400 + Math.sin(t * 0.9) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 0.6) * 0.05);
    ctx.fillStyle = '#0b0b0d';
    ctx.strokeStyle = 'rgba(190, 205, 222, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-250, 330);
    ctx.bezierCurveTo(-240, 180, -150, 150, -60, 135);
    ctx.lineTo(-48, 70);
    ctx.bezierCurveTo(-95, 40, -100, -60, -92, -95);
    ctx.bezierCurveTo(-80, -170, 80, -170, 92, -95);
    ctx.bezierCurveTo(100, -60, 95, 40, 48, 70);
    ctx.lineTo(60, 135);
    ctx.bezierCurveTo(150, 150, 240, 180, 250, 330);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  return {
    element: canvas,
    width: WIDTH,
    height: HEIGHT,
    takeFrame() {
      draw((performance.now() - start) / 1000);
      return true;
    },
    stop() {},
  };
}
