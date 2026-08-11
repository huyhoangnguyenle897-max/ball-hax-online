const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

// =========================================================
// GAME CONFIG
// =========================================================

const FIELD_WIDTH = 1400;
const FIELD_HEIGHT = 700;

const MAX_PLAYERS = 12;
const MATCH_TIME = 300;

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 10;

const GOAL_HEIGHT = 240;
const GOAL_DEPTH = 70;

// =========================================================
// HAXBALL-LIKE PHYSICS
// =========================================================

const PLAYER_PHYSICS = {
bCoef: 0.5,
damping: 0.96,
acceleration: 0.10,

kickingAcceleration: 0.07,
kickingDamping: 0.96,

kickStrength: 5.0
};

const BALL_PHYSICS = {
bCoef: 0.5,
damping: 0.99,
maxSpeed: 15
};

// Server physics tick.
// 60Hz giúp chuyển động ổn định hơn 30Hz.
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

// =========================================================
// PLAYERS
// =========================================================

const players = new Map();

let nextPlayerId = 1;

// =========================================================
// SCORE / MATCH
// =========================================================

let score = {
blue: 0,
red: 0
};

let round = 1;

let mode = "normal";

let matchEnd =
Date.now() +
MATCH_TIME * 1000;

let resetAt = 0;

// =========================================================
// BALL
// =========================================================

let ball = {
x: FIELD_WIDTH / 2,
y: FIELD_HEIGHT / 2,
vx: 0,
vy: 0
};

// =========================================================
// UTILS
// =========================================================

function clamp(value, min, max) {
return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
const number = Number(value);

return Number.isFinite(number)
? number
: fallback;
}

function distance(a, b) {
return Math.hypot(
a.x - b.x,
a.y - b.y
);
}

// =========================================================
// SPAWN
// =========================================================

function randomSpawn(player) {

if (player.team === "blue") {

player.x =
  180 +
  Math.random() * 80;

} else {

player.x =
  FIELD_WIDTH -
  180 -
  Math.random() * 80;

}

player.y =
FIELD_HEIGHT / 2 +
(Math.random() - 0.5) * 260;

player.vx = 0;
player.vy = 0;
}

// =========================================================
// RESET BALL
// =========================================================

function resetBall() {

ball = {
x: FIELD_WIDTH / 2,
y: FIELD_HEIGHT / 2,
vx: 0,
vy: 0
};

for (const player of players.values()) {
randomSpawn(player);
}
}

// =========================================================
// BALANCE TEAMS
// =========================================================

function balanceTeams() {

const list =
[...players.values()]
.sort(() => Math.random() - 0.5);

let blue = 0;
let red = 0;

for (const player of list) {

if (blue <= red) {

  player.team = "blue";
  blue++;

} else {

  player.team = "red";
  red++;
}

}

for (const player of players.values()) {
randomSpawn(player);
}
}

// =========================================================
// GAME STATE
// =========================================================

function getGameState() {

let timeLeft = 0;

if (mode === "normal") {

timeLeft =
  Math.max(
    0,
    (matchEnd - Date.now()) / 1000
  );

}

return {

type: "state",

W: FIELD_WIDTH,
H: FIELD_HEIGHT,

goalHeight: GOAL_HEIGHT,
goalDepth: GOAL_DEPTH,

score: {
  blue: score.blue,
  red: score.red
},

round,

mode,

timeLeft,

ball: {
  x: ball.x,
  y: ball.y,
  vx: ball.vx,
  vy: ball.vy
},

players:
  [...players.values()]
    .map(player => ({

      id: player.id,

      name: player.name,

      team: player.team,

      x: player.x,

      y: player.y,

      vx: player.vx,

      vy: player.vy
    }))

};
}

// =========================================================
// BROADCAST
// =========================================================

function broadcast() {

const message =
JSON.stringify(
getGameState()
);

for (const player of players.values()) {

if (
  player.ws.readyState ===
  WebSocket.OPEN
) {

  try {

    player.ws.send(message);

  } catch {
    // Bỏ qua lỗi gửi
  }
}

}
}

// =========================================================
// GOAL
// =========================================================

function goal(team) {

score[team]++;

// Golden goal
if (mode === "golden") {

round++;

mode = "normal";

score = {
  blue: 0,
  red: 0
};

matchEnd =
  Date.now() +
  MATCH_TIME * 1000;

resetBall();

return;

}

// Đội đạt 3 bàn
if (
score[team] >= 3
) {

resetAt =
  Date.now() + 2200;

return;

}

// Reset sau bàn thắng
resetAt =
Date.now() + 1200;
}

// =========================================================
// PLAYER COLLISION
// =========================================================

function resolvePlayerCollisions() {

const list =
[...players.values()];

for (
let i = 0;
i < list.length;
i++
) {

for (
  let j = i + 1;
  j < list.length;
  j++
) {

  const a = list[i];
  const b = list[j];

  let dx =
    b.x - a.x;

  let dy =
    b.y - a.y;

  let dist =
    Math.hypot(dx, dy);

  const minDistance =
    PLAYER_RADIUS * 2;

  if (dist === 0) {

    dx = 1;
    dy = 0;

    dist = 1;
  }

  if (
    dist < minDistance
  ) {

    const nx =
      dx / dist;

    const ny =
      dy / dist;

    const overlap =
      minDistance - dist;

    // Đẩy hai player ra
    a.x -=
      nx * overlap * 0.5;

    a.y -=
      ny * overlap * 0.5;

    b.x +=
      nx * overlap * 0.5;

    b.y +=
      ny * overlap * 0.5;

    // Trao đổi vận tốc theo pháp tuyến
    const relativeVelocity =
      (b.vx - a.vx) * nx +
      (b.vy - a.vy) * ny;

    if (
      relativeVelocity < 0
    ) {

      const impulse =
        -relativeVelocity *
        0.5;

      a.vx -=
        nx * impulse;

      a.vy -=
        ny * impulse;

      b.vx +=
        nx * impulse;

      b.vy +=
        ny * impulse;
    }

    keepPlayerInside(a);
    keepPlayerInside(b);
  }
}

}
}

// =========================================================
// KEEP PLAYER INSIDE
// =========================================================

function keepPlayerInside(player) {

player.x =
clamp(
player.x,
PLAYER_RADIUS,
FIELD_WIDTH -
PLAYER_RADIUS
);

player.y =
clamp(
player.y,
PLAYER_RADIUS,
FIELD_HEIGHT -
PLAYER_RADIUS
);
}

// =========================================================
// PLAYER / BALL COLLISION
// =========================================================

function collidePlayerWithBall(player) {

let dx =
ball.x - player.x;

let dy =
ball.y - player.y;

let dist =
Math.hypot(dx, dy);

const minDistance =
PLAYER_RADIUS +
BALL_RADIUS;

if (dist === 0) {

dx = 1;
dy = 0;

dist = 1;

}

if (
dist < minDistance
) {

const nx =
  dx / dist;

const ny =
  dy / dist;

const overlap =
  minDistance - dist;

// Đẩy bóng ra khỏi player
ball.x +=
  nx * overlap;

ball.y +=
  ny * overlap;

// Vận tốc tương đối
const relativeVx =
  ball.vx - player.vx;

const relativeVy =
  ball.vy - player.vy;

const relativeVelocity =
  relativeVx * nx +
  relativeVy * ny;

// Chỉ bật khi đang lao vào nhau
if (
  relativeVelocity < 0
) {

  const impulse =
    -(1 + BALL_PHYSICS.bCoef) *
    relativeVelocity;

  ball.vx +=
    nx * impulse;

  ball.vy +=
    ny * impulse;
}

// Một phần vận tốc của player truyền sang bóng
ball.vx +=
  player.vx * 0.18;

ball.vy +=
  player.vy * 0.18;

}
}

// =========================================================
// BALL WALL COLLISION
// =========================================================

function collideBallWithWalls() {

const goalTop =
FIELD_HEIGHT / 2 -
GOAL_HEIGHT / 2;

const goalBottom =
FIELD_HEIGHT / 2 +
GOAL_HEIGHT / 2;

// TOP
if (
ball.y <
BALL_RADIUS
) {

ball.y =
  BALL_RADIUS;

ball.vy =
  Math.abs(ball.vy) *
  BALL_PHYSICS.bCoef;

}

// BOTTOM
if (
ball.y >
FIELD_HEIGHT -
BALL_RADIUS
) {

ball.y =
  FIELD_HEIGHT -
  BALL_RADIUS;

ball.vy =
  -Math.abs(ball.vy) *
  BALL_PHYSICS.bCoef;

}

// LEFT WALL
if (
ball.x <
BALL_RADIUS &&
(
ball.y < goalTop ||
ball.y > goalBottom
)
) {

ball.x =
  BALL_RADIUS;

ball.vx =
  Math.abs(ball.vx) *
  BALL_PHYSICS.bCoef;

}

// RIGHT WALL
if (
ball.x >
FIELD_WIDTH -
BALL_RADIUS &&
(
ball.y < goalTop ||
ball.y > goalBottom
)
) {

ball.x =
  FIELD_WIDTH -
  BALL_RADIUS;

ball.vx =
  -Math.abs(ball.vx) *
  BALL_PHYSICS.bCoef;

}
}

// =========================================================
// CHECK GOAL
// =========================================================

function checkGoal() {

const goalTop =
FIELD_HEIGHT / 2 -
GOAL_HEIGHT / 2;

const goalBottom =
FIELD_HEIGHT / 2 +
GOAL_HEIGHT / 2;

const insideGoal =
ball.y >= goalTop &&
ball.y <= goalBottom;

// Bóng ra khỏi bên trái
if (
ball.x <
-BALL_RADIUS &&
insideGoal
) {

goal("red");

return true;

}

// Bóng ra khỏi bên phải
if (
ball.x >
FIELD_WIDTH +
BALL_RADIUS &&
insideGoal
) {

goal("blue");

return true;

}

return false;
}

// =========================================================
// BALL SPEED LIMIT
// =========================================================

function limitBallSpeed() {

const speed =
Math.hypot(
ball.vx,
ball.vy
);

if (
speed >
BALL_PHYSICS.maxSpeed
) {

ball.vx =
  ball.vx /
  speed *
  BALL_PHYSICS.maxSpeed;

ball.vy =
  ball.vy /
  speed *
  BALL_PHYSICS.maxSpeed;

}
}

// =========================================================
// GAME PHYSICS
// =========================================================

function updatePhysics() {

// -------------------------------------------------------
// RESET SAU BÀN
// -------------------------------------------------------

if (resetAt) {

if (
  Date.now() >=
  resetAt
) {

  // Có đội thắng 3 bàn
  if (
    score.blue >= 3 ||
    score.red >= 3
  ) {

    const winningTeam =
      score.blue >= 3
        ? "blue"
        : "red";

    // Đội thua được chia lại
    const losingPlayers =
      [...players.values()]
        .filter(
          player =>
            player.team !==
            winningTeam
        )
        .sort(
          () =>
            Math.random() -
            0.5
        );

    let index = 0;

    for (
      const player
      of losingPlayers
    ) {

      player.team =
        index % 2 === 0
          ? "blue"
          : "red";

      index++;
    }

    round++;

    score = {
      blue: 0,
      red: 0
    };

    mode = "normal";

    matchEnd =
      Date.now() +
      MATCH_TIME * 1000;
  }

  resetAt = 0;

  resetBall();
}

return;

}

// -------------------------------------------------------
// HẾT THỜI GIAN
// -------------------------------------------------------

if (
mode === "normal" &&
Date.now() >= matchEnd
) {

// Hòa -> Golden Goal
mode = "golden";

score = {
  blue: 0,
  red: 0
};

resetBall();

return;

}

// -------------------------------------------------------
// PLAYERS
// -------------------------------------------------------

for (
const player
of players.values()
) {

let ax = 0;
let ay = 0;

if (player.input.up)
  ay -= 1;

if (player.input.down)
  ay += 1;

if (player.input.left)
  ax -= 1;

if (player.input.right)
  ax += 1;

const moving =
  ax !== 0 ||
  ay !== 0;

// Chuẩn hóa hướng
if (moving) {

  const length =
    Math.hypot(
      ax,
      ay
    );

  ax /= length;
  ay /= length;
}

// -----------------------------------------------------
// HAXBALL-STYLE PHYSICS
// -----------------------------------------------------

const acceleration =
  player.input.kick
    ? PLAYER_PHYSICS.kickingAcceleration
    : PLAYER_PHYSICS.acceleration;

const damping =
  player.input.kick
    ? PLAYER_PHYSICS.kickingDamping
    : PLAYER_PHYSICS.damping;

if (moving) {

  player.vx +=
    ax * acceleration;

  player.vy +=
    ay * acceleration;
}

// Damping mỗi tick
player.vx *= damping;
player.vy *= damping;

// -----------------------------------------------------
// PLAYER / KICK MOVEMENT
// -----------------------------------------------------

player.x += player.vx;
player.y += player.vy;

keepPlayerInside(player);

// -----------------------------------------------------
// KICK
// -----------------------------------------------------

if (player.input.kick) {

  const dx =
    ball.x -
    player.x;

  const dy =
    ball.y -
    player.y;

  const dist =
    Math.hypot(
      dx,
      dy
    );

  const kickDistance =
    PLAYER_RADIUS +
    BALL_RADIUS +
    2;

  if (
    dist <=
    kickDistance
  ) {

    const length =
      dist || 1;

    ball.vx +=
      (dx / length) *
      PLAYER_PHYSICS.kickStrength;

    ball.vy +=
      (dy / length) *
      PLAYER_PHYSICS.kickStrength;
  }

  // Một lần nhấn = một cú đá
  player.input.kick = false;
}

}

// -------------------------------------------------------
// PLAYER / PLAYER
// -------------------------------------------------------

resolvePlayerCollisions();

// -------------------------------------------------------
// BALL
// -------------------------------------------------------

ball.x += ball.vx;
ball.y += ball.vy;

// Ball damping giống HaxBall
ball.vx *= BALL_PHYSICS.damping;
ball.vy *= BALL_PHYSICS.damping;

limitBallSpeed();

// -------------------------------------------------------
// BALL / PLAYER
// -------------------------------------------------------

for (
const player
of players.values()
) {

collidePlayerWithBall(player);

}

// -------------------------------------------------------
// WALL
// -------------------------------------------------------

collideBallWithWalls();

// -------------------------------------------------------
// GOAL
// -------------------------------------------------------

if (
checkGoal()
) {
return;
}

limitBallSpeed();
}

// =========================================================
// HTTP SERVER
// =========================================================

const publicFolder =
path.join(
__dirname,
"public"
);

const server =
http.createServer(
(request, response) => {

  let requestPath =
    decodeURIComponent(
      request.url.split("?")[0]
    );

  if (
    requestPath === "/"
  ) {

    requestPath =
      "/index.html";
  }

  const filePath =
    path.join(
      publicFolder,
      requestPath
    );

  // Bảo vệ khỏi path traversal
  if (
    !filePath.startsWith(
      publicFolder
    )
  ) {

    response.writeHead(403);

    response.end(
      "Forbidden"
    );

    return;
  }

  fs.readFile(
    filePath,
    (error, data) => {

      if (error) {

        response.writeHead(
          404,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        response.end(
          "Not found"
        );

        return;
      }

      const extension =
        path.extname(
          filePath
        );

      let contentType =
        "text/plain";

      if (
        extension === ".html"
      ) {

        contentType =
          "text/html";
      }

      if (
        extension === ".js"
      ) {

        contentType =
          "text/javascript";
      }

      if (
        extension === ".css"
      ) {

        contentType =
          "text/css";
      }

      response.writeHead(
        200,
        {
          "Content-Type":
            contentType +
            "; charset=utf-8"
        }
      );

      response.end(data);
    }
  );
}

);

// =========================================================
// WEBSOCKET SERVER
// =========================================================

const wss =
new WebSocket.Server({
server
});

wss.on(
"connection",
ws => {

// -----------------------------------------------------
// MAX PLAYERS
// -----------------------------------------------------

if (
  players.size >=
  MAX_PLAYERS
) {

  ws.send(
    JSON.stringify({
      type: "error",
      message:
        "Server đầy! Tối đa 12 người."
    })
  );

  ws.close();

  return;
}

// -----------------------------------------------------
// CREATE PLAYER
// -----------------------------------------------------

const id =
  String(
    nextPlayerId++
  );

const player = {

  id,

  name:
    "Player",

  team:
    "blue",

  x:
    FIELD_WIDTH / 2,

  y:
    FIELD_HEIGHT / 2,

  vx: 0,

  vy: 0,

  input: {

    up: false,
    down: false,
    left: false,
    right: false,
    kick: false
  },

  ws
};

players.set(
  id,
  player
);

// Chia đội
balanceTeams();

// -----------------------------------------------------
// WELCOME
// -----------------------------------------------------

ws.send(
  JSON.stringify({

    type:
      "welcome",

    id,

    playerRadius:
      PLAYER_RADIUS,

    ballRadius:
      BALL_RADIUS
  })
);

broadcast();

// -----------------------------------------------------
// RECEIVE MESSAGE
// -----------------------------------------------------

ws.on(
  "message",
  raw => {

    try {

      const message =
        JSON.parse(
          raw.toString()
        );

      // -------------------------------------------------
      // NAME
      // -------------------------------------------------

      if (
        message.type ===
        "name"
      ) {

        player.name =
          String(
            message.name ||
            "Player"
          )
          .slice(0, 16)
          .replace(
            /[<>]/g,
            ""
          );

        broadcast();
      }

      // -------------------------------------------------
      // INPUT
      // -------------------------------------------------

      if (
        message.type ===
        "input"
      ) {

        player.input = {

          up:
            !!message.up,

          down:
            !!message.down,

          left:
            !!message.left,

          right:
            !!message.right,

          kick:
            !!message.kick
        };
      }

      // -------------------------------------------------
      // CHAT
      // -------------------------------------------------

      if (
        message.type ===
        "chat"
      ) {

        const text =
          String(
            message.text ||
            ""
          )
          .trim()
          .slice(0, 80)
          .replace(
            /[<>]/g,
            ""
          );

        if (!text)
          return;

        const chatMessage =
          JSON.stringify({

            type:
              "chat",

            name:
              player.name,

            text
          });

        for (
          const p
          of players.values()
        ) {

          if (
            p.ws.readyState ===
            WebSocket.OPEN
          ) {

            try {

              p.ws.send(
                chatMessage
              );

            } catch {
              // Bỏ qua
            }
          }
        }
      }

    } catch {
      // Dữ liệu không hợp lệ
    }
  }
);

// -----------------------------------------------------
// CLOSE
// -----------------------------------------------------

ws.on(
  "close",
  () => {

    players.delete(
      id
    );

    balanceTeams();

    broadcast();
  }
);

// -----------------------------------------------------
// ERROR
// -----------------------------------------------------

ws.on(
  "error",
  () => {

    players.delete(
      id
    );

    balanceTeams();

    broadcast();
  }
);

}
);

// =========================================================
// GAME LOOP
// =========================================================

setInterval(
() => {

updatePhysics();

broadcast();

},
TICK_MS
);

// =========================================================
// START
// =========================================================

server.listen(
PORT,
"0.0.0.0",
() => {

console.log(
  `Ball Hax server đang chạy tại port ${PORT}`
);

}
);
