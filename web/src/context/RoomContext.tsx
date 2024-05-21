import Peer from "peerjs";
import { createContext, useEffect, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import socketIOClient from "socket.io-client";
import { v4 } from "uuid";
import { peerReducer } from "./peerReducer";
import { addPeerAction, removePeerAction } from "./peerActions";
const WS = "http://localhost:8080";

export const RoomContext = createContext<null | any>(null);

const ws = socketIOClient(WS);

export const RoomProvider: React.FC<{ children: any }> = ({ children }) => {
  const navigate = useNavigate();
  const [me, setMe] = useState<Peer>();
  const [stream, setStream] = useState<MediaStream>();
  const [peers, dispatch] = useReducer(peerReducer, {});

  const enterRoom = ({ roomId }: { roomId: string }) => {
    navigate(`/room/${roomId}`);
  };

  const getUsers = ({ roomId, users }: { roomId: string; users: string[] }) => {
    console.log({ roomId, users });
  };

  const removeUser = (peerId: string) => {
    dispatch(removePeerAction(peerId));
  };
  useEffect(() => {
    const peer = new Peer(v4(), {
      host: "localhost",
      port: 9000,
      path: "/myapp",
    });
    setMe(peer);

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then(setStream)
      .catch((error) => {
        console.error("Error obtaining media stream: ", error);
        alert(
          "Failed to access camera and microphone. Please check permissions."
        );
      });
    ws.on("room-created", enterRoom);
    ws.on("get-users", getUsers);
    ws.on("user-disconnected", removeUser);
    return () => {
      ws.off("room-created", enterRoom);
      ws.off("get-users", getUsers);
      ws.off("user-disconnected", removeUser);
    };
  }, []);

  useEffect(() => {
    if (!stream || !me) return;

    ws.on("user-joined", ({ peerId }) => {
      const call = me.call(peerId, stream);
      call.on("stream", (peerStream) => {
        dispatch(addPeerAction(peerId, peerStream));
      });
    });

    me.on("call", (call) => {
      call.answer(stream);
      call.on("stream", (peerStream) => {
        dispatch(addPeerAction(call.peer, peerStream));
      });
    });

    return () => {
      ws.off("user-joined");
      me.off("call");
    };
  }, [me, stream, ws]);
  return (
    <RoomContext.Provider value={{ ws, me, stream, peers }}>
      {children}
    </RoomContext.Provider>
  );
};
