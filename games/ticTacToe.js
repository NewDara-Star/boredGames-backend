const WIN_CONDITIONS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]              // Diagonals
];

export class TicTacToeGame {
    constructor(roomId, player1Id, player2Id) {
        this.roomId = roomId;
        this.player1 = player1Id;
        this.player2 = player2Id;
        this.board = Array(9).fill('');
        this.currentPlayer = player1Id; // Player 1 (X) goes first
        this.gameOver = false;
        this.winner = null;
    }

    makeMove(playerId, position) {
        // Validate move
        if (this.gameOver) {
            return { error: 'Game is already over' };
        }

        if (playerId !== this.currentPlayer) {
            return { error: 'Not your turn' };
        }

        if (position < 0 || position > 8) {
            return { error: 'Invalid position' };
        }

        if (this.board[position] !== '') {
            return { error: 'Position already taken' };
        }

        // Make move
        const symbol = playerId === this.player1 ? 'X' : 'O';
        this.board[position] = symbol;

        // Check for win
        const winResult = this.checkWin();
        if (winResult.hasWinner) {
            this.gameOver = true;
            this.winner = playerId;
            return {
                success: true,
                gameOver: true,
                winner: playerId,
                winningLine: winResult.line
            };
        }

        // Check for draw
        if (this.board.every(cell => cell !== '')) {
            this.gameOver = true;
            return {
                success: true,
                gameOver: true,
                winner: null // Draw
            };
        }

        // Switch player
        this.currentPlayer = this.currentPlayer === this.player1 ? this.player2 : this.player1;

        return {
            success: true,
            gameOver: false
        };
    }

    checkWin() {
        for (const condition of WIN_CONDITIONS) {
            const [a, b, c] = condition;
            if (
                this.board[a] &&
                this.board[a] === this.board[b] &&
                this.board[a] === this.board[c]
            ) {
                return {
                    hasWinner: true,
                    line: condition
                };
            }
        }
        return { hasWinner: false };
    }

    reset() {
        this.board = Array(9).fill('');
        this.currentPlayer = this.player1;
        this.gameOver = false;
        this.winner = null;
    }

    getState() {
        return {
            board: this.board,
            currentPlayer: this.currentPlayer,
            gameOver: this.gameOver,
            winner: this.winner
        };
    }
}
