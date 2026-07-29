// js/room.js

// 1. Import Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Import our modular functions
import { getLocalStream, toggleAudio, stopStream } from "./media.js";
import { createPeerConnection, addLocalTracks } from "./webrtc.js";

// 2. Initialize Supabase Client
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3. DOM Elements Mapping
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const standardSelect = document.getElementById("standard-select");
const startBtn = document.getElementById("start-btn");
const muteBtn = document.getElementById("mute-btn");
const endBtn = document.getElementById("end-btn");
const notesTextarea = document.getElementById("notes-textarea");
const saveNotesBtn = document.getElementById("save-notes");

// 4. Application State Variables
let localStream = null;
let peerConnection = null;
let isMuted = false;
let myUserId = null;
let currentRoomId = null;

// 5. Start Call & Matchmaking Logic
startBtn.addEventListener("click", async () => {
  const selectedStandard = parseInt(standardSelect.value);
  
  // Update UI to show loading state
  startBtn.disabled = true;
  startBtn.textContent = "Connecting...";

  try {
    // Request camera and microphone access
    localStream = await getLocalStream();
    localVideo.srcObject = localStream;

    // Initialize the WebRTC Peer Connection
    peerConnection = createPeerConnection(
      async (candidate) => {
        // Send ICE candidate to Supabase Database
        if (currentRoomId && candidate) {
          await supabase.from('candidates').insert([{ 
            room_id: currentRoomId, 
            is_caller: myUserId === currentRoomId.caller_id, // We will track this below
            candidate: candidate 
          }]);
        }
      },
      (remoteStream) => {
        // When the other student's video arrives, attach it to the large video tag
        remoteVideo.srcObject = remoteStream;
      }
    );

    // Attach local hardware tracks to the connection
    addLocalTracks(peerConnection, localStream);

    // ==========================================
    // SUPABASE DATABASE LOGIC
    // ==========================================
    startBtn.textContent = "Searching for peer...";
    
    // 1. Insert user into 'users' table
    const { data: user } = await supabase
      .from('users')
      .insert([{ standard: selectedStandard, status: 'searching' }])
      .select()
      .single();
      
    myUserId = user.id;

    // 2. Query for a match
    const { data: match } = await supabase
      .from('users')
      .select('*')
      .eq('standard', selectedStandard)
      .eq('status', 'searching')
      .neq('id', myUserId)
      .limit(1)
      .single();

    if (match) {
      // --- I AM THE CALLER ---
      startBtn.textContent = "Connecting (Caller)...";
      
      // Update statuses to matched
      await supabase.from('users').update({ status: 'matched' }).in('id', [myUserId, match.id]);

      // Create the room
      const { data: room } = await supabase
        .from('rooms')
        .insert([{ user_a: myUserId, user_b: match.id }])
        .select()
        .single();
        
      currentRoomId = room.id;
      currentRoomId.caller_id = myUserId; // Tag for ICE candidates

      // Create WebRTC Offer and save to DB
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await supabase.from('rooms').update({ offer: offer }).eq('id', currentRoomId);

      // Listen for the Answer from the Callee
      supabase.channel('caller_room').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${currentRoomId}` }, 
        (payload) => {
          if (payload.new.answer && !peerConnection.currentRemoteDescription) {
            peerConnection.setRemoteDescription(new RTCSessionDescription(payload.new.answer));
            startBtn.textContent = "Connected!";
          }
        }
      ).subscribe();

      // Listen for Callee's ICE Candidates
      supabase.channel('caller_candidates').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter: `room_id=eq.${currentRoomId}` }, 
        (payload) => {
          if (payload.new.is_caller === false) { 
            peerConnection.addIceCandidate(new RTCIceCandidate(payload.new.candidate));
          }
        }
      ).subscribe();

    } else {
      // --- I AM THE CALLEE ---
      startBtn.textContent = "Waiting for someone to join...";

      // Listen for a room to be created where I am user_b
      supabase.channel('callee_wait').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms', filter: `user_b=eq.${myUserId}` }, 
        async (payload) => {
          startBtn.textContent = "Connecting (Callee)...";
          currentRoomId = payload.new.id;
          currentRoomId.caller_id = payload.new.user_a; 
          const offer = payload.new.offer;

          // Accept Offer, Create Answer, and save to DB
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await supabase.from('rooms').update({ answer: answer }).eq('id', currentRoomId);
          
          startBtn.textContent = "Connected!";

          // Listen for Caller's ICE Candidates
          supabase.channel('callee_candidates').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter: `room_id=eq.${currentRoomId}` }, 
            (payload) => {
              if (payload.new.is_caller === true) { 
                peerConnection.addIceCandidate(new RTCIceCandidate(payload.new.candidate));
              }
            }
          ).subscribe();
        }
      ).subscribe();
    }

  } catch (error) {
    console.error("Failed to access media devices or database:", error);
    startBtn.disabled = false;
    startBtn.textContent = "Start Call";
    alert("An error occurred. Please ensure permissions are granted and keys are correct.");
  }
});

// 6. Mute Microphone Logic
muteBtn.addEventListener("click", () => {
  // Prevent muting if the stream hasn't started yet
  if (!localStream) return;
  
  isMuted = !isMuted;
  toggleAudio(localStream, isMuted);
  
  // Update button text visually
  muteBtn.textContent = isMuted ? "Unmute Mic" : "Mute Mic";
  muteBtn.classList.toggle("btn-danger", isMuted);
});

// 7. End Call & Cleanup Logic
endBtn.addEventListener("click", () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  stopStream(localStream);
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  startBtn.disabled = false;
  startBtn.textContent = "Start Call";
  muteBtn.textContent = "Mute Mic";
  muteBtn.classList.remove("btn-danger");
  isMuted = false;
  currentRoomId = null;
});

// 8. Local Storage Notes Logic (Bonus Feature)
window.addEventListener("DOMContentLoaded", () => {
  const savedNotes = localStorage.getItem("getwise_notes");
  if (savedNotes) {
    notesTextarea.value = savedNotes;
  }
});

saveNotesBtn.addEventListener("click" , () => {
  const currentNotes = notesTextarea.value;
  localStorage.setItem("getwise_notes", currentNotes);
  
  const originalText = saveNotesBtn.textContent;
  saveNotesBtn.textContent = "SAVED!";
  saveNotesBtn.style.backgroundColor = "#22c55e"; 
  
  setTimeout(() => {
    saveNotesBtn.textContent = originalText;
    saveNotesBtn.style.backgroundColor = "";
  }, 2000);
});