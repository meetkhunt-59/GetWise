// js/room.js

// 1. Import Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Import our modular functions
import { getLocalStream, toggleAudio, stopStream } from "./media.js";
import { createPeerConnection, addLocalTracks } from "./webrtc.js";

// 2. Initialize Supabase Client
const SUPABASE_URL = 'https://nlwzzgdpmuworvcblisw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sd3p6Z2RwbXV3b3J2Y2JsaXN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNDA2NzAsImV4cCI6MjEwMDkxNjY3MH0.do204MUbBxe90__5ssN2v5qFNYgRs4c1cb6xh30wRVw';
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
let isCaller = false; 

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
            is_caller: isCaller,
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
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert([{ standard: selectedStandard, status: 'searching' }])
      .select()
      .single();

    // If Supabase blocks the insert, stop the code and show the error
    if (insertError) {
      console.error("Supabase Insert Error:", insertError);
      alert("Database Error: " + insertError.message);
      startBtn.disabled = false;
      startBtn.textContent = "Start Call";
      return; 
    }
      
    myUserId = user.id;

    // 2. Query for a match
    const { data: match } = await supabase
      .from('users')
      .select('*')
      .eq('standard', selectedStandard)
      .eq('status', 'searching')
      .neq('id', myUserId)
      .limit(1)
      .maybeSingle();

    if (match) {
      // --- I AM THE CALLER ---
      startBtn.textContent = "Connecting (Caller)...";
      
      // Update statuses to matched
      await supabase.from('users').update({ status: 'matched' }).in('id', [myUserId, match.id]);
      
      isCaller = true;

      // Create WebRTC Offer
      const offer = await peerConnection.createOffer();
      // DO NOT setLocalDescription here yet! Wait for currentRoomId.

      const { data: room } = await supabase
        .from('rooms')
        .insert([{ user_a: myUserId, user_b: match.id, offer: offer }])
        .select()
        .maybeSingle();
        
      currentRoomId = room.id;

      // NOW set local description so ICE candidates start gathering with the room ID ready
      await peerConnection.setLocalDescription(offer);

      let callerCandidateQueue = [];

      // Listen for Callee's ICE Candidates (Live) FIRST to avoid missing early candidates
      supabase.channel('caller_candidates').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter: `room_id=eq.${currentRoomId}` }, 
        async (payload) => {
          if (payload.new.is_caller === false) { 
            if (peerConnection.currentRemoteDescription) {
              try { await peerConnection.addIceCandidate(new RTCIceCandidate(payload.new.candidate)); } catch(e) {}
            } else {
              callerCandidateQueue.push(payload.new.candidate);
            }
          }
        }
      ).subscribe();

      // Listen for the Answer from the Callee
      supabase.channel('caller_room').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${currentRoomId}` }, 
        async (payload) => {
          if (payload.new.answer && !peerConnection.currentRemoteDescription) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.new.answer));
            startBtn.textContent = "Connected!";
            
            // Fetch any ICE candidates the callee sent before we got the answer
            const { data: candidates } = await supabase.from('candidates').select('*').eq('room_id', currentRoomId).eq('is_caller', false);
            if (candidates) {
                for (let c of candidates) {
                    try { await peerConnection.addIceCandidate(new RTCIceCandidate(c.candidate)); } catch(e) {}
                }
            }

            // Process any live candidates that arrived while we were waiting for the answer
            for (let c of callerCandidateQueue) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
            }
            callerCandidateQueue = [];
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
          isCaller = false;
          const offer = payload.new.offer;

          let calleeCandidateQueue = [];

          // Listen for Caller's ICE Candidates (Live) FIRST to prevent missing candidates during setup
          supabase.channel('callee_candidates').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter: `room_id=eq.${currentRoomId}` }, 
            async (payload) => {
              if (payload.new.is_caller === true) { 
                if (peerConnection.currentRemoteDescription) {
                  try { await peerConnection.addIceCandidate(new RTCIceCandidate(payload.new.candidate)); } catch(e) {}
                } else {
                  calleeCandidateQueue.push(payload.new.candidate);
                }
              }
            }
          ).subscribe();

          // Accept Offer and set remote description
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          
          // Fetch any ICE candidates the caller sent before we were notified
          const { data: candidates } = await supabase.from('candidates').select('*').eq('room_id', currentRoomId).eq('is_caller', true);
          if (candidates) {
              for (let c of candidates) {
                  try { await peerConnection.addIceCandidate(new RTCIceCandidate(c.candidate)); } catch(e) {}
              }
          }

          // Process queued candidates that arrived during the few milliseconds of setup
          for (let c of calleeCandidateQueue) {
              try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
          }
          calleeCandidateQueue = [];

          // Create Answer, start ICE gathering, and save to DB
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await supabase.from('rooms').update({ answer: answer }).eq('id', currentRoomId);
          
          startBtn.textContent = "Connected!";
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