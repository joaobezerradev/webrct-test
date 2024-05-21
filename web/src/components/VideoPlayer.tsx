import React, { useEffect } from "react";

interface VideoPlayerProps {
  stream: MediaStream;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ stream }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline muted />;
};
