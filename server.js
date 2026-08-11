"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

/* =========================================================
   SERVER
========================================================= */

const PORT = process.env.PORT || 8080;

const FIELD_WIDTH = 1100;
const FIELD_HEIGHT = 560;

const MAX_PLAYERS = 12;
const MATCH_TIME = 300;

/* =========================================================
   HAXBALL-LIKE PHYSICS
========================================================= */

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 10;

const GOAL_HEIGHT = 190;
const GOAL_DEPTH = 70;

/*
 * Các thông số này được cố tình giữ vừa phải.
 * Không dùng acceleration cực lớn và không dùng
 * damping quá thấp khiến cầu thủ trượt mãi.
 */

const PHYSICS = {

    playerAcceleration: 0.095,

    playerDamping: 0.88,

    playerMaxSpeed: 5.5,

    ballDamping: 0.985,

    ballBounce: 0.72,

    playerBounce: 0.45,

    kickStrength: 5.2,

    kickCooldown: 180

};

/* =========================================================
   PLAYERS
========================================================= */

const players = new Map();

let nextPlayerId = 1;

/* =========================================================
   SCORE / MATCH
========================================================= */

let score = {
    blue: 0,
    red: 0
};

let round = 1;

let mode = "normal";

let matchEnd =
    Date.now() + MATCH_TIME * 1000;

let resetAt = 0;

/* =========================================================
   BALL
========================================================= */

let ball = {

    x: FIELD_WIDTH / 2,

    y: FIELD_HEIGHT / 2,

    vx: 0,

    vy: 0

};

/* =========================================================
   UTILITY
========================================================= */

function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function distance(ax, ay, bx, by) {

    return Math.hypot(
        bx - ax,
        by - ay
    );

}


function normalize(x, y) {

    const length =
        Math.hypot(x, y);

    if (length < 0.00001) {

        return {
            x: 0,
            y: 0
        };

    }

    return {

        x: x / length,

        y: y / length

    };

}


/* =========================================================
   SPAWN
========================================================= */

function randomSpawn(player) {

    if (player.team === "blue") {

        player.x =
            FIELD_WIDTH * 0.25;

    } else {

        player.x =
            FIELD_WIDTH * 0.75;

    }

    player.y =
        FIELD_HEIGHT / 2 +
        (Math.random() - 0.5) * 180;

    player.vx = 0;
    player.vy = 0;

}


/* =========================================================
   RESET BALL
========================================================= */

function resetBall() {

    ball.x =
        FIELD_WIDTH / 2;

    ball.y =
        FIELD_HEIGHT / 2;

    ball.vx = 0;
    ball.vy = 0;

    for (
        const player of players.values()
    ) {

        randomSpawn(player);

    }

}


/* =========================================================
   BALANCE TEAMS
========================================================= */

function balanceTeams() {

    const list =
        [...players.values()]
            .sort(
                () =>
                    Math.random() - 0.5
            );

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

    for (
        const player of players.values()
    ) {

        randomSpawn(player);

    }

}


/* =========================================================
   GAME STATE
========================================================= */

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


/* =========================================================
   BROADCAST
========================================================= */

function broadcast() {

    const message =
        JSON.stringify(
            getGameState()
        );

    for (
        const player of players.values()
    ) {

        if (
            player.ws.readyState ===
            WebSocket.OPEN
        ) {

            try {

                player.ws.send(message);

            } catch {

                // bỏ qua client lỗi

            }

        }

    }

}


/* =========================================================
   GOAL
========================================================= */

function goal(team) {

    score[team]++;

    /*
     * CƠ HỘI VÀNG
     */

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


    /*
     * Đội đạt 3 bàn
     */

    if (
        score[team] >= 3
    ) {

        resetAt =
            Date.now() + 2200;

        return;

    }


    /*
     * Reset sau bàn thắng
     */

    resetAt =
        Date.now() + 1200;

}


/* =========================================================
   PLAYER PHYSICS
========================================================= */

function updatePlayer(
    player,
    dt
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


    /*
     * Chuẩn hóa đường chéo
     */

    if (
        ax !== 0 ||
        ay !== 0
    ) {

        const length =
            Math.hypot(ax, ay);

        ax /= length;
        ay /= length;

    }


    /*
     * Gia tốc
     */

    player.vx +=
        ax *
        PHYSICS.playerAcceleration *
        dt *
        60;

    player.vy +=
        ay *
        PHYSICS.playerAcceleration *
        dt *
        60;


    /*
     * Ma sát khi không điều khiển.
     *
     * Không để cầu thủ trượt quá lâu.
     */

    const damping =
        Math.pow(
            PHYSICS.playerDamping,
            dt * 60
        );

    player.vx *= damping;
    player.vy *= damping;


    /*
     * Giới hạn tốc độ
     */

    const speed =
        Math.hypot(
            player.vx,
            player.vy
        );

    if (
        speed >
        PHYSICS.playerMaxSpeed
    ) {

        player.vx =
            player.vx /
            speed *
            PHYSICS.playerMaxSpeed;

        player.vy =
            player.vy /
            speed *
            PHYSICS.playerMaxSpeed;

    }


    /*
     * Di chuyển
     */

    player.x +=
        player.vx *
        dt *
        60;

    player.y +=
        player.vy *
        dt *
        60;


    /*
     * Giữ trong sân
     */

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


    /*
     * KICK COOLDOWN
     */

    if (
        player.kickCooldown > 0
    ) {

        player.kickCooldown -=
            dt * 1000;

    }


    /*
     * ĐÁ BÓNG
     */

    if (
        player.input.kick &&
        player.kickCooldown <= 0
    ) {

        const dx =
            ball.x -
            player.x;

        const dy =
            ball.y -
            player.y;

        const dist =
            Math.hypot(dx, dy);


        if (
            dist <=
            PLAYER_RADIUS +
            BALL_RADIUS +
            12
        ) {

            const dir =
                normalize(dx, dy);


            /*
             * Cú đá.
             */

            ball.vx +=
                dir.x *
                PHYSICS.kickStrength;

            ball.vy +=
                dir.y *
                PHYSICS.kickStrength;


            /*
             * Kick cooldown
             */

            player.kickCooldown =
                PHYSICS.kickCooldown;

        }

    }

}


/* =========================================================
   PLAYER - BALL COLLISION
========================================================= */

function collidePlayerBall(
    player
) {

    let dx =
        ball.x -
        player.x;

    let dy =
        ball.y -
        player.y;

    let dist =
        Math.hypot(dx, dy);


    if (dist < 0.0001) {

        dx = 1;
        dy = 0;

        dist = 1;

    }


    const minDistance =
        PLAYER_RADIUS +
        BALL_RADIUS;


    if (
        dist >= minDistance
    ) {

        return;

    }


    const nx =
        dx / dist;

    const ny =
        dy / dist;


    /*
     * Đẩy bóng ra khỏi cầu thủ
     */

    const overlap =
        minDistance -
        dist;

    ball.x +=
        nx *
        overlap;

    ball.y +=
        ny *
        overlap;


    /*
     * Vận tốc tương đối
     */

    const relativeVx =
        ball.vx -
        player.vx;

    const relativeVy =
        ball.vy -
        player.vy;


    const relativeVelocity =
        relativeVx * nx +
        relativeVy * ny;


    /*
     * Chỉ va chạm khi đang lao vào nhau.
     */

    if (
        relativeVelocity < 0
    ) {

        const impulse =
            -(1 +
                PHYSICS.ballBounce) *
            relativeVelocity;

        ball.vx +=
            nx *
            impulse;

        ball.vy +=
            ny *
            impulse;

    }


    /*
     * Một chút ảnh hưởng từ chuyển động
     * của cầu thủ.
     */

    ball.vx +=
        player.vx *
        0.12;

    ball.vy +=
        player.vy *
        0.12;

}


/* =========================================================
   BALL WALLS + GOALS
========================================================= */

function updateBall(dt) {

    /*
     * Di chuyển bóng
     */

    ball.x +=
        ball.vx *
        dt *
        60;

    ball.y +=
        ball.vy *
        dt *
        60;


    /*
     * Ma sát bóng
     */

    const ballDamping =
        Math.pow(
            PHYSICS.ballDamping,
            dt * 60
        );

    ball.vx *=
        ballDamping;

    ball.vy *=
        ballDamping;


    /*
     * Trần / đáy
     */

    if (
        ball.y -
        BALL_RADIUS <
        0
    ) {

        ball.y =
            BALL_RADIUS;

        ball.vy =
            Math.abs(
                ball.vy
            ) *
            PHYSICS.ballBounce;

    }


    if (
        ball.y +
        BALL_RADIUS >
        FIELD_HEIGHT
    ) {

        ball.y =
            FIELD_HEIGHT -
            BALL_RADIUS;

        ball.vy =
            -Math.abs(
                ball.vy
            ) *
            PHYSICS.ballBounce;

    }


    /*
     * Va chạm với cầu thủ
     */

    for (
        const player of players.values()
    ) {

        collidePlayerBall(player);

    }


    /*
     * Kiểm tra vùng khung thành
     */

    const goalTop =
        FIELD_HEIGHT / 2 -
        GOAL_HEIGHT / 2;

    const goalBottom =
        FIELD_HEIGHT / 2 +
        GOAL_HEIGHT / 2;


    const insideGoal =
        ball.y >= goalTop &&
        ball.y <= goalBottom;


    /*
     * Bóng vào khung thành trái.
     * Đội RED ghi bàn.
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
     * Bóng vào khung thành phải.
     * Đội BLUE ghi bàn.
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
     * Tường trái.
     *
     * Chừa khoảng trống khung thành.
     */

    if (
        ball.x -
        BALL_RADIUS <
        0 &&
        !insideGoal
    ) {

        ball.x =
            BALL_RADIUS;

        ball.vx =
            Math.abs(
                ball.vx
            ) *
            PHYSICS.ballBounce;

    }


    /*
     * Tường phải.
     */

    if (
        ball.x +
        BALL_RADIUS >
        FIELD_WIDTH &&
        !insideGoal
    ) {

        ball.x =
            FIELD_WIDTH -
            BALL_RADIUS;

        ball.vx =
            -Math.abs(
                ball.vx
            ) *
            PHYSICS.ballBounce;

    }

}


/* =========================================================
   GAME PHYSICS
========================================================= */

function updatePhysics(dt) {

    /*
     * Đang chờ reset sau bàn
     */

    if (resetAt) {

        if (
            Date.now() >=
            resetAt
        ) {

            /*
             * Đã có đội thắng trận
             */

            if (
                score.blue >= 3 ||
                score.red >= 3
            ) {

                const winningTeam =
                    score.blue >= 3
                        ? "blue"
                        : "red";


                /*
                 * Đội thua đổi đội.
                 */

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


    /*
     * Hết thời gian.
     *
     * Nếu hòa -> golden goal.
     */

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


    /*
     * Cập nhật tất cả cầu thủ.
     */

    for (
        const player of players.values()
    ) {

        updatePlayer(
            player,
            dt
        );

    }


    /*
     * Cập nhật bóng.
     */

    updateBall(dt);

}


/* =========================================================
   HTTP SERVER
========================================================= */

const publicFolder =
    path.join(
        __dirname,
        "public"
    );


const server =
    http.createServer(
        (request, response) => {

            let requestPath;

            try {

                requestPath =
                    decodeURIComponent(
                        request.url
                            .split("?")[0]
                    );

            } catch {

                response.writeHead(400);

                response.end(
                    "Bad request"
                );

                return;

            }


            if (
                requestPath === "/"
            ) {

                requestPath =
                    "/index.html";

            }


            /*
             * Chặn đường dẫn nguy hiểm
             */

            const filePath =
                path.resolve(
                    publicFolder,
                    "." +
                    requestPath
                );


            const publicRoot =
                path.resolve(
                    publicFolder
                );


            if (
                filePath !== publicRoot &&
                !filePath.startsWith(
                    publicRoot +
                    path.sep
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
                        ).toLowerCase();


                    const contentTypes = {

                        ".html":
                            "text/html",

                        ".js":
                            "text/javascript",

                        ".css":
                            "text/css",

                        ".json":
                            "application/json",

                        ".png":
                            "image/png",

                        ".jpg":
                            "image/jpeg",

                        ".jpeg":
                            "image/jpeg",

                        ".svg":
                            "image/svg+xml"

                    };


                    const contentType =
                        contentTypes[
                            extension
                        ] ||
                        "application/octet-stream";


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


/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
    new WebSocket.Server({
        server
    });


wss.on(
    "connection",
    ws => {

        /*
         * Giới hạn 12 người
         */

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

            name: "",

            team: "blue",

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

            kickCooldown: 0,

            ws

        };


        players.set(
            id,
            player
        );


        /*
         * Chia đội
         */

        balanceTeams();


        /*
         * Gửi ID cho client
         */

        ws.send(
            JSON.stringify({

                type: "welcome",

                id,

                maxPlayers:
                    MAX_PLAYERS

            })
        );


        /*
         * Gửi trạng thái ngay lập tức
         */

        broadcast();


        /* =================================================
           MESSAGE
        ================================================= */

        ws.on(
            "message",
            raw => {

                try {

                    const message =
                        JSON.parse(
                            raw.toString()
                        );


                    /*
                     * ĐẶT TÊN
                     */

                    if (
                        message.type ===
                        "name"
                    ) {

                        player.name =
                            String(
                                message.name ||
                                ""
                            )
                            .trim()
                            .slice(0, 16)
                            .replace(
                                /[<>]/g,
                                ""
                            );

                        broadcast();

                        return;

                    }


                    /*
                     * INPUT
                     */

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

                        return;

                    }


                    /*
                     * CHAT
                     */

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
                                    player.name ||
                                    "Player",

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

                    /*
                     * Bỏ qua packet lỗi
                     */

                }

            }
        );


        /* =================================================
           DISCONNECT
        ================================================= */

        ws.on(
            "close",
            () => {

                players.delete(id);

                balanceTeams();

                broadcast();

            }
        );


        ws.on(
            "error",
            () => {

                /*
                 * close sẽ xử lý việc
                 * xóa player.
                 */

            }
        );

    }
);


/* =========================================================
   GAME LOOP
========================================================= */

/*
 * 60 tick/giây.
 *
 * Logic game không phụ thuộc vào tốc độ
 * render của trình duyệt.
 */

const TICK_RATE = 60;

const TICK_TIME =
    1000 / TICK_RATE;


let lastTime =
    Date.now();


setInterval(
    () => {

        const now =
            Date.now();


        let dt =
            (now - lastTime) /
            1000;


        lastTime = now;


        /*
         * Không cho một frame lag làm
         * vật lý nhảy quá xa.
         */

        dt =
            Math.min(
                dt,
                0.05
            );


        updatePhysics(dt);

        broadcast();

    },
    TICK_TIME
);


/* =========================================================
   START
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Ball Hax server đang chạy tại port ${PORT}`
        );

    }
);
