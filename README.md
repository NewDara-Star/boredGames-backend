# boredGames Backend

The Node.js/Socket.io backend server for boredGames.

## Features

- **Real-time Communication**: Socket.io for instant game updates
- **Matchmaking System**: Pairs players looking for the same game
- **Game Logic**: Server-side validation for Tic-Tac-Toe and RPS
- **WebRTC Signaling**: Relays voice chat signals between peers

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

   The server runs on port 3001 by default.

## Events

- `find-match`: Request matchmaking
- `make-move`: Tic-Tac-Toe move
- `rps-make-choice`: RPS choice
- `voice-signal`: WebRTC signaling data
