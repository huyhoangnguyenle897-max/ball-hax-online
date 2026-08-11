const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const FIELD_WIDTH = 1400;
const FIELD_HEIGHT = 700;

const MAX_PLAYERS = 12;
const MATCH_TIME = 300;

const PLAYER_RADIUS = 18;
const BALL_RADIUS = 13;
const GOAL_HEIGHT = 240;

/* =========================
   VẬT LÝ
========================= */

const PHYSICS = {
    playerAcceleration: 0.025,
    playerKickingAcceleration: 0.0175,

    playerDamping: 0.96,
    playerKickingDamping: 0.96,

    maxPlayerSpeed: 5.5,

    ballDamping: 0.99,
    ballBounce: 0.5,

    kickStrength: 5.65,
    kickback: 0.25,

    kickDistance: 30,

    maxBallSpeed: 15
};

/* =========================
   GAME
========================= */

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


/* =========================
   HỖ TRỢ
========================= */

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}


function randomSpawn(player) {

    player.x =
        player.team === "blue"
            ? 180
            : FIELD_WIDTH - 180;

    player.y =
        FIELD_HEIGHT / 2 +
        (Math.random() - 0.5) * 240;

    player.vx = 0;
    player.vy = 0;
}


function resetBall() {

    ball.x = FIELD_WIDTH / 2;
    ball.y = FIELD_HEIGHT / 2;

    ball.vx = 0;
    ball.vy = 0;

    for (const player of players.values()) {
        randomSpawn(player);
    }
}


/* =========================
   CHIA ĐỘI
========================= */

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


/* =========================
   GAME STATE
========================= */

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


function broadcast() {

    const message =
        JSON.stringify(getGameState());

    for (const player of players.values()) {

        if (
            player.ws.readyState ===
            WebSocket.OPEN
        ) {
            player.ws.send(message);
        }
    }
}


/* =========================
   BÀN THẮNG
========================= */

function goal(team) {

    score[team]++;

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

    if (score[team] >= 3) {

        resetAt =
            Date.now() + 2200;

        return;
    }

    resetAt =
        Date.now() + 1200;
}


/* =========================
   XỬ LÝ KICK
========================= */

function kickBall(player) {

    const dx =
        ball.x - player.x;

    const dy =
        ball.y - player.y;

    const distance =
        Math.hypot(dx, dy);

    const kickRange =
        PLAYER_RADIUS +
        BALL_RADIUS +
        PHYSICS.kickDistance;

    if (distance > kickRange) {
        return false;
    }

    /*
     * Hướng từ cầu thủ tới bóng.
     */
    let nx;
    let ny;

    if (distance < 0.001) {

        const speed =
            Math.hypot(
                player.vx,
                player.vy
            );

        if (speed > 0.01) {

            nx =
                player.vx / speed;

            ny =
                player.vy / speed;

        } else {

            nx = 1;
            ny = 0;
        }

    } else {

        nx = dx / distance;
        ny = dy / distance;
    }


    /*
     * Đẩy bóng ra khỏi người trước.
     * Điều này tránh trường hợp bóng nằm
     * chồng lên cầu thủ và kick không ăn.
     */

    const minimumDistance =
        PLAYER_RADIUS +
        BALL_RADIUS;

    if (distance < minimumDistance) {

        const push =
            minimumDistance -
            distance +
            0.5;

        ball.x += nx * push;
        ball.y += ny * push;
    }


    /*
     * Lực đá chính.
     */
    ball.vx +=
        nx * PHYSICS.kickStrength;

    ball.vy +=
        ny * PHYSICS.kickStrength;


    /*
     * Kickback nhẹ lên cầu thủ.
     */
    player.vx -=
        nx * PHYSICS.kickback;

    player.vy -=
        ny * PHYSICS.kickback;


    /*
     * Giới hạn tốc độ bóng.
     */
    const ballSpeed =
        Math.hypot(
            ball.vx,
            ball.vy
        );

    if (
        ballSpeed >
        PHYSICS.maxBallSpeed
    ) {

        ball.vx =
            ball.vx /
            ballSpeed *
            PHYSICS.maxBallSpeed;

        ball.vy =
            ball.vy /
            ballSpeed *
            PHYSICS.maxBallSpeed;
    }

    return true;
}


/* =========================
   VẬT LÝ
========================= */

function updatePhysics(dt) {

    /* =====================
       RESET
    ===================== */

    if (resetAt) {

        if (Date.now() >= resetAt) {

            if (
                score.blue >= 3 ||
                score.red >= 3
            ) {

                const winningTeam =
                    score.blue >= 3
                        ? "blue"
                        : "red";

                const losingPlayers =
                    [...players.values()]
                        .filter(
                            p =>
                                p.team !==
                                winningTeam
                        )
                        .sort(
                            () =>
                                Math.random() -
                                0.5
                        );

                let index = 0;

                for (
                    const player of
                    losingPlayers
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


    /* =====================
       HẾT GIỜ
    ===================== */

    if (
        mode === "normal" &&
        Date.now() >= matchEnd
    ) {

        mode = "golden";

        score = {
            blue: 0,
            red: 0
        };

        resetBall();

        return;
    }


    /* =====================
       PLAYER
    ===================== */

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


        const moving =
            ax !== 0 ||
            ay !== 0;


        if (moving) {

            const length =
                Math.hypot(ax, ay);

            const acceleration =
                player.input.kick
                    ? PHYSICS.playerKickingAcceleration
                    : PHYSICS.playerAcceleration;

            player.vx +=
                (ax / length) *
                acceleration *
                dt *
                60;

            player.vy +=
                (ay / length) *
                acceleration *
                dt *
                60;

        } else {

            const damping =
                player.input.kick
                    ? PHYSICS.playerKickingDamping
                    : PHYSICS.playerDamping;

            player.vx *=
                Math.pow(
                    damping,
                    dt * 60
                );

            player.vy *=
                Math.pow(
                    damping,
                    dt * 60
                );
        }


        /* =====================
           PLAYER SPEED
        ===================== */

        let speed =
            Math.hypot(
                player.vx,
                player.vy
            );

        if (
            speed >
            PHYSICS.maxPlayerSpeed
        ) {

            player.vx =
                player.vx /
                speed *
                PHYSICS.maxPlayerSpeed;

            player.vy =
                player.vy /
                speed *
                PHYSICS.maxPlayerSpeed;
        }


        /* =====================
           PLAYER POSITION
        ===================== */

        player.x +=
            player.vx *
            dt *
            60;

        player.y +=
            player.vy *
            dt *
            60;


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


        /* =====================
           KICK
        ===================== */

        if (player.input.kick) {

            kickBall(player);

            /*
             * Một lần bấm = một lần kick.
             * Client phải gửi lại kick=true
             * cho lần đá tiếp theo.
             */

            player.input.kick = false;
        }
    }


    /* =====================
       BALL MOVEMENT
    ===================== */

    ball.x +=
        ball.vx *
        dt *
        60;

    ball.y +=
        ball.vy *
        dt *
        60;


    /* =====================
       BALL DAMPING
    ===================== */

    ball.vx *=
        Math.pow(
            PHYSICS.ballDamping,
            dt * 60
        );

    ball.vy *=
        Math.pow(
            PHYSICS.ballDamping,
            dt * 60
        );


    /* =====================
       BALL SPEED LIMIT
    ===================== */

    const ballSpeed =
        Math.hypot(
            ball.vx,
            ball.vy
        );

    if (
        ballSpeed >
        PHYSICS.maxBallSpeed
    ) {

        ball.vx =
            ball.vx /
            ballSpeed *
            PHYSICS.maxBallSpeed;

        ball.vy =
            ball.vy /
            ballSpeed *
            PHYSICS.maxBallSpeed;
    }


    /* =====================
       TƯỜNG TRÊN
    ===================== */

    if (
        ball.y <
        BALL_RADIUS
    ) {

        ball.y =
            BALL_RADIUS;

        ball.vy =
            Math.abs(ball.vy) *
            PHYSICS.ballBounce;
    }


    /* =====================
       TƯỜNG DƯỚI
    ===================== */

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
            PHYSICS.ballBounce;
    }


    /* =====================
       PLAYER ↔ BALL
    ===================== */

    for (
        const player of players.values()
    ) {

        let dx =
            ball.x -
            player.x;

        let dy =
            ball.y -
            player.y;

        let distance =
            Math.hypot(dx, dy);

        if (distance < 0.001) {
            distance = 0.001;
            dx = 1;
            dy = 0;
        }

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

            const overlap =
                minDistance -
                distance;

            /*
             * Tách bóng khỏi cầu thủ.
             */
            ball.x +=
                nx *
                overlap;

            ball.y +=
                ny *
                overlap;


            /*
             * Vận tốc tương đối.
             */
            const relativeVx =
                ball.vx -
                player.vx;

            const relativeVy =
                ball.vy -
                player.vy;

            const relativeNormalVelocity =
                relativeVx * nx +
                relativeVy * ny;


            /*
             * Chỉ thêm lực khi đang
             * tiến vào nhau.
             */
            if (
                relativeNormalVelocity < 0
            ) {

                const impulse =
                    -relativeNormalVelocity *
                    1.5;

                ball.vx +=
                    nx * impulse;

                ball.vy +=
                    ny * impulse;
            }
        }
    }


    /* =====================
       GOAL
    ===================== */

    const insideGoal =
        Math.abs(
            ball.y -
            FIELD_HEIGHT / 2
        ) <
        GOAL_HEIGHT / 2;


    /*
     * GOAL TRÁI
     */

    if (
        ball.x <
        -BALL_RADIUS &&
        insideGoal
    ) {

        goal("red");

        return;
    }


    /*
     * GOAL PHẢI
     */

    if (
        ball.x >
        FIELD_WIDTH +
        BALL_RADIUS &&
        insideGoal
    ) {

        goal("blue");

        return;
    }


    /*
     * TƯỜNG TRÁI
     */

    if (
        ball.x <
        BALL_RADIUS &&
        !insideGoal
    ) {

        ball.x =
            BALL_RADIUS;

        ball.vx =
            Math.abs(ball.vx) *
            PHYSICS.ballBounce;
    }


    /*
     * TƯỜNG PHẢI
     */

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
            PHYSICS.ballBounce;
    }
}


/* =========================
   HTTP SERVER
========================= */

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
                response.end("Forbidden");

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
                        path.extname(filePath);

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


/* =========================
   WEBSOCKET
========================= */

const wss =
    new WebSocket.Server({
        server
    });


wss.on(
    "connection",
    ws => {

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


        /* =====================
           MESSAGE
        ===================== */

        ws.on(
            "message",
            raw => {

                try {

                    const message =
                        JSON.parse(
                            raw.toString()
                        );


                    /* NAME */

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


                    /* INPUT */

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


                    /* CHAT */

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

                    /* Bỏ qua message lỗi */
                }
            }
        );


        /* =====================
           DISCONNECT
        ===================== */

        ws.on(
            "close",
            () => {

                players.delete(id);

                balanceTeams();

                broadcast();
            }
        );
    }
);


/* =========================
   GAME LOOP
========================= */

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

        lastTime = now;

        updatePhysics(dt);

        broadcast();

    },
    1000 / 60
);


/* =========================
   START
========================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Ball Hax server đang chạy tại port ${PORT}`
        );
    }
);
