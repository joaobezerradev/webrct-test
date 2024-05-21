import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import SimplePeer from "simple-peer";

const socket = io("http://localhost:8080", {
  transports: ["websocket"],
  upgrade: false,
});

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [joinedRoom, setJoinedRoom] = useState<boolean>(false);
  const [users, setUsers] = useState<string[]>([]);
  const [rooms, setRooms] = useState<{ id: string; users: string[] }[]>([]);
  const [whisperRoomId, setWhisperRoomId] = useState<string>("");
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRefs = useRef<{ [key: string]: MediaStream }>({});
  const remoteVideoRefs = useRef<{ [key: string]: HTMLDivElement }>({});
  const peersRef = useRef<{ [key: string]: SimplePeer.Instance }>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    fetch("http://localhost:8080/rooms")
      .then((response) => response.json())
      .then((data) => setRooms(data))
      .catch((error) => console.error("Error fetching rooms:", error));

    socket.on("room-created", ({ roomId }) => {
      setRoomId(roomId);
    });

    socket.on("joined-room", ({ roomId }) => {
      setJoinedRoom(true);
      setRoomId(roomId); // Atualiza o estado com o ID da sala
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .then((stream) => {
          localStreamRef.current = stream;
          handleRemoteStream(stream, socket.id!, true);
        });
    });

    socket.on("update-users", (users: string[]) => {
      setUsers(users);
    });

    socket.on("user-joined", ({ socketId, isAdmin: userIsAdmin }) => {
      if (socketId !== socket.id) {
        createPeer(socketId, localStreamRef.current!, isAdmin);
      }
    });

    socket.on("receive-signal", ({ signal, from }) => {
      const peer = peersRef.current[from];
      if (peer) {
        peer.signal(signal);
      } else {
        addPeer(signal, from, localStreamRef.current!, isAdmin);
      }
    });

    socket.on("user-disconnected", (socketId) => {
      handleUserDisconnected(socketId);
    });

    socket.on("audioStream", ({ audioData, from }) => {
      playAudio(audioData);
    });

    const handleBeforeUnload = () => {
      for (const socketId in peersRef.current) {
        handleUserDisconnected(socketId);
      }
      socket.disconnect();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      socket.off("room-created");
      socket.off("joined-room");
      socket.off("update-users");
      socket.off("user-joined");
      socket.off("receive-signal");
      socket.off("user-disconnected");
      socket.off("audioStream");
    };
  }, []);

  const createRoom = () => {
    socket.emit("create-room");
  };

  const joinRoom = (selectedRoomId?: string) => {
    socket.emit("join-room", { roomId: selectedRoomId ?? roomId, isAdmin });
  };

  const createPeer = (
    userToSignal: string,
    stream: MediaStream,
    isAdmin: boolean
  ) => {
    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      stream: stream,
    });

    peer.on("signal", (signal) => {
      socket.emit("send-signal", { userToSignal, signal, roomId });
    });

    peer.on("stream", (stream) => {
      handleRemoteStream(stream, userToSignal);
    });

    peersRef.current[userToSignal] = peer;
  };

  const addPeer = (
    incomingSignal: string,
    callerId: string,
    stream: MediaStream,
    isAdmin: boolean
  ) => {
    const peer = new SimplePeer({
      initiator: false,
      trickle: false,
      stream: stream,
    });

    peer.on("signal", (signal) => {
      socket.emit("return-signal", { signal, callerId });
    });

    peer.on("stream", (stream) => {
      handleRemoteStream(stream, callerId);
    });

    peer.signal(incomingSignal);
    peersRef.current[callerId] = peer;
  };

  const handleRemoteStream = (
    stream: MediaStream,
    userId: string,
    isLocal: boolean = false
  ) => {
    remoteStreamRefs.current[userId] = stream;

    const videoContainer = document.createElement("div");
    videoContainer.className = "video-container";
    videoContainer.style.display = "inline-block";
    videoContainer.style.margin = "10px";

    const videoElement = document.createElement("video");
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.width = 400;
    videoElement.height = 300;
    if (isLocal) {
      videoElement.muted = true;
    }

    const label = document.createElement("div");
    label.textContent = isLocal ? "You" : userId;
    label.className = "video-label";
    label.style.textAlign = "center";

    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(label);

    remoteVideoRefs.current[userId] = videoContainer;
    document.getElementById("remote-videos")?.appendChild(videoContainer);
  };

  const handleUserDisconnected = (socketId: string) => {
    if (peersRef.current[socketId]) {
      peersRef.current[socketId].destroy();
      delete peersRef.current[socketId];
    }
    if (remoteVideoRefs.current[socketId]) {
      const videoContainer = remoteVideoRefs.current[socketId];
      if (videoContainer.parentNode) {
        videoContainer.parentNode.removeChild(videoContainer);
      }
      delete remoteVideoRefs.current[socketId];
    }
    if (remoteStreamRefs.current[socketId]) {
      delete remoteStreamRefs.current[socketId];
    }
    setUsers((prevUsers) => prevUsers.filter((user) => user !== socketId));
  };

  const handleWhisperStart = () => {
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.addEventListener("dataavailable", (event) => {
          audioChunksRef.current.push(event.data);
        });

        mediaRecorder.addEventListener("stop", () => {
          const audioBlob = new Blob(audioChunksRef.current);
          audioChunksRef.current = [];
          audioBlob.arrayBuffer().then((arrayBuffer) => {
            socket.emit("whisper", {
              currentRoom: roomId,
              audioData: arrayBuffer,
              whisperRoomId: whisperRoomId || "all",
            });
          });
        });

        mediaRecorder.start();
      })
      .catch((error) => {
        console.error("Error capturing audio.", error);
      });
  };

  const handleWhisperStop = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  };

  const playAudio = async (arrayBuffer: ArrayBuffer) => {
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
  };
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-10">
      <h1 className="text-4xl font-extrabold mb-10">TS3 Clone</h1>
      {!joinedRoom ? (
        <div className="space-y-6">
          <button
            onClick={createRoom}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition"
          >
            Create Room
          </button>
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => joinRoom(roomId)}
            className="px-6 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition"
          >
            Join Room
          </button>
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="form-checkbox h-5 w-5 text-blue-600"
            />
            <span className="text-gray-700">Join as Admin</span>
          </label>
          <div className="p-4 border border-gray-300 rounded-lg shadow-sm max-h-96 overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Available Rooms</h2>
            {rooms.length > 0 ? (
              rooms.map((room) => (
                <div key={room.id} className="mb-4">
                  <div className="font-semibold text-gray-800">{room.id}</div>
                  <button
                    onClick={() => joinRoom(room.id)}
                    className="text-blue-500 hover:underline"
                  >
                    Join Room
                  </button>
                  <ul className="pl-4">
                    {room.users.map((user) => (
                      <li key={user} className="text-gray-600">
                        {user}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div>No rooms available.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div id="remote-videos" className="flex flex-wrap justify-center" />
          <div className="text-lg font-bold text-gray-800">
            Current Room: {roomId}
          </div>
          <input
            type="text"
            placeholder="Whisper Room ID (Optional)"
            value={whisperRoomId}
            onChange={(e) => setWhisperRoomId(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onMouseDown={handleWhisperStart}
            onMouseUp={handleWhisperStop}
            className="px-6 py-3 bg-yellow-600 text-white rounded-lg shadow-md hover:bg-yellow-700 transition"
          >
            Whisper
          </button>
          <div className="p-4 border border-gray-300 rounded-lg shadow-sm max-h-96 overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Available Rooms</h2>
            {rooms.length > 0 ? (
              rooms.map((room) => (
                <div key={room.id} className="mb-4">
                  <div className="font-semibold text-gray-800">{room.id}</div>
                  <button
                    onClick={() => joinRoom(room.id)}
                    className="text-blue-500 hover:underline"
                  >
                    Join Room
                  </button>
                  <ul className="pl-4">
                    {room.users.map((user) => (
                      <li key={user} className="text-gray-600">
                        {user}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div>No rooms available.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
