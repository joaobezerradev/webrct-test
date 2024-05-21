import { randomUUID } from "node:crypto";
import { Socket } from "socket.io";

const rooms: Record<string, Set<string>> = {};

type RoomParams = { roomId: string, peerId: string };

export const roomHandler = (socket: Socket) => {
  socket.on("create-room", () => {
    const roomId = randomUUID();
    rooms[roomId] = new Set();
    socket.emit("room-created", { roomId });
    console.log("User created the room:", roomId);
  });

  socket.on("join-room", ({ roomId, peerId }: RoomParams) => {
    if (rooms[roomId]) {
      rooms[roomId].add(peerId);
      socket.join(roomId);
      socket.to(roomId).emit("user-joined", { peerId });
      socket.emit("get-users", { roomId, users: Array.from(rooms[roomId]) });
      console.log("User joined the room:", roomId, peerId);

      // Adiciona o listener de desconexão apenas uma vez por sala e peerId
      socket.once("disconnect", () => {
        console.log("User left the room:", peerId);
        leaveRoom({ peerId, roomId });
      });
    }
  });

  const leaveRoom = ({ peerId, roomId }: RoomParams) => {
    const room = rooms[roomId];
    if (room) {
      room.delete(peerId);
      socket.to(roomId).emit("user-disconnected", peerId);
    }
  };
};
