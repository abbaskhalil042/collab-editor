import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

interface ClientData {
  id: string;
  name: string;
  color: string;
  cursorPos?: number;
}

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("checking server");
});
// Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["*"],
    methods: ["GET", "POST"],
  },
});

// State
let content = "";
const users = new Map<string, ClientData>();

io.on("connection", (socket) => {
  const query = socket.handshake.query as Partial<ClientData>;
  const name = query.name || "Anonymous";
  const color =
    query.color || `hsl(${Math.floor(Math.random() * 360)}, 70%, 70%)`;

  // Store user data with initial cursor position
  users.set(socket.id, {
    id: socket.id,
    name,
    color,
    cursorPos: 0, // Initialize cursor position
  });
  console.log(`User connected: ${name}`);

  // Send current state to new user
  socket.emit("content", {
    content,
    users: Array.from(users.values()).filter((user) => user.id !== socket.id), ///excluding myself
  });

  // Notify others about the new user
  socket.broadcast.emit("user-connected", {
    id: socket.id,
    name,
    color,
  });

  // Handling content updates
  socket.on("update", (newContent: string) => {
    content = newContent;

    socket.broadcast.emit("content", {
      content,
      users: Array.from(users.values()).filter((user) => user.id !== socket.id),
    });
  });

  // Handling cursor position updates
  socket.on("cursor-position", (data) => {
    // Update local cursor position
    const user = users.get(socket.id);
    if (user) {
      user.cursorPos = data.cursorPos;
      users.set(socket.id, user);
    }

    // Broadcast to others
    socket.broadcast.emit("cursor-position", {
      id: socket.id,
      name: data.name,
      color: data.color,
      cursorPos: data.cursorPos,
    });
  });

  // Handling user activities
  socket.on("user-activity", (activity) => {
    socket.broadcast.emit("user-activity", activity);
  });

  // Handling typing indicator
  socket.on("user-typing", () => {
    socket.broadcast.emit("user-typing", socket.id);
  });

  // Handling disconnection
  socket.on("disconnect", () => {
    const name = users.get(socket.id)?.name || "Anonymous";
    users.delete(socket.id);
    socket.broadcast.emit("user-disconnected", socket.id);
    console.log(`User disconnected: ${name}`);
  });
});

// Starting server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
