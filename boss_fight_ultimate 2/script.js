const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
// === SOUND ENGINE (NO FILES, PURE SYNTH) ===
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioCtx();

function playTone(freq, duration = 0.1, type = "sine", volume = 0.2) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

// noise burst (for explosions)
function playNoise(duration = 0.2, volume = 0.3) {
  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  source.buffer = buffer;
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  source.connect(gain);
  gain.connect(audioCtx.destination);

  source.start();
}

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const FLOOR_Y = HEIGHT - 92;
const keys = Object.create(null);
const mouse = { x: 0, y: 0, down: false };

let state;
let stars = [];
let lastTime = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => Math.random() * (max - min) + min;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

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
      introDrop: 180,
      attackCooldown: 70,
      attackLock: 0,
      patternIndex: 0,
      subTimer: 0,
      telegraph: null,
      orbitAngle: 0,
      dashTarget: null,
      phaseTransition: 0,
      aura: 0,
      wingFlare: 0
    },
    playerBullets: [],
    enemyBullets: [],
    rings: [],
    effects: [],
    meteors: [],
    lasers: [],
    particles: [],
    score: 0
  };

  stars = Array.from({ length: 120 }, () => ({
    x: rand(0, WIDTH),
    y: rand(0, HEIGHT),
    size: rand(1, 3),
    speed: rand(0.05, 0.35)
  }));
}

function spawnBurst(x, y, color, amount, speedMin = 1, speedMax = 4) {
  for (let i = 0; i < amount; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(speedMin, speedMax);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rand(20, 36),
      maxLife: 36,
      size: rand(2, 5),
      color
    });
  }
}

function playerCenter() {
  const p = state.player;
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

function bossCenter() {
  const b = state.boss;
  return { x: b.x, y: b.y };
}

function shootPlayerBullet(targetX = mouse.x, targetY = mouse.y) {
  const p = state.player;
  const speed = 11.5;
  const startX = p.x + p.w / 2;
  const startY = p.y + p.h / 2 - 6;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const len = Math.hypot(dx, dy) || 1;
  const vx = (dx / len) * speed;
  const vy = (dy / len) * speed;

  if (Math.abs(dx) > 1) p.facing = dx >= 0 ? 1 : -1;

  const originX = startX + (dx / len) * 18;
  const originY = startY + (dy / len) * 18;

  state.playerBullets.push({
    x: originX,
    y: originY,
    vx,
    vy,
    r: 6,
    life: 80
  });

  p.fireCooldown = 8;
  p.chargeGlow = 6;
  spawnBurst(originX, originY, "#a7fff3", 7, 0.6, 2.2);
}

function damagePlayer(amount, sourceX) {
  const p = state.player;
  if (p.invuln > 0 || state.mode !== "playing") return;

  p.hp = Math.max(0, p.hp - amount);
  p.invuln = 36;
  p.hitFlash = 12;
  p.recoil = 12;
  p.vx = sourceX < p.x ? 4.8 : -4.8;
  p.vy = -5.8;
  state.flash = 8;
  state.cameraShake = Math.max(state.cameraShake, 10);
  spawnBurst(p.x + p.w / 2, p.y + p.h / 2, "#ff9ca9", 16, 1, 4.5);

  if (p.hp <= 0) {
    state.mode = "lose";
    state.message = "YOU WERE ERASED";
  }
}

function damageBoss(amount) {
  const b = state.boss;
  if (b.phaseTransition > 0 || state.mode !== "playing") return;

  b.hp = Math.max(0, b.hp - amount);
  b.hurtFlash = 8;
  state.score += amount;
  state.cameraShake = Math.max(state.cameraShake, 5);
  spawnBurst(b.x, b.y, b.phase === 3 ? "#ff5db6" : "#7ff2ff", 10, 0.7, 3.5);

  if (b.hp <= 0) {
    state.mode = "win";
    state.message = "VOID CROWN DEFEATED";
    state.flash = 18;
    state.cameraShake = 15;
    spawnBurst(b.x, b.y, "#ffffff", 90, 1, 6);
  }
}

function setTelegraph(kind, duration, data = {}) {
  state.boss.telegraph = { kind, duration, time: duration, ...data };
  state.boss.attackLock = duration;
}

function addEnemyBullet(x, y, vx, vy, r, color, damage, life = 180, trail = false) {
  state.enemyBullets.push({ x, y, vx, vy, r, color, damage, life, trail });
}

function radialBurst(count, speed, damage, color) {
  const b = state.boss;
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + b.orbitAngle;
    addEnemyBullet(b.x, b.y, Math.cos(a) * speed, Math.sin(a) * speed, 8, color, damage, 180, true);
  }
}

function aimedShot(speed, damage, spread = 0) {
  const p = playerCenter();
  const b = bossCenter();
  const angle = Math.atan2(p.y - b.y, p.x - b.x) + spread;
  addEnemyBullet(b.x, b.y, Math.cos(angle) * speed, Math.sin(angle) * speed, 7, "#ffca70", damage, 200, true);
}

function spawnMeteorLine(count) {
  for (let i = 0; i < count; i++) {
    const x = rand(200, WIDTH - 80);
    const delay = i * 14;
    state.meteors.push({
      x,
      y: -80 - i * 80,
      vy: 0,
      r: rand(18, 28),
      activeIn: delay,
      warning: 38,
      landed: false,
      damage: 16
    });
  }
}

function spawnLaserSweep() {
  const p = playerCenter();
  const targetY = clamp(p.y, 80, FLOOR_Y - 40);
  setTelegraph("laser", 44, { y: targetY });
}

function spawnDashStrike() {
  const p = playerCenter();
  const b = state.boss;
  setTelegraph("dash", 26, { startX: b.x, startY: b.y, targetY: clamp(p.y, 100, FLOOR_Y - 55) });
}

function phaseCheck() {
  const b = state.boss;
  const ratio = b.hp / b.maxHp;
  let nextPhase = 1;
  if (ratio <= 0.66) nextPhase = 2;
  if (ratio <= 0.33) nextPhase = 3;

  if (nextPhase !== b.phase) {
    b.phase = nextPhase;
    b.phaseTransition = 85;
    b.attackCooldown = 80;
    b.attackLock = 0;
    b.telegraph = null;
    state.flash = 16;
    state.cameraShake = 14;
    state.rings.push({ x: b.x, y: b.y, r: 20, maxR: 210, life: 42, color: nextPhase === 2 ? "#77d9ff" : "#ff59c7" });
  }
}

function chooseBossAttack() {
  const b = state.boss;
  b.patternIndex = (b.patternIndex + 1) % 6;

  if (b.phase === 1) {
    if (b.patternIndex % 2 === 0) {
      setTelegraph("fan", 24, { shots: 5, speed: 4.2, spread: 0.38 });
    } else {
      spawnLaserSweep();
    }
    b.attackCooldown = 72;
    return;
  }

  if (b.phase === 2) {
    const roll = b.patternIndex % 3;
    if (roll === 0) {
      setTelegraph("burst", 22, { count: 14, speed: 3.8 });
    } else if (roll === 1) {
      spawnMeteorLine(6);
      b.attackLock = 30;
    } else {
      spawnLaserSweep();
    }
    b.attackCooldown = 64;
    return;
  }

  const roll = b.patternIndex % 4;
  if (roll === 0) {
    spawnDashStrike();
  } else if (roll === 1) {
    setTelegraph("spiral", 20, { turns: 28 });
  } else if (roll === 2) {
    spawnMeteorLine(8);
    b.attackLock = 28;
  } else {
    setTelegraph("cross", 18, { count: 4, speed: 5.8 });
  }
  b.attackCooldown = 54;
}

function resolveTelegraph() {
  const b = state.boss;
  const t = b.telegraph;
  if (!t) return;

  t.time--;

  if (t.kind === "dash" && t.time <= 0) {
    b.dashTarget = { x: 150, y: t.targetY, time: 22, returnX: b.baseX };
    b.telegraph = null;
    return;
  }

  if (t.time > 0) return;

  if (t.kind === "fan") {
    const p = playerCenter();
    const base = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < t.shots; i++) {
      const offset = ((i / (t.shots - 1)) - 0.5) * t.spread * 2;
      addEnemyBullet(b.x, b.y, Math.cos(base + offset) * t.speed, Math.sin(base + offset) * t.speed, 7, "#ffd57f", 10, 170, true);
    }
  } else if (t.kind === "burst") {
    radialBurst(t.count, t.speed, 12, "#77f7ff");
  } else if (t.kind === "laser") {
    state.lasers.push({ y: t.y, life: 28, damage: 18, activeAt: 12 });
  } else if (t.kind === "spiral") {
    for (let i = 0; i < t.turns; i++) {
      const a = b.orbitAngle + i * 0.45;
      addEnemyBullet(b.x, b.y, Math.cos(a) * 4.4, Math.sin(a) * 4.4, 6, "#ff66c7", 11, 160, true);
    }
  } else if (t.kind === "cross") {
    const speed = t.speed;
    addEnemyBullet(b.x, b.y, speed, 0, 8, "#ff68d8", 14, 170, true);
    addEnemyBullet(b.x, b.y, -speed, 0, 8, "#ff68d8", 14, 170, true);
    addEnemyBullet(b.x, b.y, 0, speed, 8, "#ff68d8", 14, 170, true);
    addEnemyBullet(b.x, b.y, 0, -speed, 8, "#ff68d8", 14, 170, true);
  }

  state.cameraShake = Math.max(state.cameraShake, 7);
  b.telegraph = null;
}

function updateBoss() {
  const b = state.boss;
  b.time++;
  b.orbitAngle += 0.015 + b.phase * 0.003;
  b.aura = Math.sin(b.time * 0.07) * 8;
  b.wingFlare = Math.sin(b.time * 0.15) * 0.5 + 0.5;
  b.hurtFlash = Math.max(0, b.hurtFlash - 1);

  if (b.phaseTransition > 0) {
    b.phaseTransition--;
    b.y = b.baseY + Math.sin(b.time * 0.3) * 18;
    if (b.phaseTransition % 8 === 0) {
      state.rings.push({ x: b.x, y: b.y, r: 18, maxR: 150, life: 28, color: b.phase === 2 ? "#77e2ff" : "#ff4ec4" });
    }
    return;
  }

  if (b.dashTarget) {
    const d = b.dashTarget;
    d.time--;
    if (d.time > 12) {
      b.x += (110 - b.x) * 0.35;
      b.y += (d.y - b.y) * 0.35;
    } else {
      b.x += (d.returnX - b.x) * 0.18;
      b.y += (b.baseY - b.y) * 0.18;
    }

    if (Math.abs(b.x - 140) < 60 && Math.abs((state.player.y + state.player.h / 2) - b.y) < 52) {
      damagePlayer(18, b.x);
    }

    if (d.time <= 0) {
      b.dashTarget = null;
    }
    return;
  }

  const hoverScale = b.phase === 1 ? 22 : b.phase === 2 ? 30 : 42;
  b.baseY = b.phase === 3 ? 190 : 215;
  b.y = b.baseY + Math.sin(b.time * 0.045 * (1 + b.phase * 0.15)) * hoverScale;
  b.x = b.baseX + Math.cos(b.time * 0.02) * (16 + b.phase * 4);

  if (b.attackLock > 0) {
    b.attackLock--;
  }

  if (b.telegraph) {
    resolveTelegraph();
    return;
  }

  b.attackCooldown--;
  if (b.attackCooldown <= 0) {
    chooseBossAttack();
  }

  if (b.phase === 1 && b.attackCooldown % 36 === 0) {
    aimedShot(4.6, 9);
  }

  if (b.phase === 2 && b.attackCooldown % 28 === 0) {
    aimedShot(5.2, 10, rand(-0.16, 0.16));
  }

  if (b.phase === 3 && b.attackCooldown % 18 === 0) {
    const spread = rand(-0.24, 0.24);
    aimedShot(6, 11, spread);
    if (Math.random() < 0.45) aimedShot(6, 11, -spread);
  }
}

function updatePlayer() {
  const p = state.player;
  p.hitFlash = Math.max(0, p.hitFlash - 1);
  p.invuln = Math.max(0, p.invuln - 1);
  p.fireCooldown = Math.max(0, p.fireCooldown - 1);
  p.dashCooldown = Math.max(0, p.dashCooldown - 1);
  p.chargeGlow = Math.max(0, p.chargeGlow - 1);

  const left = keys["a"] || keys["ArrowLeft"];
  const right = keys["d"] || keys["ArrowRight"];

  if (p.dashTime > 0) {
    p.dashTime--;
    p.vx = p.dashDir * 12;
    if (p.dashTime === 0) {
      p.invuln = Math.max(p.invuln, 10);
    }
  } else {
    if (left) {
      p.vx -= p.speed;
      p.facing = -1;
    }
    if (right) {
      p.vx += p.speed;
      p.facing = 1;
    }
    if (!left && !right) {
      p.vx *= 0.82;
    }
  }

  p.vx = clamp(p.vx, -p.maxSpeed, p.maxSpeed);
  p.vy += 0.62;
  p.x += p.vx;
  p.y += p.vy;

  if (p.y + p.h >= FLOOR_Y) {
    p.y = FLOOR_Y - p.h;
    p.vy = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  p.x = clamp(p.x, 18, WIDTH - p.w - 18);
}

function updateProjectiles() {
  const p = state.player;
  const b = state.boss;

  for (const bullet of state.playerBullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    bullet.life--;

    if (dist(bullet.x, bullet.y, b.x, b.y) < b.r + bullet.r + 6 && state.mode === "playing") {
      damageBoss(12);
      bullet.life = 0;
    }
  }

  state.playerBullets = state.playerBullets.filter(b => b.life > 0 && b.x > -40 && b.x < WIDTH + 40);

  for (const bullet of state.enemyBullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    bullet.life--;

    if (bullet.trail && state.timer % 3 === 0) {
      state.effects.push({ x: bullet.x, y: bullet.y, r: bullet.r * 1.2, life: 12, color: bullet.color, alpha: 0.22 });
    }

    if (dist(bullet.x, bullet.y, p.x + p.w / 2, p.y + p.h / 2) < bullet.r + 22) {
      damagePlayer(bullet.damage, bullet.x);
      bullet.life = 0;
    }
  }

  state.enemyBullets = state.enemyBullets.filter(b => b.life > 0 && b.x > -120 && b.x < WIDTH + 120 && b.y > -120 && b.y < HEIGHT + 120);
}

function updateMeteors() {
  const p = state.player;
  for (const m of state.meteors) {
    if (m.activeIn > 0) {
      m.activeIn--;
      continue;
    }

    if (m.warning > 0) {
      m.warning--;
      continue;
    }

    m.vy += 0.55;
    m.y += m.vy;

    if (!m.landed && m.y + m.r >= FLOOR_Y) {
      m.y = FLOOR_Y - m.r;
      m.landed = true;
      spawnBurst(m.x, FLOOR_Y - 6, "#ffb48b", 24, 1, 5);
      state.rings.push({ x: m.x, y: FLOOR_Y, r: 15, maxR: 90, life: 24, color: "#ffb48b" });
      if (Math.abs((p.x + p.w / 2) - m.x) < 70 && p.onGround) {
        damagePlayer(m.damage, m.x);
      }
      m.life = 10;
    }

    if (m.landed) {
      m.life--;
    }
  }

  state.meteors = state.meteors.filter(m => !m.landed || m.life > 0);
}

function updateLasers() {
  const p = state.player;

  for (const laser of state.lasers) {
    laser.life--;
    if (laser.life <= laser.activeAt) {
      if (p.y < laser.y + 16 && p.y + p.h > laser.y - 16) {
        damagePlayer(laser.damage, WIDTH);
      }
    }
  }

  state.lasers = state.lasers.filter(l => l.life > 0);
}

function updateEffects() {
  for (const ring of state.rings) {
    ring.life--;
    ring.r += (ring.maxR - ring.r) * 0.16;
  }
  state.rings = state.rings.filter(r => r.life > 0);

  for (const e of state.effects) {
    e.life--;
    e.r += 0.6;
    e.alpha *= 0.9;
  }
  state.effects = state.effects.filter(e => e.life > 0);

  for (const p of state.particles) {
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.97;
    p.vy = p.vy * 0.97 + 0.03;
  }
  state.particles = state.particles.filter(p => p.life > 0);
}

function updateGame() {
  state.timer++;

  if (state.flash > 0) state.flash--;
  if (state.cameraShake > 0) state.cameraShake *= 0.86;

  if (state.mode === "intro") {
    state.introTimer--;
    state.boss.time++;
    state.boss.y = state.boss.baseY + Math.sin(state.boss.time * 0.05) * 18;
    if (state.introTimer <= 0) state.mode = "playing";
    return;
  }

  if (state.mode !== "playing") return;

  if ((keys["w"] || keys["ArrowUp"] || keys[" "]) && state.player.onGround) {
    state.player.vy = -state.player.jumpPower;
    state.player.onGround = false;
    spawnBurst(state.player.x + state.player.w / 2, FLOOR_Y - 4, "#86d6ff", 8, 0.5, 1.8);
  }

  if (mouse.down && state.player.fireCooldown === 0) {
    shootPlayerBullet();
  }

  if ((keys["Shift"] || keys["ShiftLeft"] || keys["ShiftRight"]) && state.player.dashCooldown === 0 && state.player.dashTime === 0) {
    state.player.dashTime = 10;
    state.player.dashCooldown = 40;
    if (keys["a"] || keys["ArrowLeft"]) {
      state.player.dashDir = -1;
    } else if (keys["d"] || keys["ArrowRight"]) {
      state.player.dashDir = 1;
    } else {
      state.player.dashDir = mouse.x < state.player.x + state.player.w / 2 ? -1 : 1;
    }
    state.player.invuln = 14;
    state.cameraShake = Math.max(state.cameraShake, 5);
    spawnBurst(state.player.x + state.player.w / 2, state.player.y + state.player.h / 2, "#c2ffff", 14, 1, 3.2);
  }

  updatePlayer();
  updateBoss();
  updateProjectiles();
  updateMeteors();
  updateLasers();
  updateEffects();
  phaseCheck();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, "#0b1324");
  gradient.addColorStop(0.55, "#09101d");
  gradient.addColorStop(1, "#05070d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const star of stars) {
    star.y += star.speed;
    if (star.y > HEIGHT) {
      star.y = -4;
      star.x = rand(0, WIDTH);
    }
    ctx.globalAlpha = 0.5 + Math.sin((star.x + state.timer) * 0.01) * 0.25;
    ctx.fillStyle = "#d7e7ff";
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(125, 198, 255, 0.08)";
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(170 + i * 270, FLOOR_Y + 10, 95, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#0b1120";
  ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);

  ctx.strokeStyle = "rgba(124, 207, 255, 0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y + 0.5);
  ctx.lineTo(WIDTH, FLOOR_Y + 0.5);
  ctx.stroke();
}

function drawPlayer() {
  const p = state.player;
  const pulse = p.chargeGlow > 0 ? p.chargeGlow * 0.5 : 0;

  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  if (p.dashTime > 0) ctx.scale(1.2, 0.84);

  ctx.fillStyle = p.hitFlash > 0 ? "#ffffff" : p.invuln > 0 ? "#97ffff" : "#3fe4ff";
  ctx.shadowColor = "rgba(79, 245, 255, 0.45)";
  ctx.shadowBlur = 12 + pulse;
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0d182d";
  ctx.fillRect(-5 + p.facing * 3, -12, 10, 10);

  ctx.fillStyle = "#cffffe";
  ctx.fillRect(p.facing * 10 - 3, -8, 12, 4);
  ctx.restore();
}

function drawBoss() {
  const b = state.boss;
  const pulse = Math.sin(b.time * 0.12) * 7 + b.aura;
  const phaseColors = ["#ffb84d", "#63e4ff", "#ff49bc"];
  const main = b.hurtFlash > 0 ? "#ffffff" : phaseColors[b.phase - 1];

  ctx.save();
  ctx.translate(b.x, b.y);

  const halo = ctx.createRadialGradient(0, 0, 16, 0, 0, b.r + 40 + pulse);
  halo.addColorStop(0, "rgba(255,255,255,0.24)");
  halo.addColorStop(0.45, b.phase === 1 ? "rgba(255,184,77,0.16)" : b.phase === 2 ? "rgba(99,228,255,0.16)" : "rgba(255,73,188,0.18)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, b.r + 40 + pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,255,255,${0.18 + b.wingFlare * 0.18})`;
  ctx.lineWidth = 4;
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * 22, -10);
    ctx.quadraticCurveTo(i * (70 + b.wingFlare * 20), -40, i * (95 + b.wingFlare * 25), 0);
    ctx.quadraticCurveTo(i * (72 + b.wingFlare * 16), 36, i * 16, 18);
    ctx.stroke();
  }

  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.arc(0, 0, b.r + pulse * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0a1020";
  ctx.beginPath();
  ctx.arc(0, 0, b.r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-10, -6, 4, 0, Math.PI * 2);
  ctx.arc(10, -6, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 8, 12, 0.15, Math.PI - 0.15);
  ctx.stroke();

  if (b.telegraph) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, b.r + 20 + Math.sin(state.timer * 0.35) * 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawProjectiles() {
  for (const e of state.effects) {
    ctx.globalAlpha = e.alpha;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const ring of state.rings) {
    ctx.globalAlpha = ring.life / 42;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const bullet of state.playerBullets) {
    const g = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, bullet.r + 10);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, "#7efaf0");
    g.addColorStop(1, "rgba(126,250,240,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.r + 6, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const bullet of state.enemyBullets) {
    const g = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, bullet.r + 10);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, bullet.color);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.r + 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const laser of state.lasers) {
    const active = laser.life <= laser.activeAt;
    ctx.fillStyle = active ? "rgba(255, 90, 170, 0.32)" : "rgba(255,255,255,0.14)";
    ctx.fillRect(0, laser.y - 14, WIDTH, 28);
    ctx.strokeStyle = active ? "rgba(255, 255, 255, 0.9)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = active ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(0, laser.y);
    ctx.lineTo(WIDTH, laser.y);
    ctx.stroke();
  }

  for (const m of state.meteors) {
    if (m.activeIn > 0) continue;

    if (m.warning > 0) {
      ctx.strokeStyle = `rgba(255,190,140,${0.2 + 0.5 * Math.sin(m.warning * 0.4) ** 2})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(m.x, 0);
      ctx.lineTo(m.x, FLOOR_Y);
      ctx.stroke();
      continue;
    }

    const g = ctx.createRadialGradient(m.x - 6, m.y - 8, 4, m.x, m.y, m.r + 8);
    g.addColorStop(0, "#fff2cc");
    g.addColorStop(0.5, "#ff965e");
    g.addColorStop(1, "rgba(255,150,94,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of state.particles) {
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  const p = state.player;
  const b = state.boss;

  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.fillRect(26, 22, 260, 22);
  ctx.fillRect(WIDTH - 386, 22, 360, 22);

  ctx.fillStyle = "#53f4ff";
  ctx.fillRect(26, 22, 260 * (p.hp / p.maxHp), 22);

  ctx.fillStyle = b.phase === 1 ? "#ffb84d" : b.phase === 2 ? "#63e4ff" : "#ff49bc";
  ctx.fillRect(WIDTH - 386, 22, 360 * (b.hp / b.maxHp), 22);

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 22, 260, 22);
  ctx.strokeRect(WIDTH - 386, 22, 360, 22);

  ctx.fillStyle = "#eef7ff";
  ctx.font = "bold 15px Arial";
  ctx.fillText("PLAYER", 28, 18);
  ctx.fillText("VOID CROWN", WIDTH - 384, 18);

  ctx.font = "14px Arial";
  ctx.fillText(`Phase ${b.phase}`, WIDTH / 2 - 26, 28);
  ctx.fillText(`Score ${state.score}`, WIDTH / 2 - 28, 48);

  if (state.mode === "intro") {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 46px Arial";
    ctx.fillText("VOID CROWN", WIDTH / 2, HEIGHT / 2 - 30);
    ctx.font = "18px Arial";
    ctx.fillText("Survive three phases. Shoot, jump, dash.", WIDTH / 2, HEIGHT / 2 + 10);
    ctx.fillText("A / D move · W or Space jump · Click shoot · Shift dash", WIDTH / 2, HEIGHT / 2 + 38);
    ctx.textAlign = "left";
  }

  if (state.mode === "win" || state.mode === "lose") {
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = state.mode === "win" ? "#8effd2" : "#ff9ba6";
    ctx.font = "bold 48px Arial";
    ctx.fillText(state.message, WIDTH / 2, HEIGHT / 2 - 8);
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px Arial";
    ctx.fillText("Press R to restart", WIDTH / 2, HEIGHT / 2 + 32);
    ctx.textAlign = "left";
  }
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  const shake = state.cameraShake;
  const offsetX = shake ? rand(-shake, shake) : 0;
  const offsetY = shake ? rand(-shake, shake) : 0;
  ctx.save();
  ctx.translate(offsetX, offsetY);

  drawBackground();
  drawProjectiles();
  drawBoss();
  drawPlayer();

  ctx.restore();
  drawHUD();

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${state.flash / 22})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function frame(ts) {
  if (!lastTime) lastTime = ts;
  lastTime = ts;

  updateGame();
  render();
  requestAnimationFrame(frame);
}

document.addEventListener("keydown", (e) => {
  keys[e.key] = true;

  if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
  }

  if ((e.key === "r" || e.key === "R") && state.mode !== "playing") {
    resetGame();
  }
});

document.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

resetGame();
requestAnimationFrame(frame);


canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  mouse.down = true;
  if (state.mode === "playing" && state.player.fireCooldown === 0) {
    shootPlayerBullet();
  }
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.down = false;
});

canvas.addEventListener("mouseleave", () => {
  mouse.down = false;
});
