const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const FIELD_WIDTH = 1400;
const FIELD_HEIGHT = 700;

const MAX_PLAYERS = 12;
const MATCH_TIME = 300; // 5 phút

const PLAYER_RADIUS = 18;
const BALL_RADIUS = 13;
const GOAL_HEIGHT = 240;

const players = new Map();

let nextPlayerId = 1;

let score = {
  blue: 0,
  red: 0
};

let round = 1;

let mode = "normal";

let matchEnd =
  Date.now() + MATCH_TIME * 1000;

let resetAt = 0;

let ball = {
  x: FIELD_WIDTH / 2,
  y: FIELD_HEIGHT / 2,
  vx: 0,
  vy: 0
};

let lastTime = Date.now();


// =========================
// HỖ TRỢ
// =========================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function randomSpawn(player) {

  if (player.team === "blue") {

    player.x = 180;

  } else {

    player.x = FIELD_WIDTH - 180;

  }

  player.y =
    130 +
    Math.random() *
    (FIELD_HEIGHT - 260);

  player.vx = 0;
  player.vy = 0;
}


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


// =========================
// CHIA ĐỘI
// =========================

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


// =========================
// TRẠNG THÁI GAME
// =========================

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

    score: {
      blue: score.blue,
      red: score.red
    },

    round,

    mode,

    timeLeft,

    ball: {
      x: ball.x,
      y: ball.y
    },

    players:
      [...players.values()]
        .map(player => ({

          id: player.id,

          name: player.name,

          team: player.team,

          x: player.x,

          y: player.y

        }))
  };
}


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

      player.ws.send(message);

    }
  }
}


// =========================
// BÀN THẮNG
// =========================

function goal(team) {

  score[team]++;

  // CƠ HỘI VÀNG
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
  if (score[team] >= 3) {

    resetAt =
      Date.now() + 2200;

    return;
  }


  // Sau khi ghi bàn
  resetAt =
    Date.now() + 1200;
}


// =========================
// VẬT LÝ GAME
// =========================

function updatePhysics(dt) {

  // Đang chờ reset sau bàn thắng
  if (resetAt) {

    if (Date.now() >= resetAt) {

      // Có đội thắng trận
      if (
        score.blue >= 3 ||
        score.red >= 3
      ) {

        const winningTeam =
          score.blue >= 3
            ? "blue"
            : "red";

        // Đội thắng giữ nguyên đội hình.
        // Đội thua được xáo lại.
        const losingPlayers =
          [...players.values()]
            .filter(
              p => p.team !== winningTeam
            )
            .sort(
              () => Math.random() - 0.5
            );

        let index = 0;

        for (const player of losingPlayers) {

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


  // Hết thời gian
  if (
    mode === "normal" &&
    Date.now() >= matchEnd
  ) {

    // HÒA -> CƠ HỘI VÀNG
    mode = "golden";

    score = {
      blue: 0,
      red: 0
    };

    resetBall();

    return;
  }


  // =========================
  // PLAYER
  // =========================

  const acceleration = 0.018;

  const maxSpeed = 5.5;

  for (
    const player of players.values()
  ) {

    let ax = 0;
    let ay = 0;


    if (player.input.up)
      ay--;

    if (player.input.down)
      ay++;

    if (player.input.left)
      ax--;

    if (player.input.right)
      ax++;


    if (ax !== 0 || ay !== 0) {

      const length =
        Math.hypot(ax, ay);

      player.vx +=
        (ax / length) *
        acceleration *
        dt;

      player.vy +=
        (ay / length) *
        acceleration *
        dt;

    } else {

      player.vx *=
        Math.pow(0.0005, dt);

      player.vy *=
        Math.pow(0.0005, dt);

    }


    // Giới hạn tốc độ
    const speed =
      Math.hypot(
        player.vx,
        player.vy
      );

    if (speed > maxSpeed) {

      player.vx =
        player.vx /
        speed *
        maxSpeed;

      player.vy =
        player.vy /
        speed *
        maxSpeed;

    }


    player.x =
      clamp(
        player.x +
        player.vx * dt,

        PLAYER_RADIUS,

        FIELD_WIDTH -
        PLAYER_RADIUS
      );


    player.y =
      clamp(
        player.y +
        player.vy * dt,

        PLAYER_RADIUS,

        FIELD_HEIGHT -
        PLAYER_RADIUS
      );


    // =========================
    // ĐÁ BÓNG
    // =========================

    if (player.input.kick) {

      const dx =
        ball.x -
        player.x;

      const dy =
        ball.y -
        player.y;

      const distance =
        Math.hypot(dx, dy);

      if (
        distance <
        PLAYER_RADIUS +
        BALL_RADIUS +
        30
      ) {

        const length =
          distance || 1;

        ball.vx +=
          (dx / length) * 11;

        ball.vy +=
          (dy / length) * 11;

      }

      // Không có hồi chiêu.
      // Nút đá có thể dùng lại ngay.
      player.input.kick = false;

    }

  }


  // =========================
  // BALL
  // =========================

  ball.x +=
    ball.vx * dt;

  ball.y +=
    ball.vy * dt;


  // Ma sát
  ball.vx *=
    Math.pow(0.16, dt);

  ball.vy *=
    Math.pow(0.16, dt);


  // Tường trên / dưới
  if (
    ball.y <
    BALL_RADIUS
  ) {

    ball.y =
      BALL_RADIUS;

    ball.vy =
      Math.abs(ball.vy) *
      0.75;

  }


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
      0.75;

  }


  // =========================
  // PLAYER VA CHẠM BÓNG
  // =========================

  for (
    const player of players.values()
  ) {

    const dx =
      ball.x -
      player.x;

    const dy =
      ball.y -
      player.y;

    const distance =
      Math.hypot(dx, dy) ||
      0.001;

    const minDistance =
      PLAYER_RADIUS +
      BALL_RADIUS;

    if (
      distance <
      minDistance
    ) {

      const nx =
        dx / distance;

      const ny =
        dy / distance;

      const push =
        minDistance -
        distance;

      ball.x +=
        nx * push;

      ball.y +=
        ny * push;

      const force =
        2 +
        Math.min(
          3,
          Math.hypot(
            player.vx,
            player.vy
          )
        );

      ball.vx +=
        nx * force;

      ball.vy +=
        ny * force;

    }

  }


  // =========================
  // KHUNG THÀNH
  // =========================

  const insideGoal =
    Math.abs(
      ball.y -
      FIELD_HEIGHT / 2
    ) <
    GOAL_HEIGHT / 2;


  // Bóng vào khung thành trái
  if (
    ball.x <
    -BALL_RADIUS &&
    insideGoal
  ) {

    goal("red");

    return;

  }


  // Bóng vào khung thành phải
  if (
    ball.x >
    FIELD_WIDTH +
    BALL_RADIUS &&
    insideGoal
  ) {

    goal("blue");

    return;

  }


  // Bóng chạm tường trái
  if (
    ball.x <
    BALL_RADIUS &&
    !insideGoal
  ) {

    ball.x =
      BALL_RADIUS;

    ball.vx =
      Math.abs(ball.vx) *
      0.75;

  }


  // Bóng chạm tường phải
  if (
    ball.x >
    FIELD_WIDTH -
    BALL_RADIUS &&
    !insideGoal
  ) {

    ball.x =
      FIELD_WIDTH -
      BALL_RADIUS;

    ball.vx =
      -Math.abs(ball.vx) *
      0.75;

  }

}


// =========================
// HTTP SERVER
// =========================

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


// =========================
// WEBSOCKET SERVER
// =========================

const wss =
  new WebSocket.Server({
    server
  });


wss.on(
  "connection",
  ws => {

    // Không cho quá 12 người
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


    const id =
      String(nextPlayerId++);


    const player = {

      id,

      name:
        "Player",

      team:
        "blue",

      x: 0,

      y: 0,

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


    balanceTeams();


    ws.send(
      JSON.stringify({

        type:
          "welcome",

        id

      })
    );


    broadcast();


    // =========================
    // NHẬN DỮ LIỆU
    // =========================

    ws.on(
      "message",
      raw => {

        try {

          const message =
            JSON.parse(
              raw.toString()
            );


          // Tên
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

          }


          // Điều khiển
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


          // Chat
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
              const p of
              players.values()
            ) {

              if (
                p.ws.readyState ===
                WebSocket.OPEN
              ) {

                p.ws.send(
                  chatMessage
                );

              }

            }

          }

        } catch {

          // Bỏ qua dữ liệu lỗi

        }

      }
    );


    // =========================
    // NGẮT KẾT NỐI
    // =========================

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

  }
);


// =========================
// GAME LOOP
// =========================

setInterval(
  () => {

    const now =
      Date.now();


    const dt =
      Math.min(
        0.035,
        (now - lastTime) /
        1000
      );


    lastTime =
      now;


    updatePhysics(dt);

    broadcast();

  },
  1000 / 30
);


// =========================
// START SERVER
// =========================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Ball Hax server đang chạy tại port ${PORT}`
    );

  }
);
