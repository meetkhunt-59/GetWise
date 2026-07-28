/**
 * @returns {Promise<MediaStream>}
 */
export async function getLocalStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    return stream;
  } catch (error) {
    console.error("Error accessing camera/microphone:", error);
    alert("Camera and Microphone permissions are required to start video chat.");
    throw error;
  }
}

/**
 * Mutes or unmutes the local microphone.
 * @param {MediaStream} stream 
 * @param {boolean} isMuted 
 */
export function toggleAudio(stream, isMuted) {
  if (stream) {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }
}

/**
 * Stops all tracks (camera and mic) when the call ends.
 * @param {MediaStream} stream 
 */
export function stopStream(stream) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}