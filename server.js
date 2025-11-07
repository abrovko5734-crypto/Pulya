import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static("avatars"));

let users = {};
if (fs.existsSync("users.json"))
    users = JSON.parse(fs.readFileSync("users.json", "utf8"));

// Сохранение базы
function saveUsers() {
    fs.writeFileSync("users.json", JSON.stringify(users, null, 4));
}

// HTTP — загрузка аватара
app.post("/avatar", (req, res) => {
    const { username, image } = req.body;

    if (!users[username]) return res.json({ error: "no user" });

    const file = `avatars/${username}.png`;
    fs.writeFileSync(file, Buffer.from(image, "base64"));
    users[username].avatar = `/avatars/${username}.png`;
    saveUsers();

    res.json({ ok: true });
});

// WebSocket
const wss = new WebSocketServer({ noServer: true });

let clients = new Map();

wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
        msg = JSON.parse(msg);

        // Регистрация
        if (msg.type === "register") {
            if (users[msg.login]) {
                return ws.send(JSON.stringify({ type: "error", msg: "login exists" }));
            }

            users[msg.login] = {
                pass: msg.pass,
                nick: msg.login,
                avatar: "",
            };
            saveUsers();

            ws.send(JSON.stringify({ type: "ok", msg: "registered" }));
        }

        // Логин
        if (msg.type === "login") {
            const u = users[msg.login];
            if (!u || u.pass !== msg.pass) {
                return ws.send(JSON.stringify({ type: "error", msg: "wrong login/pass" }));
            }

            clients.set(ws, msg.login);

            // Отправка списка онлайн
            ws.send(JSON.stringify({
                type: "login_ok",
                user: msg.login,
                nick: u.nick,
                avatar: u.avatar,
                online: Array.from(clients.values()),
            }));

            // Обновление другим
            broadcast({
                type: "online",
                list: Array.from(clients.values()),
            });
        }

        // Сообщение
        if (msg.type === "msg") {
            const from = clients.get(ws);
            broadcast({ type: "msg", from, text: msg.text });
        }
    });

    ws.on("close", () => {
        clients.delete(ws);
        broadcast({
            type: "online",
            list: Array.from(clients.values()),
        });
    });
});

function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of clients.keys()) ws.send(data);
}

// HTTP + WS upgrade
const server = app.listen(process.env.PORT || 3000, () => {
    console.log("✅ Server started on PORT", process.env.PORT || 3000);
});

server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
