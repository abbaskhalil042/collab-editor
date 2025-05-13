"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";

interface User {
  id: string;
  name: string;
  color: string;
  cursorPos?: number;
}

interface EditHistory {
  user: string;
  change: string;
  timestamp: string;
}

export const CollabEditor: React.FC = () => {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [showNameInput, setShowNameInput] = useState(true);
  const [remoteCursors, setRemoteCursors] = useState<{ [key: string]: User }>({});
  const [editHistory, setEditHistory] = useState<EditHistory[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  const socketRef = useRef<Socket | null>(null);
  const userColorRef = useRef(`hsl(${Math.random() * 360}, 70%, 70%)`);
  const editorRef = useRef<Editor | null>(null);
  const lastTypedPositionRef = useRef<number | null>(null);
  const cursorTimeoutsRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  // Clear all timeouts when component unmounts
  const clearAllTimeouts = useCallback(() => {
    const timeouts = cursorTimeoutsRef.current;
    Object.values(timeouts).forEach(clearTimeout);
    cursorTimeoutsRef.current = {};
  }, []);

  // Handle cursor position updates
  const handleCursorPosition = useCallback((userData: User) => {
    if (userData.id !== socketRef.current?.id) {
      setRemoteCursors((prev) => {
        const newCursors = { ...prev, [userData.id]: userData };

        // Clear previous timeout if exists
        if (cursorTimeoutsRef.current[userData.id]) {
          clearTimeout(cursorTimeoutsRef.current[userData.id]);
        }

        // Set new timeout to remove cursor after 2 seconds
        const timeoutId = setTimeout(() => {
          setRemoteCursors((prev) => {
            const updated = { ...prev };
            delete updated[userData.id];
            return updated;
          });
          delete cursorTimeoutsRef.current[userData.id];
        }, 2000);

        // Store the timeout ID in the ref
        cursorTimeoutsRef.current[userData.id] = timeoutId;

        return newCursors;
      });
    }
  }, []);

  // tiptap editor configuration
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color],
    content,
    onUpdate: ({ editor }) => {
      const newContent = editor.getHTML();
      setContent(newContent);

      if (socketRef.current?.connected) {
        const cursorPos = editor.state.selection.anchor;
        lastTypedPositionRef.current = cursorPos;

        socketRef.current.emit("cursor-position", {
          id: socketRef.current.id,
          name,
          color: userColorRef.current,
          cursorPos,
        });

        socketRef.current.emit("update", newContent);
        socketRef.current.emit("user-typing");

        const { from, to } = editor.state.selection;
        if (from !== to) return;
        editor.commands.setColor(userColorRef.current);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (socketRef.current?.connected) {
        const cursorPos = editor.state.selection.anchor;
        socketRef.current.emit("cursor-position", {
          id: socketRef.current.id,
          name,
          color: userColorRef.current,
          cursorPos,
        });
      }
    },
  });

  // Set editor ref
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!showNameInput && !socketRef.current) {
      const socket = io("https://collab-editor-backend-bknx.onrender.com", {
        transports: ["websocket"],
        query: { name, color: userColorRef.current },
      });

      socketRef.current = socket;

      // Handle typing indicators
      socket.on("user-typing", (userId) => {
        setTypingUsers((prev) => {
          const newSet = new Set(prev);
          newSet.add(userId);
          return newSet;
        });

        setTimeout(() => {
          setTypingUsers((prev) => {
            const newSet = new Set(prev);
            newSet.delete(userId);
            return newSet;
          });
        }, 1500);
      });

      socket.on("connect", () => setIsConnected(true));
      socket.on("disconnect", () => setIsConnected(false));
      socket.on("content", (data) => {
        if (editorRef.current) {
          editorRef.current.commands.setContent(data.content, false);
          setContent(data.content);
          setUsers(data.users);
        }
      });

      socket.on("cursor-position", handleCursorPosition);
      socket.on("user-activity", (activity) => {
        setEditHistory((prev) =>
          [
            {
              user: activity.user,
              change: activity.change,
              timestamp: new Date().toLocaleTimeString(),
            },
            ...prev,
          ].slice(0, 10)
        );
      });

      socket.on("user-connected", (user) => {
        setUsers((prev) => [...prev, user]);
      });

      socket.on("user-disconnected", (userId) => {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setRemoteCursors((prev) => {
          const newCursors = { ...prev };
          delete newCursors[userId];
          return newCursors;
        });
        if (cursorTimeoutsRef.current[userId]) {
          clearTimeout(cursorTimeoutsRef.current[userId]);
          delete cursorTimeoutsRef.current[userId];
        }
      });

      return () => {
        clearAllTimeouts();
        socket.disconnect();
      };
    }
  }, [showNameInput, name, handleCursorPosition, clearAllTimeouts]);

  const renderCursors = useCallback(() => {
    if (!editorRef.current) return null;
    const editor = editorRef.current;
    const view = editor.view;
    const docSize = view.state.doc.content.size;

    return Object.values(remoteCursors)
      .filter((user) => typingUsers.has(user.id))
      .map((user) => {
        if (user.cursorPos === undefined) return null;

        try {
          const safePos = Math.max(0, Math.min(user.cursorPos, docSize - 1));
          const coords = view.coordsAtPos(safePos);
          if (!coords || (coords.left === 0 && coords.top === 0)) return null;

          const editorRect = view.dom.getBoundingClientRect();
          const scrollContainer = view.dom.parentElement;
          const scrollLeft = scrollContainer?.scrollLeft || 0;
          const scrollTop = scrollContainer?.scrollTop || 0;

          const adjustedLeft = coords.left - editorRect.left + scrollLeft;
          const adjustedTop = coords.top - editorRect.top + scrollTop;

          return (
            <div
              key={user.id}
              className="absolute flex flex-col items-center pointer-events-none"
              style={{
                left: `${adjustedLeft}px`,
                top: `${adjustedTop}px`,
                zIndex: 30,
                transform: "translateY(-90%)",
                transition: "transform 50ms linear",
              }}
            >
              <div
                className="h-5 w-5 rounded-full flex items-center justify-center border-2 border-white"
                style={{
                  backgroundColor: user.color,
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.8)",
                }}
              >
                <span className="text-xs text-black font-bold">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div
                className="w-2 h-0 border-l-3 border-r-3 border-b-3 border-l-transparent border-r-transparent"
                style={{
                  borderBottomColor: user.color,
                  marginTop: "-1px",
                  filter: "drop-shadow(0 5px 5px rgba(0,0,0,0.2))",
                }}
              />
            </div>
          );
        } catch (error) {
          console.error("Error rendering cursor:", error);
          return null;
        }
      });
  }, [remoteCursors, typingUsers]);

  if (showNameInput) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="p-6 rounded-lg shadow-md w-96">
          <h1 className="text-2xl font-bold mb-4 text-center">
            Join Collaborative Editor
          </h1>
          <div className="flex flex-col space-y-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setShowNameInput(false)}
              className="border p-2 rounded"
              placeholder="Enter your name"
            />
            <button
              onClick={() => setShowNameInput(false)}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto min-h-screen">
      <div className="flex justify-between items-center mb-4">
        <div className="font-medium">
          You: <span style={{ color: userColorRef.current }}>{name}</span>
          {!isConnected && (
            <span className="ml-2 text-red-500">(Disconnected)</span>
          )}
        </div>
        <div className="text-sm">
          Online:
          {users.map((u) => (
            <span key={u.id} style={{ color: u.color }} className="ml-2">
              {u.name}
              {typingUsers.has(u.id) && (
                <span className="ml-1 text-gray-500">(typing...)</span>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="relative border rounded-lg">
        <EditorContent editor={editor} />
        {renderCursors()}
      </div>
      <div className="mt-4">
        <h3 className="font-medium mb-2">Recent Changes:</h3>
        {editHistory.map((history, index) => (
          <div key={index} className="text-sm mb-1">
            <span style={{ color: history.user === name ? "blue" : "black" }}>
              {history.user}:{" "}
            </span>
            <span style={{ color: history.user === name ? "blue" : "black" }}>
              {history.change}
            </span>
            <span className="text-gray-500 text-xs ml-2">
              {history.timestamp}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};