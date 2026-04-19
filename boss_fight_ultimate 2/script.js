const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const FLOOR_Y = HEIGHT - 92;

const keys = Object.create(null);
const mouse = { x: 0, y: 0, down: false };

// ===== AUDIO ENGINE (NO FILES, PURE CODE) =====
let audioCtx;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playTone(freq, duration, type = "sine", volume = 0.2) {
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.value = volume;

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();

  gain.gain.exponentialRampToValueAtTime(
    0.001,
    audioCtx.currentTime + duration
  );

  osc.stop(audioCtx.currentTime + duration);
}

// advanced sounds
function shootSound() {
  playTone(750, 0.07, "square", 0.15);
}

function hitSound() {
  playTone(120, 0.25, "sawtooth", 0.25);
}

function bossHitSound() {
  playTone(260, 0.1, "triangle", 0.2);
}

function dashSound() {
  playTone(900, 0.05, "square", 0.18);
  playTone(400, 0.08, "triangle", 0.12);
}

function meteorSound() {
  playTone(80, 0.4, "sawtooth", 0.3);
}

function bossAttackSound() {
  playTone(300, 0.12, "square", 0.2);
}

// ==============================================

let state;
let stars = [];
let lastTime = 0;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => Math.random() * (max - min) + min;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

// ====== GAME RESET ======
function resetGame() {
  state = {
    mode: "intro",
    timer: 0,
    introTimer: 150,
    flash: 0,
    cameraShake: 0,
    message: "VOID CROWN",
    player: {
      x: 140,
      y: FLOOR_Y - 58,
      w: 34,
      h: 58,
      vx: 0,
      vy: 0,
      speed: 0.8,
      maxSpeed: 5.8,
      jumpPower: 12.8,
      onGround: false,
      facing: 1,
      hp: 100,
      maxHp: 100,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTime: 0,
      dashDir: 1,
      invuln: 0,
      hitFlash: 0,
      recoil: 0,
      chargeGlow: 0
    },
    boss: {
      x: 850,
      y: 215,
      baseX: 850,
      baseY: 215,
      r: 40,
      hp: 900,
      maxHp: 900,
      phase: 1,
      prevPhase: 1,
      time: 0,
      hurtFlash: 0,
      attackCooldown: 70,
      patternIndex: 0,
      telegraph: null,
      orbitAngle: 0,
      phaseTransition: 0
    },
    playerBullets: [],
    enemyBullets: [],
    meteors: [],
    lasers: [],
    effects: [],
    rings: [],
    particles: [],
    score: 0
  };

  stars = Array.from({ length: 100 }, () => ({
    x: rand(0, WIDTH),
    y: rand(0, HEIGHT),
    size: rand(1, 3),
    speed: rand(0.05, 0.3)
  }));
}

// ====== SHOOT ======
function shootPlayerBullet() {
  const p = state.player;

  const angle = Math.atan2(mouse.y - p.y, mouse.x - p.x);
  const speed = 11;

  state.playerBullets.push({
    x: p.x + p.w / 2,
    y: p.y + p.h / 2,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 6,
    life: 80
  });

  p.fireCooldown = 8;

  shootSound();
}

// ====== DAMAGE ======
function damagePlayer(amount) {
  const p = state.player;
  if (p.invuln > 0) return;

  p.hp -= amount;
  p.invuln = 30;

  hitSound();

  if (p.hp <= 0) {
    state.mode = "lose";
  }
}

function damageBoss(amount) {
  const b = state.boss;
  b.hp -= amount;

  bossHitSound();

  if (b.hp <= 0) {
    state.mode = "win";
  }
}

// ====== DASH ======
function dash() {
  const p = state.player;

  if (p.dashCooldown > 0) return;

  p.dashTime = 10;
  p.dashCooldown = 40;
  p.invuln = 12;

  dashSound();
}

// ====== METEOR ======
function spawnMeteor(x) {
  state.meteors.push({
    x,
    y: -50,
    vy: 0,
    r: 20
  });
}

// ====== UPDATE ======
function updateGame() {
  state.timer++;

  if (state.mode !== "playing") return;

  const p = state.player;

  // movement
  if (keys["a"]) p.vx -= 0.5;
  if (keys["d"]) p.vx += 0.5;

  p.vx *= 0.9;
  p.vy += 0.6;

  p.x += p.vx;
  p.y += p.vy;

  if (p.y + p.h > FLOOR_Y) {
    p.y = FLOOR_Y - p.h;
    p.vy = 0;
    p.onGround = true;
  }

  // jump
  if ((keys["w"] || keys[" "]) && p.onGround) {
    p.vy = -12;
    p.onGround = false;
  }

  // dash
  if (keys["k"]) dash();

  // shoot
  if (mouse.down && p.fireCooldown <= 0) {
    shootPlayerBullet();
  }

  p.fireCooldown--;

  // bullets
  for (const b of state.playerBullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    if (dist(b.x, b.y, state.boss.x, state.boss.y) < 50) {
      damageBoss(10);
      b.life = 0;
    }
  }

  state.playerBullets = state.playerBullets.filter(b => b.life > 0);

  // meteors
  for (const m of state.meteors) {
    m.vy += 0.5;
    m.y += m.vy;

    if (m.y > FLOOR_Y - m.r) {
      meteorSound();

      if (Math.abs(m.x - p.x) < 50) {
        damagePlayer(20);
      }

      m.dead = true;
    }
  }

  state.meteors = state.meteors.filter(m => !m.dead);

  // boss attacks
  if (state.timer % 120 === 0) {
    spawnMeteor(rand(100, WIDTH - 100));
    bossAttackSound();
  }
}

// ====== DRAW ======
function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // player
  const p = state.player;
  ctx.fillStyle = "#3fe4ff";
  ctx.fillRect(p.x, p.y, p.w, p.h);

  // boss
  const b = state.boss;
  ctx.fillStyle = "#ff4da6";
  ctx.beginPath();
  ctx.arc(b.x, b.y, 40, 0, Math.PI * 2);
  ctx.fill();

  // bullets
  ctx.fillStyle = "#fff";
  for (const bl of state.playerBullets) {
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // meteors
  ctx.fillStyle = "#ff8844";
  for (const m of state.meteors) {
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ====== LOOP ======
function frame() {
  updateGame();
  draw();
  requestAnimationFrame(frame);
}

// ====== INPUT ======
document.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;

  // unlock audio on first input
  initAudio();
});

document.addEventListener("keyup", e => {
  keys[e.key.toLowerCase()] = false;
});

canvas.addEventListener("mousedown", e => {
  mouse.down = true;
  initAudio();
});

window.addEventListener("mouseup", () => {
  mouse.down = false;
});

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});

// ===== START =====
resetGame();
state.mode = "playing";
frame();
