// js/room.js

// Import our modular functions
import { getLocalStream, toggleAudio, stopStream } from "./media.js";
import { createPeerConnection, addLocalTracks } from "./webrtc.js";

// 1. DOM Elements Mapping
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const standardSelect = document.getElementById("standard-select");
const startBtn = document.getElementById("start-btn");
const muteBtn = document.getElementById("mute-btn");
const endBtn = document.getElementById("end-btn");
const notesTextarea = document.getElementById("notes-textarea");
const saveNotesBtn = document.getElementById("save-notes");

// 2. Application State Variables
let localStream = null;
let peerConnection = null;
let isMuted = false;

// 3. Start Call & Matchmaking Logic
startBtn.addEventListener("click", async () => {
  const selectedStandard = standardSelect.value;
  
  // Update UI to show loading state
  startBtn.disabled = true;
  startBtn.textContent = "Connecting...";

  try {
    // Request camera and microphone access
    localStream = await getLocalStream();
    localVideo.srcObject = localStream;

    // Initialize the WebRTC Peer Connection
    peerConnection = createPeerConnection(
      (candidate) => {
        // TODO: Send this ICE candidate to your Supabase Database
        console.log("Generated ICE Candidate to send via Supabase:", candidate);
      },
      (remoteStream) => {
        // When the other student's video arrives, attach it to the large video tag
        remoteVideo.srcObject = remoteStream;
      }
    );

    // Attach local hardware tracks to the connection
    addLocalTracks(peerConnection, localStream);

    // ==========================================
    // SUPABASE DATABASE LOGIC WILL GO HERE
    // 1. Insert user into 'users' table with selectedStandard
    // 2. Query for a match
    // 3. Call createOffer() or handleOfferAndCreateAnswer() 
    // ==========================================

    startBtn.textContent = "Connected";
  } catch (error) {
    console.error("Failed to access media devices:", error);
    startBtn.disabled = false;
    startBtn.textContent = "Start Call";
    alert("Please allow camera and microphone permissions to brainstorm.");
  }
});

// 4. Mute Microphone Logic
muteBtn.addEventListener("click", () => {
  // Prevent muting if the stream hasn't started yet
  if (!localStream) return;
  
  isMuted = !isMuted;
  toggleAudio(localStream, isMuted);
  
  // Update button text visually
  muteBtn.textContent = isMuted ? "Unmute Mic" : "Mute Mic";
  
  // Optional: Add a CSS class so you can style the button red when muted
  muteBtn.classList.toggle("btn-danger", isMuted);
});

// 5. End Call & Cleanup Logic
endBtn.addEventListener("click", () => {
  // Close the WebRTC connection safely
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  // Shut down the camera light and audio tracks
  stopStream(localStream);
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  // Reset the UI buttons
  startBtn.disabled = false;
  startBtn.textContent = "Start Call";
  muteBtn.textContent = "Mute Mic";
  muteBtn.classList.remove("btn-danger");
  isMuted = false;
});

// 6. Local Storage Notes Logic (Bonus Feature)
// When the page loads, check if the student has saved notes from a previous session
window.addEventListener("DOMContentLoaded", () => {
  const savedNotes = localStorage.getItem("getwise_notes");
  if (savedNotes) {
    notesTextarea.value = savedNotes;
  }
});

// Save notes to the browser's memory when the button is clicked
saveNotesBtn.addEventListener("click", () => {
  const currentNotes = notesTextarea.value;
  localStorage.setItem("getwise_notes", currentNotes);
  
  // Provide temporary visual feedback that the save was successful
  const originalText = saveNotesBtn.textContent;
  saveNotesBtn.textContent = "SAVED!";
  saveNotesBtn.style.backgroundColor = "#22c55e"; // Green color
  
  setTimeout(() => {
    saveNotesBtn.textContent = originalText;
    saveNotesBtn.style.backgroundColor = ""; // Revert to original CSS
  }, 2000);
});