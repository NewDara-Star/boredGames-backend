export class LudoGame {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players;
        this.currentTurn = 0;
        this.diceValue = null;
        this.gameState = 'waiting';

        // Game Constants
        this.COLORS = ['red', 'blue', 'yellow', 'green'];

        // Map Player Index (0-3) to Board Constants
        this.TURNING_POINTS = { 0: 50, 1: 11, 2: 24, 3: 37 };
        this.START_POSITIONS = { 0: 0, 1: 13, 2: 26, 3: 39 };

        // Home Stretch: 100s, 200s, 300s, 400s
        this.HOME_ENTRANCE = {
            0: [100, 101, 102, 103, 104, 105],
            1: [200, 201, 202, 203, 204, 205],
            2: [300, 301, 302, 303, 304, 305],
            3: [400, 401, 402, 403, 404, 405]
        };

        // Base Positions: 500s, 600s, 700s, 800s
        this.BASE_POSITIONS = {
            0: [500, 501, 502, 503],
            1: [600, 601, 602, 603],
            2: [700, 701, 702, 703],
            3: [800, 801, 802, 803]
        };

        this.SAFE_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47];

        // Initialize Tokens
        this.tokens = {};
        players.forEach((playerId, index) => {
            this.tokens[playerId] = {
                color: this.COLORS[index],
                playerIndex: index,
                pieces: [0, 1, 2, 3].map(id => ({
                    id,
                    position: this.BASE_POSITIONS[index][id],
                    finished: false
                }))
            };
        });
    }

    rollDice() {
        if (this.gameState !== 'waiting') return { error: 'Not your turn' };

        this.diceValue = Math.floor(Math.random() * 6) + 1;
        this.gameState = 'moving';

        return {
            diceValue: this.diceValue,
            currentPlayer: this.players[this.currentTurn]
        };
    }

    getValidMoves(playerId) {
        const playerTokens = this.tokens[playerId];
        const pIndex = playerTokens.playerIndex;
        const validMoves = [];

        playerTokens.pieces.forEach((piece, index) => {
            if (piece.finished) return;

            // In Base
            if (piece.position >= 500) {
                if (this.diceValue === 6) validMoves.push(index);
            }
            // On Board
            else {
                const potentialPos = this.simulateMove(pIndex, piece.position, this.diceValue);
                if (potentialPos !== null) validMoves.push(index);
            }
        });

        return validMoves;
    }

    simulateMove(pIndex, currentPos, steps) {
        let pos = currentPos;
        for (let i = 0; i < steps; i++) {
            pos = this.getNextPosition(pIndex, pos);
            if (pos === null) return null; // Overshot finish
        }
        return pos;
    }

    getNextPosition(pIndex, currentPos) {
        // If in home stretch
        if (currentPos >= 100 && currentPos < 500) {
            const home = this.HOME_ENTRANCE[pIndex];
            const idx = home.indexOf(currentPos);
            if (idx === -1) return null; // Should not happen
            if (idx === 5) return null; // Already at finish
            return home[idx + 1];
        }

        // If at turning point
        if (currentPos === this.TURNING_POINTS[pIndex]) {
            return this.HOME_ENTRANCE[pIndex][0];
        }

        // Standard track move
        if (currentPos === 51) return 0;
        return currentPos + 1;
    }

    movePiece(playerId, pieceIndex) {
        if (this.players[this.currentTurn] !== playerId) return { error: 'Not your turn' };

        const playerTokens = this.tokens[playerId];
        const pIndex = playerTokens.playerIndex;
        const piece = playerTokens.pieces[pieceIndex];

        if (!piece) return { error: 'Invalid piece' };

        let captured = null;

        // Move Logic
        if (piece.position >= 500) {
            // Move out of base
            if (this.diceValue === 6) {
                piece.position = this.START_POSITIONS[pIndex];
                // Check capture at start
                captured = this.checkCapture(playerId, piece.position);
            } else {
                return { error: 'Need 6 to start' };
            }
        } else {
            // Move on board
            const newPos = this.simulateMove(pIndex, piece.position, this.diceValue);
            if (newPos === null) return { error: 'Invalid move' };

            piece.position = newPos;

            // Check Finish
            const home = this.HOME_ENTRANCE[pIndex];
            if (piece.position === home[5]) {
                piece.finished = true;
            }

            // Check Capture (only on main track 0-51)
            if (piece.position <= 51) {
                captured = this.checkCapture(playerId, piece.position);
            }
        }

        // Check Win
        const winner = this.checkWinner(playerId);
        if (winner) {
            this.gameState = 'finished';
            return {
                success: true,
                tokens: this.tokens,
                captured,
                winner: playerId,
                gameOver: true
            };
        }

        // Turn Logic
        const bonusTurn = this.diceValue === 6 || captured || piece.finished;

        if (!bonusTurn) {
            this.currentTurn = (this.currentTurn + 1) % this.players.length;
        }

        this.gameState = 'waiting';
        this.diceValue = null;

        return {
            success: true,
            tokens: this.tokens,
            captured,
            currentTurn: this.currentTurn,
            nextPlayer: this.players[this.currentTurn],
            gameOver: false
        };
    }

    checkCapture(playerId, position) {
        if (this.SAFE_POSITIONS.includes(position)) return null;

        for (const [opponentId, opponentTokens] of Object.entries(this.tokens)) {
            if (opponentId === playerId) continue;

            for (const piece of opponentTokens.pieces) {
                if (piece.position === position) {
                    // Capture! Send back to base
                    piece.position = this.BASE_POSITIONS[opponentTokens.playerIndex][piece.id];
                    return {
                        playerId: opponentId,
                        color: opponentTokens.color
                    };
                }
            }
        }
        return null;
    }

    skipTurn() {
        this.currentTurn = (this.currentTurn + 1) % this.players.length;
        this.gameState = 'waiting';
        this.diceValue = null;
        return {
            currentTurn: this.currentTurn,
            nextPlayer: this.players[this.currentTurn]
        };
    }

    checkWinner(playerId) {
        return this.tokens[playerId].pieces.every(p => p.finished);
    }

    getState() {
        return {
            roomId: this.roomId,
            players: this.players,
            tokens: this.tokens,
            currentTurn: this.currentTurn,
            currentPlayer: this.players[this.currentTurn],
            diceValue: this.diceValue,
            gameState: this.gameState
        };
    }
}
