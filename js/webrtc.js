// Public STUN servers provided by Google to discover public IP addresses
const rtcConfiguration = {
  iceServers: [
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

/**
 * Creates and configures a new WebRTC Peer Connection.
 * @param {Function} onIceCandidate - Callback when a local network candidate is found
 * @param {Function} onRemoteTrack - Callback when the remote peer's video stream arrives
 * @returns {RTCPeerConnection}
 */
export function createPeerConnection(onIceCandidate, onRemoteTrack) {
  const pc = new RTCPeerConnection(rtcConfiguration);

  // Triggered when the browser finds an ICE candidate (network route)
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
    }
  };

  // Triggered when incoming video/audio tracks arrive from the peer
  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      onRemoteTrack(event.streams[0]);
    }
  };

  return pc;
}

/**
 * Adds the local video/audio tracks to the WebRTC connection.
 */
export function addLocalTracks(pc, localStream) {
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });
}

/**
 * Creates an SDP Offer (Called by User A)
 */
export async function createOffer(pc) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return offer;
}

/**
 * Receives an Offer and Creates an SDP Answer (Called by User B)
 */
export async function handleOfferAndCreateAnswer(pc, offer) {
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return answer;
}

/**
 * Sets the Remote Answer on the caller's peer connection (Called by User A)
 */
export async function handleAnswer(pc, answer) {
  if (!pc.currentRemoteDescription) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

/**
 * Adds a received ICE Candidate from the signalling database to the peer connection.
 */
export async function addIceCandidate(pc, candidate) {
  if (candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}