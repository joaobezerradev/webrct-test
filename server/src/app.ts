import express, { Request, Response } from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import path from 'node:path'
import cors from 'cors';

interface Room {
  users: Set<string>;
  admins: Set<string>;
}

interface SignalData {
  userToSignal: string;
  signal: any;
  roomId: string;
}

interface JoinRoomData {
  roomId: string;
  isAdmin: boolean;
}

interface ReturnSignalData {
  signal: any;
  callerId: string;
}

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new SocketIOServer(server);

const rooms: { [key: string]: Room } = {};

app.get("/api", (req: Request, res: Response) => {
  res.send("Server is running.");
});

app.get('/api/whisper', async (req, res) => {
  const filePath = path.join(__dirname, 'whisper.wav');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      res.status(500).send('Error sending file');
    }
  });
});

app.get("/api/rooms", (req: Request, res: Response) => {
  const roomList = Object.keys(rooms).map((roomId) => ({
    id: roomId,
    users: Array.from(rooms[roomId].users),
  }));
  res.json(roomList);
});

io.on('connection', (socket: Socket) => {
  console.log('New client connected:', socket.id);

  socket.on('create-room', () => {
    const roomId = `room-${Math.random().toString(36).substr(2, 9)}`;
    rooms[roomId] = { users: new Set(), admins: new Set() };
    socket.emit('room-created', { roomId });
    console.log('Room created:', roomId);
  });

  socket.on('join-room', ({ roomId, isAdmin }: JoinRoomData) => {
    const room = rooms[roomId];
    if (room) {
      room.users.add(socket.id);
      if (isAdmin) {
        room.admins.add(socket.id);
      }
      socket.join(roomId);
      socket.emit('joined-room', { roomId });
      io.to(roomId).emit('user-joined', { socketId: socket.id, isAdmin });
      io.to(roomId).emit('update-users', Array.from(room.users));
      console.log(`User ${socket.id} joined room ${roomId}`);
    }
  });

  socket.on('send-signal', ({ userToSignal, signal }: SignalData) => {
    io.to(userToSignal).emit('receive-signal', { signal, from: socket.id });
  });

  socket.on('return-signal', ({ signal, callerId }: ReturnSignalData) => {
    io.to(callerId).emit('receive-signal', { signal, from: socket.id });
  });

  socket.on("whisper", ({ currentRoom, audioData, whisperRoomId }: any) => {
    if (whisperRoomId && rooms[whisperRoomId]) {
      io.to(whisperRoomId).emit("audioStream", { audioData, from: socket.id });
    } else {
      for (const roomId in rooms) {
        if (roomId !== currentRoom) {
          io.to(roomId).emit("audioStream", { audioData, from: socket.id });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.users.delete(socket.id)) {
        room.admins.delete(socket.id);
        io.to(roomId).emit('user-disconnected', socket.id);
        io.to(roomId).emit('update-users', Array.from(room.users));
        console.log(`User ${socket.id} disconnected from room ${roomId}`);
        break;
      }
    }
  });
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
