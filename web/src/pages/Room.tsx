import { useContext, useEffect } from "react";
import { useParams } from "react-router-dom";
import { RoomContext } from "../context/RoomContext";
import { VideoPlayer } from "../components/VideoPlayer";
import { PeerState } from "../context/peerReducer";

export const Room: React.FC = () => {
  const { id } = useParams();
  const { ws, me, stream, peers } = useContext(RoomContext);

  useEffect(() => {
    if (me) ws.emit("join-room", { roomId: id, peerId: me._id });
  }, [id, me, ws]);
  return (
    <>
      Room ID {id}
      <div className="grid grid-cols-4 gap-4">
        <VideoPlayer stream={stream} />
        {Object.values(peers as PeerState).map((peer: any, index) => (
          <VideoPlayer stream={peer.stream} key={index} />
        ))}
      </div>
    </>
  );
};
