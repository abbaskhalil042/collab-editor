"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
// Socket.io
const server = http_1.default.createServer();
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ["http://localhost:3000"],
        methods: ["GET", "POST"],
    },
});
// State
let content = "";
const users = new Map();
io.on("connection", (socket) => {
    const query = socket.handshake.query;
    const name = query.name || "Anonymous";
    const color = query.color || `hsl(${Math.floor(Math.random() * 360)}, 70%, 70%)`;
    // Store user data with initial cursor position
    users.set(socket.id, {
        id: socket.id,
        name,
        color,
        cursorPos: 0 // Initialize cursor position
    });
    console.log(`User connected: ${name}`);
    // Send current state to new user
    socket.emit("content", {
        content,
        users: Array.from(users.values()).filter(user => user.id !== socket.id) // Don't send self
    });
    // Notify others about the new user
    socket.broadcast.emit("user-connected", {
        id: socket.id,
        name,
        color
    });
    // Handling content updates
    socket.on("update", (newContent) => {
        content = newContent;
        socket.broadcast.emit("content", {
            content,
            users: Array.from(users.values()).filter(user => user.id !== socket.id)
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
            cursorPos: data.cursorPos
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
        var _a;
        const name = ((_a = users.get(socket.id)) === null || _a === void 0 ? void 0 : _a.name) || "Anonymous";
        users.delete(socket.id);
        socket.broadcast.emit("user-disconnected", socket.id);
        console.log(`User disconnected: ${name}`);
    });
});
// Starting server
const PORT = 4000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
