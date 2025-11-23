import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { matchmakingManager } from './matchmaking.js';
import { TicTacToeGame } from './games/ticTacToe.js';
import { RockPaperScissorsGame } from './games/rockPaperScissors.js';
import { LudoGame } from './games/ludo.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_this_in_production';

const app = express();
const httpServer = createServer(app);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());

// Auth Routes
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Username already taken' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '24h' });
      res.json({
        token,
        user: { id: this.lastID, username, wins_ttt: 0, losses_ttt: 0, wins_rps: 0, losses_rps: 0 }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        wins_ttt: user.wins_ttt,
        losses_ttt: user.losses_ttt,
        wins_rps: user.wins_rps,
        losses_rps: user.losses_rps
      }
    });
  });
});

app.get('/api/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });

    db.get(`SELECT id, username, wins_ttt, losses_ttt, wins_rps, losses_rps FROM users WHERE id = ?`, [user.id], (err, dbUser) => {
      if (err || !dbUser) return res.status(404).json({ error: 'User not found' });
      res.json({ user: dbUser });
    });
  });
});

// Socket.io server
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Socket Auth Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return next(); // Allow guest if token invalid (or handle error)
      socket.user = decoded;
      next();
    });
  } else {
    next();
  }
});

// Store active games
const activeGames = new Map();

// AI Turn Processor
function processAITurn(io, roomId, game) {
  const currentPlayerId = game.players[game.currentTurn];
  if (!currentPlayerId || !currentPlayerId.startsWith('AI-')) return;

  console.log(`[LUDO] AI Turn: ${currentPlayerId}`);

  setTimeout(() => {
    // 1. Roll Dice
    const result = game.rollDice();
    const validMoves = game.getValidMoves(currentPlayerId);

    io.to(roomId).emit('ludo-dice-rolled', {
      diceValue: result.diceValue,
      currentPlayer: currentPlayerId,
      validMoves: [] // AI moves aren't clickable by humans
    });

    setTimeout(() => {
      if (validMoves.length > 0) {
        // 2. Move Piece (Randomly pick one)
        const pieceIndex = validMoves[Math.floor(Math.random() * validMoves.length)];
        const moveResult = game.movePiece(currentPlayerId, pieceIndex);

        io.to(roomId).emit('ludo-piece-moved', {
          tokens: moveResult.tokens,
          currentTurn: moveResult.currentTurn,
          nextPlayer: moveResult.nextPlayer,
          gameOver: moveResult.gameOver,
          winner: moveResult.winner
        });

        if (!moveResult.gameOver) {
          processAITurn(io, roomId, game);
        }
      } else {
        // 3. Skip Turn
        game.skipTurn();
        const gameState = game.getState();

        io.to(roomId).emit('ludo-piece-moved', {
          tokens: gameState.tokens,
          currentTurn: gameState.currentTurn,
          nextPlayer: gameState.currentPlayer,
          gameOver: false,
          skipped: true
        });

        processAITurn(io, roomId, game);
      }
    }, 1500);
  }, 1000);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeConnections: io.engine.clientsCount,
    activeGames: activeGames.size
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle matchmaking
  socket.on('find-match', ({ gameType, difficulty }) => {
    console.log(`${socket.id} looking for ${gameType} match`);

    if (gameType === 'tic-tac-toe') {
      matchmakingManager.addToQueue(socket, gameType, difficulty);

      // Try to match players
      const match = matchmakingManager.findMatch(gameType);

      if (match) {
        const { player1, player2 } = match;
        const roomId = `${gameType}-${Date.now()}`;

        // Create game instance
        const game = new TicTacToeGame(roomId, player1.id, player2.id);
        activeGames.set(roomId, game);

        // Join both players to room
        player1.join(roomId);
        player2.join(roomId);

        // Notify both players
        player1.emit('match-found', {
          roomId,
          opponent: player2.id,
          playerSymbol: 'X',
          yourTurn: true
        });

        player2.emit('match-found', {
          roomId,
          opponent: player1.id,
          playerSymbol: 'O',
          yourTurn: false
        });

        console.log(`Match created: ${roomId}`);
      } else {
        socket.emit('searching', { message: 'Looking for opponent...' });
      }
    } else if (gameType === 'rock-paper-scissors') {
      matchmakingManager.addToQueue(socket, gameType);

      // Try to match players
      const match = matchmakingManager.findMatch(gameType);

      if (match) {
        const { player1, player2 } = match;
        const roomId = `${gameType}-${Date.now()}`;

        // Create game instance
        const game = new RockPaperScissorsGame(roomId, player1.id, player2.id);
        activeGames.set(roomId, game);

        // Join both players to room
        player1.join(roomId);
        player2.join(roomId);

        // Notify both players
        player1.emit('match-found', {
          roomId,
          opponent: player2.id,
          gameType: 'rock-paper-scissors'
        });

        player2.emit('match-found', {
          roomId,
          opponent: player1.id,
          gameType: 'rock-paper-scissors'
        });

        console.log(`RPS Match created: ${roomId}`);
      } else {
        socket.emit('searching', { message: 'Looking for opponent...' });
      }
    } else if (gameType === 'ludo') {
      const playerCount = difficulty || 2; // Use difficulty field for player count
      matchmakingManager.addToQueue(socket, gameType, playerCount);

      // Try to match players
      const match = matchmakingManager.findMatch(gameType, playerCount);

      if (match) {
        const players = match.players;
        const roomId = `${gameType}-${Date.now()}`;
        const playerIds = players.map(p => p.id);

        // Create game instance
        const game = new LudoGame(roomId, playerIds);
        activeGames.set(roomId, game);

        // Join all players to room
        players.forEach(player => player.join(roomId));

        // Notify all players with their colors
        const gameState = game.getState();
        players.forEach(player => {
          player.emit('match-found', {
            roomId,
            gameType: 'ludo',
            gameState,
            yourColor: game.tokens[player.id].color,
            playerCount: playerIds.length
          });
        });

        console.log(`Ludo Match created: ${roomId} with ${playerIds.length} players`);
      } else {
        socket.emit('searching', { message: 'Looking for opponents...' });
      }
    }
  });

  // Handle private room creation for Ludo
  socket.on('ludo-create-room', ({ playerCount }) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomId = `ludo-private-${roomCode}`;

    socket.join(roomId);

    // Store room metadata
    if (!activeGames.has(roomId)) {
      activeGames.set(roomId, {
        type: 'ludo-lobby',
        roomCode,
        host: socket.id,
        maxPlayers: playerCount || 4,
        players: [socket.id],
        ready: false
      });
    }

    socket.emit('ludo-room-created', {
      roomId,
      roomCode,
      maxPlayers: playerCount || 4
    });

    console.log(`Ludo private room created: ${roomCode} by ${socket.id}`);
  });

  // Handle joining Ludo private room
  socket.on('ludo-join-room', ({ roomCode }) => {
    const roomId = `ludo-private-${roomCode.toUpperCase()}`;
    const lobby = activeGames.get(roomId);

    if (!lobby || lobby.type !== 'ludo-lobby') {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (lobby.players.length >= lobby.maxPlayers) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    socket.join(roomId);
    lobby.players.push(socket.id);

    // Notify all players in room
    io.to(roomId).emit('ludo-player-joined', {
      roomId,
      roomCode,
      players: lobby.players,
      maxPlayers: lobby.maxPlayers,
      host: lobby.host
    });

    console.log(`${socket.id} joined Ludo room ${roomCode}`);
  });

  // Handle starting Ludo private game
  socket.on('ludo-start-game', ({ roomId, fillWithAI }) => {
    const lobby = activeGames.get(roomId);

    if (!lobby || lobby.type !== 'ludo-lobby') {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (lobby.host !== socket.id) {
      socket.emit('error', { message: 'Only host can start the game' });
      return;
    }

    let playerIds = [...lobby.players];

    // Fill with AI if requested
    if (fillWithAI && playerIds.length < lobby.maxPlayers) {
      const aiCount = lobby.maxPlayers - playerIds.length;
      for (let i = 0; i < aiCount; i++) {
        playerIds.push(`AI-${i + 1}`);
      }
    }

    // Create game instance
    const game = new LudoGame(roomId, playerIds);
    activeGames.set(roomId, game);

    // Notify all players
    const gameState = game.getState();
    lobby.players.forEach(playerId => {
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        playerSocket.emit('ludo-game-started', {
          roomId,
          gameState,
          yourColor: game.tokens[playerId].color,
          playerCount: playerIds.length,
          aiPlayers: playerIds.filter(id => id.startsWith('AI-'))
        });
      }
    });

    console.log(`Ludo game started in room ${roomId} with ${playerIds.length} players`);

    // Check if first player is AI
    processAITurn(io, roomId, game);
  });

  // Handle private room creation (legacy for TTT)
  socket.on('create-room', ({ gameType }) => {
    const roomId = `${gameType}-private-${Date.now()}`;
    socket.join(roomId);

    socket.emit('room-created', { roomId });
    console.log(`Private room created: ${roomId}`);
  });

  // Handle joining private room
  socket.on('join-room', ({ roomId }) => {
    const room = io.sockets.adapter.rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.size >= 2) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    socket.join(roomId);

    // Get the other player
    const players = Array.from(room);
    const otherPlayerId = players.find(id => id !== socket.id);

    // Create game instance
    const game = new TicTacToeGame(roomId, otherPlayerId, socket.id);
    activeGames.set(roomId, game);

    // Notify both players
    io.to(otherPlayerId).emit('opponent-joined', {
      roomId,
      opponent: socket.id,
      playerSymbol: 'X',
      yourTurn: true
    });

    socket.emit('opponent-joined', {
      roomId,
      opponent: otherPlayerId,
      playerSymbol: 'O',
      yourTurn: false
    });

    console.log(`Player joined room: ${roomId}`);
  });

  // Handle game moves
  socket.on('make-move', ({ roomId, position }) => {
    const game = activeGames.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    const result = game.makeMove(socket.id, position);

    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Broadcast move to both players
    io.to(roomId).emit('move-made', {
      position,
      player: socket.id,
      board: game.board,
      currentPlayer: game.currentPlayer,
      gameOver: result.gameOver,
      winner: result.winner,
      winningLine: result.winningLine
    });

    // Clean up finished games
    if (result.gameOver) {
      const p1Socket = io.sockets.sockets.get(game.player1);
      const p2Socket = io.sockets.sockets.get(game.player2);

      if (result.winner) {
        // Winner updates
        if (p1Socket?.user && result.winner === game.player1) {
          db.run('UPDATE users SET wins_ttt = wins_ttt + 1 WHERE id = ?', [p1Socket.user.id]);
        } else if (p1Socket?.user) {
          db.run('UPDATE users SET losses_ttt = losses_ttt + 1 WHERE id = ?', [p1Socket.user.id]);
        }

        if (p2Socket?.user && result.winner === game.player2) {
          db.run('UPDATE users SET wins_ttt = wins_ttt + 1 WHERE id = ?', [p2Socket.user.id]);
        } else if (p2Socket?.user) {
          db.run('UPDATE users SET losses_ttt = losses_ttt + 1 WHERE id = ?', [p2Socket.user.id]);
        }
      } else {
        // Draw updates (optional, skipping for now to keep simple)
      }

      setTimeout(() => {
        activeGames.delete(roomId);
      }, 5000);
    }
  });

  // Handle RPS choices
  socket.on('rps-make-choice', ({ roomId, choice }) => {
    const game = activeGames.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    const result = game.makeChoice(socket.id, choice);

    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    if (result.waiting) {
      // Only notify the player who made the choice
      socket.emit('choice-made', { message: 'Waiting for opponent...' });
    } else if (result.roundComplete) {
      // Both players have chosen, broadcast result
      io.to(roomId).emit('round-result', {
        roundWinner: result.roundWinner,
        choices: result.choices,
        scores: result.scores,
        currentRound: result.currentRound,
        gameOver: result.gameOver,
        winner: result.winner
      });

      // Clean up finished games
      if (result.gameOver) {
        const p1Socket = io.sockets.sockets.get(game.player1);
        const p2Socket = io.sockets.sockets.get(game.player2);

        if (result.winner) {
          if (p1Socket?.user && result.winner === game.player1) {
            db.run('UPDATE users SET wins_rps = wins_rps + 1 WHERE id = ?', [p1Socket.user.id]);
          } else if (p1Socket?.user) {
            db.run('UPDATE users SET losses_rps = losses_rps + 1 WHERE id = ?', [p1Socket.user.id]);
          }

          if (p2Socket?.user && result.winner === game.player2) {
            db.run('UPDATE users SET wins_rps = wins_rps + 1 WHERE id = ?', [p2Socket.user.id]);
          } else if (p2Socket?.user) {
            db.run('UPDATE users SET losses_rps = losses_rps + 1 WHERE id = ?', [p2Socket.user.id]);
          }
        }

        setTimeout(() => {
          activeGames.delete(roomId);
        }, 5000);
      }
    }
  });

  // Handle Ludo dice roll
  socket.on('ludo-roll-dice', ({ roomId }) => {
    console.log(`[LUDO] Dice roll requested by ${socket.id} for room ${roomId}`);
    const game = activeGames.get(roomId);

    if (!game) {
      console.log(`[LUDO] Game not found for room ${roomId}`);
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    console.log(`[LUDO] Game found. Type: ${game.type || 'LudoGame'}, Current player: ${game.players?.[game.currentTurn]}`);

    const result = game.rollDice();

    if (result.error) {
      console.log(`[LUDO] Dice roll error: ${result.error}`);
      socket.emit('error', { message: result.error });
      return;
    }

    console.log(`[LUDO] Dice rolled: ${result.diceValue}`);

    console.log(`[LUDO] Dice rolled: ${result.diceValue}`);

    const validMoves = game.getValidMoves(socket.id);

    // Broadcast dice roll to all players
    io.to(roomId).emit('ludo-dice-rolled', {
      diceValue: result.diceValue,
      currentPlayer: result.currentPlayer,
      validMoves: validMoves
    });

    // If no valid moves, auto-skip turn after delay
    if (validMoves.length === 0) {
      console.log(`[LUDO] No valid moves for ${socket.id}, skipping turn...`);
      setTimeout(() => {
        game.skipTurn();
        const gameState = game.getState();

        io.to(roomId).emit('ludo-piece-moved', {
          tokens: gameState.tokens,
          currentTurn: gameState.currentTurn,
          nextPlayer: gameState.currentPlayer,
          gameOver: false,
          skipped: true
        });

        processAITurn(io, roomId, game);
      }, 1500);
    }
  });

  // Handle Ludo piece movement
  socket.on('ludo-move-piece', ({ roomId, pieceIndex }) => {
    const game = activeGames.get(roomId);

    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    const result = game.movePiece(socket.id, pieceIndex);

    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Broadcast move to all players
    io.to(roomId).emit('ludo-piece-moved', {
      tokens: result.tokens,
      captured: result.captured,
      currentTurn: result.currentTurn,
      nextPlayer: result.nextPlayer,
      gameOver: result.gameOver,
      winner: result.winner
    });

    if (!result.gameOver) {
      processAITurn(io, roomId, game);
    }

    // Clean up finished games
    if (result.gameOver) {
      setTimeout(() => {
        activeGames.delete(roomId);
      }, 5000);
    }
  });

  // Handle game reset
  socket.on('reset-game', ({ roomId }) => {
    const game = activeGames.get(roomId);

    if (game) {
      game.reset();
      io.to(roomId).emit('game-reset', {
        board: game.board,
        currentPlayer: game.currentPlayer
      });
    }
  });

  // Handle leave game
  socket.on('leave-game', ({ roomId }) => {
    socket.leave(roomId);
    socket.to(roomId).emit('opponent-left');

    // Clean up game
    activeGames.delete(roomId);
    console.log(`Player left game: ${roomId}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    // Remove from matchmaking queue
    matchmakingManager.removeFromQueue(socket.id);

    // Notify opponents in active games
    activeGames.forEach((game, roomId) => {
      if (game.player1 === socket.id || game.player2 === socket.id) {
        socket.to(roomId).emit('opponent-disconnected');
        activeGames.delete(roomId);
      }
    });
  });

  // WebRTC voice chat signaling
  socket.on('voice-signal', ({ roomId, signal }) => {
    // Relay WebRTC signal to the other player in the room
    socket.to(roomId).emit('voice-signal', { signal });
  });

  // Cancel matchmaking
  socket.on('cancel-matchmaking', () => {
    matchmakingManager.removeFromQueue(socket.id);
    socket.emit('matchmaking-cancelled');
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🎮 boredGames server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready - Redeploy Triggered`);
});
