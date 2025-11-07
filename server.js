const express = require("express");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use("/avatars", express.static(path.join(__dirname, "avatars")));
app.use(express.json({ limit: "10mb" })); // Ограничение размера для аватаров

// CORS для HTTP запросов
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Load user database
let users = [];
const USERS_FILE = "users.json";

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf8");
      users = JSON.parse(data);
      console.log(`✅ Loaded ${users.length} users`);
    } else {
      users = [];
      console.log("ℹ️  No users file found, starting with empty users");
    }
  } catch (err) {
    console.error("❌ Error loading users:", err);
    users = [];
  }
}

// Save users to file
function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("❌ Error saving users:", err);
  }
}

// Validate username (basic sanitization)
function isValidUsername(username) {
  return typeof username === "string" && 
         username.length >= 1 && 
         username.length <= 20 &&
         /^[a-zA-Z0-9_]+$/.test(username);
}

// HTTP endpoint for uploading avatar
app.post("/uploadAvatar", (req, res) => {
  try {
    const { username, image } = req.body;

    if (!username || !image) {
      return res.status(400).json({ error: "Username and image are required" });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: "Invalid username format" });
    }

    // Ensure avatars directory exists
    const avatarsDir = path.join(__dirname, "avatars");
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }

    const avatarPath = path.join(avatarsDir, `${username}.png`);
    const buffer = Buffer.from(image, "base64");
    
    // Validate base64 image
    if (buffer.length > 5 * 1024 * 1024) { // 5MB limit
      return res.status(400).json({ error: "Image too large" });
    }

    fs.writeFileSync(avatarPath, buffer);

    // Update user avatar
    const user = users.find(u => u.name === username);
    if (user) {
      user.avatar = `/avatars/${username}.png`;
      saveUsers();
    }

    res.json({ ok: true, avatar: `/avatars/${username}.png` });
  } catch (error) {
    console.error("❌ Avatar upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    users: users.length 
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  loadUsers(); // Load users after server starts
});

// WebSocket server
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true
});

// WebSocket connection handling
wss.on("connection", (ws, req) => {
  console.log(`🔗 New WebSocket connection from ${req.socket.remoteAddress}`);
  
  // Send initial data
  try {
    ws.send(JSON.stringify({ 
      type: "init", 
      users,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error("❌ Error sending init data:", error);
  }

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      console.log(`📨 Received message type: ${msg.type}`);

      // Update user balance, nickname, etc.
      if (msg.type === "updateUser") {
        if (!isValidUsername(msg.name)) {
          return ws.send(JSON.stringify({ 
            type: "error", 
            message: "Invalid username format" 
          }));
        }

        const user = users.find(u => u.name === msg.name);
        if (user) {
          if (msg.balance !== undefined && typeof msg.balance === "number") {
            user.balance = msg.balance;
          }
          if (msg.nick !== undefined && typeof msg.nick === "string") {
            user.nick = msg.nick.substring(0, 50); // Limit nickname length
          }
          saveUsers();
        }

        broadcast({
          type: "updateUsers",
          users,
          updatedBy: msg.name
        });
      }

      // Register new user
      if (msg.type === "register") {
        if (!isValidUsername(msg.name)) {
          return ws.send(JSON.stringify({ 
            type: "error", 
            message: "Invalid username format. Use only letters, numbers and underscore." 
          }));
        }

        if (users.find(u => u.name === msg.name)) {
          return ws.send(JSON.stringify({ 
            type: "error", 
            message: "User already exists" 
          }));
        }

        const newUser = {
          name: msg.name,
          pass: msg.pass, // In production, hash passwords!
          nick: msg.name,
          avatar: "",
          balance: 0,
          registered: new Date().toISOString()
        };
        
        users.push(newUser);
        saveUsers();

        ws.send(JSON.stringify({ type: "register_ok" }));
        
        // Notify all clients about new user
        broadcast({
          type: "userRegistered",
          user: newUser
        });
      }

      // User login
      if (msg.type === "login") {
        const user = users.find(u => u.name === msg.name && u.pass === msg.pass);
        if (!user) {
          return ws.send(JSON.stringify({ 
            type: "error", 
            message: "Wrong username or password" 
          }));
        }

        ws.send(JSON.stringify({
          type: "login_ok",
          user
        }));
      }

    } catch (error) {
      console.error("❌ WebSocket message error:", error);
      ws.send(JSON.stringify({ 
        type: "error", 
        message: "Invalid message format" 
      }));
    }
  });

  ws.on("close", () => {
    console.log(`🔌 WebSocket connection closed`);
  });

  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error);
  });
});

// Broadcast message to all clients
function broadcast(obj) {
  const data = JSON.stringify(obj);
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (error) {
        console.error("❌ Broadcast error:", error);
      }
    }
  });
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  wss.close(() => {
    server.close(() => {
      console.log("✅ Server closed");
      process.exit(0);
    });
  });
});
