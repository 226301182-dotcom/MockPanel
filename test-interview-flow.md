# MockPanel Interview Room - Test Checklist

## ✅ Pre-flight Checks
- [ ] Backend running on http://localhost:8000
- [ ] Frontend running on http://localhost:3000
- [ ] Environment variables loaded (Deepgram, Gemini, etc.)

## 🎯 Dashboard Test
1. Go to http://localhost:3000/dashboard
2. Fill form:
   - Domain: SDE (should show HR Manager + Technical Lead)
   - Name: Test User
   - Duration: 20 minutes
   - Difficulty: Moderate
   - Language: English
3. Click "Start Interview"
4. Should redirect to /interview/[session_id]

## 🎭 Interview Room Tests

### Domain-Specific Panels
- [ ] SDE: Shows 2 panelists (HR Manager, Technical Lead) with blue accent
- [ ] UPSC: Shows 3 panelists with gold accent
- [ ] PSU: Shows 2 panelists with green accent

### WebSocket Events Test
Open browser console (F12) and watch for:
- [ ] `speaker_change` events
- [ ] `ai_text_chunk` events (AI speaking)
- [ ] `transcript_final` events (user speech)
- [ ] `thinking` events

### Mobile Responsive Test (Browser width < 768px)
- [ ] Panel grid hidden on mobile
- [ ] Single active speaker shown
- [ ] "Preparing next question..." placeholder when no active speaker
- [ ] PiP size: 110x66px, position: bottom-90px right-12px
- [ ] Question sidebar hidden, replaced by "Question" button
- [ ] Question button opens bottom sheet

### View Mode Toggle
- [ ] "Switch View" button in control dock
- [ ] Panel View: Interviewers full screen, user PiP small
- [ ] Candidate View: User camera large, interviewers compressed/hidden
- [ ] Smooth transitions (0.4s ease)

### Notes Panel
- [ ] "Notes" button in control dock
- [ ] Left drawer slides in (300px wide)
- [ ] Textarea saves to localStorage
- [ ] Clear button works
- [ ] Notes persist on page refresh

### Captions Bar
- [ ] Shows "AI Speaking" in gold during AI responses
- [ ] Shows "You (Live)" in green during user speech
- [ ] Clears on speaker changes
- [ ] No typewriter effects - real WebSocket data only

### Active Speaker Focus
- [ ] Active speaker: full opacity, highlighted border
- [ ] Inactive speakers: opacity-45, dimmed borders
- [ ] Smooth transitions (0.35s ease)

### Control Dock
- [ ] Mic toggle (green/red)
- [ ] Camera toggle (blue/gray)
- [ ] Captions toggle (gold/gray)
- [ ] Question panel toggle
- [ ] Switch view button
- [ ] Notes button
- [ ] Interrupt button

## 🚀 Expected WebSocket Flow
1. Connect to `ws://localhost:8002/ws/v1/interview/{session_id}`
2. Receive first `question` event
3. User speaks → `transcript_final` → AI thinks → `thinking` → `ai_text_chunk` → `response_complete`
4. `speaker_change` events control who appears to be speaking

## 🔍 Debug Console Commands
```javascript
// Check WebSocket connection
ws = new WebSocket('ws://localhost:8002/ws/v1/interview/YOUR_SESSION_ID');

// Send test audio
ws.send(JSON.stringify({type: "audio", data: "base64_audio_data"}));

// Check session data
fetch('http://localhost:8000/api/v1/sessions/YOUR_SESSION_ID').then(r=>r.json()).then(console.log);
```

## 📱 Mobile Browser Test
- Test on Chrome DevTools mobile view
- Test on actual mobile device if possible
- Verify touch interactions and responsive behavior

## ✅ Success Criteria
- [ ] No "Starting..." hang issue
- [ ] Correct domain panel shows
- [ ] Mobile experience works properly
- [ ] All WebSocket events handled correctly
- [ ] Notes persist and work
- [ ] View switching works smoothly
- [ ] Captions reflect real conversation
