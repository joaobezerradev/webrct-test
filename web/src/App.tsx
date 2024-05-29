import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import SimplePeer from "simple-peer";

const socket = io("http://localhost:8080/", {
  transports: ["websocket"],
  upgrade: false,
});

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [joinedRoom, setJoinedRoom] = useState<boolean>(false);
  const [users, setUsers] = useState<{ id: string; muted: boolean }[]>([]);
  const [rooms, setRooms] = useState<{ id: string; users: string[] }[]>([]);
  const [whisperRoomId, setWhisperRoomId] = useState<string>("");
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRefs = useRef<{ [key: string]: MediaStream }>({});
  const remoteVideoRefs = useRef<{ [key: string]: HTMLDivElement }>({});
  const peersRef = useRef<{ [key: string]: SimplePeer.Instance }>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    fetch("http://localhost:8080/api/rooms")
      .then((response) => response.json())
      .then((data) => setRooms(data))
      .catch((error) => console.error("Error fetching rooms:", error));

    socket.on("room-created", ({ roomId }) => {
      setRoomId(roomId);
    });

    socket.on("joined-room", ({ roomId }) => {
      setJoinedRoom(true);
      setRoomId(roomId);
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          localStreamRef.current = stream;
          handleRemoteStream(stream, socket.id!, true, roomId);
        });
    });

    socket.on("update-users", (users: string[]) => {
      setUsers(users.map((user) => ({ id: user, muted: false })));
    });

    socket.on("user-joined", ({ socketId }) => {
      if (socketId !== socket.id) {
        createPeer(socketId, localStreamRef.current!);
      }
    });

    socket.on("receive-signal", ({ signal, from }) => {
      const peer = peersRef.current[from];
      if (peer) {
        peer.signal(signal);
      } else {
        addPeer(signal, from, localStreamRef.current!);
      }
    });

    socket.on("user-disconnected", (socketId) => {
      handleUserDisconnected(socketId);
    });

    socket.on("audioStream", ({ audioData }) => {
      playAudio(audioData);
    });

    socket.on("mute-user", (userId) => {
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, muted: true } : user
        )
      );
      if (userId === socket.id && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      updateMuteIcon(userId, true);
    });

    socket.on("unmute-user", (userId) => {
      console.log({ event: "unmute-user received", userId });
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, muted: false } : user
        )
      );
      if (userId === socket.id && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          track.enabled = true;
        });
      }
      updateMuteIcon(userId, false);
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
      socket.off("mute-user");
      socket.off("unmute-user");
    };
  }, []);

  const createRoom = () => {
    socket.emit("create-room");
  };

  const joinRoom = (selectedRoomId?: string) => {
    const roomToJoin = selectedRoomId ?? roomId;
    socket.emit("join-room", { roomId: roomToJoin, isAdmin });
  };

  const createPeer = (userToSignal: string, stream: MediaStream) => {
    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      stream: stream,
    });

    peer.on("signal", (signal) => {
      socket.emit("send-signal", { userToSignal, signal, roomId });
    });

    peer.on("stream", (stream) => {
      handleRemoteStream(stream, userToSignal, false, roomId);
    });

    peersRef.current[userToSignal] = peer;
  };

  const addPeer = (
    incomingSignal: string,
    callerId: string,
    stream: MediaStream
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
      handleRemoteStream(stream, callerId, false, roomId);
    });

    peer.signal(incomingSignal);
    peersRef.current[callerId] = peer;
  };

  const handleRemoteStream = (
    stream: MediaStream,
    userId: string,
    isLocal: boolean = false,
    currentRoomId: string
  ) => {
    remoteStreamRefs.current[userId] = stream;

    const audioContainer = document.createElement("div");
    audioContainer.className = "audio-container";
    audioContainer.style.display = "inline-block";
    audioContainer.style.margin = "10px";
    audioContainer.style.padding = "20px";
    audioContainer.style.borderRadius = "10px";
    audioContainer.style.backgroundColor = isLocal
      ? "rgba(0, 122, 255, 0.1)"
      : "rgba(255, 255, 255, 0.1)";
    audioContainer.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
    audioContainer.style.textAlign = "center";

    const audioElement = document.createElement("audio");
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.style.visibility = "hidden";
    audioElement.style.height = "0";
    audioElement.style.width = "0";
    if (isLocal) {
      audioElement.muted = true;
    }

    const muteIcon = document.createElement("div");
    muteIcon.className = "mute-icon";
    muteIcon.style.fontSize = "24px";
    muteIcon.style.marginTop = "10px";
    muteIcon.style.cursor = "pointer";
    muteIcon.style.color = "white";
    muteIcon.innerHTML = isLocal
      ? '<i class="fa fa-microphone" aria-hidden="true"></i>'
      : '<i class="fas fa-volume-up"></i>';

    muteIcon.onclick = () => {
      if (isLocal) {
        const track = stream.getTracks()[0];
        track.enabled = !track.enabled;
        muteIcon.innerHTML = track.enabled
          ? '<i class="fa fa-microphone" aria-hidden="true"></i>'
          : '<i class="fa fa-microphone-slash" aria-hidden="true"></i>';
      } else {
        audioElement.muted = !audioElement.muted;
        muteIcon.innerHTML = audioElement.muted
          ? '<i class="fas fa-volume-mute"></i>'
          : '<i class="fas fa-volume-up"></i>';
      }
    };

    const label = document.createElement("div");
    label.textContent = isLocal ? `${userId} (You)` : userId;
    label.className = "audio-label";
    label.style.marginTop = "10px";
    label.style.color = "white";
    label.style.fontWeight = "bold";

    audioContainer.appendChild(audioElement);
    audioContainer.appendChild(muteIcon);
    audioContainer.appendChild(label);

    if (!isLocal) {
      const muteButton = document.createElement("button");
      muteButton.className =
        "mute-button bg-red-600 text-white px-2 py-1 rounded";
      muteButton.innerText = "Mute";
      muteButton.onclick = () => {
        const user = users.find((user) => user.id === userId);
        if (user && user.muted) {
          socket.emit("unmute-user", { roomId: currentRoomId, userId });
          user.muted = false;
        } else {
          socket.emit("mute-user", { roomId: currentRoomId, userId });
        }
      };

      const removeButton = document.createElement("button");
      removeButton.className =
        "remove-button bg-red-600 text-white px-2 py-1 rounded ml-2";
      removeButton.innerText = "Remove";
      removeButton.onclick = () => {
        socket.emit("remove-user", { roomId: currentRoomId, userId });
      };

      audioContainer.appendChild(muteButton);
      audioContainer.appendChild(removeButton);
    }

    remoteVideoRefs.current[userId] = audioContainer;
    document.getElementById("remote-videos")?.appendChild(audioContainer);

    // Listen for microphone unmuted event
    socket.on("microphone-unmuted", (unmutedUserId) => {
      console.log("microphone-unmuted");
      updateMuteIcon(unmutedUserId, false);
    });
  };

  const updateMuteIcon = (userId: string, muted: boolean) => {
    const audioContainer = remoteVideoRefs.current[userId];
    if (audioContainer) {
      const muteIcon = audioContainer.querySelector(".mute-icon");
      if (muteIcon) {
        muteIcon.innerHTML = muted
          ? '<i class="fa fa-microphone-slash" aria-hidden="true"></i>'
          : '<i class="fa fa-microphone" aria-hidden="true"></i>';
      }
      const muteButton = audioContainer.querySelector(
        ".mute-button"
      ) as HTMLButtonElement;
      if (muteButton) {
        muteButton.innerText = muted ? "Unmute" : "Mute";
      }
    }
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
    setUsers((prevUsers) => prevUsers.filter((user) => user.id !== socketId));
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
    try {
      const response = await fetch("http://localhost:8080/api/whisper");
      const whisperArrayBuffer = await response.arrayBuffer();

      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const [whisperAudioBuffer, mainAudioBuffer] = await Promise.all([
        audioContext.decodeAudioData(whisperArrayBuffer),
        audioContext.decodeAudioData(arrayBuffer),
      ]);

      const whisperSource = audioContext.createBufferSource();
      whisperSource.buffer = whisperAudioBuffer;
      whisperSource.connect(audioContext.destination);

      const mainSource = audioContext.createBufferSource();
      mainSource.buffer = mainAudioBuffer;
      mainSource.connect(audioContext.destination);

      whisperSource.start();
      const whisperDuration = whisperAudioBuffer.duration;
      mainSource.start(audioContext.currentTime + whisperDuration);
    } catch (error) {
      console.error("Error playing audio.", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-gray-900 to-gray-800 py-10 text-gray-100 grid grid-cols-1 lg:grid-cols-3 gap-8">
      <header className="col-span-1 lg:col-span-3 mb-6 text-center">
        <h1 className="text-5xl font-extrabold text-indigo-400">TS3 Clone</h1>
      </header>

      {joinedRoom ? (
        <div className="col-span-2 flex flex-col h-full space-y-6">
          <div className="flex-grow bg-gray-800 p-4 rounded-lg shadow-md overflow-y-auto">
            <div
              id="remote-videos"
              className="flex flex-col space-y-4 max-w-md w-full"
            />
          </div>
        </div>
      ) : (
        <div className="col-span-1 lg:col-span-3 flex justify-center items-center">
          <div className="space-y-8 w-full max-w-md flex flex-col items-center">
            <button
              onClick={createRoom}
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg shadow-lg hover:bg-indigo-700 transition-transform transform hover:scale-105"
            >
              Create Room
            </button>
            <input
              type="text"
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-600 rounded-lg shadow-sm focus:outline-none focus:border-indigo-500 bg-gray-700 text-gray-100"
            />
            <button
              onClick={() => joinRoom(roomId)}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg shadow-lg hover:bg-green-700 transition-transform transform hover:scale-105"
            >
              Join Room
            </button>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="form-checkbox h-5 w-5 text-indigo-600"
              />
              <span className="text-gray-300">Join as Admin</span>
            </label>
          </div>
        </div>
      )}

      <div
        className={`space-y-8 w-full max-w-md ${
          joinedRoom ? "col-span-1" : "col-span-1 lg:col-span-3"
        } flex flex-col h-full`}
      >
        {joinedRoom && (
          <>
            <div className="text-lg font-bold text-gray-100">
              Current Room: {roomId}
            </div>
          </>
        )}

        {joinedRoom && isAdmin && (
          <>
            <input
              type="text"
              placeholder="Whisper Room ID (Optional)"
              value={whisperRoomId}
              onChange={(e) => setWhisperRoomId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-600 rounded-lg shadow-sm focus:outline-none focus:border-indigo-500 bg-gray-700 text-gray-100"
            />
            <button
              onMouseDown={handleWhisperStart}
              onMouseUp={handleWhisperStop}
              className="w-full px-6 py-3 bg-yellow-600 text-white rounded-lg shadow-lg hover:bg-yellow-700 transition-transform transform hover:scale-105"
            >
              Whisper
            </button>
          </>
        )}

        {joinedRoom && (
          <div className="flex-grow bg-gray-800 p-6 border border-gray-600 rounded-lg shadow-sm overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-gray-100">
              Available Rooms
            </h2>
            {rooms.length > 0 ? (
              rooms.map((room) => (
                <div key={room.id} className="mb-4">
                  <div className="font-semibold text-gray-200">{room.id}</div>
                  <button
                    onClick={() => joinRoom(room.id)}
                    className="text-indigo-400 hover:underline"
                  >
                    Join Room
                  </button>
                  <ul className="pl-4">
                    {room.users.map((user) => (
                      <li key={user} className="text-gray-400">
                        {user}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="text-gray-400">No rooms available.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
